/**
 * GET /api/auth/me — return the current session (or 401).
 *
 * Returns:
 *   200 → { uid, email, plan, createdAt }
 *   401 → { error: "not signed in" }
 *
 * Verifies the cookie locally (HMAC-SHA256). Optionally enriches with the
 * Firestore user record so the UI can show plan + createdAt without a
 * second client-side request.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readSessionFromRequest } from "../_lib/auth.js";
import { readDoc } from "../_lib/firestore.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "method not allowed" });
  }
  const session = readSessionFromRequest(req);
  if (!session) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(401).json({ error: "not signed in" });
  }

  // Best-effort enrichment. If Firestore is unreachable we still confirm the
  // session — better to be partially informative than 500 the user out.
  let plan: string | null = null;
  let createdAt: string | null = null;
  try {
    const user = await readDoc(`crixin_users/${session.uid}`);
    if (user) {
      plan = typeof user["plan"] === "string" ? user["plan"] : null;
      createdAt = user["createdAt"] instanceof Date
        ? user["createdAt"].toISOString()
        : null;
    }
  } catch {
    // swallow — caller still gets uid + email below
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    uid: session.uid,
    email: session.email,
    plan,
    createdAt,
  });
}
