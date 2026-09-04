/**
 * `crixin coder <subcommand>` — sub-router for the AI-coding-session analyzer.
 *
 * The Coder side of Crixin reads what your coding AIs (Claude Code, Codex CLI,
 * Cursor) write to disk and gives you back a portrait of how they see you:
 * Wrapped reports, behavioral archetype, skipped phrases, deep search.
 *
 * Mirrors the structure of `src/voice/cli.ts`. The actual engines live at
 * their original paths (`src/ingesters/`, `src/wrapped/`, `src/db/queries.ts`,
 * `src/cli/wrapped.ts`, etc.) — this file is just the router.
 */
import kleur from "kleur";
import { log } from "../lib/log.js";

import { ingestAll, type IngestAllOpts } from "../ingesters/index.js";
import { runWrapped } from "../cli/wrapped.js";
import { runArchetype } from "../cli/archetype.js";
import { runSkipped } from "../cli/skipped.js";
import { runSearch } from "../cli/search.js";
import { runExport } from "../cli/export.js";
import { runForecast } from "../cli/forecast.js";
import { runModels } from "../cli/models.js";
import { runProjects } from "../cli/projects.js";
import { runCompare } from "../cli/compare.js";
import { runDigest } from "../cli/digest.js";
import { runPrompts } from "../cli/prompts.js";
import { runTag, runPin } from "../cli/tag.js";
import { runAlert } from "../cli/alert.js";
import { runShare, runShareList, runShareRevoke } from "../cli/share.js";
import { runReport } from "../cli/report.js";
import { runVerify } from "../cli/verify.js";
import { runCoderInstall } from "./install.js";

import { startMcpServer } from "../mcp/server.js";
import { startServer } from "../server/index.js";
import { findFreePort } from "../lib/port.js";
import { openInBrowser } from "../lib/browser.js";

const CODER_HELP = `${kleur.bold("crixin coder")} — observability for your AI coding sessions.

${kleur.gray("Core:")}
  ${kleur.cyan("crixin coder install")}              wire MCP into Claude Desktop / Claude Code / Cursor
  ${kleur.cyan("crixin coder ingest")}               rescan ~/.claude / ~/.codex / Cursor, update local DB
  ${kleur.cyan("crixin coder dashboard")}            ingest + open the in-product dashboard at 127.0.0.1
  ${kleur.cyan("crixin coder mcp")}                  run as the sessions MCP server (stdio)
  ${kleur.cyan("crixin coder search")} ${kleur.gray("<query>")}      deep-search messages from the CLI
  ${kleur.cyan("crixin coder export")} ${kleur.gray("<id>")}         dump a session as Markdown
  ${kleur.cyan("crixin coder wrapped")} ${kleur.gray("[--year N]")}  generate annual Wrapped report (HTML)

${kleur.gray("Insight:")}
  ${kleur.cyan("crixin coder archetype")} ${kleur.gray("[me|tool]")}   you + your coding AI, behaviorally
  ${kleur.cyan("crixin coder skipped")} ${kleur.gray("[--days N]")}     skip phrases ("pre-existing", "out of scope")
  ${kleur.cyan("crixin coder forecast")}                cost forecast — Free: YTD · Pro: + projections
  ${kleur.cyan("crixin coder models")}                  top models breakdown
  ${kleur.cyan("crixin coder prompts")} ${kleur.gray("[--limit N]")}    your top user prompts
  ${kleur.cyan("crixin coder projects")} ${kleur.gray("(Pro)")}         per-project comparison
  ${kleur.cyan("crixin coder compare")} ${kleur.gray("<a> <b>")}        side-by-side session diff
  ${kleur.cyan("crixin coder digest")} ${kleur.gray("[--days 7] [--ai]")}
  ${kleur.cyan("crixin coder report")} ${kleur.gray("(Pro) [--days 30]")} DORA/SPACE-aligned report

${kleur.gray("State (mostly Free):")}
  ${kleur.cyan("crixin coder tag")} ${kleur.gray("<id> <name>")}        attach tag (Free: 5 max)
  ${kleur.cyan("crixin coder pin")} ${kleur.gray("<id>")}               pin session to top of dashboard
  ${kleur.cyan("crixin coder unpin")} ${kleur.gray("<id>")}             unpin

${kleur.gray("Pro:")}
  ${kleur.cyan("crixin coder alert add")} ${kleur.gray("<period> <cents>")} cost alert (daily/weekly/monthly)
  ${kleur.cyan("crixin coder share")} ${kleur.gray("--year YYYY")}       generate Wrapped share link
  ${kleur.cyan("crixin coder verify")} ${kleur.gray("<id>")}             call Anthropic count_tokens to spot-check

${kleur.gray("Docs:")} https://crixin.com/coder  ·  https://github.com/THELAZIZAGROUP/crixin
`;

