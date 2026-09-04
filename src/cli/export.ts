import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";
import { log } from "../lib/log.js";

/** Emit a session as Markdown to stdout. `crixin export <session-id>`. */
export function runExport(sessionId: string): void {
  const db = getDb();
  const session = queries.getSession(db, sessionId);
  if (!session) {
    log.error(`Session not found: ${sessionId}`);
    process.exitCode = 1;
    return;
  }
  const messages = queries.getMessages(db, sessionId);
  const ts = session.started_at ? new Date(session.started_at).toISOString() : "unknown";

  const lines: string[] = [];
  lines.push(`# Session ${session.id}`);
  lines.push("");
  lines.push(`- Project: ${session.project ?? "(no project)"}`);
  lines.push(`- Source: ${session.source}`);
  lines.push(`- Started: ${ts}`);
  lines.push(`- Messages: ${session.message_count}`);
  lines.push("");
  for (const m of messages) {
    const tsStr = m.ts ? new Date(m.ts).toISOString() : "";
    lines.push(`## ${m.role}${tsStr ? "  ·  " + tsStr : ""}`);
    lines.push("");
    lines.push(m.content ?? "");
    lines.push("");
  }
  process.stdout.write(lines.join("\n") + "\n");
}
