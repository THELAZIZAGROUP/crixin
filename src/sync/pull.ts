/**
 * `crixin sync pull` — fetch metadata from peers and stash in sync_inbox.
 *
 * v1 pull pages until the server says it's done or we reach `--limit` records.
 * The cursor is the largest `updated_at` we've seen; persisted to sync.json.
 * Records authored by this device are filtered out — we don't want to
 * shadow-load our own rows back into the inbox.
 */
import { getDb } from "../db/init.js";
import { log } from "../lib/log.js";
import { readSyncState, patchSyncState } from "./state.js";
import { upsertRemoteDevice } from "./device.js";
import { syncRequest, SyncAuthError, SyncNetworkError } from "./client.js";

export interface PullSummary {
  fetched: number;
  inserted: number;
  unchanged: number;
  truncated: boolean;
  new_cursor: number;
}

interface PullOpts {
  limit?: number;
  /** Override the cursor for one-off resyncs (`crixin sync pull --since 0`). */
  since?: number;
}

export async function runSyncPull(opts: PullOpts = {}): Promise<PullSummary> {
  const state = readSyncState();
  if (!state.account_uid || !state.device_id || !state.device_token) {
    throw new Error("not linked — run `crixin sync link` first");
  }
  if (!state.enabled) {
    throw new Error("sync is disabled — run `crixin sync enable` first");
  }

  const limit = Math.max(1, Math.min(opts.limit ?? 500, 2500));
  let cursor = opts.since ?? state.last_pull_cursor ?? 0;
  let truncated = false;

  const summary: PullSummary = {
    fetched: 0, inserted: 0, unchanged: 0, truncated: false, new_cursor: cursor,
  };

  while (summary.fetched < limit) {
    let page: {
      records?: Array<Record<string, unknown>>;
      cursor?: number;
      truncated?: boolean;
    };
    try {
      const r = await syncRequest<typeof page>({
        method: "GET",
        path: `/api/sync/pull?since=${cursor}&limit=${Math.min(500, limit - summary.fetched)}`,
      });
      page = r.data;
    } catch (err) {
      if (err instanceof SyncAuthError) throw err;
      if (err instanceof SyncNetworkError) throw err;
      log.warn(`pull failed: ${(err as Error).message}`);
      break;
    }
    const records = Array.isArray(page.records) ? page.records : [];
    if (records.length === 0) break;

    const { inserted, unchanged } = upsertInbox(records, state.device_id ?? "");
    summary.fetched += records.length;
    summary.inserted += inserted;
    summary.unchanged += unchanged;
    cursor = typeof page.cursor === "number" ? page.cursor : cursor;
    truncated = !!page.truncated;
    if (!truncated) break;
  }

  summary.new_cursor = cursor;
  summary.truncated = truncated;
  patchSyncState({ last_pulled_at: Date.now(), last_pull_cursor: cursor });
  return summary;
}

function upsertInbox(records: Array<Record<string, unknown>>, thisDeviceId: string): { inserted: number; unchanged: number } {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO sync_inbox (record_id, source, source_device_id, payload_json, updated_at, pulled_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(record_id) DO UPDATE SET
      source_device_id = excluded.source_device_id,
      payload_json     = excluded.payload_json,
      updated_at       = excluded.updated_at,
      pulled_at        = excluded.pulled_at
    WHERE excluded.updated_at >= sync_inbox.updated_at
  `);

  let inserted = 0;
  let unchanged = 0;
  const now = Date.now();
  for (const r of records) {
    const record_id = typeof r["record_id"] === "string" ? (r["record_id"] as string) : null;
    const source = typeof r["source"] === "string" ? (r["source"] as string) : null;
    const device_id = typeof r["device_id"] === "string" ? (r["device_id"] as string) : null;
    const updated_at = typeof r["updated_at"] === "number" ? (r["updated_at"] as number) : null;
    if (!record_id || !source || updated_at === null) {
      unchanged++;
      continue;
    }
    if (device_id && device_id === thisDeviceId) {
      // Don't re-import our own records into the inbox.
      unchanged++;
      continue;
    }
    const result = stmt.run(record_id, source, device_id, JSON.stringify(r), updated_at, now);
    if ((result.changes ?? 0) > 0) inserted++;
    else unchanged++;

    // Opportunistically mirror the remote device.
    if (device_id) upsertRemoteDevice({ device_id, last_seen_at: updated_at });
  }
  return { inserted, unchanged };
}
