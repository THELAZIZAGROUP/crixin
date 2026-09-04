/**
 * Read-only queries against the sync tables. Powers `crixin sync status` and
 * `crixin sync inbox`. Kept separate from push/pull to avoid pulling DB-write
 * code into status-only paths.
 */
import { getDb } from "../db/init.js";

export interface OutboxStats {
  total: number;
  pending: number;        // pushed_at IS NULL
  pushed: number;         // pushed_at IS NOT NULL
  errored: number;        // push_error IS NOT NULL
  latest_queued_at: number | null;
  latest_pushed_at: number | null;
}

export interface InboxStats {
  total: number;
  latest_updated_at: number | null;
  distinct_devices: number;
  sources: Record<string, number>;
}

export function outboxStats(): OutboxStats {
  const db = getDb();
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN pushed_at IS NULL THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN pushed_at IS NOT NULL THEN 1 ELSE 0 END) AS pushed,
      SUM(CASE WHEN push_error IS NOT NULL THEN 1 ELSE 0 END) AS errored,
      MAX(queued_at) AS latest_queued_at,
      MAX(pushed_at) AS latest_pushed_at
    FROM sync_outbox
  `).get() as {
    total: number;
    pending: number | null;
    pushed: number | null;
    errored: number | null;
    latest_queued_at: number | null;
    latest_pushed_at: number | null;
  };
  return {
    total: counts.total ?? 0,
    pending: counts.pending ?? 0,
    pushed: counts.pushed ?? 0,
    errored: counts.errored ?? 0,
    latest_queued_at: counts.latest_queued_at,
    latest_pushed_at: counts.latest_pushed_at,
  };
}

export function inboxStats(): InboxStats {
  const db = getDb();
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      MAX(updated_at) AS latest_updated_at,
      COUNT(DISTINCT source_device_id) AS distinct_devices
    FROM sync_inbox
  `).get() as {
    total: number;
    latest_updated_at: number | null;
    distinct_devices: number | null;
  };
  const bySource = db.prepare(`
    SELECT source, COUNT(*) AS n FROM sync_inbox GROUP BY source
  `).all() as Array<{ source: string; n: number }>;
  const sources: Record<string, number> = {};
  for (const r of bySource) sources[r.source] = r.n;
  return {
    total: counts.total ?? 0,
    latest_updated_at: counts.latest_updated_at,
    distinct_devices: counts.distinct_devices ?? 0,
    sources,
  };
}

export interface InboxRow {
  record_id: string;
  source: string;
  source_device_id: string | null;
  project: string | null;
  started_at: number | null;
  ended_at: number | null;
  message_count: number | null;
  duration_seconds: number | null;
  cost_usd_cents: number | null;
  updated_at: number;
  pulled_at: number;
}

/**
 * Latest pulled records, newest first. Parses payload_json safely; rows whose
 * payload is missing or malformed are skipped (never surfaced as garbled).
 */
export function listInbox(limit = 10): InboxRow[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT record_id, source, source_device_id, payload_json, updated_at, pulled_at
      FROM sync_inbox
     ORDER BY updated_at DESC
     LIMIT ?
  `).all(Math.max(1, Math.min(limit, 200))) as Array<{
    record_id: string;
    source: string;
    source_device_id: string | null;
    payload_json: string;
    updated_at: number;
    pulled_at: number;
  }>;

  const out: InboxRow[] = [];
  for (const r of rows) {
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(r.payload_json) as Record<string, unknown>; }
    catch { continue; }
    out.push({
      record_id: r.record_id,
      source: r.source,
      source_device_id: r.source_device_id,
      project: typeof payload["project"] === "string" ? (payload["project"] as string) : null,
      started_at: typeof payload["started_at"] === "number" ? (payload["started_at"] as number) : null,
      ended_at: typeof payload["ended_at"] === "number" ? (payload["ended_at"] as number) : null,
      message_count: typeof payload["message_count"] === "number" ? (payload["message_count"] as number) : null,
      duration_seconds: typeof payload["duration_seconds"] === "number" ? (payload["duration_seconds"] as number) : null,
      cost_usd_cents: typeof payload["cost_usd_cents"] === "number" ? (payload["cost_usd_cents"] as number) : null,
      updated_at: r.updated_at,
      pulled_at: r.pulled_at,
    });
  }
  return out;
}
