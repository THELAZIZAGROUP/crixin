/**
 * GET /api/share/:token — F14
 * Serves a previously-uploaded Wrapped report.
 * Anyone with the URL can view it (the URL itself is the cap-secret); we
 * just check the doc exists, isn't revoked, and isn't expired.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { readDoc } from "../_lib/firestore.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).send("method not allowed");
  const token = req.query["token"];
  if (typeof token !== "string" || !/^[A-Za-z0-9]{16,40}$/.test(token)) {
    return res.status(400).send("invalid token");
  }

  const doc = await readDoc(`crixin_shares/${token}`);
  if (!doc) return notFound(res);
  if (doc.revoked === true) return notFound(res);
  const exp = doc.expiresAt && doc.expiresAt.toDate ? doc.expiresAt.toDate().getTime() : (typeof doc.expiresAt === "number" ? doc.expiresAt : null);
  if (exp && exp < Date.now()) return notFound(res);
  if (typeof doc.html !== "string") return notFound(res);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(200).send(doc.html);
}

function notFound(res: VercelResponse) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.status(404).send(
    `<!doctype html><html><head><meta charset="utf-8"><title>Not found</title>
<style>body{background:#0b0d12;color:#9097a8;font-family:Inter,sans-serif;text-align:center;padding:80px 20px;}h1{color:#f7768e;}</style></head>
<body><h1>404</h1><p>This share link is gone — expired, revoked, or never existed.</p>
<p style="color:#5b6075;font-size:13px;">— <a href="https://crixin.com" style="color:#7aa2f7;">crixin.com</a></p></body></html>`
  );
}
