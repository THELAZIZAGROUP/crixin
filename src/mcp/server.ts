import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ingestAll } from "../ingesters/index.js";
import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";

/**
 * Coder MCP server (stdio transport) — the memory half of the Crixin toolkit.
 *
 * Tools exposed to AI hosts:
 *   - search_sessions(query, limit?)        — full-text match across all messages
 *   - list_recent_sessions(limit?)          — most recent sessions, with summary
 *   - get_session(session_id)               — full session content as Markdown
 *   - stats()                               — aggregate counts across the local store
 *
 * Re-ingests on startup so the host always sees current data when it launches us.
 */
function getCrixinVersion(): string {
  try {
    const url = new URL("../../package.json", import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const txt = require("node:fs").readFileSync(url, "utf8") as string;
    const pkg = JSON.parse(txt) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export async function startMcpServer(): Promise<void> {
  // Reindex once on launch — keeps things fresh without extra config.
  try {
    ingestAll();
  } catch {
    // Don't crash MCP startup over an ingest hiccup; we still serve queries.
  }

  const server = new Server(
    { name: "crixin-coder", version: getCrixinVersion() },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "search_sessions",
        description:
          "Deep-search messages across every ingested AI coding session (Claude Code, Codex CLI, Cursor). Returns matched sessions with a snippet, a relative timestamp, and a ready-to-paste resume command.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Words to search for; ANDed implicitly." },
            limit: { type: "integer", default: 25, minimum: 1, maximum: 200 },
          },
          required: ["query"],
        },
      },
      {
        name: "list_recent_sessions",
        description:
          "List the most recent sessions across all sources, newest first.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "integer", default: 25, minimum: 1, maximum: 200 },
          },
        },
      },
      {
        name: "get_session",
        description:
          "Return the full content of one session as Markdown (header + every message in order).",
        inputSchema: {
          type: "object",
          properties: {
            session_id: { type: "string" },
          },
          required: ["session_id"],
        },
      },
      {
        name: "stats",
        description:
          "Return aggregate stats: total sessions, messages, cost, busiest hour, top projects.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const db = getDb();

    if (name === "search_sessions") {
      const query = String(args["query"] ?? "").trim();
      const limit = clampInt(args["limit"], 1, 200, 25);
      if (!query) {
        return textResult("Pass a non-empty query.");
      }
      const hits = queries.searchMessages(db, query, limit);
      if (hits.length === 0) return textResult(`No matches for "${query}".`);
      const lines: string[] = [`Found ${hits.length} match(es) for "${query}":`, ""];
      for (const h of hits) {
        const session = queries.getSession(db, h.session_id);
        const project = session?.project ?? "(no project)";
        const ts = h.ts ? new Date(h.ts).toISOString() : "—";
        lines.push(`### ${project}`);
        lines.push(`- Session: \`${h.session_id}\``);
        lines.push(`- Source: ${session?.source ?? "?"}`);
        lines.push(`- When: ${ts}`);
        lines.push(`- Resume: \`${resumeCmd(session?.source ?? "?", project, h.session_id)}\``);
        lines.push(`- Snippet: ${h.snippet.replace(/\s+/g, " ").trim()}`);
        lines.push("");
      }
      return textResult(lines.join("\n"));
    }

    if (name === "list_recent_sessions") {
      const limit = clampInt(args["limit"], 1, 200, 25);
      const sessions = queries.listRecentSessions(db, limit);
      if (sessions.length === 0) return textResult("No sessions ingested yet.");
      const lines: string[] = [`${sessions.length} most recent sessions:`, ""];
      for (const s of sessions) {
        const ts = s.started_at ? new Date(s.started_at).toISOString() : "—";
        const cost = s.cost_usd_cents > 0 ? `$${(s.cost_usd_cents / 100).toFixed(2)}` : "—";
        lines.push(
          `- \`${s.id}\` · ${s.source} · ${s.project ?? "(no project)"} · ${ts} · ${s.message_count} msgs · ${cost}`,
        );
      }
      return textResult(lines.join("\n"));
    }

    if (name === "get_session") {
      const id = String(args["session_id"] ?? "");
      const session = queries.getSession(db, id);
      if (!session) return textResult(`Session not found: ${id}`);
      const messages = queries.getMessages(db, id);
      const lines: string[] = [];
      lines.push(`# ${session.project ?? "(no project)"}`);
      lines.push("");
      lines.push(`- Source: ${session.source}`);
      lines.push(`- Session: \`${session.id}\``);
      lines.push(`- Started: ${session.started_at ? new Date(session.started_at).toISOString() : "—"}`);
      lines.push(`- Messages: ${session.message_count}`);
      if (session.cost_usd_cents > 0) {
        lines.push(`- Est. cost: $${(session.cost_usd_cents / 100).toFixed(2)}`);
      }
      lines.push("");
      for (const m of messages) {
        const tsStr = m.ts ? new Date(m.ts).toISOString() : "";
        lines.push(`## ${m.role}${tsStr ? "  ·  " + tsStr : ""}`);
        lines.push("");
        lines.push(m.content ?? "");
        lines.push("");
      }
      return textResult(lines.join("\n"));
    }

    if (name === "stats") {
      const stats = queries.stats(db);
      const agg = queries.aggregates(db);
      const out = [
        `Sessions: ${stats.sessions}`,
        `Messages: ${stats.messages}`,
        `Sources: ${stats.sources}`,
        `Total est. cost: $${(agg.totalCostCents / 100).toFixed(2)}`,
        `Total time: ${(agg.totalDurationMs / 3.6e6).toFixed(1)}h`,
        `Busiest hour: ${agg.busiestHour ?? "—"}`,
        "",
        "Top projects:",
        ...agg.topProjects.map((p) => `  - ${p.project}: ${p.count}`),
      ].join("\n");
      return textResult(out);
    }

    return textResult(`Unknown tool: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Resolves only when the transport closes (host disconnects).
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function resumeCmd(source: string, project: string | null, id: string): string {
  const bare = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  if (source === "claude-code") return `cd ${project ?? "~"} && claude --resume ${bare}`;
  if (source === "codex") return `codex resume ${bare}`;
  if (source === "cursor") return `# Cursor — open the chat sidebar to find ${bare.slice(0, 8)}`;
  return `# resume: ${bare}`;
}

function textResult(text: string) {
  return { content: [{ type: "text", text }] };
}
