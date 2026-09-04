/**
 * `crixin alert` — F9 (Pro)
 *
 * Subcommands:
 *   crixin alert add daily 500           — fire when daily spend hits $5.00
 *   crixin alert add weekly 5000          — weekly threshold $50.00
 *   crixin alert add monthly 20000 --project foo
 *   crixin alert list
 *   crixin alert rm <id>
 *   crixin alert check                    — run threshold check now (called by cron / widget)
 */
import { getDb } from "../db/init.js";
import { isPro, PRO_BADGE, PRO_UPGRADE_HINT } from "../license/features.js";
import { log } from "../lib/log.js";
import { spawn } from "node:child_process";
import kleur from "kleur";

interface AlertRow {
  id: number;
  kind: "cost_daily" | "cost_weekly" | "cost_monthly";
  threshold_cents: number;
  project: string | null;
  enabled: number;
  last_fired_at: number | null;
  created_at: number;
}

export function runAlert(args: { positionals: string[]; flags: Record<string, string | boolean> }): void {
  if (!isPro() && (args.positionals[0] === "add" || args.positionals[0] === undefined)) {
    log.error("Cost alerts are Pro-only.");
    log.hint(`${PRO_BADGE} ${PRO_UPGRADE_HINT}`);
    return;
  }
  const db = getDb();
  const [sub, ...rest] = args.positionals;

  if (sub === "add") {
    const [kind, threshold] = rest;
    const validKinds = ["daily", "weekly", "monthly"] as const;
    if (!validKinds.includes(kind as (typeof validKinds)[number])) {
      log.error("Usage: crixin alert add <daily|weekly|monthly> <cents> [--project foo]");
      process.exitCode = 1; return;
    }
    const cents = parseInt(threshold ?? "0", 10);
    if (!Number.isFinite(cents) || cents <= 0) { log.error("Threshold must be a positive integer (cents)."); return; }
    const project = typeof args.flags["project"] === "string" ? args.flags["project"] : null;
    db.prepare(
      `INSERT INTO alerts (kind, threshold_cents, project, enabled, created_at)
       VALUES (?, ?, ?, 1, ?)`,
    ).run(`cost_${kind}`, cents, project, Date.now());
    log.success(`Alert added: ${kind} $${(cents / 100).toFixed(2)}${project ? " · " + project : ""}`);
    return;
  }

  if (sub === "rm") {
    const id = parseInt(rest[0] ?? "", 10);
    if (!id) { log.error("Usage: crixin alert rm <id>"); return; }
    db.prepare(`DELETE FROM alerts WHERE id = ?`).run(id);
    log.success(`Removed alert ${id}.`);
    return;
  }

  if (sub === "check") {
    runAlertCheck();
    return;
  }

  // list (default)
  const rows = db.prepare(`SELECT * FROM alerts ORDER BY id`).all() as unknown as AlertRow[];
  if (rows.length === 0) {
    console.log(kleur.gray("No alerts configured. `crixin alert add weekly 5000` to add one."));
    return;
  }
  console.log("");
  console.log(kleur.bold("Alerts"));
  for (const r of rows) {
    const proj = r.project ? ` · ${r.project}` : "";
    const fired = r.last_fired_at ? ` (last: ${new Date(r.last_fired_at).toISOString().slice(0, 10)})` : "";
    console.log(`  #${r.id}  ${r.kind.padEnd(14)} $${(r.threshold_cents / 100).toFixed(2).padStart(8)}${proj}${kleur.gray(fired)}`);
  }
  console.log("");
}

/** Called by widget tick (or by `crixin alert check`) — fires notifications. */
export function runAlertCheck(): void {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM alerts WHERE enabled = 1`)
    .all() as unknown as AlertRow[];
  if (rows.length === 0) return;

  const now = Date.now();
  const periodStart = (kind: AlertRow["kind"]) => {
    const d = new Date(now);
    if (kind === "cost_daily") return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (kind === "cost_weekly") {
      const day = d.getDay() || 7;
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() - (day - 1)).getTime();
    }
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  };

  for (const a of rows) {
    const start = periodStart(a.kind);
    if (a.last_fired_at && a.last_fired_at >= start) continue;
    const where = a.project ? `AND project = ?` : "";
    const params: (number | string)[] = [start];
    if (a.project) params.push(a.project);
    const r = db
      .prepare(`SELECT COALESCE(SUM(cost_usd_cents),0) AS c FROM sessions WHERE started_at >= ? ${where}`)
      .get(...params) as { c: number };
    if (r.c >= a.threshold_cents) {
      const period = a.kind.replace("cost_", "");
      const msg = `${period} spend ${a.project ? "for " + a.project : ""} crossed $${(a.threshold_cents / 100).toFixed(2)} (now $${(r.c / 100).toFixed(2)})`;
      notify("Crixin alert", msg);
      db.prepare(`UPDATE alerts SET last_fired_at = ? WHERE id = ?`).run(now, a.id);
      log.warn(`fired alert #${a.id}: ${msg}`);
    }
  }
}

function notify(title: string, body: string) {
  const escTitle = title.replace(/"/g, '\\"');
  const escBody = body.replace(/"/g, '\\"').replace(/\n/g, "\\n");
  spawn("osascript", ["-e", `display notification "${escBody}" with title "${escTitle}"`]);
}
