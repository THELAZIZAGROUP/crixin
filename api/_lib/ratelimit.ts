/**
 * Per-IP token-bucket rate limiter for serverless endpoints.
 *
 * Lives in process memory. On Vercel Fluid Compute, function instances are
 * reused across concurrent requests, so a single instance protects against
 * single-source flooding. On scale-out, multiple instances each enforce the
 * limit independently — total throughput is `limit × instances`, which is
 * fine for our threat model (a stranger flooding /api/checkout, not a
 * coordinated DDoS — we lean on Vercel's edge for that).
 */

import type { VercelRequest } from "@vercel/node";

const buckets = new Map<string, { count: number; resetAt: number }>();

/** Returns true if the request is allowed. False = over the limit. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

/** Best-effort client IP — Vercel always sets x-forwarded-for. */
export function clientIp(req: VercelRequest): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0]!.trim();
  if (Array.isArray(xff) && xff[0]) return xff[0].split(",")[0]!.trim();
  return req.socket?.remoteAddress ?? "unknown";
}
