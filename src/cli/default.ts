/**
 * Default `npx crixin` (no args) — print the voice quickstart with current
 * DB state. The legacy session-analyzer dashboard was retired in v0.1.0.
 *
 * The intent is "show me what to do next". If the local DB has voice calls,
 * remind the user about wrapped/archetype/ducked. If it doesn't, point them
 * at `crixin voice ingest` (or `crixin voice doctor` if they haven't even
 * configured Twilio yet).
 */
import kleur from "kleur";
import { getDb } from "../db/init.js";
import { log } from "../lib/log.js";

interface DefaultOpts {
  port?: number;
  open: boolean;
}

export async function runDefault(_opts: DefaultOpts): Promise<void> {
  const db = getDb();
  const callRow = db.prepare(`SELECT COUNT(*) AS n FROM voice_calls`).get() as { n: number };
  let sessionRow = { n: 0 };
  try {
    sessionRow = db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number };
  } catch {
    // sessions table may not exist on a fresh v0.1 install; that's fine.
  }
  const calls = callRow.n;
  const sessions = sessionRow.n;

  process.stdout.write(
    "\n" +
      kleur.bold("crixin") +
      kleur.gray(" — local-first AI observability + voice primitives.") +
      "\n\n",
  );

  // Voice (the front-door product)
  process.stdout.write(kleur.bold("voice") + kleur.gray(" — AI agents that pick up the phone\n"));
  if (calls === 0) {
    log.info("No calls in your local DB yet.");
    log.hint("  crixin voice doctor                verify Twilio is reachable");
    log.hint("  crixin voice install               wire MCP into AI hosts");
    log.hint("  crixin voice ingest                pull recent calls into SQLite");
    log.hint("  crixin voice wrapped               see what your AI did this year");
  } else {
    log.success(`${calls.toLocaleString()} call${calls === 1 ? "" : "s"} in local DB.`);
    log.hint("  crixin voice wrapped               annual recap (HTML)");
    log.hint("  crixin voice archetype             your AI's caller style");
    log.hint("  crixin voice ducked                phrases your AI uses to dodge");
  }

  // Coder (the v0.2 reincarnation)
  process.stdout.write("\n" + kleur.bold("coder") + kleur.gray(" — observability for your AI coding sessions\n"));
  if (sessions === 0) {
    log.info("No coding sessions ingested yet.");
    log.hint("  crixin coder install               wire coder MCP into AI hosts");
    log.hint("  crixin coder ingest                read ~/.claude / ~/.codex / Cursor");
    log.hint("  crixin coder dashboard             ingest + open the in-product UI");
    log.hint("  crixin coder wrapped               your year in receipts");
  } else {
    log.success(`${sessions.toLocaleString()} session${sessions === 1 ? "" : "s"} indexed.`);
    log.hint("  crixin coder dashboard             open the in-product UI");
    log.hint("  crixin coder wrapped               your year in receipts");
    log.hint("  crixin coder archetype             your behavioral archetype");
  }

  process.stdout.write(
    "\n" +
      kleur.gray("Help:") +
      "  crixin help  ·  crixin voice help  ·  crixin coder help\n" +
      kleur.gray("Docs:") +
      "  https://crixin.com\n\n",
  );
}
