/**
 * GET /api/sync/pull — fetch metadata records for the signed-in user.
 *
 * Query:
 *   since   unix ms; only return records with updated_at > since
 *   limit   max records to return (default 200, cap 500)
 *
 * Auth: device-token bearer.
 *
 * v1 listDocuments-then-filter approach. For most users (under ~5k records)
 * this is fine. Phase 2 swaps to a Firestore structured query with the right
 * composite index.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { rateLimit, clientIp } from "../_lib/ratelimit.js";
import { readDeviceTokenFromRequest } from "../_lib/device-token.js";
import { listDocs, readDoc } from "../_lib/firestore.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "method not allowed" });
  }
  const ipKey = clientIp(req);
  if (!rateLimit(`sync:pull:${ipKey}`, 60, 60 * 1000)) {
    return res.status(429).json({ error: "rate limited" });
  }

  const tok = readDeviceTokenFromRequest(req);
  if (!tok) return res.status(401).json({ error: "missing or invalid device token" });

  const myDoc = await readDoc(`crixin_sync_devices/${tok.device_id}`).catch(() => null);
  if (!myDoc || myDoc["uid"] !== tok.uid) {
    return res.status(403).json({ error: "device revoked" });
  }

  const since = numberQuery(req, "since") ?? 0;
  const limit = clamp(numberQuery(req, "limit") ?? 200, 1, 500);

  // v1: paginate listDocuments until we have enough records OR run out.
  // Limits us to roughly 5k records-per-user before the request gets slow;
  // that's fine for the audience this ships to.
  const mine: Record<string, unknown>[] = [];
  let pageToken: string | null = null;
  let pagesScanned = 0;
  const maxPages = 20;  // 20 × 100 = 2000 records scanned before we cut off

  try {
    do {
      const page = await listDocs({
        collectionPath: "crixin_sync_records",
        pageSize: 100,
        pageToken: pageToken ?? undefined,
      });
      for (const d of page.docs) {
        if (d.fields["uid"] !== tok.uid) continue;
        const ua = typeof d.fields["updated_at"] === "number" ? (d.fields["updated_at"] as number) : 0;
        if (ua > since) mine.push(d.fields);
        if (mine.length >= limit) break;
      }
      pageToken = page.nextPageToken;
      pagesScanned++;
      if (mine.length >= limit) break;
    } while (pageToken && pagesScanned < maxPages);
  } catch (err) {
    return res.status(500).json({ error: "pull failed", detail: errorMsg(err) });
  }

  // Order ASC so the client can advance its cursor monotonically.
  mine.sort((a, b) => Number(a["updated_at"] ?? 0) - Number(b["updated_at"] ?? 0));

  const cursor = mine.length > 0 ? Number(mine[mine.length - 1]!["updated_at"]) : since;
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    records: mine,
    cursor,
    truncated: !!pageToken && mine.length < limit,
  });
}

function numberQuery(req: VercelRequest, key: string): number | null {
  const v = req.query[key];
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : "unknown";
}
