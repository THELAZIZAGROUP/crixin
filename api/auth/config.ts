/**
 * GET /api/auth/config — returns the public Firebase config the /auth/callback
 * page needs to initialize the JS SDK.
 *
 * The API key is "public" in Firebase parlance (visible to all clients) and
 * is restricted by Authorized Domains in the Firebase console. We still
 * route it through this endpoint instead of hard-coding it in static HTML so
 * the value can be rotated via Vercel env without a redeploy.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const apiKey = process.env["FIREBASE_WEB_API_KEY"];
  const projectId = process.env["FIREBASE_PROJECT_ID"];
  if (!apiKey || !projectId) {
    return res.status(500).json({ error: "auth not configured" });
  }
  // 5-minute browser cache. Rotation latency = cache TTL.
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json({
    apiKey,
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
  });
}
