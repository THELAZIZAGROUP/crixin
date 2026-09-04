/**
 * `crixin verify <session-id>` — F10 (Free, opt-in)
 * Calls Anthropic's /v1/messages/count_tokens with the session's user prompts
 * to verify our local count is accurate. Requires ANTHROPIC_API_KEY in env.
 */
import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";
import { anthropicCountTokens } from "../pricing/anthropic-counter.js";
import { log } from "../lib/log.js";
import kleur from "kleur";

export async function runVerify(sessionId: string): Promise<void> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    log.error("ANTHROPIC_API_KEY env var not set.");
    log.hint("Get one at https://console.anthropic.com/ and `export ANTHROPIC_API_KEY=sk-ant-…`");
    log.hint("Crixin never ships or fetches keys; this is opt-in.");
    process.exitCode = 1;
    return;
  }
  const db = getDb();
  const session = queries.getSession(db, sessionId);
  if (!session) { log.error(`Session not found: ${sessionId}`); process.exitCode = 1; return; }
  const messages = queries.getMessages(db, sessionId)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, 50)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: (m.content ?? "").slice(0, 8000),
    }));
  if (messages.length === 0) {
    log.error("Session has no user/assistant messages to verify against.");
    return;
  }
  const model = (db.prepare(`SELECT model FROM messages WHERE session_id = ? AND model IS NOT NULL LIMIT 1`)
    .get(sessionId) as { model?: string } | undefined)?.model ?? "claude-opus-4-7";

  log.info(`Verifying with Anthropic API (model=${model}, ${messages.length} messages)…`);
  const r = await anthropicCountTokens({ model, messages }, apiKey);
  if ("error" in r) { log.error("count_tokens failed: " + r.error); process.exitCode = 1; return; }

  const local = session.prompt_tokens;
  const delta = r.input_tokens - local;
  const pct = local > 0 ? ((delta / local) * 100).toFixed(1) : "n/a";

  console.log("");
  console.log(kleur.bold("Token verification"));
  console.log(`  Local (DB):      ${local.toLocaleString()}`);
  console.log(`  Anthropic API:   ${r.input_tokens.toLocaleString()}`);
  console.log(`  Delta:           ${delta >= 0 ? "+" : ""}${delta.toLocaleString()} (${pct}%)`);
  console.log("");
  if (Math.abs(delta) / Math.max(local, 1) < 0.05) {
    log.success("Match within 5% — local count is trustworthy.");
  } else {
    log.warn("Local count diverges by >5% — re-ingest may be stale, or the JSONL `usage` block is missing some lines.");
  }
}
