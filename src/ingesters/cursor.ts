import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { paths } from "../lib/paths.js";
import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";
import { estimateMessageCostCents, estimateTokens } from "../pricing/index.js";
import type { NormalizedMessage, IngestSummary } from "./types.js";

const SOURCE = "cursor";

/**
 * Walk Cursor's app-data dir, find every state.vscdb (one global + one per
 * workspace), open each in read-only mode, and pull `composerData:<uuid>`
 * rows out of the `cursorDiskKV` table. Each composerData blob is one
 * Cursor chat / composer session.
 *
 * Cursor's storage shape evolves frequently; we treat unknown fields gracefully
 * and only ingest sessions where we can extract at least an id + a createdAt.
 *
 * Caveats (validate against real-Cursor-power-user data in v0.3):
 *  - Newer Cursor versions may store the actual message bubbles in a separate
 *    table or under a different key prefix.
 *  - `conversationMap` and `fullConversationHeadersOnly` were observed empty
 *    on a low-usage instance. The ingester records the session metadata
 *    regardless and leaves messages empty when content is unavailable.
 */
export function ingestCursor(): IngestSummary {
  const summary: IngestSummary = {
    source: SOURCE,
    scanned: 0,
    inserted: 0,
    skippedUnchanged: 0,
    failed: 0,
  };
  if (!existsSync(paths.cursorAppData)) return summary;

  const dbFiles = findStateDbs(paths.cursorAppData);
  if (dbFiles.length === 0) return summary;

  const db = getDb();

  const upsertSession = db.prepare(
    `INSERT INTO sessions (
       id, source, project, started_at, ended_at,
       message_count, prompt_tokens, output_tokens, cost_usd_cents,
       source_path, source_mtime, source_size
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       project       = excluded.project,
       started_at    = excluded.started_at,
       ended_at      = excluded.ended_at,
       message_count = excluded.message_count,
       prompt_tokens = excluded.prompt_tokens,
       output_tokens = excluded.output_tokens,
       cost_usd_cents = excluded.cost_usd_cents,
       source_path   = excluded.source_path,
       source_mtime  = excluded.source_mtime,
       source_size   = excluded.source_size`,
  );
  const deleteMessages = db.prepare(`DELETE FROM messages WHERE session_id = ?`);
  const insertMessage = db.prepare(
    `INSERT INTO messages (session_id, idx, role, content, ts, model, tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const dbPath of dbFiles) {
    let stat;
    try {
      stat = statSync(dbPath);
    } catch {
      continue;
    }
    const project = projectFromDbPath(dbPath);
    let cursorDb: DatabaseSync | undefined;
    try {
      cursorDb = new DatabaseSync(dbPath, { readOnly: true });
    } catch {
      continue;
    }

    let rows: { key: string; value: string | Uint8Array }[];
    try {
      rows = cursorDb
        .prepare(`SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'`)
        .all() as { key: string; value: string | Uint8Array }[];
    } catch {
      cursorDb.close();
      continue;
    }
    cursorDb.close();

    for (const row of rows) {
      summary.scanned += 1;
      try {
        const valueStr =
          typeof row.value === "string"
            ? row.value
            : Buffer.from(row.value).toString("utf8");
        const data = JSON.parse(valueStr) as unknown;
        if (!data || typeof data !== "object") {
          summary.failed += 1;
          continue;
        }
        const d = data as Record<string, unknown>;
        const composerId =
          typeof d["composerId"] === "string"
            ? (d["composerId"] as string)
            : row.key.slice("composerData:".length);
        const sessionId = `cursor/${composerId}`;

        const fingerprintMtime = Math.floor(stat.mtimeMs);
        const fingerprintSize = valueStr.length;
        const existing = queries.getSourceFingerprint(db, sessionId);
        if (
          existing &&
          existing.source_mtime === fingerprintMtime &&
          existing.source_size === fingerprintSize
        ) {
          summary.skippedUnchanged += 1;
          continue;
        }

        const createdAt = numericFromUnknown(d["createdAt"]);
        const modelName = readModelName(d["modelConfig"]);
        const messages = extractMessages(d);

        const startedAt = createdAt ?? messages[0]?.ts ?? null;
        const endedAt = messages.at(-1)?.ts ?? startedAt;

        let promptTokens = 0;
        let outputTokens = 0;
        let costCents = 0;
        for (const m of messages) {
          const t = estimateTokens(m.content);
          if (m.role === "assistant") outputTokens += t;
          else promptTokens += t;
          costCents += estimateMessageCostCents(m.content, m.role, modelName);
        }

        const txn = db.exec.bind(db);
        txn("BEGIN");
        try {
          upsertSession.run(
            sessionId,
            SOURCE,
            project,
            startedAt,
            endedAt,
            messages.length,
            promptTokens,
            outputTokens,
            costCents,
            `${dbPath}#${row.key}`,
            fingerprintMtime,
            fingerprintSize,
          );
          deleteMessages.run(sessionId);
          let idx = 0;
          for (const m of messages) {
            insertMessage.run(
              sessionId,
              idx,
              m.role,
              m.content,
              m.ts,
              m.model ?? modelName,
              m.tokens ?? null,
            );
            idx += 1;
          }
          txn("COMMIT");
          summary.inserted += 1;
        } catch (err) {
          txn("ROLLBACK");
          throw err;
        }
      } catch {
        summary.failed += 1;
      }
    }
  }

  return summary;
}

