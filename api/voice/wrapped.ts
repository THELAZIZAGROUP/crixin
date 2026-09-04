/**
 * GET /api/voice/wrapped — return the signed-in user's latest Voice Wrapped
 * snapshot from Firestore (or 404 if none exists yet).
 *
 * POST /api/voice/wrapped — upload a Voice Wrapped snapshot. The request body
 * is the same shape as `WrappedStats` from src/voice/analyze.ts (the CLI
 * computes it locally; this endpoint persists it for the hosted /account page).
 *
 * Both endpoints require a valid session cookie. Snapshots are keyed off the
 * session's `uid` so users only ever see their own data.
 *
 * Storage: `crixin_voice_wrapped/{uid}` — single doc per user holding the
 * latest snapshot. Year-by-year history is left for a future v0.2.x.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { writeDoc, readDoc } from "../_lib/firestore.js";
import { readSessionFromRequest } from "../_lib/auth.js";

interface WrappedSnapshot {
  year: number;
  totalCalls: number;
  completedCalls?: number;
  totalMinutes: number;
  totalCostCents: number;
  uniqueDestinations?: number;
  busiestHour?: number | null;
  longestCallSeconds?: number | null;
  avgCallSeconds?: number | null;
  topDestinationCountries?: Array<{ country: string; count: number; minutes: number }>;
  topCampaigns?: Array<{ campaign: string; count: number; minutes: number }>;
  topOutcomes?: Array<{ outcome: string; count: number }>;
  topLanguages?: Array<{ language: string; count: number }>;
  callerArchetype?: string | null;
  duckRate?: number | null;
  transcribedCount?: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const session = readSessionFromRequest(req);
  if (!session) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(401).json({ error: "not signed in" });
  }
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const doc = await readDoc(`crixin_voice_wrapped/${session.uid}`).catch(() => null);
    if (!doc) {
      return res.status(404).json({ error: "no snapshot yet" });
    }
    return res.status(200).json(doc);
  }

  if (req.method === "POST") {
    const body = (req.body ?? {}) as Partial<WrappedSnapshot>;

    // Minimal validation — required keys, sane bounds
    if (typeof body.year !== "number" || body.year < 2000 || body.year > 2100) {
      return res.status(400).json({ error: "valid `year` required" });
    }
    if (typeof body.totalCalls !== "number" || body.totalCalls < 0) {
      return res.status(400).json({ error: "valid `totalCalls` required" });
    }
    if (typeof body.totalMinutes !== "number" || body.totalMinutes < 0) {
      return res.status(400).json({ error: "valid `totalMinutes` required" });
    }
    if (typeof body.totalCostCents !== "number" || body.totalCostCents < 0) {
      return res.status(400).json({ error: "valid `totalCostCents` required" });
    }

    // Cap the array sizes so a leaky CLI can't blow up Firestore single-doc limits.
    const cap = <T,>(arr: T[] | undefined, n: number): T[] => (arr ?? []).slice(0, n);
    const sanitized: Record<string, unknown> = {
      uid: session.uid,
      email: session.email,
      year: body.year,
      totalCalls: Math.floor(body.totalCalls),
      completedCalls: typeof body.completedCalls === "number" ? Math.floor(body.completedCalls) : 0,
      totalMinutes: Math.floor(body.totalMinutes),
      totalCostCents: Math.floor(body.totalCostCents),
      uniqueDestinations:
        typeof body.uniqueDestinations === "number" ? Math.floor(body.uniqueDestinations) : 0,
      busiestHour: typeof body.busiestHour === "number" ? Math.floor(body.busiestHour) : null,
      longestCallSeconds:
        typeof body.longestCallSeconds === "number" ? Math.floor(body.longestCallSeconds) : null,
      avgCallSeconds:
        typeof body.avgCallSeconds === "number" ? Math.floor(body.avgCallSeconds) : null,
      topDestinationCountries: cap(body.topDestinationCountries, 5),
      topCampaigns: cap(body.topCampaigns, 5),
      topOutcomes: cap(body.topOutcomes, 5),
      topLanguages: cap(body.topLanguages, 5),
      callerArchetype: typeof body.callerArchetype === "string" ? body.callerArchetype : null,
      duckRate: typeof body.duckRate === "number" ? body.duckRate : null,
      transcribedCount:
        typeof body.transcribedCount === "number" ? Math.floor(body.transcribedCount) : 0,
      syncedAt: new Date(),
      source: "cli-sync",
    };

    await writeDoc(`crixin_voice_wrapped/${session.uid}`, sanitized, { merge: false });
    return res.status(200).json({ ok: true, syncedAt: sanitized["syncedAt"] });
  }

  return res.status(405).json({ error: "method not allowed" });
}