interface CoderArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export async function runCoder(args: CoderArgs): Promise<number> {
  const sub = args.positionals[0];

  if (!sub || sub === "help" || args.flags["help"] || args.flags["h"]) {
    process.stdout.write(CODER_HELP);
    return 0;
  }

  if (sub === "mcp" || args.flags["mcp"]) {
    await startMcpServer();
    return 0;
  }

  if (sub === "install") {
    runCoderInstall({
      project: Boolean(args.flags["project"]),
      only: typeof args.flags["only"] === "string" ? args.flags["only"] : undefined,
      print: Boolean(args.flags["print"]),
      command: typeof args.flags["command"] === "string" ? args.flags["command"] : undefined,
      uninstall: Boolean(args.flags["uninstall"]),
      migrateLegacy: Boolean(args.flags["migrate-legacy"]),
    });
    return 0;
  }

  if (sub === "ingest") {
    runCoderIngest({ includeSubagents: Boolean(args.flags["include-subagents"]) });
    return 0;
  }

  if (sub === "dashboard") {
    return await runCoderDashboard(args);
  }

  if (sub === "search") {
    const query = args.positionals.slice(1).join(" ").trim();
    if (!query) {
      log.error("Usage: crixin coder search <words…>");
      return 1;
    }
    const limit = Number(args.flags["limit"] ?? 25);
    const reindex = Boolean(args.flags["reindex"]);
    runSearch({ query, limit, reindex });
    return 0;
  }

  if (sub === "export") {
    const id = args.positionals[1];
    if (!id) { log.error("Usage: crixin coder export <id>"); return 1; }
    runExport(id);
    return 0;
  }

  if (sub === "wrapped") {
    const year = args.flags["year"] ? Number(args.flags["year"]) : new Date().getFullYear();
    const out = String(args.flags["out"] ?? `./crixin-coder-wrapped-${year}.html`);
    const anonymize = Boolean(args.flags["anonymize"]);
    const reindex = Boolean(args.flags["reindex"]);
    runWrapped({ year, out, anonymize, reindex });
    return 0;
  }

  if (sub === "archetype") {
    const who = args.positionals[1] as "me" | "tool" | undefined;
    const source = typeof args.flags["source"] === "string" ? args.flags["source"] : undefined;
    runArchetype({ who, source });
    return 0;
  }

  if (sub === "skipped") {
    runSkipped({
      days: args.flags["days"] ? Number(args.flags["days"]) : undefined,
      project: typeof args.flags["project"] === "string" ? args.flags["project"] : undefined,
      limit: args.flags["limit"] ? Number(args.flags["limit"]) : undefined,
      json: Boolean(args.flags["json"]),
    });
    return 0;
  }

  if (sub === "forecast") { runForecast(); return 0; }
  if (sub === "models")   { runModels();   return 0; }
  if (sub === "projects") { runProjects(); return 0; }

