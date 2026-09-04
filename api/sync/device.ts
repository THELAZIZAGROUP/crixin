/**
 * GET  /api/sync/device — list all devices linked to this user's account.
 * POST /api/sync/device — touch this device's last_seen_at heartbeat.
 *
 * Auth: device-token bearer.
 *
 * The browser dashboard will eventually use this to render a device list with
 * remove buttons. For v1 the CLI uses GET to populate `crixin sync devices`.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { rateLimit, clientIp } from "../_lib/ratelimit.js";
import { readDeviceTokenFromRequest } from "../_lib/device-token.js";
import { listDocs, readDoc, writeDoc } from "../_lib/firestore.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ipKey = clientIp(req);
  if (!rateLimit(`sync:device:${ipKey}`, 60, 60 * 1000)) {
    return res.status(429).json({ error: "rate limited" });
  }

  const tok = readDeviceTokenFromRequest(req);
  if (!tok) return res.status(401).json({ error: "missing or invalid device token" });

  // Revocation check: the doc must still exist.
  const myDoc = await readDoc(`crixin_sync_devices/${tok.device_id}`).catch(() => null);
  if (!myDoc || myDoc["uid"] !== tok.uid) {
    return res.status(403).json({ error: "device revoked" });
  }

  if (req.method === "POST") {
    try {
      await writeDoc(`crixin_sync_devices/${tok.device_id}`, { last_seen_at: new Date() }, { merge: true });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: "heartbeat failed", detail: errorMsg(err) });
    }
  }

  if (req.method === "GET") {
    try {
      const { docs } = await listDocs({ collectionPath: "crixin_sync_devices", pageSize: 100 });
      const mine = docs
        .filter((d) => d.fields["uid"] === tok.uid)
        .map((d) => ({
          device_id: d.id,
          device_name: d.fields["device_name"] ?? null,
          hostname: d.fields["hostname"] ?? null,
          os: d.fields["os"] ?? null,
          created_at: dateToMs(d.fields["created_at"]),
          last_seen_at: dateToMs(d.fields["last_seen_at"]),
        }));
      return res.status(200).json({ ok: true, devices: mine });
    } catch (err) {
      return res.status(500).json({ error: "could not list devices", detail: errorMsg(err) });
    }
  }

  return res.status(405).json({ error: "method not allowed" });
}

function dateToMs(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}
function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : "unknown";
}
