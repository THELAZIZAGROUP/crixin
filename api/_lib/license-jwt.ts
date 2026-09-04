/**
 * Server-side: mint Ed25519-signed JWTs for the Stripe webhook.
 *
 * Required env var:
 *   LICENSE_PRIV_KEY_B64 — raw 32-byte Ed25519 private key, base64-encoded.
 *
 * Token format matches `src/license/jwt.ts` in the npm package — header has
 * alg=EdDSA, payload has {sub, email, tier, iat, exp}.
 */

import { createPrivateKey, sign } from "node:crypto";

export interface MintArgs {
  /** Stripe customer id — becomes the JWT `sub`. */
  sub: string;
  email?: string;
  /** "pro" for monthly subscriptions, "lifetime" for one-time $99. */
  tier: "pro" | "lifetime";
  /** Token expiry. Pro: 30 days past current period end. Lifetime: 100 years. */
  expSec: number;
}

let cachedKey: ReturnType<typeof createPrivateKey> | null = null;

function getPrivateKey() {
  if (cachedKey) return cachedKey;
  const b64 = process.env["LICENSE_PRIV_KEY_B64"];
  if (!b64) throw new Error("LICENSE_PRIV_KEY_B64 not configured on this Vercel project");
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) throw new Error(`Expected 32-byte raw Ed25519 key, got ${raw.length}`);
  // Wrap raw 32 bytes in PKCS8 DER for createPrivateKey.
  const pkcs8Prefix = Buffer.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b,
    0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);
  const der = Buffer.concat([pkcs8Prefix, raw]);
  cachedKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return cachedKey;
}

export function mintLicenseJwt(args: MintArgs): string {
  const header = { alg: "EdDSA", typ: "JWT" };
  const payload = {
    sub: args.sub,
    email: args.email,
    tier: args.tier,
    iat: Math.floor(Date.now() / 1000),
    exp: args.expSec,
  };
  const b64u = (s: string) =>
    Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const h = b64u(JSON.stringify(header));
  const p = b64u(JSON.stringify(payload));
  const signingInput = Buffer.from(`${h}.${p}`, "utf8");
  const sig = sign(null, signingInput, getPrivateKey());
  const s = sig.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${h}.${p}.${s}`;
}
