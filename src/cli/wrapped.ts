import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ingestAll } from "../ingesters/index.js";
import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";
import { renderWrappedHtml } from "../wrapped/render.js";
import { log } from "../lib/log.js";
import kleur from "kleur";

interface WrappedArgs {
  year: number;
  out: string;
  anonymize: boolean;
  reindex: boolean;
}

/** `crixin wrapped` — generate the static annual report. */
export function runWrapped(args: WrappedArgs): void {
  if (args.reindex) {
    log.info("Re-ingesting before report…");
    ingestAll();
  }
  const db = getDb();

  // Reuse the cross-source aggregates and filter by the requested year.
  const start = Date.UTC(args.year, 0, 1);
  const end = Date.UTC(args.year + 1, 0, 1);

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS sessions,
              COALESCE(SUM(message_count), 0) AS messages,
              COALESCE(SUM(COALESCE(ended_at, 0) - COALESCE(started_at, 0)), 0) AS dur,
              COALESCE(SUM(cost_usd_cents), 0) AS cost
         FROM sessions
        WHERE started_at IS NOT NULL AND started_at >= ? AND started_at < ?`,
    )
    .get(start, end) as { sessions: number; messages: number; dur: number; cost: number };

  if (totals.sessions === 0) {
    log.warn(`No sessions found for ${args.year}.`);
    log.hint("Try without --year, or run `crixin ingest` first.");
    process.exitCode = 1;
    return;
  }

  const topProjects = db
    .prepare(
      `SELECT COALESCE(project, '(no project)') AS project, COUNT(*) AS count
         FROM sessions
        WHERE started_at >= ? AND started_at < ?
     GROUP BY project ORDER BY count DESC LIMIT 5`,
    )
    .all(start, end) as unknown as { project: string; count: number }[];

  const bySource = db
    .prepare(
      `SELECT source, COUNT(*) AS count, COALESCE(SUM(cost_usd_cents), 0) AS costCents
         FROM sessions
        WHERE started_at >= ? AND started_at < ?
     GROUP BY source ORDER BY count DESC`,
    )
    .all(start, end) as unknown as {
    source: string;
    count: number;
    costCents: number;
  }[];

  const byHour = db
    .prepare(
      `SELECT CAST(strftime('%H', m.ts/1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
              COUNT(*) AS count
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
        WHERE m.role = 'user' AND m.ts IS NOT NULL
          AND s.started_at >= ? AND s.started_at < ?
     GROUP BY hour ORDER BY hour ASC`,
    )
    .all(start, end) as unknown as { hour: number; count: number }[];

  const byDow = db
    .prepare(
      `SELECT CAST(strftime('%w', m.ts/1000, 'unixepoch', 'localtime') AS INTEGER) AS dow,
              COUNT(*) AS count
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
        WHERE m.role = 'user' AND m.ts IS NOT NULL
          AND s.started_at >= ? AND s.started_at < ?
     GROUP BY dow ORDER BY dow ASC`,
    )
    .all(start, end) as unknown as { dow: number; count: number }[];

  const byMonth = db
    .prepare(
      `SELECT strftime('%Y-%m', started_at/1000, 'unixepoch', 'localtime') AS month,
              COUNT(*) AS sessions,
              COALESCE(SUM(cost_usd_cents), 0) AS costCents
         FROM sessions
        WHERE started_at >= ? AND started_at < ?
     GROUP BY month ORDER BY month ASC`,
    )
    .all(start, end) as unknown as {
    month: string;
    sessions: number;
    costCents: number;
  }[];

  const longSessions = db
    .prepare(
      `SELECT COUNT(*) AS n FROM sessions
        WHERE started_at >= ? AND started_at < ?
          AND ended_at IS NOT NULL AND started_at IS NOT NULL
          AND (ended_at - started_at) >= 3600000`,
    )
    .get(start, end) as { n: number };

  const userVsAsst = db
    .prepare(
      `SELECT
         SUM(CASE WHEN m.role = 'user' THEN 1 ELSE 0 END) AS u,
         SUM(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END) AS a
       FROM messages m JOIN sessions s ON s.id = m.session_id
       WHERE s.started_at >= ? AND s.started_at < ?`,
    )
    .get(start, end) as { u: number | null; a: number | null };

  const busiestHour =
    byHour.length > 0
      ? byHour.reduce((a, b) => (b.count > a.count ? b : a)).hour
      : null;

  const html = renderWrappedHtml(
    {
      year: args.year,
      totalSessions: totals.sessions,
      totalMessages: totals.messages,
      totalDurationMs: totals.dur,
      totalCostCents: totals.cost,
      topProjects,
      bySource,
      byHour,
      byDayOfWeek: byDow,
      byMonth,
      busiestHour,
      longSessionCount: longSessions.n,
      userMessages: userVsAsst.u ?? 0,
      assistantMessages: userVsAsst.a ?? 0,
    },
    { anonymize: args.anonymize },
  );

  const outPath = resolve(args.out);
  writeFileSync(outPath, html);
  log.success(`Wrote ${kleur.cyan(outPath)}`);
  log.hint(`Open it: open "${outPath}"`);
  log.hint("Screenshot the page and post it. PII is " + (args.anonymize ? "stripped." : "INCLUDED — pass --anonymize to strip."));
}
