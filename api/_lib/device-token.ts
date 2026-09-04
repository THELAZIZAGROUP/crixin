/**
 * Device tokens for Crixin Sync.
 *
 * Mint: `mintDeviceToken({ uid, device_id })` — called by /api/sync/link after
 * the user approves a device from the browser (cookie-authenticated).
 *
 * Verify: `verifyDeviceToken(authHeader)` — called by every other sync
 * endpoint to authenticate the CLI. Token is HMAC-signed with the same
 * AUTH_SESSION_SECRET that signs the session cookie, but uses a distinct
 * `kind` claim so a stolen session cookie can't be replayed as a device token
 * (and vice versa).
 *
 * Revocation: the corresponding Firestore device doc (`crixin_sync_devices/<device_id>`)
 * must exist. push/pull endpoints check both signature AND Firestore presence,
 * so deleting the doc revokes the token without needing rotation.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";

const TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;  // 90 days

export interface DeviceTokenPayload {
  /** App user id (sha256(email)[:24]) — same as session cookie uid. */
  uid: string;
  /** Stable device id (32 hex from CLI). */
  device_id: string;
  /** Token kind — guards against cross-token replay. */
  kind: "crixin_device";
  iat: number;
  exp: number;
}

export function mintDeviceToken(args: { uid: string; device_id: string }): string {
  const secret = sessionSecret();
  const now = Math.floor(Date.now() / 1000);
  const payload: DeviceTokenPayload = {
    uid: args.uid,
    device_id: args.device_id,
    kind: "crixin_device",
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "CRIXIN_DEV" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyDeviceToken(token: string | undefined): DeviceTokenPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];

  const expected = createHmac("sha256", sessionSecret())
    .update(`${header}.${body}`)
    .digest();
  let provided: Buffer;
  try { provided = Buffer.from(sig, "base64url"); } catch { return null; }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let payload: DeviceTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as DeviceTokenPayload;
  } catch { return null; }

  if (payload.kind !== "crixin_device") return null;
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (typeof payload.uid !== "string" || payload.uid.length < 16) return null;
  if (typeof payload.device_id !== "string" || payload.device_id.length < 16) return null;
  return payload;
}

/** Pull a bearer device token off the Authorization header. */
export function readDeviceTokenFromRequest(req: VercelRequest): DeviceTokenPayload | null {
  const raw = req.headers["authorization"];
  if (typeof raw !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  if (!m) return null;
  return verifyDeviceToken(m[1]!.trim());
}

function sessionSecret(): string {
  const s = process.env["AUTH_SESSION_SECRET"];
  if (!s || s.length < 32) throw new Error("AUTH_SESSION_SECRET missing or too short (>= 32 chars)");
  return s;
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}
