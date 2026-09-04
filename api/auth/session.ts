/**
 * POST /api/auth/session — exchange a Firebase ID token for our HttpOnly
 * session cookie.
 *
 * Body: { idToken: string }
 *
 * Flow:
 *   1. Frontend `/auth/callback` validates the magic-link click via Firebase
 *      JS SDK's `signInWithEmailLink`. That gives us a Firebase ID token
 *      (RS256, signed by Google).
 *   2. Frontend POSTs the ID token here.
 *   3. We verify the JWT against Google's JWKS (project / iss / aud / exp).
 *   4. Touch `crixin_users/<uid>` with lastSignInAt.
 *   5. Mint an HttpOnly + SameSite=Lax + (Secure in prod) session cookie
 *      keyed off the verified email + uid. Stateless — no Firestore lookup
 *      per request.
 *
 * Why not skip our cookie and just keep the Firebase ID token client-side?
 *   - Firebase tokens expire in 1 hour; we'd have to refresh constantly.
 *   - Firebase ID tokens live in localStorage by default (XSS-readable).
 *   - HttpOnly cookies are CSRF-protected by SameSite=Lax + the JWT signature.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { rateLimit, clientIp } from "../_lib/ratelimit.js";
import { verifyFirebaseIdToken } from "../_lib/firebase-identity.js";
import { writeDoc } from "../_lib/firestore.js";
import { mintSessionCookie, setSessionCookie, deriveUserId } from "../_lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }
  const ipKey = clientIp(req);
  if (!rateLimit(`auth:session:${ipKey}`, 30, 60 * 1000)) {
    return res.status(429).json({ error: "too many session attempts; slow down" });
  }

  const body = (req.body ?? {}) as { idToken?: string };
  const idToken = typeof body.idToken === "string" ? body.idToken : "";
  if (!idToken) {
    return res.status(400).json({ error: "missing idToken" });
  }

  let claims;
  try {
    claims = await verifyFirebaseIdToken(idToken);
  } catch (err) {
    return res.status(401).json({
      error: "invalid id token",
      detail: err instanceof Error ? err.message : "unknown",
    });
  }

  const email = (claims.email ?? "").trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: "id token missing email" });
  }

  // We use OUR derived uid (sha256(email)) as the canonical app-side user
  // identifier so it stays stable across Firebase Auth account deletes/recreates.
  // Firebase's user_id is also recorded for reference.
  const uid = deriveUserId(email);

  writeDoc(
    `crixin_users/${uid}`,
    {
      uid,
      firebaseUid: claims.user_id,
      email,
      lastSignInAt: new Date(),
      lastSignInIp: ipKey,
    },
    { merge: true },
  ).catch(() => {});

  const cookie = mintSessionCookie({ uid, email });
  setSessionCookie(res, cookie);

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, uid, email });
}
