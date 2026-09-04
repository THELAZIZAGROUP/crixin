import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { paths } from "../lib/paths.js";
import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";
import {
  estimateMessageCostCents,
  estimateTokens,
  anthropicCostCents,
  anthropicTotalTokens,
  type AnthropicUsage,
} from "../pricing/index.js";
import type { NormalizedMessage, IngestSummary } from "./types.js";

const SOURCE = "claude-code";

/**
 * Walk ~/.claude/projects/, find all *.jsonl session files, and ingest any whose
 * (mtime, size) fingerprint differs from what's stored. Idempotent.
 *
 * v0.0.4: optional `includeSubagents` walks the `subagents/` subdirectories
 * too. Sub-agent files are stored with their parent session's ID populated in
 * `parent_session_id` so the dashboard can group them under the parent.
 */
export interface ClaudeCodeIngestOpts {
  /** Include sub-agent JSONL files (under any `subagents/` segment). Default: false. */
  includeSubagents?: boolean;
}

export function ingestClaudeCode(opts: ClaudeCodeIngestOpts = {}): IngestSummary {
  const summary: IngestSummary = {
    source: SOURCE,
    scanned: 0,
    inserted: 0,
    skippedUnchanged: 0,
    failed: 0,
  };

  if (!existsSync(paths.claudeCodeProjects)) {
    return summary;
  }

  const includeSubagents = opts.includeSubagents ?? process.env["CRIXIN_INCLUDE_SUBAGENTS"] === "1";

  const db = getDb();
  const files = walkJsonlFiles(paths.claudeCodeProjects, { includeSubagents });

  const upsertSession = db.prepare(
    `INSERT INTO sessions (
       id, source, project, started_at, ended_at,
       message_count, prompt_tokens, output_tokens, cost_usd_cents,
       source_path, source_mtime, source_size, parent_session_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
       source_size   = excluded.source_size,
       parent_session_id = excluded.parent_session_id`,
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
      const sessionId = sessionIdFromFilename(file);
      if (!sessionId) {
        summary.failed += 1;
        continue;
      }

      const existing = queries.getSourceFingerprint(db, sessionId);
      if (
        existing &&
        existing.source_mtime === mtimeMs &&
        existing.source_size === sizeBytes
      ) {
        summary.skippedUnchanged += 1;
        continue;
      }

      const parsed = parseJsonlFile(file);
      const project = projectFromPath(file);
      const startedAt = parsed.messages[0]?.ts ?? null;
      const endedAt = parsed.messages.at(-1)?.ts ?? null;

      // ---------- pricing -----------------------------------------------------
      // If we collected ANY authoritative usage blocks during parse, use them
      // and fall back to estimates only for messages without usage.
      let promptTokens = 0;
      let outputTokens = 0;
      let costCents = 0;
      const sessionModel = parsed.messages.find((m) => m.model)?.model ?? null;

      if (parsed.usageByIdx.size > 0) {
        // AUTHORITATIVE path
        for (let i = 0; i < parsed.messages.length; i++) {
          const m = parsed.messages[i]!;
          const u = parsed.usageByIdx.get(i);
          if (u) {
            promptTokens +=
              (u.input_tokens ?? 0) +
              (u.cache_creation_input_tokens ?? 0) +
              (u.cache_read_input_tokens ?? 0);
            outputTokens += u.output_tokens ?? 0;
            costCents += anthropicCostCents(u, m.model ?? sessionModel);
          } else {
            // Estimate the user / system / tool_result lines without API usage
            const t = estimateTokens(m.content);
            if (m.role === "assistant") outputTokens += t;
            else promptTokens += t;
            costCents += estimateMessageCostCents(m.content, m.role, m.model ?? sessionModel);
          }
        }
      } else {
        // ESTIMATED path (older Claude Code corpora that didn't record usage)
        for (const m of parsed.messages) {
          const t = estimateTokens(m.content);
          if (m.role === "assistant") outputTokens += t;
          else promptTokens += t;
          costCents += estimateMessageCostCents(m.content, m.role, m.model ?? sessionModel);
        }
      }
      // -----------------------------------------------------------------------

      // Sub-agent files live under .../subagents/<file>; parent's id is the
      // directory name two levels up (the parent session uuid).
      const parentSessionId = parentFromSubagentPath(file);

      const txn = db.exec.bind(db);
      txn("BEGIN");
      try {
        upsertSession.run(
          sessionId,
          SOURCE,
          project,
          startedAt,
          endedAt,
          parsed.messages.length,
          promptTokens,
          outputTokens,
          costCents,
          file,
          mtimeMs,
          sizeBytes,
          parentSessionId,
        );
        deleteMessages.run(sessionId);
        let idx = 0;
        for (const m of parsed.messages) {
          const u = parsed.usageByIdx.get(idx);
          const tokens = u ? anthropicTotalTokens(u) : null;
          insertMessage.run(
            sessionId,
            idx,
            m.role,
            m.content,
            m.ts,
            m.model ?? null,
            tokens ?? m.tokens ?? null,
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

/** Recursively find *.jsonl under root, returning absolute paths. */
function walkJsonlFiles(
  root: string,
  opts: { includeSubagents: boolean },
): string[] {
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
      if (e.name === "subagents" && !opts.includeSubagents) continue;
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

/**
 * If `file` lives under a `subagents/` segment, the parent session's UUID is
 * the directory name two segments up:
 *   .../<project>/<parent-uuid>/subagents/<this-uuid>.jsonl
 */
function parentFromSubagentPath(file: string): string | null {
  const segs = file.split("/");
  const subIdx = segs.lastIndexOf("subagents");
  if (subIdx <= 0) return null;
  const parent = segs[subIdx - 1];
  if (!parent) return null;
  if (/^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/.test(parent)) {
    return parent;
  }
  return null;
}

function sessionIdFromFilename(file: string): string | undefined {
  const base = basename(file).replace(/\.jsonl$/, "");
  if (!base || !/^[A-Za-z0-9_-]+$/.test(base)) return undefined;
  if (/^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$/.test(base)) {
    return base;
  }
  const project = projectFromPath(file);
  return project ? `${project}/${base}` : base;
}

function projectFromPath(file: string): string | null {
  const root = paths.claudeCodeProjects;
  if (!file.startsWith(root)) return null;
  const rel = file.slice(root.length).replace(/^\/+/, "");
  const firstSlash = rel.indexOf("/");
  return firstSlash === -1 ? null : rel.slice(0, firstSlash);
}

interface ParsedFile {
  messages: NormalizedMessage[];
  /** Maps message index → Anthropic usage block, when present. */
  usageByIdx: Map<number, AnthropicUsage>;
}

/**
 * Parse one JSONL file. Each line is one event. We keep the ones that look
 * like messages and flatten their content into a string. When Anthropic's
 * `message.usage` block is present (assistant lines from modern Claude Code),
 * we capture it for cache-aware cost accounting.
 */
function parseJsonlFile(file: string): ParsedFile {
  const raw = readFileSync(file, "utf8");
  const messages: NormalizedMessage[] = [];
  const usageByIdx = new Map<number, AnthropicUsage>();

  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const m = normalize(obj);
    if (!m) continue;
    const idx = messages.length;
    messages.push(m);
    const u = pickUsage(obj);
    if (u) usageByIdx.set(idx, u);
  }
  return { messages, usageByIdx };
}

function normalize(obj: unknown): NormalizedMessage | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const role = pickRole(o);
  if (!role) return null;
  const ts = pickTimestamp(o);
  const content = pickContent(o);
  if (!content) return null;
  return {
    role,
    content,
    ts,
    model: pickModel(o),
    tokens: null,
  };
}

function pickRole(o: Record<string, unknown>): NormalizedMessage["role"] | null {
  // role can live at top level or inside .message
  let r: string | undefined;
  if (typeof o["role"] === "string") r = o["role"] as string;
  else if (typeof o["type"] === "string") r = o["type"] as string;
  if (!r) {
    const msg = o["message"];
    if (msg && typeof msg === "object") {
      const mm = msg as Record<string, unknown>;
      if (typeof mm["role"] === "string") r = mm["role"] as string;
    }
  }
  if (!r) return null;
  if (r === "user" || r === "assistant" || r === "system") return r;
  if (r === "tool_result" || r === "tool_use") return "tool_result";
  return null;
}

function pickTimestamp(o: Record<string, unknown>): number | null {
  const candidates = ["timestamp", "ts", "created_at", "createdAt", "time"];
  for (const k of candidates) {
    const v = o[k];
    if (typeof v === "number") return v > 1e12 ? v : v * 1000;
    if (typeof v === "string") {
      const parsed = Date.parse(v);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return null;
}

function pickContent(o: Record<string, unknown>): string | null {
  const direct = o["content"];
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct)) {
    const parts: string[] = [];
    for (const item of direct) {
      if (typeof item === "string") parts.push(item);
      else if (item && typeof item === "object") {
        const it = item as Record<string, unknown>;
        if (typeof it["text"] === "string") parts.push(it["text"] as string);
        else if (typeof it["content"] === "string") parts.push(it["content"] as string);
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }
  const msg = o["message"];
  if (msg && typeof msg === "object") {
    return pickContent(msg as Record<string, unknown>);
  }
  if (typeof o["text"] === "string") return o["text"] as string;
  return null;
}

function pickModel(o: Record<string, unknown>): string | null {
  if (typeof o["model"] === "string") return o["model"] as string;
  const msg = o["message"];
  if (msg && typeof msg === "object") {
    const mm = msg as Record<string, unknown>;
    if (typeof mm["model"] === "string") return mm["model"] as string;
  }
  return null;
}

/**
 * Pull Anthropic's usage block. In Claude Code's JSONL it lives at
 * `.message.usage` for assistant lines; some old corpora put it at the top.
 */
function pickUsage(obj: unknown): AnthropicUsage | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const direct = o["usage"];
  if (direct && typeof direct === "object") return cleanUsage(direct as Record<string, unknown>);
  const msg = o["message"];
  if (msg && typeof msg === "object") {
    const mm = msg as Record<string, unknown>;
    const u = mm["usage"];
    if (u && typeof u === "object") return cleanUsage(u as Record<string, unknown>);
  }
  return null;
}

function cleanUsage(u: Record<string, unknown>): AnthropicUsage | null {
  const out: AnthropicUsage = {};
  let any = false;
  for (const k of [
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
  ] as const) {
    const v = u[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      out[k] = v;
      any = true;
    }
  }
  return any ? out : null;
}
