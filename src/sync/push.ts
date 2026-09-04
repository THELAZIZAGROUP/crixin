/**
 * `crixin sync push` — extract new metadata records and send them up.
 *
 * Flow:
 *   1. Verify state: linked, enabled, has token.
 *   2. Extract records from sessions + voice_calls via the metadata extractor.
 *   3. Queue them in sync_outbox (idempotent by record_id; updates content_hash
 *      and payload if changed, but only if content_hash differs).
 *   4. Batch and POST to /api/sync/push.
 *   5. Mark each accepted record's pushed_at; record errors on rejected ones.
 *
 * v1: only one extraction pass per push. No diff against server state — we
 * trust the server's "latest updated_at wins" dedupe. This means the first
 * push from a fresh device is the most expensive one; subsequent pushes only
 * carry rows whose content_hash drifted (e.g., ingest added more messages).
 */
import { getDb } from "../db/init.js";
import { log } from "../lib/log.js";
import { readSyncState, patchSyncState } from "./state.js";
import { ensureThisDevice } from "./device.js";
import { extractSyncRecords, type SyncRecord } from "./metadata.js";
import { syncRequest, SyncAuthError, SyncNetworkError } from "./client.js";

const BATCH_SIZE = 250;

interface PushOpts {
  limit?: number;
  dryRun?: boolean;
}

export interface PushSummary {
  extracted: number;
  queued: number;
  pushed: number;
  rejected: number;
  unchanged: number;
}

export async function runSyncPush(opts: PushOpts = {}): Promise<PushSummary> {
  const state = readSyncState();
  if (!state.account_uid || !state.device_id || !state.device_token) {
    throw new Error("not linked — run `crixin sync link` first");
  }
  if (!state.enabled) {
    throw new Error("sync is disabled — run `crixin sync enable` first");
  }

  const device = ensureThisDevice();
  const records = extractSyncRecords({
    uid: state.account_uid,
    device_id: device.device_id,
    limit: opts.limit,
  });

  const summary: PushSummary = { extracted: records.length, queued: 0, pushed: 0, rejected: 0, unchanged: 0 };
  if (records.length === 0) return summary;

  const toSend = upsertOutbox(records);
  summary.queued = toSend.length;
  summary.unchanged = records.length - toSend.length;

  if (opts.dryRun) return summary;

  for (let i = 0; i < toSend.length; i += BATCH_SIZE) {
    const batch = toSend.slice(i, i + BATCH_SIZE);
    try {
      const r = await syncRequest<{ accepted: number; rejected: number; rejections?: Array<{ record_id: string; reason: string }> }>({
        method: "POST",
        path: "/api/sync/push",
        body: { records: batch },
      });
      summary.pushed += r.data.accepted ?? 0;
      summary.rejected += r.data.rejected ?? 0;
      markPushed(batch, r.data.rejections ?? []);
    } catch (err) {
      if (err instanceof SyncAuthError) throw err;
      if (err instanceof SyncNetworkError) throw err;
      log.warn(`batch ${i / BATCH_SIZE + 1} failed: ${(err as Error).message}`);
      summary.rejected += batch.length;
      markBatchError(batch, (err as Error).message);
    }
  }

  patchSyncState({ last_pushed_at: Date.now() });
  return summary;
}

/**
 * Insert each record into sync_outbox if missing, or update payload/content_hash
 * if the content_hash changed. Returns the set of records that need pushing.
 */
function upsertOutbox(records: SyncRecord[]): SyncRecord[] {
  const db = getDb();
  const existing = new Map<string, { content_hash: string; pushed_at: number | null }>();
  const ids = records.map((r) => r.record_id);

  // Read existing in chunks (SQLite parameter limit ~999).
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const placeholders = chunk.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT record_id, content_hash, pushed_at FROM sync_outbox WHERE record_id IN (${placeholders})`,
    ).all(...chunk) as Array<{ record_id: string; content_hash: string; pushed_at: number | null }>;
    for (const r of rows) existing.set(r.record_id, { content_hash: r.content_hash, pushed_at: r.pushed_at });
  }

  const insert = db.prepare(`
    INSERT INTO sync_outbox (record_id, source, local_id, content_hash, payload_json, queued_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(record_id) DO UPDATE SET
      source       = excluded.source,
      local_id     = excluded.local_id,
      content_hash = excluded.content_hash,
      payload_json = excluded.payload_json,
      queued_at    = excluded.queued_at,
      pushed_at    = NULL,
      push_error   = NULL
  `);

  const toSend: SyncRecord[] = [];
  const now = Date.now();
  for (const r of records) {
    const prev = existing.get(r.record_id);
    if (prev && prev.content_hash === r.content_hash && prev.pushed_at !== null) {
      continue;  // already up-to-date on the server
    }
    insert.run(r.record_id, r.source, r.local_id, r.content_hash, JSON.stringify(r), now);
    toSend.push(r);
  }
  return toSend;
}

function markPushed(batch: SyncRecord[], rejections: Array<{ record_id: string; reason: string }>): void {
  const db = getDb();
  const rejected = new Map(rejections.map((r) => [r.record_id, r.reason]));
  const okStmt = db.prepare(`UPDATE sync_outbox SET pushed_at = ?, push_error = NULL WHERE record_id = ?`);
  const errStmt = db.prepare(`UPDATE sync_outbox SET pushed_at = NULL, push_error = ? WHERE record_id = ?`);
  const now = Date.now();
  for (const r of batch) {
    const why = rejected.get(r.record_id);
    if (why) errStmt.run(why.slice(0, 200), r.record_id);
    else okStmt.run(now, r.record_id);
  }
}

function markBatchError(batch: SyncRecord[], message: string): void {
  const db = getDb();
  const stmt = db.prepare(`UPDATE sync_outbox SET pushed_at = NULL, push_error = ? WHERE record_id = ?`);
  const msg = message.slice(0, 200);
  for (const r of batch) stmt.run(msg, r.record_id);
}
