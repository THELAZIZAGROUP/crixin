/**
 * POST /api/auth/start — kick off magic-link sign-in / sign-up.
 *
 * Body: { email: string }
 *
 * Hybrid flow:
 *   1. Validate email + rate-limit per IP.
 *   2. Ask Firebase Identity Toolkit to mint a sign-in-with-email-link URL
 *      (`returnOobLink=true` — Firebase does NOT send its own email; we get
 *      the URL back). Single-use + 1-hour expiry are enforced by Firebase.
 *   3. Touch (or create) `crixin_users/<uid>` with our app-side metadata
 *      (plan, lastSignInRequestedAt). Firebase Auth itself owns the
 *      identity; this collection is just our app-specific user profile.
 *   4. Send the link via Resend with the themed magic-link template.
 *
 * Always responds 200 with `{ ok: true }` regardless of whether the email
 * exists — we don't leak account-existence to drive-by submitters.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { writeDoc, readDoc } from "../_lib/firestore.js";
import { sendEmail, templates } from "../_lib/email.js";
import { rateLimit, clientIp } from "../_lib/ratelimit.js";
import { generateSignInWithEmailLink } from "../_lib/firebase-identity.js";
import { deriveUserId, isValidEmail } from "../_lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }
  const ipKey = clientIp(req);
  if (!rateLimit(`auth:start:${ipKey}`, 5, 15 * 60 * 1000)) {
    return res.status(429).json({ error: "too many requests; try again in a few minutes" });
  }

  const body = (req.body ?? {}) as { email?: string };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "invalid email" });
  }

  const siteUrl = process.env["PUBLIC_SITE_URL"] ?? "https://crixin.com";
  const continueUrl = `${siteUrl}/auth/callback`;

  // 1. Detect new vs returning so the email subject/copy is honest.
  const uid = deriveUserId(email);
  const existing = await readDoc(`crixin_users/${uid}`).catch(() => null);
  const isNewUser = !existing;

  // 2. Ask Firebase to mint the link. Don't await on Firestore writes — we
  //    only need them to settle in the background.
  let oobLink: string;
  try {
    const result = await generateSignInWithEmailLink({ email, continueUrl });
    oobLink = result.oobLink;
  } catch (err) {
    console.error("generateSignInWithEmailLink failed:", err);
    // Don't reveal infra errors. Always 200 to avoid account-existence leaks.
    return res.status(200).json({ ok: true });
  }

  // 3. Touch our app-side user doc. Firebase Auth owns the identity record;
  //    this is purely the plan / preferences mirror.
  writeDoc(
    `crixin_users/${uid}`,
    isNewUser
      ? {
          uid,
          email,
          createdAt: new Date(),
          lastSignInRequestedAt: new Date(),
          plan: "free",
        }
      : {
          email,
          lastSignInRequestedAt: new Date(),
        },
    { merge: true },
  ).catch(() => {});

  // 4. Send the email. Fire-and-forget so a Resend hiccup doesn't reveal
  //    whether the address exists. Errors are logged for debugging.
  const t = templates.magicLink({
    url: oobLink,
    expiresInMinutes: 60, // Firebase's default sign-in-link TTL
    isNewUser,
  });
  sendEmail({ to: email, ...t }).catch((err) => {
    console.error("magic-link send failed:", err);
  });

  return res.status(200).json({ ok: true });
}
