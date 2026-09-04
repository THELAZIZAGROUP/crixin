/**
 * `crixin projects` — F12 (Pro)
 * Side-by-side per-project comparison: cost, sessions, msgs, tokens, avg duration.
 */
import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";
import { isPro, PRO_BADGE, PRO_UPGRADE_HINT } from "../license/features.js";
import { log } from "../lib/log.js";
import kleur from "kleur";

export function runProjects(): void {
  if (!isPro()) {
    log.warn("Multi-project comparison is Pro-only.");
    log.hint(`${PRO_BADGE} ${PRO_UPGRADE_HINT}`);
    return;
  }
  const db = getDb();
  const rows = queries.byProject(db, 25);
  if (rows.length === 0) {
    console.log(kleur.gray("No project data yet — run `crixin ingest`."));
    return;
  }
  const fmt$ = (c: number) => "$" + (c / 100).toFixed(2);
  const fmtM = (ms: number) => (ms / 60000).toFixed(0) + "m";
  console.log("");
  console.log(kleur.bold("Projects · top 25 by cost"));
  console.log(kleur.gray("  " + "─".repeat(76)));
  console.log(
    `  ${"project".padEnd(36)}  ${"cost".padStart(8)}  ${"sessions".padStart(8)}  ${"msgs".padStart(7)}  ${"avg".padStart(6)}`,
  );
  console.log(kleur.gray("  " + "─".repeat(76)));
  for (const r of rows) {
    const proj = r.project.length > 35 ? "…" + r.project.slice(-34) : r.project;
    console.log(
      `  ${kleur.cyan(proj.padEnd(36))}  ${fmt$(r.costCents).padStart(8)}  ${String(r.sessions).padStart(8)}  ${String(r.messages).padStart(7)}  ${fmtM(r.avgSessionMs).padStart(6)}`,
    );
  }
  console.log("");
}
