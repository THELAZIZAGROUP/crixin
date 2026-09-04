/**
 * Tiny Ed25519 JWT verifier — `jsonwebtoken` is overkill and adds 4 transitive
 * deps. This 60-line file does the one thing we need: verify EdDSA-signed
 * JWTs against the public key shipped in `keys.ts`.
 *
 * JWT shape we expect:
 *   header  : {"alg":"EdDSA","typ":"JWT"}
 *   payload : {"sub":<stripe_customer_id>,"email":"…","tier":"pro"|"lifetime",
 *              "iat":<sec>,"exp":<sec>}
 *   sig     : Ed25519 signature over `<header_b64>.<payload_b64>`
 */

import { createPublicKey, verify } from "node:crypto";
import { LICENSE_PUBLIC_KEY_RAW_B64 } from "./keys.js";

export interface LicenseClaims {
  sub: string;
  email?: string;
  tier: "pro" | "lifetime";
  iat: number;
  exp: number;
}

let cachedPubKey: ReturnType<typeof createPublicKey> | null = null;

function getPubKey() {
  if (cachedPubKey) return cachedPubKey;
  // Wrap the raw 32 bytes in DER (PKIX SPKI) for `createPublicKey`.
  const raw = Buffer.from(LICENSE_PUBLIC_KEY_RAW_B64, "base64");
  // SPKI prefix for Ed25519 — 12 bytes that identify the curve, then key.
  const spkiPrefix = Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);
  const der = Buffer.concat([spkiPrefix, raw]);
  cachedPubKey = createPublicKey({ key: der, format: "der", type: "spki" });
  return cachedPubKey;
}

/** Returns claims if the JWT verifies against our embedded public key, else null. */
export function verifyLicenseJwt(token: string): LicenseClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  if (!h || !p || !s) return null;
  let header: { alg?: string; typ?: string };
  let payload: LicenseClaims;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "EdDSA") return null;

  const signingInput = Buffer.from(`${h}.${p}`, "utf8");
  const signature = Buffer.from(s, "base64url");
  let ok = false;
  try {
    ok = verify(null, signingInput, getPubKey(), signature);
  } catch {
    ok = false;
  }
  if (!ok) return null;

  // Time checks.
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < nowSec) return null;
  if (typeof payload.iat === "number" && payload.iat > nowSec + 60) return null;
  if (payload.tier !== "pro" && payload.tier !== "lifetime") return null;

  return payload;
}
