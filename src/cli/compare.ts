/**
 * `crixin compare <a> <b>` — F13 (Free)
 * Side-by-side diff of two sessions.
 */
import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";
import { log } from "../lib/log.js";
import kleur from "kleur";

export function runCompare(aId: string, bId: string): void {
  const db = getDb();
  const c = queries.compareSessions(db, aId, bId);
  if (!c.a || !c.b) {
    log.error("Could not find one or both sessions:");
    if (!c.a) log.hint(`  - missing: ${aId}`);
    if (!c.b) log.hint(`  - missing: ${bId}`);
    process.exitCode = 1;
    return;
  }
  const fmt$ = (c: number) => "$" + (c / 100).toFixed(2);
  const fmtM = (ms: number | null) => (ms ? Math.round(ms / 60000) + "m" : "—");
  const dur = (a: { started_at: number | null; ended_at: number | null }) =>
    a.ended_at && a.started_at ? a.ended_at - a.started_at : null;

  const row = (label: string, a: string, b: string) =>
    `  ${kleur.gray(label.padEnd(18))}  ${a.padStart(20)}  ${b.padStart(20)}`;

  console.log("");
  console.log(kleur.bold("Compare sessions"));
  console.log(kleur.gray("  " + "─".repeat(60)));
  console.log(row("", kleur.cyan("A"), kleur.cyan("B")));
  console.log(row("session id", c.a.id.slice(0, 18), c.b.id.slice(0, 18)));
  console.log(row("source", c.a.source, c.b.source));
  console.log(row("project", (c.a.project ?? "—").slice(-18), (c.b.project ?? "—").slice(-18)));
  console.log(row("messages", String(c.a.message_count), String(c.b.message_count)));
  console.log(row("user / asst", `${c.aShape.user}/${c.aShape.assistant}`, `${c.bShape.user}/${c.bShape.assistant}`));
  console.log(row("duration", fmtM(dur(c.a)), fmtM(dur(c.b))));
  console.log(row("est. cost", fmt$(c.a.cost_usd_cents), fmt$(c.b.cost_usd_cents)));
  console.log(row("input tokens", String(c.a.prompt_tokens), String(c.b.prompt_tokens)));
  console.log(row("output tokens", String(c.a.output_tokens), String(c.b.output_tokens)));
  console.log(row("longest msg", String(c.aShape.longest), String(c.bShape.longest)));
  console.log("");
}
