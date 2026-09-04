/**
 * Voice analyzer engines — the post-pivot replacement for the session-based
 * wrapped / archetype / skipped engines. Same algorithms in spirit, new
 * corpus: Twilio call records + Deepgram transcripts in voice_calls.
 *
 * Three CLI surfaces feed into the helpers here:
 *   - `crixin voice wrapped`   — annual recap, HTML
 *   - `crixin voice archetype` — caller-style classifier (Closer / Listener / Ducker / …)
 *   - `crixin voice ducked`    — phrases your AI uses to dodge questions in calls
 *
 * All three are deterministic. No LLM calls, no telemetry, no network beyond
 * what `crixin voice ingest` did to fill the local DB.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb } from "../db/init.js";
import { log } from "../lib/log.js";
import kleur from "kleur";

// =============================================================================
//  Voice Wrapped
// =============================================================================

interface WrappedStats {
  year: number;
  totalCalls: number;
  completedCalls: number;
  totalMinutes: number;
  totalCostCents: number;
  uniqueDestinations: number;
  topDestinationCountries: Array<{ country: string; count: number; minutes: number }>;
  busiestHour: number | null;        // 0..23
  longestCallSeconds: number | null;
  longestCallSid: string | null;
  avgCallSeconds: number | null;
  topOutcomes: Array<{ outcome: string; count: number }>;
  topCampaigns: Array<{ campaign: string; count: number; minutes: number }>;
  transcribedCount: number;          // how many calls have transcript_text
  topLanguages: Array<{ language: string; count: number }>;
}

export function computeVoiceWrapped(year: number = new Date().getFullYear()): WrappedStats {
  const db = getDb();
  const yearStart = Date.UTC(year, 0, 1);
  const yearEnd = Date.UTC(year + 1, 0, 1);

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
              SUM(duration_seconds) AS dur,
              SUM(price_cents) AS cost,
              COUNT(DISTINCT to_number) AS uniqueTo,
              SUM(CASE WHEN transcript_text IS NOT NULL AND length(transcript_text) > 0 THEN 1 ELSE 0 END) AS transcribed
         FROM voice_calls
        WHERE started_at >= ? AND started_at < ?`,
    )
    .get(yearStart, yearEnd) as {
    total: number;
    completed: number;
    dur: number | null;
    cost: number | null;
    uniqueTo: number;
    transcribed: number;
  };

  const longest = db
    .prepare(
      `SELECT sid, duration_seconds FROM voice_calls
        WHERE started_at >= ? AND started_at < ?
        ORDER BY duration_seconds DESC LIMIT 1`,
    )
    .get(yearStart, yearEnd) as { sid: string; duration_seconds: number } | undefined;

  const busiestHourRow = db
    .prepare(
      `SELECT CAST(strftime('%H', started_at/1000, 'unixepoch', 'localtime') AS INTEGER) AS hr,
              COUNT(*) AS n
         FROM voice_calls
        WHERE started_at >= ? AND started_at < ?
        GROUP BY hr ORDER BY n DESC LIMIT 1`,
    )
    .get(yearStart, yearEnd) as { hr: number; n: number } | undefined;

  // Country breakdown — strip + and treat the leading 1-3 digits as the
  // country code lookup. Cheap heuristic; good enough for Wrapped.
  const byCountryRows = db
    .prepare(
      `SELECT to_number, COUNT(*) AS n, SUM(duration_seconds) AS dur
         FROM voice_calls
        WHERE started_at >= ? AND started_at < ? AND to_number IS NOT NULL
        GROUP BY to_number`,
    )
    .all(yearStart, yearEnd) as Array<{ to_number: string; n: number; dur: number }>;

  const byCountry = new Map<string, { count: number; minutes: number }>();
  for (const r of byCountryRows) {
    const cc = countryCodeFor(r.to_number);
    const cur = byCountry.get(cc) ?? { count: 0, minutes: 0 };
    cur.count += r.n;
    cur.minutes += Math.round((r.dur ?? 0) / 60);
    byCountry.set(cc, cur);
  }
  const topDestinationCountries = [...byCountry.entries()]
    .map(([country, v]) => ({ country, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const outcomeRows = db
    .prepare(
      `SELECT outcome, COUNT(*) AS n
         FROM voice_calls
        WHERE started_at >= ? AND started_at < ? AND outcome IS NOT NULL
        GROUP BY outcome ORDER BY n DESC LIMIT 5`,
    )
    .all(yearStart, yearEnd) as Array<{ outcome: string; n: number }>;

  const campaignRows = db
    .prepare(
      `SELECT campaign, COUNT(*) AS n, SUM(duration_seconds) AS dur
         FROM voice_calls
        WHERE started_at >= ? AND started_at < ? AND campaign IS NOT NULL
        GROUP BY campaign ORDER BY n DESC LIMIT 5`,
    )
    .all(yearStart, yearEnd) as Array<{ campaign: string; n: number; dur: number }>;

  const langRows = db
    .prepare(
      `SELECT transcript_language AS lang, COUNT(*) AS n
         FROM voice_calls
        WHERE started_at >= ? AND started_at < ? AND transcript_language IS NOT NULL
        GROUP BY lang ORDER BY n DESC LIMIT 5`,
    )
    .all(yearStart, yearEnd) as Array<{ lang: string; n: number }>;

  const total = totals.total ?? 0;
  return {
    year,
    totalCalls: total,
    completedCalls: totals.completed ?? 0,
    totalMinutes: Math.round((totals.dur ?? 0) / 60),
    totalCostCents: totals.cost ?? 0,
    uniqueDestinations: totals.uniqueTo ?? 0,
    topDestinationCountries,
    busiestHour: busiestHourRow?.hr ?? null,
    longestCallSeconds: longest?.duration_seconds ?? null,
    longestCallSid: longest?.sid ?? null,
    avgCallSeconds: total > 0 ? Math.round((totals.dur ?? 0) / total) : null,
    topOutcomes: outcomeRows.map((r) => ({ outcome: r.outcome, count: r.n })),
    topCampaigns: campaignRows.map((r) => ({
      campaign: r.campaign,
      count: r.n,
      minutes: Math.round((r.dur ?? 0) / 60),
    })),
    transcribedCount: totals.transcribed ?? 0,
    topLanguages: langRows.map((r) => ({ language: r.lang, count: r.n })),
  };
}

export function renderVoiceWrappedHtml(s: WrappedStats): string {
  const dollar = (cents: number) =>
    cents === 0 ? "$0" : `$${(cents / 100).toFixed(2)}`;
  const minLabel = (n: number) => `${n.toLocaleString()} min`;
  const hr = (h: number | null) =>
    h == null ? "—" : `${h % 12 || 12} ${h < 12 || h === 24 ? "AM" : "PM"}`;
  const dur = (sec: number | null) => {
    if (sec == null) return "—";
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  };

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8" />
<title>Crixin Voice Wrapped — ${s.year}</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap" />
<style>
  :root {
    --bg: #0a0c11; --surface: #14161e; --border: #1c1f29;
    --text: #f5f5f0; --muted: #9fa3b3; --brand: #f5b452;
    --font: 'Geist', system-ui, sans-serif;
    --mono: 'Geist Mono', ui-monospace, monospace;
    --display: 'Instrument Serif', Georgia, serif;
  }
  * { box-sizing: border-box; }
  body { margin:0; font-family:var(--font); background:var(--bg); color:var(--text); line-height:1.6; }
  .wrap { max-width:880px; margin:0 auto; padding:60px 24px; }
  h1 { font-family:var(--display); font-size:64px; font-weight:400; margin:0 0 8px; line-height:1.1; }
  h1 em { color:var(--brand); }
  .lede { color:var(--muted); font-size:18px; margin:0 0 48px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin:32px 0; }
  .stat { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:20px; }
  .stat .label { font-family:var(--mono); font-size:11px; color:var(--muted); letter-spacing:0.08em; text-transform:uppercase; margin-bottom:8px; }
  .stat .value { font-family:var(--display); font-size:36px; font-weight:400; line-height:1.1; }
  .stat .sub { color:var(--muted); font-size:13px; margin-top:6px; }
  h2 { font-family:var(--display); font-size:32px; font-weight:400; font-style:italic; margin:48px 0 16px; color:var(--brand); }
  table { width:100%; border-collapse:collapse; background:var(--surface); border:1px solid var(--border); border-radius:8px; overflow:hidden; }
  th, td { padding:12px 16px; text-align:left; border-bottom:1px solid var(--border); }
  th { font-family:var(--mono); font-size:11px; color:var(--muted); letter-spacing:0.08em; text-transform:uppercase; }
  tr:last-child td { border-bottom:none; }
  .empty { color:var(--muted); font-style:italic; }
  .footer { margin-top:64px; color:var(--muted); font-size:13px; text-align:center; }
  .footer a { color:var(--brand); }
  .pill { display:inline-block; font-family:var(--mono); font-size:11px; padding:3px 8px; background:var(--brand); color:#0a0c11; border-radius:4px; letter-spacing:0.05em; }
</style></head><body>
<div class="wrap">
  <span class="pill">VOICE MCP · WRAPPED · ${s.year}</span>
  <h1 style="margin-top:14px;">Your year on the <em>phone</em>.</h1>
  <p class="lede">${s.totalCalls.toLocaleString()} call${s.totalCalls === 1 ? "" : "s"} placed in ${s.year}. ${s.totalMinutes.toLocaleString()} minutes on the line. ${dollar(s.totalCostCents)} in Twilio spend. Every byte stayed on your laptop.</p>

  <div class="grid">
    <div class="stat"><div class="label">total calls</div><div class="value">${s.totalCalls.toLocaleString()}</div><div class="sub">${s.completedCalls.toLocaleString()} completed</div></div>
    <div class="stat"><div class="label">total minutes</div><div class="value">${s.totalMinutes.toLocaleString()}</div><div class="sub">avg ${dur(s.avgCallSeconds)} per call</div></div>
    <div class="stat"><div class="label">spend (twilio)</div><div class="value">${dollar(s.totalCostCents)}</div><div class="sub">${s.totalCalls > 0 ? `~${dollar(Math.round(s.totalCostCents / s.totalCalls))}/call` : "no calls yet"}</div></div>
    <div class="stat"><div class="label">unique destinations</div><div class="value">${s.uniqueDestinations.toLocaleString()}</div><div class="sub">distinct phone numbers</div></div>
    <div class="stat"><div class="label">busiest hour</div><div class="value">${hr(s.busiestHour)}</div><div class="sub">most calls placed</div></div>
    <div class="stat"><div class="label">longest call</div><div class="value">${dur(s.longestCallSeconds)}</div><div class="sub">${s.longestCallSid ? s.longestCallSid.slice(0, 10) + "…" : "—"}</div></div>
  </div>

  <h2>Top countries you reached</h2>
  ${s.topDestinationCountries.length === 0
    ? `<p class="empty">No destination data yet — run <code>crixin voice ingest</code>.</p>`
    : `<table><thead><tr><th>Country</th><th>Calls</th><th>Minutes</th></tr></thead><tbody>${s.topDestinationCountries
        .map(
          (c) =>
            `<tr><td>${escape(c.country)}</td><td>${c.count.toLocaleString()}</td><td>${minLabel(c.minutes)}</td></tr>`,
        )
        .join("")}</tbody></table>`}

  ${s.topCampaigns.length > 0
    ? `<h2>Top tags</h2><table><thead><tr><th>Tag</th><th>Calls</th><th>Minutes</th></tr></thead><tbody>${s.topCampaigns
        .map(
          (c) =>
            `<tr><td>${escape(c.campaign)}</td><td>${c.count.toLocaleString()}</td><td>${minLabel(c.minutes)}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : ""}

  ${s.topOutcomes.length > 0
    ? `<h2>Outcomes</h2><table><thead><tr><th>Outcome</th><th>Count</th></tr></thead><tbody>${s.topOutcomes
        .map((o) => `<tr><td>${escape(o.outcome)}</td><td>${o.count.toLocaleString()}</td></tr>`)
        .join("")}</tbody></table>`
    : ""}

  ${s.transcribedCount > 0
    ? `<h2>Languages on the line</h2><table><thead><tr><th>Language</th><th>Calls</th></tr></thead><tbody>${s.topLanguages
        .map((l) => `<tr><td>${escape(l.language)}</td><td>${l.count.toLocaleString()}</td></tr>`)
        .join("")}</tbody></table><p class="lede" style="margin-top:8px;font-size:14px;">${s.transcribedCount.toLocaleString()} of ${s.totalCalls.toLocaleString()} calls have Deepgram transcripts.</p>`
    : `<h2>Transcripts</h2><p class="empty">No transcripts yet. Set <code>DEEPGRAM_API_KEY</code> and re-run <code>crixin voice ingest</code> to get language detection + Caller Archetype + Ducked phrase analysis.</p>`}

  <div class="footer">
    Generated by <a href="https://crixin.com">crixin</a> · all data stayed on your machine.
  </div>
</div></body></html>`;
}

// =============================================================================
//  Caller Archetype — the voice analogue of the dev/tool archetypes.
//  Same 9-signal classifier shape, new signals derived from call patterns +
//  transcript language.
// =============================================================================

export interface CallerSignals {
  totalCalls: number;
  completedRate: number;        // completed / total
  avgCallSeconds: number;
  shortCallRate: number;        // <30s
  longCallRate: number;         // >180s
  noAnswerRate: number;         // status='no-answer' or 'busy'
  dodgeRate: number;            // hedging phrases per transcript
  questionRate: number;         // assistant Says ending with '?' (proxy: '?' density)
  closeRate: number;            // close phrases per transcript
}

export interface CallerArchetype {
  label: string;
  rationale: string;
  topSignals: Array<{ name: string; value: number }>;
}

export function computeCallerSignals(): CallerSignals {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
              SUM(duration_seconds) AS dur,
              SUM(CASE WHEN duration_seconds < 30 AND duration_seconds > 0 THEN 1 ELSE 0 END) AS short_,
              SUM(CASE WHEN duration_seconds > 180 THEN 1 ELSE 0 END) AS long_,
              SUM(CASE WHEN status IN ('no-answer','busy') THEN 1 ELSE 0 END) AS noanswer
         FROM voice_calls`,
    )
    .get() as {
    total: number;
    completed: number;
    dur: number | null;
    short_: number;
    long_: number;
    noanswer: number;
  };

  const transcripts = db
    .prepare(
      `SELECT transcript_text FROM voice_calls
        WHERE transcript_text IS NOT NULL AND length(transcript_text) > 0`,
    )
    .all() as Array<{ transcript_text: string }>;

  let dodgeHits = 0;
  let questionHits = 0;
  let closeHits = 0;
  for (const t of transcripts) {
    const lower = t.transcript_text.toLowerCase();
    if (DODGE_PATTERNS.some((p) => lower.includes(p))) dodgeHits += 1;
    if (CLOSE_PATTERNS.some((p) => lower.includes(p))) closeHits += 1;
    questionHits += (t.transcript_text.match(/\?/g) ?? []).length;
  }
  const total = row.total ?? 0;
  const safe = (n: number, d: number) => (d === 0 ? 0 : n / d);

  return {
    totalCalls: total,
    completedRate: safe(row.completed ?? 0, total),
    avgCallSeconds: total > 0 ? Math.round((row.dur ?? 0) / total) : 0,
    shortCallRate: safe(row.short_ ?? 0, total),
    longCallRate: safe(row.long_ ?? 0, total),
    noAnswerRate: safe(row.noanswer ?? 0, total),
    dodgeRate: safe(dodgeHits, transcripts.length),
    questionRate: transcripts.length > 0 ? questionHits / transcripts.length : 0,
    closeRate: safe(closeHits, transcripts.length),
  };
}

export function classifyCallerArchetype(s: CallerSignals): CallerArchetype {
  const candidates: Array<{ label: string; weight: number; rationale: string }> = [];

  if (s.totalCalls === 0) {
    return {
      label: "Nothing yet",
      rationale: "No calls in the local DB. Run `crixin voice ingest` first.",
      topSignals: [],
    };
  }

  if (s.shortCallRate >= 0.4 && s.avgCallSeconds < 60) {
    candidates.push({
      label: "Quick Pitcher",
      weight: s.shortCallRate * 100,
      rationale: `${pct(s.shortCallRate)} of your calls land under 30s and the average call runs ${s.avgCallSeconds}s. The pitch is short and the line clears fast.`,
    });
  }
  if (s.longCallRate >= 0.3) {
    candidates.push({
      label: "Patient Listener",
      weight: s.longCallRate * 80,
      rationale: `${pct(s.longCallRate)} of your calls run past 3 minutes — your AI lets the prospect talk.`,
    });
  }
  if (s.dodgeRate >= 0.15) {
    candidates.push({
      label: "Ducker",
      weight: s.dodgeRate * 120,
      rationale: `${pct(s.dodgeRate)} of transcripts contain a dodge phrase ("let me get back to you", "I'll have my team follow up"). Your AI deflects when pressed.`,
    });
  }
  if (s.closeRate >= 0.2) {
    candidates.push({
      label: "Hard Closer",
      weight: s.closeRate * 110,
      rationale: `${pct(s.closeRate)} of transcripts contain a close-attempt phrase. Your AI is going for the booking.`,
    });
  }
  if (s.questionRate >= 4) {
    candidates.push({
      label: "Discovery Caller",
      weight: s.questionRate * 8,
      rationale: `Avg ${s.questionRate.toFixed(1)} questions asked per call — your AI runs discovery before pitching.`,
    });
  }
  if (s.noAnswerRate >= 0.5) {
    candidates.push({
      label: "Voicemail Whisperer",
      weight: s.noAnswerRate * 90,
      rationale: `${pct(s.noAnswerRate)} of dials hit no-answer or busy. Most of the work is leaving messages.`,
    });
  }
  if (s.completedRate < 0.4 && s.totalCalls > 5) {
    candidates.push({
      label: "Lead Burner",
      weight: (1 - s.completedRate) * 70,
      rationale: `Only ${pct(s.completedRate)} of dials complete. Worth checking your list quality before scaling.`,
    });
  }

  if (candidates.length === 0) {
    candidates.push({
      label: "Steady Operator",
      weight: 50,
      rationale: `${s.totalCalls.toLocaleString()} calls, ${pct(s.completedRate)} completion, ${s.avgCallSeconds}s average. Nothing extreme — your AI just shows up and does the job.`,
    });
  }

  candidates.sort((a, b) => b.weight - a.weight);
  const top = candidates[0]!;
  const topSignals: Array<{ name: string; value: number }> = [
    { name: "shortCallRate", value: round(s.shortCallRate) },
    { name: "longCallRate", value: round(s.longCallRate) },
    { name: "dodgeRate", value: round(s.dodgeRate) },
    { name: "closeRate", value: round(s.closeRate) },
    { name: "noAnswerRate", value: round(s.noAnswerRate) },
    { name: "questionRate", value: round(s.questionRate) },
    { name: "completedRate", value: round(s.completedRate) },
  ]
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);

  return { label: top.label, rationale: top.rationale, topSignals };
}

// =============================================================================
//  Ducked — phrases your AI uses to dodge questions in calls.
//  The voice analogue of `crixin skipped`.
// =============================================================================

const DODGE_PATTERNS = [
  "let me get back to you",
  "i'll have my team follow up",
  "i'll have someone follow up",
  "that's a great question",
  "i don't have that information",
  "i'm not sure",
  "i'll need to check",
  "let me check on that",
  "i can't speak to that",
  "i'm not authorized",
  "i'll forward this",
  "we'll send you an email",
  "send me an email",
  "i'll connect you with",
];

const CLOSE_PATTERNS = [
  "would you like to book",
  "can i schedule",
  "let's schedule",
  "let's get you on the calendar",
  "what time works",
  "are you available",
  "can i confirm",
  "ready to move forward",
  "happy to send over",
  "shall i go ahead",
];

export interface DuckedRow {
  callSid: string;
  matched: string;
  startedAt: number | null;
  toNumber: string | null;
  snippet: string;
}

export function findDuckedPhrases(opts: { limit?: number } = {}): {
  rows: DuckedRow[];
  totalCalls: number;
  totalDodges: number;
  duckRate: number;
} {
  const db = getDb();
  const transcripts = db
    .prepare(
      `SELECT sid, started_at, to_number, transcript_text
         FROM voice_calls
        WHERE transcript_text IS NOT NULL AND length(transcript_text) > 0
        ORDER BY started_at DESC`,
    )
    .all() as Array<{ sid: string; started_at: number | null; to_number: string | null; transcript_text: string }>;

  const totalCallsRow = db.prepare(`SELECT COUNT(*) AS n FROM voice_calls`).get() as { n: number };
  const limit = opts.limit ?? 25;
  const rows: DuckedRow[] = [];
  let totalDodges = 0;
  let calledWithDodge = 0;

  for (const t of transcripts) {
    const lower = t.transcript_text.toLowerCase();
    const matches: Array<{ phrase: string; index: number }> = [];
    for (const p of DODGE_PATTERNS) {
      const idx = lower.indexOf(p);
      if (idx >= 0) matches.push({ phrase: p, index: idx });
    }
    if (matches.length > 0) {
      calledWithDodge += 1;
      totalDodges += matches.length;
      // Keep the first match per call so the report doesn't drown in dupes
      const first = matches.sort((a, b) => a.index - b.index)[0]!;
      const start = Math.max(0, first.index - 40);
      const end = Math.min(t.transcript_text.length, first.index + first.phrase.length + 60);
      rows.push({
        callSid: t.sid,
        matched: first.phrase,
        startedAt: t.started_at,
        toNumber: t.to_number,
        snippet: t.transcript_text.slice(start, end).trim(),
      });
    }
    if (rows.length >= limit) break;
  }

  return {
    rows,
    totalCalls: totalCallsRow.n ?? 0,
    totalDodges,
    duckRate: transcripts.length > 0 ? calledWithDodge / transcripts.length : 0,
  };
}

// =============================================================================
//  CLI runners — called by src/voice/cli.ts
// =============================================================================

export function runVoiceWrapped(opts: { year?: number; out?: string } = {}): number {
  const year = opts.year ?? new Date().getFullYear();
  const stats = computeVoiceWrapped(year);
  const html = renderVoiceWrappedHtml(stats);
  const outPath = resolve(opts.out ?? `./crixin-voice-wrapped-${year}.html`);
  writeFileSync(outPath, html, "utf8");
  log.success(`Wrote ${outPath}`);
  log.stat("total calls", stats.totalCalls.toLocaleString());
  log.stat("total minutes", stats.totalMinutes.toLocaleString());
  log.stat("twilio spend", stats.totalCostCents === 0 ? "$0" : `$${(stats.totalCostCents / 100).toFixed(2)}`);
  if (stats.totalCalls === 0) {
    log.hint("No calls in DB. Run `crixin voice ingest` first.");
  }
  return 0;
}

export function runCallerArchetype(): number {
  const signals = computeCallerSignals();
  const arch = classifyCallerArchetype(signals);
  process.stdout.write("\n" + kleur.bold("Caller Archetype: ") + kleur.cyan(arch.label) + "\n\n");
  process.stdout.write(arch.rationale + "\n\n");
  if (arch.topSignals.length > 0) {
    process.stdout.write(kleur.gray("Top signals:\n"));
    for (const s of arch.topSignals) {
      process.stdout.write(`  ${kleur.gray(s.name.padEnd(18))} ${s.value}\n`);
    }
    process.stdout.write("\n");
  }
  if (signals.totalCalls === 0) {
    log.hint("No calls in DB. Run `crixin voice ingest` first.");
  }
  return 0;
}

export function runDucked(opts: { limit?: number; json?: boolean } = {}): number {
  const result = findDuckedPhrases({ limit: opts.limit });
  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(
    "\n" +
      kleur.bold("Ducked phrases — when your AI dodges on a call\n\n") +
      `  ${kleur.gray("calls with dodge")}  ${result.rows.length} / ${result.totalCalls}\n` +
      `  ${kleur.gray("duck rate")}         ${pct(result.duckRate)}\n` +
      `  ${kleur.gray("total dodge hits")}  ${result.totalDodges}\n\n`,
  );
  if (result.rows.length === 0) {
    if (result.totalCalls === 0) {
      log.hint("No calls in DB. Run `crixin voice ingest` first.");
    } else {
      log.info("No dodge phrases found in any transcript. Either your AI is direct, or you need transcripts (set DEEPGRAM_API_KEY + re-ingest).");
    }
    return 0;
  }
  for (const r of result.rows) {
    const when = r.startedAt ? new Date(r.startedAt).toISOString().slice(0, 16).replace("T", " ") : "—";
    process.stdout.write(
      `${kleur.cyan(r.callSid.slice(0, 12))}…  ${kleur.gray(when)}  ${kleur.gray(r.toNumber ?? "—")}\n` +
        `  matched: ${kleur.yellow(r.matched)}\n` +
        `  ${kleur.gray("…" + r.snippet + "…")}\n\n`,
    );
  }
  return 0;
}

// =============================================================================
//  Helpers
// =============================================================================

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Best-effort country lookup from an E.164 number. Covers the destinations
 * we advertise on the pricing page (US/CA, Egypt, UAE, UK, Spain) plus a few
 * other common ones — falls back to "Other" for anything we don't recognize.
 * Not a substitute for libphonenumber, but adds zero deps.
 */
function countryCodeFor(e164: string): string {
  const digits = e164.replace(/[^\d]/g, "");
  if (digits.startsWith("1")) return "United States / Canada";
  if (digits.startsWith("20")) return "Egypt";
  if (digits.startsWith("971")) return "UAE";
  if (digits.startsWith("44")) return "United Kingdom";
  if (digits.startsWith("34")) return "Spain";
  if (digits.startsWith("49")) return "Germany";
  if (digits.startsWith("33")) return "France";
  if (digits.startsWith("91")) return "India";
  if (digits.startsWith("234")) return "Nigeria";
  if (digits.startsWith("966")) return "Saudi Arabia";
  if (digits.startsWith("962")) return "Jordan";
  if (digits.startsWith("963")) return "Syria";
  if (digits.startsWith("961")) return "Lebanon";
  if (digits.startsWith("90")) return "Turkey";
  return "Other";
}
