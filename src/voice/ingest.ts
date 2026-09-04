/**
 * `crixin voice ingest` — pull recent Twilio call records into the local
 * SQLite so the wrapped/archetype/ducked engines have something to chew on.
 *
 * Strategy:
 *   1. Page through GET /Calls.json since the most-recent `started_at` we have
 *      (or the last 90 days on first run).
 *   2. UPSERT each call row into voice_calls.
 *   3. For each call with a recording, fetch the recording metadata and
 *      mirror it into voice_recordings.
 *   4. If DEEPGRAM_API_KEY is set, transcribe any recording we don't yet have
 *      a transcript for. Skip silently when missing — transcription is the
 *      only cost-bearing step here, so it stays opt-in.
 *
 * Designed to be idempotent: re-running mirrors any new calls but doesn't
 * re-transcribe rows that already have transcript_text.
 */
import { getDb } from "../db/init.js";
import { log } from "../lib/log.js";
import { loadEnv } from "./env.js";
import { TwilioClient, TwilioApiError } from "./twilio/client.js";
import { listCalls, listRecordingsForCall } from "./twilio/calls.js";
import type { CallRecording } from "./twilio/calls.js";
import { transcribeRecording } from "./twilio/transcribe.js";

interface IngestOpts {
  /** Max calls to walk this run (defaults to 250). */
  limit?: number;
  /** Override since-window (in days) — default 90, or "since last seen" if we have rows. */
  sinceDays?: number;
  /** Skip Deepgram transcription even if DEEPGRAM_API_KEY is set. */
  skipTranscribe?: boolean;
  /** Re-transcribe rows that already have transcripts (forces a refresh). */
  reTranscribe?: boolean;
}

interface IngestResult {
  calls: { upserted: number; total: number };
  recordings: { upserted: number };
  transcripts: { added: number; skipped: number; failed: number };
}

