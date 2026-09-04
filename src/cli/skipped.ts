/**
 * `crixin skipped` — F15 (Free)
 *
 *   crixin skipped [--days 7] [--project foo] [--limit 50] [--json]
 *
 * Surfaces assistant messages where the LLM declined to fix something with
 * a recognizable skip phrase. Useful for catching the "this is pre-existing"
 * loop where the model rationalizes around a real bug.
 */
import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";
import { log } from "../lib/log.js";
import kleur from "kleur";

interface SkippedArgs {
  days?: number;
  project?: string;
  limit?: number;
  json?: boolean;
  source?: string;
}

export function runSkipped(args: SkippedArgs): void {
  const db = getDb();
  const stats = queries.skipStats(db);

  if (args.json) {
    const skips = queries.skipPatterns(db, {
      sinceDays: args.days,
      project: args.project,
      limit: args.limit ?? 100,
    });
    process.stdout.write(JSON.stringify({ stats, skips }, null, 2) + "\n");
    return;
  }

  // Header — total skip rate per source
  console.log("");
  console.log(kleur.bold("Skip patterns") + kleur.gray("  · the LLM duck-typing past your bugs"));
  console.log(kleur.gray("  " + "─".repeat(70)));
  for (const r of stats.bySource) {
    const pct = (r.rate * 100).toFixed(2);
    const color = r.rate > 0.02 ? kleur.yellow : r.rate > 0.005 ? kleur.gray : kleur.green;
    console.log(
      `  ${kleur.cyan(r.source.padEnd(14))} ${String(r.skips).padStart(5)} skips / ${String(r.assistantMessages).padStart(6)} msgs   ${color(pct + "%")}`,
    );
  }

  if (stats.byProject.length > 0) {
    console.log("");
    console.log(kleur.bold("By project"));
    for (const r of stats.byProject.slice(0, 10)) {
      const proj = r.project.length > 50 ? "…" + r.project.slice(-49) : r.project;
      console.log(`  ${proj.padEnd(50)} ${String(r.skips).padStart(4)} skips`);
    }
  }

  // Recent skip lines
  const skips = queries.skipPatterns(db, {
    sinceDays: args.days,
    project: args.project,
    limit: args.limit ?? 25,
  });
  if (skips.length > 0) {
    console.log("");
    console.log(
      kleur.bold("Recent skip lines") +
        kleur.gray(args.days ? ` · last ${args.days}d` : "") +
        kleur.gray(args.project ? ` · ${args.project}` : ""),
    );
    console.log(kleur.gray("  " + "─".repeat(70)));
    for (const s of skips.slice(0, args.limit ?? 25)) {
      const ts = s.ts ? new Date(s.ts).toISOString().slice(0, 16).replace("T", " ") : "—";
      const proj = s.project ? (s.project.length > 32 ? "…" + s.project.slice(-31) : s.project) : "(no project)";
      const phrase = kleur.yellow(`"${s.phrase}"`);
      console.log(`  ${kleur.gray(ts)}  ${kleur.cyan(s.source.padEnd(11))}  ${proj.padEnd(34)}  ${phrase}`);
      const snippetClean = s.snippet.replace(new RegExp(`(${s.phrase})`, "ig"), kleur.yellow("$1"));
      console.log(`    ${kleur.gray("…")}${snippetClean}${kleur.gray("…")}`);
      console.log(`    ${kleur.gray("session:")} ${s.sessionId}`);
    }
    console.log("");
  } else {
    console.log("");
    log.info(`No skip phrases found${args.days ? ` in the last ${args.days}d` : ""}.`);
  }

  if (stats.bySource.length === 0) {
    log.hint("No assistant messages indexed yet — run `crixin ingest` first.");
  } else {
    log.hint("Tip: pipe to `--json` for machine-readable output, or filter with `--project foo` / `--days 7`.");
  }
}
