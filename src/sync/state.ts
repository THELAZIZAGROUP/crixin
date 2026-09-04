/**
 * Sync state file — persisted at ~/.crixin/sync.json.
 *
 * Holds the small amount of state the CLI needs between invocations:
 *   - device_id     stable 32-hex id minted on first run
 *   - device_token  HMAC-signed bearer token issued by the server after `sync link`
 *   - account_*     the email + uid this device is linked to
 *   - server        API base URL (default https://crixin.com; CRIXIN_SYNC_BASE overrides)
 *   - enabled       true after `sync enable`; gates push/pull
 *   - last_*        bookkeeping for incremental sync
 *
 * The token grants access to the user's sync namespace, so the file is written
 * with 0600 permissions. It lives next to `license.json` for the same reason.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { paths, ensureCrixinHome } from "../lib/paths.js";

export interface SyncState {
  device_id: string | null;
  device_token: string | null;
  device_name: string | null;
  account_email: string | null;
  account_uid: string | null;
  server: string;
  enabled: boolean;
  last_pushed_at: number | null;
  last_pulled_at: number | null;
  last_pull_cursor: number | null;
}

const DEFAULT_STATE: SyncState = {
  device_id: null,
  device_token: null,
  device_name: null,
  account_email: null,
  account_uid: null,
  server: "https://crixin.com",
  enabled: false,
  last_pushed_at: null,
  last_pulled_at: null,
  last_pull_cursor: null,
};

function statePath(): string {
  return join(paths.crixinHome, "sync.json");
}

export function readSyncState(): SyncState {
  const p = statePath();
  if (!existsSync(p)) return { ...DEFAULT_STATE, server: envServer() };
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      server: envServer() ?? parsed.server ?? DEFAULT_STATE.server,
    };
  } catch {
    return { ...DEFAULT_STATE, server: envServer() };
  }
}

export function writeSyncState(state: SyncState): void {
  ensureCrixinHome();
  const p = statePath();
  if (!existsSync(dirname(p))) mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2), "utf8");
  try { chmodSync(p, 0o600); } catch { /* best-effort on win32 */ }
}

export function patchSyncState(patch: Partial<SyncState>): SyncState {
  const next = { ...readSyncState(), ...patch };
  writeSyncState(next);
  return next;
}

function envServer(): string {
  const v = process.env["CRIXIN_SYNC_BASE"];
  return typeof v === "string" && v.length > 0 ? v : DEFAULT_STATE.server;
}

/** Redacted shape suitable for logs and `sync status`. */
export function redactedState(s: SyncState): SyncState & { device_token_present: boolean } {
  return {
    ...s,
    device_token: s.device_token ? `${s.device_token.slice(0, 12)}…` : null,
    device_token_present: !!s.device_token,
  };
}
