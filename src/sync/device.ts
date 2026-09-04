/**
 * Device identity — minted once per machine, persisted to sync.json AND
 * mirrored into the local sync_devices table so `crixin sync devices` and
 * `crixin sync status` can answer offline.
 */
import { hostname, platform } from "node:os";
import { randomBytes } from "node:crypto";
import { getDb } from "../db/init.js";
import { readSyncState, writeSyncState, patchSyncState } from "./state.js";

export interface DeviceInfo {
  device_id: string;
  device_name: string;
  hostname: string;
  os: string;
  created_at: number;
}

/**
 * Return this device's stable info, minting it on first call. Idempotent.
 *
 * The device_id is just a 32-hex random — it carries no PII. We map it to a
 * user account on the server side once `sync link` completes.
 */
export function ensureThisDevice(): DeviceInfo {
  const state = readSyncState();
  const hn = hostname() || "unknown-host";
  const os = platform();
  const now = Date.now();

  let device_id = state.device_id;
  let device_name = state.device_name;

  if (!device_id) {
    device_id = randomBytes(16).toString("hex");
    device_name = hn;
    patchSyncState({ device_id, device_name });
  } else if (!device_name) {
    device_name = hn;
    patchSyncState({ device_name });
  }

  upsertLocalDeviceRow({
    device_id,
    device_name: device_name ?? hn,
    hostname: hn,
    os,
    created_at: now,
  });

  return { device_id, device_name: device_name ?? hn, hostname: hn, os, created_at: now };
}

/** Mirror our own device row into sync_devices. */
function upsertLocalDeviceRow(d: DeviceInfo): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO sync_devices (device_id, device_name, hostname, os, created_at, last_seen_at, is_this_device)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(device_id) DO UPDATE SET
      device_name    = excluded.device_name,
      hostname       = excluded.hostname,
      os             = excluded.os,
      last_seen_at   = excluded.last_seen_at,
      is_this_device = 1
  `);
  stmt.run(d.device_id, d.device_name, d.hostname, d.os, d.created_at, Date.now());
}

/** Upsert a remote device row (from a sync pull / device list response). */
export function upsertRemoteDevice(d: {
  device_id: string;
  device_name?: string | null;
  hostname?: string | null;
  os?: string | null;
  created_at?: number | null;
  last_seen_at?: number | null;
}): void {
  const db = getDb();
  const local = readSyncState();
  const isThis = local.device_id === d.device_id ? 1 : 0;
  const stmt = db.prepare(`
    INSERT INTO sync_devices (device_id, device_name, hostname, os, created_at, last_seen_at, is_this_device)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      device_name  = excluded.device_name,
      hostname     = excluded.hostname,
      os           = excluded.os,
      last_seen_at = excluded.last_seen_at
  `);
  stmt.run(
    d.device_id,
    d.device_name ?? null,
    d.hostname ?? null,
    d.os ?? null,
    d.created_at ?? Date.now(),
    d.last_seen_at ?? null,
    isThis,
  );
}

export interface ListedDevice {
  device_id: string;
  device_name: string | null;
  hostname: string | null;
  os: string | null;
  created_at: number;
  last_seen_at: number | null;
  is_this_device: boolean;
}

export function listLocalDevices(): ListedDevice[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT device_id, device_name, hostname, os, created_at, last_seen_at, is_this_device
      FROM sync_devices
     ORDER BY is_this_device DESC, COALESCE(last_seen_at, created_at) DESC
  `).all() as Array<{
    device_id: string;
    device_name: string | null;
    hostname: string | null;
    os: string | null;
    created_at: number;
    last_seen_at: number | null;
    is_this_device: number;
  }>;
  return rows.map((r) => ({ ...r, is_this_device: r.is_this_device === 1 }));
}

/** Clear the local device row — used when `crixin sync disable --forget` runs. */
export function forgetThisDevice(): void {
  const state = readSyncState();
  if (!state.device_id) return;
  const db = getDb();
  db.prepare(`DELETE FROM sync_devices WHERE device_id = ?`).run(state.device_id);
  writeSyncState({
    ...state,
    device_id: null,
    device_token: null,
    device_name: null,
    account_email: null,
    account_uid: null,
    enabled: false,
    last_pushed_at: null,
    last_pulled_at: null,
    last_pull_cursor: null,
  });
}
