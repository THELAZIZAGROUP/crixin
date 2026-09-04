import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { paths } from "../lib/paths.js";
import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";
import { estimateMessageCostCents, estimateTokens } from "../pricing/index.js";
import type { NormalizedMessage, IngestSummary } from "./types.js";

const SOURCE = "codex";

/**
 * Walk ~/.codex/sessions/**\/rollout-*.jsonl and ingest any whose (mtime, size)
 * differs from what we've stored. Idempotent. Each file is one Codex session.
 *
 * Codex line shape (each .jsonl line):
 *   {"type": "session_meta",  "payload": { id, cwd, ... }, "timestamp": "..."}
 *   {"type": "turn_context",  "payload": { model, ... },   "timestamp": "..."}
 *   {"type": "response_item", "payload": { role, type:"message", content: [...] }, "timestamp": "..."}
 *   {"type": "event_msg",     "payload": { type, ... },    "timestamp": "..."}
 *   {"type": "compacted",     "payload": { ... },          "timestamp": "..."}
 *
 * We pull session metadata from `session_meta` and messages from
 * `response_item` lines whose `payload.type === "message"`.
 */
export function ingestCodex(): IngestSummary {
  const summary: IngestSummary = {
    source: SOURCE,
    scanned: 0,
    inserted: 0,
    skippedUnchanged: 0,
    failed: 0,
  };

  if (!existsSync(paths.codexSessions)) {
    return summary;
  }

  const db = getDb();
  const files = walkJsonlFiles(paths.codexSessions);

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

  for (const file of files) {
    summary.scanned += 1;
    try {
      const stat = statSync(file);
      const mtimeMs = Math.floor(stat.mtimeMs);
      const sizeBytes = stat.size;

      const parsed = parseSessionFile(file);
      if (!parsed) {
        summary.failed += 1;
        continue;
      }
      const sessionId = `codex/${parsed.id}`;

      const existing = queries.getSourceFingerprint(db, sessionId);
      if (
        existing &&
        existing.source_mtime === mtimeMs &&
        existing.source_size === sizeBytes
      ) {
        summary.skippedUnchanged += 1;
        continue;
      }

      const startedAt = parsed.messages[0]?.ts ?? parsed.metaTs ?? null;
      const endedAt = parsed.messages.at(-1)?.ts ?? startedAt;

      let promptTokens = 0;
      let outputTokens = 0;
      let costCents = 0;
      for (const m of parsed.messages) {
        const t = estimateTokens(m.content);
        if (m.role === "assistant") outputTokens += t;
        else promptTokens += t;
        costCents += estimateMessageCostCents(m.content, m.role, parsed.model);
      }

      const txn = db.exec.bind(db);
      txn("BEGIN");
      try {
        upsertSession.run(
          sessionId,
          SOURCE,
          parsed.cwd,
          startedAt,
          endedAt,
          parsed.messages.length,
          promptTokens,
          outputTokens,
          costCents,
          file,
          mtimeMs,
          sizeBytes,
        );
        deleteMessages.run(sessionId);
        let idx = 0;
        for (const m of parsed.messages) {
          insertMessage.run(
            sessionId,
            idx,
            m.role,
            m.content,
            m.ts,
            m.model ?? parsed.model ?? null,
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

  return summary;
}

interface ParsedCodexFile {
  id: string;
  cwd: string | null;
  metaTs: number | null;
  model: string | null;
  messages: NormalizedMessage[];
}

function parseSessionFile(file: string): ParsedCodexFile | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let id: string | null = null;
  let cwd: string | null = null;
  let metaTs: number | null = null;
  let model: string | null = null;
  const messages: NormalizedMessage[] = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || typeof obj !== "object") continue;
    const o = obj as Record<string, unknown>;
    const type = String(o["type"] ?? "");
    const payload = o["payload"] as Record<string, unknown> | undefined;
    const tsRaw = o["timestamp"];
    const ts = typeof tsRaw === "string" ? Date.parse(tsRaw) || null : null;

    if (type === "session_meta" && payload) {
      id = (payload["id"] as string) ?? id;
      cwd = (payload["cwd"] as string) ?? cwd;
      metaTs = ts;
      continue;
    }
    if (type === "turn_context" && payload) {
      const m = payload["model"];
      if (typeof m === "string" && !model) model = m;
      continue;
    }
    if (type === "response_item" && payload && payload["type"] === "message") {
      const role = normalizeRole(payload["role"]);
      const content = flattenContent(payload["content"]);
      if (role && content) {
        messages.push({ role, content, ts });
      }
      continue;
    }
    // Skip event_msg / compacted for v0.2; revisit in v0.3 if signal-rich.
  }

  // Derive id from filename if session_meta wasn't present.
  if (!id) {
    const m = basename(file).match(/-([a-f0-9-]{36})\.jsonl$/i);
    if (m && m[1]) id = m[1];
  }
  if (!id) return null;
  return { id, cwd, metaTs, model, messages };
}

function normalizeRole(raw: unknown): NormalizedMessage["role"] | null {
  if (typeof raw !== "string") return null;
  if (raw === "user" || raw === "assistant" || raw === "system") return raw;
  if (raw === "developer") return "system";
  if (raw === "tool" || raw === "function") return "tool_result";
  return null;
}

function flattenContent(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (!Array.isArray(raw)) return null;
  const parts: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    if (item && typeof item === "object") {
      const it = item as Record<string, unknown>;
      if (typeof it["text"] === "string") parts.push(it["text"] as string);
      else if (typeof it["content"] === "string") parts.push(it["content"] as string);
    }
  }
  return parts.length ? parts.join("\n") : null;
}

function walkJsonlFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && full.endsWith(".jsonl")) {
        out.push(full);
      }
    }
  }
  return out;
}