  if (sub === "compare") {
    const [, a, b] = args.positionals;
    if (!a || !b) { log.error("Usage: crixin coder compare <a> <b>"); return 1; }
    runCompare(a, b);
    return 0;
  }

  if (sub === "digest") {
    const windowDays = Number(args.flags["days"] ?? 7);
    const ai = Boolean(args.flags["ai"]);
    await runDigest({ windowDays, ai });
    return 0;
  }

  if (sub === "prompts") {
    const limit = args.flags["limit"] ? Number(args.flags["limit"]) : undefined;
    const project = typeof args.flags["project"] === "string" ? args.flags["project"] : undefined;
    const json = Boolean(args.flags["json"]);
    runPrompts({ limit, project, json });
    return 0;
  }

  if (sub === "tag") {
    runTag({ positionals: args.positionals.slice(1) });
    return 0;
  }
  if (sub === "pin" || sub === "unpin") {
    const id = args.positionals[1];
    if (!id) { log.error(`Usage: crixin coder ${sub} <id>`); return 1; }
    runPin(id, sub === "pin");
    return 0;
  }

  if (sub === "alert") {
    runAlert({ positionals: args.positionals.slice(1), flags: args.flags });
    return 0;
  }

  if (sub === "share") {
    const sub2 = args.positionals[1];
    if (sub2 === "list") { runShareList(); return 0; }
    if (sub2 === "revoke") {
      const t = args.positionals[2];
      if (!t) { log.error("Usage: crixin coder share revoke <token>"); return 1; }
      runShareRevoke(t);
      return 0;
    }
    const year = args.flags["year"] ? Number(args.flags["year"]) : new Date().getFullYear();
    const out = typeof args.flags["out"] === "string" ? args.flags["out"] : undefined;
    const ttlDays = args.flags["ttl"] ? Number(args.flags["ttl"]) : 30;
    await runShare({ year, out, ttlDays });
    return 0;
  }

  if (sub === "report") {
    const windowDays = Number(args.flags["days"] ?? 30);
    const out = typeof args.flags["out"] === "string" ? args.flags["out"] : undefined;
    const format = (args.flags["format"] as "term" | "html" | "both" | undefined) ?? "both";
    runReport({ windowDays, out, format });
    return 0;
  }

  if (sub === "verify") {
    const id = args.positionals[1];
    if (!id) { log.error("Usage: crixin coder verify <id>"); return 1; }
    await runVerify(id);
    return 0;
  }

  log.error(`Unknown coder subcommand: ${sub}`);
  process.stdout.write(CODER_HELP);
  return 1;
}

function runCoderIngest(opts: IngestAllOpts = {}): void {
  log.info("Ingesting Claude Code / Codex CLI / Cursor sessions…");
  const summaries = ingestAll(opts);
  for (const s of summaries) {
    if (s.scanned === 0 && s.inserted === 0) {
      log.hint(`${s.source.padEnd(12)} — none found`);
      continue;
    }
    const parts = [`scanned=${s.scanned}`, `ingested=${s.inserted}`, `unchanged=${s.skippedUnchanged}`];
    if (s.failed > 0) parts.push(`failed=${s.failed}`);
    log.stat(s.source, parts.join("  "));
  }
  log.success("Ingest complete.");
}

async function runCoderDashboard(args: CoderArgs): Promise<number> {
  const port = args.flags["port"] ? Number(args.flags["port"]) : await findFreePort(7470);
  const open = !args.flags["no-open"];

  runCoderIngest();

  const handle = await startServer({ port });
  log.success(`Dashboard: ${kleur.cyan(handle.url)}`);
  log.hint("Ctrl-C to stop.");

  if (open) await openInBrowser(handle.url);

  await new Promise<void>((resolve) => {
    const onSig = async () => {
      log.info("Shutting down…");
      await handle.stop();
      resolve();
    };
    process.once("SIGINT", onSig);
    process.once("SIGTERM", onSig);
  });
  return 0;
}