export async function runVoiceIngest(opts: IngestOpts = {}): Promise<IngestResult> {
  const env = loadEnv();
  const client = new TwilioClient(env);
  const db = getDb();

  // Compute the lookback window
  const lastSeen = db
    .prepare(`SELECT MAX(started_at) AS maxStarted FROM voice_calls`)
    .get() as { maxStarted: number | null } | undefined;
  const days = opts.sinceDays ?? (lastSeen?.maxStarted ? 1 : 90);
  const sinceMs = lastSeen?.maxStarted
    ? Math.max(lastSeen.maxStarted - 86400000, Date.now() - 86400000 * days)
    : Date.now() - 86400000 * days;
  const sinceIso = new Date(sinceMs).toISOString();

  log.info(
    `Pulling Twilio calls since ${sinceIso}` +
      (lastSeen?.maxStarted
        ? ` (catching up from last sync at ${new Date(lastSeen.maxStarted).toISOString()})`
        : ""),
  );

  let calls;
  try {
    calls = await listCalls(client, {
      startTimeAfter: sinceIso,
      pageSize: Math.min(opts.limit ?? 250, 1000),
    });
  } catch (caught) {
    if (caught instanceof TwilioApiError) {
      log.error(caught.message);
      if (caught.twilioCode === 20003 || caught.status === 401) {
        log.hint("Run `crixin voice doctor` to diagnose.");
      }
      throw caught;
    }
    throw caught;
  }

  log.info(`Twilio returned ${calls.length} call${calls.length === 1 ? "" : "s"}.`);

  const upsertCall = db.prepare(`
    INSERT INTO voice_calls (
      sid, account_sid, direction, from_number, to_number, status,
      started_at, ended_at, duration_seconds, price_cents, price_unit,
      recording_count, transcript_text, transcript_language,
      transcript_confidence, campaign, outcome, fetched_at, pinned
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, 0
    )
    ON CONFLICT(sid) DO UPDATE SET
      status            = excluded.status,
      ended_at          = excluded.ended_at,
      duration_seconds  = excluded.duration_seconds,
      price_cents       = excluded.price_cents,
      price_unit        = excluded.price_unit,
      recording_count   = excluded.recording_count,
      fetched_at        = excluded.fetched_at
  `);

  const upsertRecording = db.prepare(`
    INSERT INTO voice_recordings (
      sid, call_sid, duration_seconds, status, media_url,
      transcript_text, transcript_language, transcript_confidence, fetched_at
    ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
    ON CONFLICT(sid) DO UPDATE SET
      duration_seconds = excluded.duration_seconds,
      status           = excluded.status,
      media_url        = excluded.media_url,
      fetched_at       = excluded.fetched_at
  `);

  const updateRecordingTranscript = db.prepare(`
    UPDATE voice_recordings
       SET transcript_text       = ?,
           transcript_language   = ?,
           transcript_confidence = ?
     WHERE sid = ?
  `);

  const rollupCallTranscript = db.prepare(`
    UPDATE voice_calls
       SET transcript_text       = (SELECT GROUP_CONCAT(transcript_text, ' ') FROM voice_recordings WHERE call_sid = ? AND transcript_text IS NOT NULL),
           transcript_language   = (SELECT transcript_language FROM voice_recordings WHERE call_sid = ? AND transcript_language IS NOT NULL LIMIT 1),
           transcript_confidence = (SELECT AVG(transcript_confidence) FROM voice_recordings WHERE call_sid = ? AND transcript_confidence IS NOT NULL)
     WHERE sid = ?
  `);

  const result: IngestResult = {
    calls: { upserted: 0, total: calls.length },
    recordings: { upserted: 0 },
    transcripts: { added: 0, skipped: 0, failed: 0 },
  };

  const fetchedAt = Date.now();
  const wantTranscribe = !opts.skipTranscribe && Boolean(env.deepgramApiKey);

  for (const c of calls) {
    const startedMs = c.start_time ? Date.parse(c.start_time) : null;
    const endedMs = c.end_time ? Date.parse(c.end_time) : null;
    const duration = c.duration ? parseInt(c.duration, 10) || 0 : 0;
    const priceCents = priceToCents(c.price);

    // First pass: insert with recording_count = 0 so we have the row even if
    // recording lookup fails.
    upsertCall.run(
      c.sid,
      null, // account_sid not on the basic call object
      c.direction ?? null,
      c.from ?? null,
      c.to ?? null,
      c.status ?? null,
      startedMs,
      endedMs,
      duration,
      priceCents,
      c.price_unit ?? null,
      0,
      fetchedAt,
    );
    result.calls.upserted += 1;

    // Pull recordings (best-effort — calls without recordings are common)
    let recordings: CallRecording[] = [];
    try {
      recordings = await listRecordingsForCall(client, c.sid);
    } catch {
      recordings = [];
    }
    if (recordings.length > 0) {
      // Update the call's recording_count
      db.prepare(`UPDATE voice_calls SET recording_count = ? WHERE sid = ?`).run(
        recordings.length,
        c.sid,
      );
      for (const r of recordings) {
        upsertRecording.run(
          r.sid,
          c.sid,
          parseInt(r.duration, 10) || 0,
          r.status,
          r.media_url,
          fetchedAt,
        );
        result.recordings.upserted += 1;

        // Optional Deepgram transcribe pass
        if (wantTranscribe) {
          const existing = db
            .prepare(`SELECT transcript_text FROM voice_recordings WHERE sid = ?`)
            .get(r.sid) as { transcript_text: string | null } | undefined;
          if (existing?.transcript_text && !opts.reTranscribe) {
            result.transcripts.skipped += 1;
            continue;
          }
          try {
            const t = await transcribeRecording(client, { recordingSid: r.sid });
            updateRecordingTranscript.run(
              t.transcript,
              t.language,
              t.confidence,
              r.sid,
            );
            result.transcripts.added += 1;
          } catch (err) {
            result.transcripts.failed += 1;
            log.warn(
              `Transcription failed for ${r.sid}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
      // Roll up per-recording transcripts onto the call row
      rollupCallTranscript.run(c.sid, c.sid, c.sid, c.sid);
    }
  }

  log.success(
    `Mirrored ${result.calls.upserted} call${result.calls.upserted === 1 ? "" : "s"}, ${result.recordings.upserted} recording${result.recordings.upserted === 1 ? "" : "s"}.`,
  );
  if (wantTranscribe) {
    log.info(
      `Transcripts: ${result.transcripts.added} added · ${result.transcripts.skipped} cached · ${result.transcripts.failed} failed`,
    );
  } else if (env.deepgramApiKey === undefined) {
    log.hint(
      "DEEPGRAM_API_KEY not set — transcripts skipped. Wrapped + Archetype need transcripts to be useful.",
    );
  }

  return result;
}

/** Twilio's `price` is a negative-string (e.g. "-0.0140"). Convert to positive cents. */
function priceToCents(raw: string | null | undefined): number {
  if (!raw) return 0;
  const f = parseFloat(raw);
  if (!Number.isFinite(f)) return 0;
  return Math.round(Math.abs(f) * 100);
}
