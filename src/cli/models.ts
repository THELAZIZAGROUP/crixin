/**
 * `crixin models` — F2
 * Free: top model + share %
 * Pro:  full breakdown w/ cost + drill-down per project
 */
import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";
import { isPro, PRO_BADGE, PRO_UPGRADE_HINT } from "../license/features.js";
import kleur from "kleur";

export function runModels(): void {
  const db = getDb();
  const rows = queries.topModels(db, isPro() ? 20 : 3);

  if (rows.length === 0) {
    console.log(kleur.gray("No model data yet — run `crixin ingest` first."));
    return;
  }

  console.log("");
  console.log(kleur.bold(isPro() ? "Models · top 20" : "Models · top 3"));
  console.log(kleur.gray("  ─────────────────"));
  for (const r of rows) {
    const pct = (r.pctOfTotal * 100).toFixed(1) + "%";
    const cost = "$" + (r.costCents / 100).toFixed(2);
    const shortModel = r.model.length > 32 ? r.model.slice(0, 32) + "…" : r.model;
    if (isPro()) {
      console.log(
        `  ${kleur.cyan(shortModel.padEnd(34))}  ${pct.padStart(7)}  ${cost.padStart(10)}  ${String(r.messages).padStart(7)} msgs  ${String(r.sessions).padStart(4)} sessions`,
      );
    } else {
      console.log(`  ${kleur.cyan(shortModel.padEnd(34))}  ${pct.padStart(7)}`);
    }
  }
  if (!isPro()) {
    console.log("");
    console.log(kleur.gray(`  ${PRO_BADGE} ${PRO_UPGRADE_HINT}`));
    console.log(kleur.gray("  Pro adds: cost per model, full top-20, per-project drill-down, monthly trends."));
  }
  console.log("");
}
