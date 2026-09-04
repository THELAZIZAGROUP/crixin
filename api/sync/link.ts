/**
 * POST /api/sync/link — approve a CLI device for the signed-in user and mint
 * a device token.
 *
 * Body: { device_id, device_name?, hostname?, os? }
 *
 * Auth: requires the magic-link session cookie (not a device token — this is
 * the only endpoint that bootstraps one).
 *
 * Flow:
 *   1. User runs `crixin sync link` → CLI generates a random device_id and
 *      opens crixin.com/sync/link?device_id=…&device_name=… in a browser.
 *   2. /sync/link page calls /api/auth/me. If not signed in, it redirects to
 *      /login then back here.
 *   3. User clicks "Approve this device." Browser POSTs here.
 *   4. We create the Firestore device doc, mint the bearer token, return it.
 *   5. The page shows the token in a copyable box with instructions to paste
 *      it into `crixin sync link --token <…>`.
 *
 * Why this dance instead of an OAuth-style loopback?
 *   Loopback servers in a CLI are flaky on shared machines / restrictive
 *   networks, and crixin's surface area is too small to justify the
 *   complexity. The paste-the-token UX matches `crixin license activate`.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readSessionFromRequest } from "../_lib/auth.js";
import { rateLimit, clientIp } from "../_lib/ratelimit.js";
import { writeDoc } from "../_lib/firestore.js";
import { mintDeviceToken } from "../_lib/device-token.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }
  const ipKey = clientIp(req);
  if (!rateLimit(`sync:link:${ipKey}`, 20, 60 * 1000)) {
    return res.status(429).json({ error: "too many link attempts; slow down" });
  }

  const session = readSessionFromRequest(req);
  if (!session) {
    return res.status(401).json({ error: "not signed in" });
  }

  const body = (req.body ?? {}) as {
    device_id?: unknown;
    device_name?: unknown;
    hostname?: unknown;
    os?: unknown;
  };
  const device_id = typeof body.device_id === "string" ? body.device_id.trim() : "";
  if (!/^[0-9a-f]{16,64}$/.test(device_id)) {
    return res.status(400).json({ error: "invalid device_id (expected 16-64 hex chars)" });
  }
  const device_name = typeof body.device_name === "string"
    ? body.device_name.trim().slice(0, 80)
    : null;
  const hostname = typeof body.hostname === "string" ? body.hostname.trim().slice(0, 120) : null;
  const os = typeof body.os === "string" && /^[a-z0-9_-]{1,16}$/i.test(body.os) ? body.os : null;

  try {
    await writeDoc(`crixin_sync_devices/${device_id}`, {
      device_id,
      uid: session.uid,
      email: session.email,
      device_name,
      hostname,
      os,
      created_at: new Date(),
      last_seen_at: new Date(),
    }, { merge: true });
  } catch (err) {
    return res.status(500).json({
      error: "could not register device",
      detail: err instanceof Error ? err.message : "unknown",
    });
  }

  const token = mintDeviceToken({ uid: session.uid, device_id });

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    device_id,
    device_token: token,
    account: { uid: session.uid, email: session.email },
  });
}
