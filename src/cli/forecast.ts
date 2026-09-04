/**
 * `crixin forecast` — F1
 * Free: total YTD spend
 * Pro:  + 30/90 day projections + per-project breakdown + run-rate
 */
import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";
import { isPro, PRO_BADGE, PRO_UPGRADE_HINT } from "../license/features.js";
import { log } from "../lib/log.js";
import kleur from "kleur";

export function runForecast(): void {
  const db = getDb();
  const f = queries.costForecast(db);
  const fmt = (c: number) => "$" + (c / 100).toFixed(2);

  console.log("");
  console.log(kleur.bold("Cost forecast"));
  console.log(kleur.gray("  ─────────────"));
  console.log(`  Year-to-date:    ${kleur.cyan(fmt(f.ytdCents))}`);

  if (isPro()) {
    console.log(`  Last 7 days:     ${fmt(f.last7dCents)}`);
    console.log(`  Last 30 days:    ${fmt(f.last30dCents)}`);
    console.log("");
    console.log(kleur.bold("Projections ") + kleur.gray(`(linear, from last-30d burn — ${f.daysOfData} days of data)`));
    console.log(`  End of month:    ${kleur.yellow(fmt(f.projectedMonthEndCents))}`);
    console.log(`  End of year:     ${kleur.yellow(fmt(f.projectedYearEndCents))}`);
    console.log("");
    const dailyBurn = f.last30dCents / 30;
    console.log(kleur.gray(`  Avg daily burn (30d): ${fmt(Math.round(dailyBurn))}`));

    // Per-project — Pro adds the breakdown
    console.log("");
    console.log(kleur.bold("Top projects by cost"));
    const proj = queries.byProject(db, 6);
    for (const p of proj) {
      const proj = p.project.length > 40 ? p.project.slice(-40) : p.project;
      console.log(`  ${proj.padEnd(40)}  ${fmt(p.costCents).padStart(8)}  ${String(p.sessions).padStart(4)} sessions`);
    }
  } else {
    console.log("");
    console.log(kleur.gray(`  ${PRO_BADGE} ${PRO_UPGRADE_HINT}`));
    console.log(kleur.gray("  Pro adds: 30/90-day projections, per-project breakdown, daily burn rate."));
  }
  console.log("");
  log.hint("Reminder: API-equivalent — your Claude Pro subscription bills flat-rate.");
}
