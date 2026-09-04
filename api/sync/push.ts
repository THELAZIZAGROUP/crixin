/**
 * POST /api/sync/push — upload a batch of metadata records.
 *
 * Body: { records: SyncRecord[] }
 *
 * Auth: device-token bearer.
 *
 * Server-side validation:
 *   - device-token signature valid + not expired
 *   - corresponding device doc exists (revocation guard)
 *   - every record has the EXACT allowlisted shape (no unknown keys)
 *   - every record.device_id matches the token's device_id
 *
 * Storage layout:
 *   crixin_sync_records/{uid}_{record_id}
 *
 * Flat-keyed for simplicity — Firestore lets us listDocuments under
 * `crixin_sync_records` and filter by uid prefix on the client (acceptable for
 * a single account's sync namespace). If sync ever grows enough that this is a
 * problem, migrate to a subcollection layout.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { rateLimit, clientIp } from "../_lib/ratelimit.js";
import { readDeviceTokenFromRequest } from "../_lib/device-token.js";
import { readDoc, writeDoc } from "../_lib/firestore.js";

const ALLOWED_KEYS = new Set<string>([
  "record_id", "source", "local_id", "project",
  "started_at", "ended_at", "message_count", "prompt_tokens", "output_tokens",
  "cost_usd_cents", "duration_seconds", "direction",
  "content_hash", "device_id", "updated_at",
]);
const ALLOWED_SOURCES = new Set<string>(["claude-code", "codex", "cursor", "sdk", "voice"]);
const ALLOWED_DIRECTIONS = new Set<string>([
  "outbound-api", "inbound", "outbound-dial", "outbound-reply",
]);
const MAX_BATCH = 500;

interface IncomingRecord {
  record_id: string;
  source: string;
  local_id: string;
  project: string | null;
  started_at: number | null;
  ended_at: number | null;
  message_count: number | null;
  prompt_tokens: number | null;
  output_tokens: number | null;
  cost_usd_cents: number | null;
  duration_seconds: number | null;
  direction: string | null;
  content_hash: string;
  device_id: string;
  updated_at: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }
  const ipKey = clientIp(req);
  if (!rateLimit(`sync:push:${ipKey}`, 60, 60 * 1000)) {
    return res.status(429).json({ error: "rate limited" });
  }

  const tok = readDeviceTokenFromRequest(req);
  if (!tok) return res.status(401).json({ error: "missing or invalid device token" });

  const myDoc = await readDoc(`crixin_sync_devices/${tok.device_id}`).catch(() => null);
  if (!myDoc || myDoc["uid"] !== tok.uid) {
    return res.status(403).json({ error: "device revoked" });
  }

  const body = (req.body ?? {}) as { records?: unknown };
  if (!Array.isArray(body.records)) {
    return res.status(400).json({ error: "records[] required" });
  }
  if (body.records.length > MAX_BATCH) {
    return res.status(400).json({ error: `batch too large (max ${MAX_BATCH})` });
  }

  const accepted: string[] = [];
  const rejected: Array<{ record_id: string | null; reason: string }> = [];

  for (const raw of body.records) {
    const validation = validateRecord(raw, tok.device_id);
    if (!validation.ok) {
      rejected.push({ record_id: extractIdSafely(raw), reason: validation.reason });
      continue;
    }
    const rec = validation.record;
    try {
      // Upsert with merge. updated_at decides which write wins; Firestore
      // doesn't natively do "conditional update on updated_at" without a
      // transaction, but for v1 the device-id partition makes write conflicts
      // rare (two devices pushing the same session inside the same second).
      await writeDoc(`crixin_sync_records/${tok.uid}_${rec.record_id}`, {
        uid: tok.uid,
        ...rec,
        server_received_at: new Date(),
      });
      accepted.push(rec.record_id);
    } catch (err) {
      rejected.push({ record_id: rec.record_id, reason: errorMsg(err).slice(0, 160) });
    }
  }

  // Heartbeat on every push — cheap, keeps device list useful.
  writeDoc(`crixin_sync_devices/${tok.device_id}`, { last_seen_at: new Date() }, { merge: true })
    .catch(() => {});

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    accepted: accepted.length,
    rejected: rejected.length,
    rejections: rejected.slice(0, 10),
  });
}

function validateRecord(
  raw: unknown,
  expectedDeviceId: string,
): { ok: true; record: IncomingRecord } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not an object" };
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!ALLOWED_KEYS.has(k)) return { ok: false, reason: `unknown field: ${k}` };
  }
  if (typeof o["record_id"] !== "string" || !/^[a-f0-9]{16,64}$/.test(o["record_id"] as string)) {
    return { ok: false, reason: "invalid record_id" };
  }
  if (typeof o["source"] !== "string" || !ALLOWED_SOURCES.has(o["source"])) {
    return { ok: false, reason: "invalid source" };
  }
  if (typeof o["local_id"] !== "string" || (o["local_id"] as string).length === 0 || (o["local_id"] as string).length > 256) {
    return { ok: false, reason: "invalid local_id" };
  }
  if (o["project"] !== null && typeof o["project"] !== "string") return { ok: false, reason: "invalid project" };
  if (typeof o["project"] === "string" && (o["project"] as string).length > 512) return { ok: false, reason: "project too long" };
  if (!isNullableInt(o["started_at"])) return { ok: false, reason: "invalid started_at" };
  if (!isNullableInt(o["ended_at"])) return { ok: false, reason: "invalid ended_at" };
  if (!isNullableInt(o["message_count"])) return { ok: false, reason: "invalid message_count" };
  if (!isNullableInt(o["prompt_tokens"])) return { ok: false, reason: "invalid prompt_tokens" };
  if (!isNullableInt(o["output_tokens"])) return { ok: false, reason: "invalid output_tokens" };
  if (!isNullableInt(o["cost_usd_cents"])) return { ok: false, reason: "invalid cost_usd_cents" };
  if (!isNullableInt(o["duration_seconds"])) return { ok: false, reason: "invalid duration_seconds" };
  if (o["direction"] !== null && (typeof o["direction"] !== "string" || !ALLOWED_DIRECTIONS.has(o["direction"]))) {
    return { ok: false, reason: "invalid direction" };
  }
  if (typeof o["content_hash"] !== "string" || !/^[a-f0-9]{16,128}$/.test(o["content_hash"] as string)) {
    return { ok: false, reason: "invalid content_hash" };
  }
  if (typeof o["device_id"] !== "string" || (o["device_id"] as string) !== expectedDeviceId) {
    return { ok: false, reason: "device_id mismatch with token" };
  }
  if (typeof o["updated_at"] !== "number" || !Number.isFinite(o["updated_at"] as number)) {
    return { ok: false, reason: "invalid updated_at" };
  }
  return { ok: true, record: o as unknown as IncomingRecord };
}

function isNullableInt(v: unknown): boolean {
  if (v === null) return true;
  return typeof v === "number" && Number.isFinite(v);
}

function extractIdSafely(raw: unknown): string | null {
  if (raw && typeof raw === "object" && "record_id" in raw) {
    const id = (raw as { record_id?: unknown }).record_id;
    if (typeof id === "string") return id;
  }
  return null;
}

function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : "unknown";
}
