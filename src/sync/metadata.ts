/**
 * Metadata extractor — the privacy floor of Crixin Sync.
 *
 * Everything that leaves the user's machine flows through this file. The hard
 * rule: NEVER read message bodies or transcripts. The DB queries here only
 * touch `sessions` and `voice_calls`, and only the allowlisted columns. The
 * `messages`, `tool_uses`, and `voice_recordings` tables are not referenced.
 *
 * If a new column is added upstream that contains free-text user content, it
 * must NOT appear here without an explicit privacy review. The TypeScript
 * `SyncRecord` shape is the contract — server-side push.ts rejects anything
 * outside it.
 */
import { createHash } from "node:crypto";
import { getDb } from "../db/init.js";

/**
 * Typed metadata record. This is the EXACT shape sent over the wire and
 * persisted in sync_outbox.payload_json. Server's push.ts validates the same
 * shape and rejects unknown keys.
 */
export interface SyncRecord {
  record_id: string;        // sha256(uid + source + local_id)
  source: "claude-code" | "codex" | "cursor" | "sdk" | "voice";
  local_id: string;         // sessions.id or voice_calls.sid
  project: string | null;   // sessions.project; null for voice
  started_at: number | null;
  ended_at: number | null;
  message_count: number | null;     // sessions only
  prompt_tokens: number | null;     // sessions only
  output_tokens: number | null;     // sessions only
  cost_usd_cents: number | null;    // sessions: tokens × rate; voice: price_cents
  duration_seconds: number | null;  // voice only
  direction: "outbound-api" | "inbound" | "outbound-dial" | "outbound-reply" | null;  // voice only
  content_hash: string;     // sha256 over the load-bearing metadata fields
  device_id: string;        // origin device
  updated_at: number;       // unix ms; client side at extraction time
}

/** Whitelist of keys allowed in a SyncRecord — duplicated server-side. */
export const SYNC_RECORD_KEYS = [
  "record_id",
  "source",
  "local_id",
  "project",
  "started_at",
  "ended_at",
  "message_count",
  "prompt_tokens",
  "output_tokens",
  "cost_usd_cents",
  "duration_seconds",
  "direction",
  "content_hash",
  "device_id",
  "updated_at",
] as const;

const ALLOWED_SOURCES = new Set<string>(["claude-code", "codex", "cursor", "sdk", "voice"]);
const ALLOWED_DIRECTIONS = new Set<string>([
  "outbound-api",
  "inbound",
  "outbound-dial",
  "outbound-reply",
]);

export interface ExtractOpts {
  /** App user id from the session cookie (`uid` claim). Required — record_id depends on it. */
  uid: string;
  /** Device id producing these records. */
  device_id: string;
  /** Optional cap on rows. Useful for dry-runs. */
  limit?: number;
  /** Optional minimum updated_at — extract only rows changed since this ms. */
  since?: number;
}

/**
 * Read syncable rows from `sessions` + `voice_calls`. Returns typed records,
 * stripped of any raw content. Deterministic — same inputs produce identical
 * record_ids and content_hashes.
 *
 * NB: This function does NOT consult sync_outbox. The caller (push.ts) is
 * responsible for diffing against what we've already sent. Keeping extraction
 * pure makes it cheap to test.
 */
