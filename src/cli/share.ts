/**
 * `crixin share` — F14 (Pro)
 *
 * Generate-and-upload-and-share, in one command.
 *
 *   crixin share              → mint local token, generate Wrapped HTML,
 *                               POST to https://crixin.com/api/share with
 *                               the active license token, print the
 *                               public URL.
 *   crixin share list         → all share tokens this machine has issued.
 *   crixin share revoke <t>   → mark revoked locally + best-effort POST
 *                               revocation to the API.
 *
 * The local persistence in `share_tokens` mirrors what we send to the API
 * so the user can audit / re-fetch from disk.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { getDb } from "../db/init.js";
import { isPro, PRO_BADGE, PRO_UPGRADE_HINT } from "../license/features.js";
import { paths } from "../lib/paths.js";
import { renderWrappedHtml } from "../wrapped/render.js";
import { log } from "../lib/log.js";
import kleur from "kleur";

interface ShareArgs {
  year: number;
  out?: string;
  ttlDays?: number;
}

const SHARE_API = process.env["CRIXIN_SHARE_API"] ?? "https://crixin.com/api/share";

export async function runShare(args: ShareArgs): Promise<void> {
  if (!isPro()) {
    log.error("Share links are Pro-only.");
    log.hint(`${PRO_BADGE} ${PRO_UPGRADE_HINT}`);
    return;
  }

  // Need the JWT for upload auth.
  let token: string | undefined;
  if (existsSync(paths.licenseFile)) {
    try {
      const j = JSON.parse(readFileSync(paths.licenseFile, "utf8")) as { token?: string };
      token = j.token;
    } catch {}
  }
  if (!token) {
    log.error("No license token on disk — `crixin license activate <token>` first.");
    log.hint("(CRIXIN_PRO=1 unlocks Pro features but doesn't grant a publishable share license.)");
    return;
  }

  const shareToken = generateToken();
  const ttlDays = args.ttlDays ?? 30;
  const expiresAt = ttlDays > 0 ? Date.now() + ttlDays * 86400000 : null;

  log.info("Building Wrapped report…");
  const html = buildWrappedFor(args.year);
  if (!html) {
    log.error("No data for that year — run `crixin ingest` first.");
    return;
  }

  log.info(`Uploading to ${SHARE_API}…`);
  let publicUrl: string;
  try {
    const r = await fetch(SHARE_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: shareToken,
        scope: "wrapped",
        year: args.year,
        html,
        ttlDays,
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      log.error(`Upload failed: ${r.status} ${errText.slice(0, 200)}`);
      if (r.status === 401) log.hint("License JWT may have expired — open the customer portal to reissue.");
      return;
    }
    const j = (await r.json()) as { url?: string };
    publicUrl = j.url ?? `${SHARE_API.replace("/api/share", "")}/api/share/${shareToken}`;
  } catch (err) {
    log.error("Upload failed: " + (err instanceof Error ? err.message : String(err)));
    return;
  }

  // Persist locally
  const db = getDb();
  db.prepare(
    `INSERT INTO share_tokens (token, scope, year, remote_url, created_at, expires_at, revoked)
     VALUES (?, 'wrapped', ?, ?, ?, ?, 0)`,
  ).run(shareToken, args.year, publicUrl, Date.now(), expiresAt);

  // Save HTML locally too — useful for "what did I share?" audit
  const out = args.out ?? resolve(process.cwd(), `crixin-share-${shareToken}.html`);
  writeFileSync(out, html);

  console.log("");
  console.log(kleur.bold("✓ Share link created"));
  console.log(`  URL:        ${kleur.cyan(publicUrl)}`);
  console.log(`  Token:      ${shareToken}`);
  console.log(`  Year:       ${args.year}`);
  console.log(`  TTL:        ${ttlDays} days`);
  console.log(`  Local copy: ${kleur.gray(out)}`);
  console.log("");
  log.hint("Anyone with the URL can view the report. Project names were anonymized before upload.");
}

export function runShareList(): void {
  if (!isPro()) {
    log.error("Share links are Pro-only.");
    return;
  }
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM share_tokens ORDER BY created_at DESC`)
    .all() as {
    token: string;
    scope: string;
    year: number | null;
    remote_url: string | null;
    created_at: number;
    expires_at: number | null;
    revoked: number;
  }[];
  if (rows.length === 0) {
    console.log(kleur.gray("No share tokens yet."));
    return;
  }
  console.log("");
  console.log(kleur.bold("Share tokens"));
  for (const r of rows) {
    const exp = r.expires_at ? new Date(r.expires_at).toISOString().slice(0, 10) : "no expiry";
    const status = r.revoked ? kleur.red("revoked") : kleur.green("active");
    console.log(`  ${r.token}  ${r.scope}/${r.year ?? "—"}  ${exp}  ${status}`);
    if (r.remote_url) console.log(`    ${kleur.gray(r.remote_url)}`);
  }
  console.log("");
}

export function runShareRevoke(token: string): void {
  if (!isPro()) {
    log.error("Share links are Pro-only.");
    return;
  }
  const db = getDb();
  db.prepare(`UPDATE share_tokens SET revoked = 1 WHERE token = ?`).run(token);
  log.success(`Token revoked locally: ${token}`);
  log.hint("Remote revocation lands in v0.0.6 with the DELETE /api/share/:token endpoint.");
}

// ---------------------------------------------------------------------------

function generateToken(): string {
  return randomBytes(20)
    .toString("base64")
    .replace(/[+/=]/g, "")
    .slice(0, 32);
}

function buildWrappedFor(year: number): string | null {
  const db = getDb();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);

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
  if (totals.sessions === 0) return null;

  const topProjects = db
    .prepare(
      `SELECT COALESCE(project, '(no project)') AS project, COUNT(*) AS count
         FROM sessions WHERE started_at >= ? AND started_at < ?
       GROUP BY project ORDER BY count DESC LIMIT 5`,
    )
    .all(start, end) as { project: string; count: number }[];

  const bySource = db
    .prepare(
      `SELECT source, COUNT(*) AS count, COALESCE(SUM(cost_usd_cents), 0) AS costCents
         FROM sessions WHERE started_at >= ? AND started_at < ?
       GROUP BY source ORDER BY count DESC`,
    )
    .all(start, end) as { source: string; count: number; costCents: number }[];

  const byHour = db
    .prepare(
      `SELECT CAST(strftime('%H', m.ts/1000, 'unixepoch', 'localtime') AS INTEGER) AS hour, COUNT(*) AS count
         FROM messages m JOIN sessions s ON s.id = m.session_id
        WHERE m.role = 'user' AND m.ts IS NOT NULL AND s.started_at >= ? AND s.started_at < ?
       GROUP BY hour ORDER BY hour ASC`,
    )
    .all(start, end) as { hour: number; count: number }[];

  const byDow = db
    .prepare(
      `SELECT CAST(strftime('%w', m.ts/1000, 'unixepoch', 'localtime') AS INTEGER) AS dow, COUNT(*) AS count
         FROM messages m JOIN sessions s ON s.id = m.session_id
        WHERE m.role = 'user' AND m.ts IS NOT NULL AND s.started_at >= ? AND s.started_at < ?
       GROUP BY dow ORDER BY dow ASC`,
    )
    .all(start, end) as { dow: number; count: number }[];

  const byMonth = db
    .prepare(
      `SELECT strftime('%Y-%m', started_at/1000, 'unixepoch', 'localtime') AS month,
              COUNT(*) AS sessions,
              COALESCE(SUM(cost_usd_cents), 0) AS costCents
         FROM sessions WHERE started_at >= ? AND started_at < ?
       GROUP BY month ORDER BY month ASC`,
    )
    .all(start, end) as { month: string; sessions: number; costCents: number }[];

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
      `SELECT SUM(CASE WHEN m.role='user' THEN 1 ELSE 0 END) AS u,
              SUM(CASE WHEN m.role='assistant' THEN 1 ELSE 0 END) AS a
         FROM messages m JOIN sessions s ON s.id = m.session_id
        WHERE s.started_at >= ? AND s.started_at < ?`,
    )
    .get(start, end) as { u: number | null; a: number | null };

  const busiestHour = byHour.length > 0
    ? byHour.reduce((a, b) => (b.count > a.count ? b : a)).hour
    : null;

  return renderWrappedHtml(
    {
      year,
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
    { anonymize: true }, // ALWAYS anonymize for shared content
  );
}
