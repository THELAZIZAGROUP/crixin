/**
 * `crixin report` — F11 (Pro)
 * Renders a DORA/SPACE-aligned productivity report from session data.
 *
 * Mapping (we map session-level signals onto each framework dimension):
 *   Activity     ← sessions/day, messages/day, distinct projects
 *   Performance  ← cost-per-output-Ktok (lower is better; signals model efficiency)
 *   Efficiency   ← avg session duration, avg messages-per-session
 *   Flow         ← longest contiguous block of activity (gap < 30min)
 *
 * Outputs both terminal table + a static HTML for management hand-off.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";
import { isPro, PRO_BADGE, PRO_UPGRADE_HINT } from "../license/features.js";
import { log } from "../lib/log.js";
import kleur from "kleur";

interface ReportArgs {
  windowDays: number;
  out?: string;
  format: "term" | "html" | "both";
}

export function runReport(args: ReportArgs): void {
  if (!isPro()) {
    log.error("Productivity reports are Pro-only.");
    log.hint(`${PRO_BADGE} ${PRO_UPGRADE_HINT}`);
    return;
  }
  const db = getDb();
  const r = queries.productivityReport(db, args.windowDays);
  const fmt = (n: number, d = 1) => Number(n.toFixed(d)).toLocaleString();

  if (args.format === "term" || args.format === "both") {
    console.log("");
    console.log(kleur.bold(`Productivity report · last ${args.windowDays}d`));
    console.log(kleur.gray("  " + "─".repeat(60)));
    console.log(`  ${kleur.cyan("Activity")}`);
    console.log(`    Sessions/day:        ${fmt(r.activity.sessionsPerDay, 2)}`);
    console.log(`    Messages/day:        ${fmt(r.activity.messagesPerDay, 0)}`);
    console.log(`    Projects touched:    ${r.activity.projectsTouched}`);
    console.log(`  ${kleur.cyan("Performance")}`);
    console.log(`    $ per 1K output tok: $${fmt(r.performance.costCentsPerOutputKtok / 100, 4)}`);
    console.log(`    Output tokens:       ${fmt(r.performance.outputTokens, 0)}`);
    console.log(`  ${kleur.cyan("Efficiency")}`);
    console.log(`    Avg session minutes: ${fmt(r.efficiency.avgSessionMinutes, 1)}`);
    console.log(`    Avg msgs/session:    ${fmt(r.efficiency.avgMessagesPerSession, 1)}`);
    console.log(`  ${kleur.cyan("Flow")}`);
    console.log(`    Longest focus block: ${fmt(r.flow.longestFocusBlockMinutes, 0)} min`);
    console.log(`    Blocks > 1 hour:     ${r.flow.focusBlocksOverHour}`);
    console.log("");
  }

  if (args.format === "html" || args.format === "both") {
    const html = renderReportHtml(r);
    const out = args.out ?? resolve(process.cwd(), `crixin-report-${new Date().toISOString().slice(0, 10)}.html`);
    writeFileSync(out, html);
    log.success(`Wrote ${out}`);
  }
}

function renderReportHtml(r: ReturnType<typeof queries.productivityReport>): string {
  const fmt = (n: number, d = 1) => Number(n.toFixed(d)).toLocaleString();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>Crixin Productivity Report</title>
<style>
  body { font-family: Inter, -apple-system, system-ui, sans-serif; background: #0b0d12; color: #e6e8ef; max-width: 760px; margin: 48px auto; padding: 0 24px; }
  h1 { font-weight: 700; letter-spacing: -0.02em; margin: 0 0 8px; font-size: 32px; }
  .lede { color: #9097a8; margin: 0 0 32px; }
  h2 { font-size: 16px; text-transform: uppercase; letter-spacing: 0.10em; color: #f5b452; margin: 28px 0 12px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 8px 0; border-bottom: 1px dashed #272a35; }
  td:last-child { text-align: right; font-weight: 600; }
  .footer { color: #5b6075; font-size: 12px; margin-top: 40px; }
</style></head>
<body>
<h1>Productivity Report</h1>
<p class="lede">Last ${r.rangeDays} days · DORA/SPACE-aligned proxies derived from local AI coding session data.</p>

<h2>Activity</h2>
<table>
<tr><td>Sessions per day</td><td>${fmt(r.activity.sessionsPerDay, 2)}</td></tr>
<tr><td>Messages per day</td><td>${fmt(r.activity.messagesPerDay, 0)}</td></tr>
<tr><td>Distinct projects touched</td><td>${r.activity.projectsTouched}</td></tr>
</table>

<h2>Performance</h2>
<table>
<tr><td>USD per 1K output tokens (lower = more efficient)</td><td>$${fmt(r.performance.costCentsPerOutputKtok / 100, 4)}</td></tr>
<tr><td>Total output tokens</td><td>${fmt(r.performance.outputTokens, 0)}</td></tr>
</table>

<h2>Efficiency</h2>
<table>
<tr><td>Average session length</td><td>${fmt(r.efficiency.avgSessionMinutes, 1)} min</td></tr>
<tr><td>Average messages per session</td><td>${fmt(r.efficiency.avgMessagesPerSession, 1)}</td></tr>
</table>

<h2>Flow</h2>
<table>
<tr><td>Longest contiguous focus block</td><td>${fmt(r.flow.longestFocusBlockMinutes, 0)} min</td></tr>
<tr><td>Focus blocks over 1 hour</td><td>${r.flow.focusBlocksOverHour}</td></tr>
</table>

<p class="footer">Generated ${new Date().toISOString().slice(0, 10)} by Crixin · local-first · zero data left this laptop.</p>
</body></html>`;
}
