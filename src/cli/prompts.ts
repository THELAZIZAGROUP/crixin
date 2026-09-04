/**
 * `crixin prompts` — F6
 * Free: top 3 longest user prompts (read-only)
 * Pro:  top 50 + per-project filter
 */
import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";
import { isPro, PRO_BADGE, PRO_UPGRADE_HINT } from "../license/features.js";
import kleur from "kleur";

interface PromptsArgs {
  limit?: number;
  project?: string;
  json?: boolean;
}

export function runPrompts(args: PromptsArgs): void {
  const db = getDb();
  const limit = isPro() ? Math.min(args.limit ?? 50, 200) : 3;
  let rows = queries.topPrompts(db, isPro() ? 200 : 50);
  if (args.project && isPro()) {
    rows = rows.filter((r) => r.project?.includes(args.project!));
  }
  rows = rows.slice(0, limit);

  if (args.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
    return;
  }

  if (rows.length === 0) {
    console.log(kleur.gray("No prompts in the corpus yet."));
    return;
  }

  console.log("");
  console.log(kleur.bold(isPro() ? `Top ${limit} prompts` : "Top 3 prompts (Free)"));
  console.log(kleur.gray("  " + "─".repeat(60)));
  for (const [i, p] of rows.entries()) {
    const proj = p.project ? p.project.split("/").pop()! : "(no project)";
    const ts = p.ts ? new Date(p.ts).toISOString().slice(0, 10) : "—";
    console.log(`  ${kleur.cyan(`#${i + 1}`)}  ${ts}  ${kleur.gray(proj.slice(-32))}  ${kleur.gray(`(${p.length} chars)`)}`);
    const snippet = p.content.replace(/\s+/g, " ").trim().slice(0, 220);
    console.log("    " + snippet + (p.content.length > 220 ? "…" : ""));
    console.log("");
  }
  if (!isPro()) {
    console.log(kleur.gray(`  ${PRO_BADGE} ${PRO_UPGRADE_HINT}`));
    console.log(kleur.gray("  Pro adds: top 200, per-project filter, JSON export, save/star/tag."));
    console.log("");
  }
}