export function extractSyncRecords(opts: ExtractOpts): SyncRecord[] {
  const db = getDb();
  const out: SyncRecord[] = [];
  const limit = Math.max(0, Math.floor(opts.limit ?? 10_000));

  // -- sessions (coder side) --
  const sessRows = db.prepare(`
    SELECT id, source, project, started_at, ended_at, message_count,
           prompt_tokens, output_tokens, cost_usd_cents
      FROM sessions
     WHERE COALESCE(ended_at, started_at, 0) >= ?
     ORDER BY COALESCE(ended_at, started_at, 0) DESC
     LIMIT ?
  `).all(opts.since ?? 0, limit) as Array<{
    id: string;
    source: string;
    project: string | null;
    started_at: number | null;
    ended_at: number | null;
    message_count: number;
    prompt_tokens: number;
    output_tokens: number;
    cost_usd_cents: number;
  }>;

  for (const r of sessRows) {
    if (!ALLOWED_SOURCES.has(r.source)) continue;
    const content_hash = sha256Hex([
      r.source,
      r.id,
      String(r.ended_at ?? r.started_at ?? 0),
      String(r.message_count),
      String(r.prompt_tokens),
      String(r.output_tokens),
      String(r.cost_usd_cents),
    ].join("|"));
    out.push({
      record_id: deriveRecordId(opts.uid, r.source, r.id),
      source: r.source as SyncRecord["source"],
      local_id: r.id,
      project: r.project,
      started_at: r.started_at,
      ended_at: r.ended_at,
      message_count: r.message_count,
      prompt_tokens: r.prompt_tokens,
      output_tokens: r.output_tokens,
      cost_usd_cents: r.cost_usd_cents,
      duration_seconds: null,
      direction: null,
      content_hash,
      device_id: opts.device_id,
      updated_at: Date.now(),
    });
  }

  // -- voice_calls (voice side) -- METADATA ONLY.
  // Explicitly NOT selecting: transcript_text, transcript_language,
  // transcript_confidence, from_number, to_number, campaign, outcome.
  const voiceRows = db.prepare(`
    SELECT sid, direction, started_at, ended_at, duration_seconds, price_cents
      FROM voice_calls
     WHERE COALESCE(ended_at, started_at, 0) >= ?
     ORDER BY COALESCE(ended_at, started_at, 0) DESC
     LIMIT ?
  `).all(opts.since ?? 0, limit) as Array<{
    sid: string;
    direction: string | null;
    started_at: number | null;
    ended_at: number | null;
    duration_seconds: number;
    price_cents: number;
  }>;

  for (const r of voiceRows) {
    const direction = r.direction && ALLOWED_DIRECTIONS.has(r.direction)
      ? (r.direction as SyncRecord["direction"])
      : null;
    const content_hash = sha256Hex([
      "voice",
      r.sid,
      String(r.ended_at ?? r.started_at ?? 0),
      String(r.duration_seconds),
      String(r.price_cents),
    ].join("|"));
    out.push({
      record_id: deriveRecordId(opts.uid, "voice", r.sid),
      source: "voice",
      local_id: r.sid,
      project: null,
      started_at: r.started_at,
      ended_at: r.ended_at,
      message_count: null,
      prompt_tokens: null,
      output_tokens: null,
      cost_usd_cents: r.price_cents,
      duration_seconds: r.duration_seconds,
      direction,
      content_hash,
      device_id: opts.device_id,
      updated_at: Date.now(),
    });
  }

  return out;
}

/** Stable dedupe key — same uid+source+local_id always maps to the same record. */
export function deriveRecordId(uid: string, source: string, localId: string): string {
  return sha256Hex(`${uid}|${source}|${localId}`).slice(0, 32);
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Type-guard: returns true if `obj` is shaped like a SyncRecord and contains
 * NO keys outside the allowlist. Used server-side to reject unknown fields.
 */
export function isValidSyncRecord(obj: unknown): obj is SyncRecord {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!SYNC_RECORD_KEYS.includes(k as (typeof SYNC_RECORD_KEYS)[number])) return false;
  }
  if (typeof o["record_id"] !== "string" || (o["record_id"] as string).length < 16) return false;
  if (typeof o["source"] !== "string" || !ALLOWED_SOURCES.has(o["source"])) return false;
  if (typeof o["local_id"] !== "string" || (o["local_id"] as string).length === 0) return false;
  if (typeof o["content_hash"] !== "string" || (o["content_hash"] as string).length < 16) return false;
  if (typeof o["device_id"] !== "string" || (o["device_id"] as string).length < 8) return false;
  if (typeof o["updated_at"] !== "number") return false;
  // Permissive on nullable numerics — we trust the typed extractor that built this.
  return true;
}