function findStateDbs(root: string): string[] {
  const out: string[] = [];
  const global = join(root, "User", "globalStorage", "state.vscdb");
  if (existsSync(global)) out.push(global);
  const wsRoot = join(root, "User", "workspaceStorage");
  if (!existsSync(wsRoot)) return out;
  let entries;
  try {
    entries = readdirSync(wsRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const candidate = join(wsRoot, e.name, "state.vscdb");
    if (existsSync(candidate)) out.push(candidate);
  }
  return out;
}

/**
 * Best-effort project label. The workspace dir name in Cursor is a
 * timestamp-shaped string with no semantic content; the actual workspace path
 * lives inside the workspace state.vscdb but is non-trivial to resolve. v0.2
 * uses the dir name; v0.3 will try to resolve to the real fs path.
 */
function projectFromDbPath(dbPath: string): string | null {
  if (dbPath.includes("/globalStorage/")) return "(global)";
  const m = dbPath.match(/workspaceStorage\/([^/]+)\//);
  return m && m[1] ? m[1] : null;
}

function numericFromUnknown(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
    const dt = Date.parse(v);
    if (!Number.isNaN(dt)) return dt;
  }
  return null;
}

function readModelName(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const m = (raw as Record<string, unknown>)["modelName"];
  return typeof m === "string" ? m : null;
}

/**
 * Pull messages out of a Cursor composerData blob. Multiple shapes coexist;
 * we try them in order. If none yield messages, returns [].
 */
function extractMessages(d: Record<string, unknown>): NormalizedMessage[] {
  // Shape 1 (older): { conversation: [{ role, message: { content }, timestamp }, …] }
  const conv = d["conversation"];
  if (Array.isArray(conv) && conv.length > 0) {
    const out: NormalizedMessage[] = [];
    for (const c of conv) {
      if (!c || typeof c !== "object") continue;
      const cc = c as Record<string, unknown>;
      const role = normalizeRole(cc["role"] ?? cc["type"]);
      const content = pickContent(cc);
      const ts = numericFromUnknown(cc["timestamp"] ?? cc["ts"] ?? cc["time"]);
      if (role && content) out.push({ role, content, ts });
    }
    if (out.length > 0) return out;
  }

  // Shape 2 (newer): conversationMap = { [bubbleId]: { type, text, … } }
  const map = d["conversationMap"];
  if (map && typeof map === "object" && Object.keys(map).length > 0) {
    const out: NormalizedMessage[] = [];
    for (const v of Object.values(map as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const vv = v as Record<string, unknown>;
      const role = normalizeRole(vv["type"] ?? vv["role"]);
      const content = pickContent(vv);
      const ts = numericFromUnknown(vv["timestamp"] ?? vv["createdAt"]);
      if (role && content) out.push({ role, content, ts });
    }
    if (out.length > 0) return out;
  }

  // Shape 3: fullConversationHeadersOnly is a sequence of bubble headers — best-effort labels only.
  const headers = d["fullConversationHeadersOnly"];
  if (Array.isArray(headers) && headers.length > 0) {
    const out: NormalizedMessage[] = [];
    for (const h of headers) {
      if (!h || typeof h !== "object") continue;
      const hh = h as Record<string, unknown>;
      const role = normalizeRole(hh["type"] ?? hh["role"]);
      const content = pickContent(hh) ?? `[no content captured — bubble ${hh["bubbleId"] ?? ""}]`;
      const ts = numericFromUnknown(hh["timestamp"] ?? hh["createdAt"]);
      if (role) out.push({ role, content, ts });
    }
    if (out.length > 0) return out;
  }

  return [];
}

function normalizeRole(raw: unknown): NormalizedMessage["role"] | null {
  if (typeof raw !== "string") return null;
  const r = raw.toLowerCase();
  if (r === "user" || r === "human" || r === "1") return "user";
  if (r === "assistant" || r === "ai" || r === "bot" || r === "2") return "assistant";
  if (r === "system" || r === "developer") return "system";
  if (r === "tool" || r === "tool_result" || r === "function") return "tool_result";
  return null;
}

function pickContent(o: Record<string, unknown>): string | null {
  if (typeof o["text"] === "string") return o["text"] as string;
  if (typeof o["content"] === "string") return o["content"] as string;
  const message = o["message"];
  if (message && typeof message === "object") {
    const inner = pickContent(message as Record<string, unknown>);
    if (inner) return inner;
  }
  if (Array.isArray(o["content"])) {
    const parts: string[] = [];
    for (const item of o["content"] as unknown[]) {
      if (typeof item === "string") parts.push(item);
      else if (item && typeof item === "object") {
        const it = item as Record<string, unknown>;
        if (typeof it["text"] === "string") parts.push(it["text"] as string);
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }
  return null;
}
