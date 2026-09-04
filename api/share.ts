/**
 * POST /api/share — F14
 *
 * Accepts a Pro user's Wrapped HTML and stores it in Firestore at
 * `crixin_shares/<token>`, then serves it at GET /api/share/:token.
 *
 * Auth: caller passes their license JWT in `Authorization: Bearer <jwt>`.
 * We verify with the same Ed25519 public key the npm package uses (so a
 * leaked Free user's account can't upload — only valid Pro license holders).
 *
 * Body shape (JSON):
 *   { token: string,        // 32-char base32; matches the local token
 *     scope: "wrapped",
 *     year: number,
 *     html: string,         // self-contained Wrapped HTML
 *     ttlDays?: number      // default 30
 *   }
 *
 * Caps: HTML must be < 1.5 MB (Firestore single-doc limit is 1 MiB; we
 * compress + base64 if needed).
 *
 * Required env:
 *   LICENSE_PUBLIC_KEY_RAW_B64  (mirror of the npm package's embedded key)
 *   FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY  (Firestore)
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { writeDoc } from "./_lib/firestore.js";
import { rateLimit, clientIp } from "./_lib/ratelimit.js";

interface ShareBody {
  token?: string;
  scope?: string;
  year?: number;
  html?: string;
  ttlDays?: number;
}

interface LicenseClaims {
  sub: string;
  email?: string;
  tier: "pro" | "lifetime";
  iat: number;
  exp: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  if (!rateLimit(`share:${clientIp(req)}`, 30, 60_000)) {
    return res.status(429).json({ error: "rate limit — try again in a minute" });
  }

  // 1. Verify license JWT
  const auth = req.headers["authorization"];
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing license token" });
  }
  const jwt = auth.slice(7).trim();
  const claims = verifyJwt(jwt);
  if (!claims) return res.status(401).json({ error: "license token invalid or expired" });
  if (claims.tier !== "pro" && claims.tier !== "lifetime") {
    return res.status(403).json({ error: "Pro tier required" });
  }

  // 2. Validate body
  const body = (req.body ?? {}) as ShareBody;
  if (typeof body.token !== "string" || !/^[A-Za-z0-9]{16,40}$/.test(body.token)) {
    return res.status(400).json({ error: "token must be 16–40 alphanumeric chars" });
  }
  if (typeof body.html !== "string" || body.html.length === 0) {
    return res.status(400).json({ error: "html required" });
  }
  if (body.html.length > 1_500_000) {
    return res.status(413).json({ error: "html too large (max 1.5 MB)" });
  }
  if (body.scope !== "wrapped") {
    return res.status(400).json({ error: "scope must be 'wrapped'" });
  }
  if (typeof body.year !== "number" || body.year < 2000 || body.year > 2100) {
    return res.status(400).json({ error: "valid year required" });
  }

  const ttlDays = Math.min(Math.max(body.ttlDays ?? 30, 1), 365);
  const expiresAt = Date.now() + ttlDays * 86400000;

  // 3. Persist to Firestore — html stored as a string field; size cap above
  // keeps us comfortably under the 1MiB single-doc limit.
  await writeDoc(
    `crixin_shares/${body.token}`,
    {
      token: body.token,
      scope: body.scope,
      year: body.year,
      html: body.html,
      ownerSub: claims.sub,
      ownerEmail: claims.email ?? null,
      createdAt: new Date(),
      expiresAt: new Date(expiresAt),
      revoked: false,
    },
    { merge: true },
  );

  const siteUrl = process.env["PUBLIC_SITE_URL"] ?? "https://crixin.com";
  return res.status(200).json({
    ok: true,
    token: body.token,
    url: `${siteUrl}/api/share/${body.token}`,
    expiresAt,
  });
}

// ---------------------------------------------------------------------------
// Inline Ed25519 JWT verification (same algorithm as src/license/jwt.ts in the
// npm package). Done locally instead of importing from src/ so the Vercel
// function bundle stays tight.
// ---------------------------------------------------------------------------
function verifyJwt(token: string): LicenseClaims | null {
  const pubB64 = process.env["LICENSE_PUBLIC_KEY_RAW_B64"];
  if (!pubB64) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  if (!h || !p || !s) return null;
  let header: { alg?: string };
  let payload: LicenseClaims;
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "EdDSA") return null;

  const raw = Buffer.from(pubB64, "base64");
  const spkiPrefix = Buffer.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);
  const der = Buffer.concat([spkiPrefix, raw]);
  const pubKey = createPublicKey({ key: der, format: "der", type: "spki" });

  const ok = cryptoVerify(
    null,
    Buffer.from(`${h}.${p}`, "utf8"),
    pubKey,
    Buffer.from(s, "base64url"),
  );
  if (!ok) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < nowSec) return null;
  return payload;
}
