/**
 * HTTP client for the sync server. Thin wrapper over fetch with:
 *   - Authorization: Bearer <device_token>
 *   - JSON body encoding
 *   - typed errors
 *   - server base from sync.json (CRIXIN_SYNC_BASE env wins for tests/dev)
 *
 * Nothing here knows about extraction or persistence. Push/pull modules call
 * these and own the state-machine bookkeeping themselves.
 */
import { readSyncState } from "./state.js";

export class SyncAuthError extends Error {
  constructor(msg: string, readonly status: number) { super(msg); }
}
export class SyncServerError extends Error {
  constructor(msg: string, readonly status: number, readonly detail?: unknown) { super(msg); }
}
export class SyncNetworkError extends Error {
  readonly originalCause?: unknown;
  constructor(msg: string, cause?: unknown) {
    super(msg);
    this.originalCause = cause;
  }
}

export interface SyncRequestOpts {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  /** Override the persisted device token (used by `sync link --token` before persistence). */
  token?: string;
  /** Override the server base (used by tests). */
  baseUrl?: string;
}

export interface SyncResponse<T> {
  ok: true;
  status: number;
  data: T;
  headers: Headers;
}

/**
 * Run a sync request. Throws SyncAuthError on 401/403, SyncServerError on
 * other 4xx/5xx, SyncNetworkError on transport failures.
 */
export async function syncRequest<T = unknown>(opts: SyncRequestOpts): Promise<SyncResponse<T>> {
  const state = readSyncState();
  const baseUrl = opts.baseUrl ?? state.server;
  const token = opts.token ?? state.device_token;

  if (!token && requiresAuth(opts.path)) {
    throw new SyncAuthError("no device token — run `crixin sync link` first", 401);
  }

  const url = new URL(opts.path, baseUrl).toString();
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "User-Agent": `crixin-sync (${process.platform})`,
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (cause) {
    throw new SyncNetworkError(
      `sync request to ${url} failed: ${cause instanceof Error ? cause.message : "unknown"}`,
      cause,
    );
  }

  let data: unknown = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try { data = await res.json(); } catch { data = null; }
  } else {
    try { data = await res.text(); } catch { data = null; }
  }

  if (res.status === 401 || res.status === 403) {
    throw new SyncAuthError(extractMessage(data) ?? `auth failed (${res.status})`, res.status);
  }
  if (!res.ok) {
    throw new SyncServerError(extractMessage(data) ?? `sync ${res.status}`, res.status, data);
  }

  return { ok: true, status: res.status, data: data as T, headers: res.headers };
}

function requiresAuth(path: string): boolean {
  // `link` is the only endpoint that mints a token, so it tolerates absence.
  return !path.startsWith("/api/sync/link");
}

function extractMessage(data: unknown): string | null {
  if (data && typeof data === "object" && "error" in data) {
    const e = (data as { error?: unknown }).error;
    if (typeof e === "string") return e;
  }
  return null;
}
