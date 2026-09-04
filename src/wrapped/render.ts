/**
 * Annual Crixin Wrapped — generates a self-contained static HTML page.
 *
 * Designed to be screenshotted and shared. PII is stripped by default
 * (project paths replaced with anonymous labels); pass anonymize=false to
 * keep specifics.
 */

import { inferArchetype } from "./archetype.js";

export interface WrappedData {
  year: number;
  totalSessions: number;
  totalMessages: number;
  totalDurationMs: number;
  totalCostCents: number;
  topProjects: { project: string; count: number }[];
  bySource: { source: string; count: number; costCents: number }[];
  byHour: { hour: number; count: number }[];
  byDayOfWeek: { dow: number; count: number }[];
  byMonth: { month: string; sessions: number; costCents: number }[];
  busiestHour: number | null;
  longSessionCount: number;
  userMessages: number;
  assistantMessages: number;
}

export function renderWrappedHtml(data: WrappedData, opts: { anonymize: boolean }): string {
  const ratio = data.assistantMessages > 0 ? data.userMessages / data.assistantMessages : 0;
  const meanMsgs = data.totalSessions > 0 ? data.totalMessages / data.totalSessions : 0;
  const arch = inferArchetype({
    totalSessions: data.totalSessions,
    totalMessages: data.totalMessages,
    totalDurationMs: data.totalDurationMs,
    userToAssistantRatio: ratio,
    meanMessagesPerSession: meanMsgs,
    longSessionCount: data.longSessionCount,
  });

  const projects = opts.anonymize
    ? data.topProjects.map((p, i) => ({ ...p, project: `Project ${String.fromCharCode(65 + i)}` }))
    : data.topProjects;

  const heatmaxHour = Math.max(1, ...data.byHour.map((h) => h.count));
  const heatmaxDow = Math.max(1, ...data.byDayOfWeek.map((d) => d.count));
  const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const hourCells = Array.from({ length: 24 }, (_, h) => {
    const found = data.byHour.find((r) => r.hour === h);
    const count = found?.count ?? 0;
    const intensity = count / heatmaxHour;
    return `<div class="hcell" data-hour="${h}" style="background: rgba(245, 180, 82, ${
      0.05 + intensity * 0.85
    });" title="${h}h · ${count.toLocaleString()} prompts">${h.toString().padStart(2, "0")}</div>`;
  }).join("");

  const dowCells = Array.from({ length: 7 }, (_, d) => {
    const found = data.byDayOfWeek.find((r) => r.dow === d);
    const count = found?.count ?? 0;
    const intensity = count / heatmaxDow;
    return `<div class="dcell" style="background: rgba(122, 162, 247, ${
      0.05 + intensity * 0.85
    });" title="${dowNames[d]} · ${count.toLocaleString()} prompts">${dowNames[d]}<br><small>${count.toLocaleString()}</small></div>`;
  }).join("");

  const monthRows = data.byMonth
    .map((m) => {
      const cost = (m.costCents / 100).toFixed(2);
      const w = data.byMonth.reduce((mx, x) => Math.max(mx, x.sessions), 1);
      const pct = (m.sessions / w) * 100;
      return `<div class="month-row">
        <span class="month-label mono">${m.month}</span>
        <div class="month-bar"><div class="month-fill" style="width: ${pct}%"></div></div>
        <span class="month-sessions">${m.sessions} sessions</span>
        <span class="month-cost">$${cost}</span>
      </div>`;
    })
    .join("");

  const sourceRows = data.bySource
    .map(
      (s) => `<div class="source-row">
        <span class="source-name">${escapeHtml(s.source)}</span>
        <span class="source-count">${s.count.toLocaleString()} sessions</span>
        <span class="source-cost">${s.costCents > 0 ? "$" + (s.costCents / 100).toFixed(2) : "—"}</span>
      </div>`,
    )
    .join("");

  const totalHours = (data.totalDurationMs / 3.6e6).toFixed(1);
  const totalCost = (data.totalCostCents / 100).toFixed(2);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Your ${data.year} in AI coding · Crixin Wrapped</title>
<style>
  :root {
    --bg: #0b0d12;
    --surface: #161922;
    --elevated: #1f2330;
    --border: #272a35;
    --text: #e6e8ef;
    --muted: #9097a8;
    --soft: #5b6075;
    --brand: #f5b452;
    --accent: #7aa2f7;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background:
      radial-gradient(1200px 600px at 80% -10%, rgba(245, 180, 82, 0.10), transparent 60%),
      radial-gradient(900px 500px at -10% 110%, rgba(122, 162, 247, 0.10), transparent 60%),
      var(--bg);
    color: var(--text);
    font-family: "Inter", -apple-system, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    line-height: 1.55;
  }
  .mono { font-family: "JetBrains Mono", "SF Mono", ui-monospace, monospace; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 64px 24px 96px; }

  .pill {
    display: inline-block;
    padding: 4px 12px;
    border: 1px solid var(--brand);
    color: var(--brand);
    border-radius: 9999px;
    font-size: 11px; letter-spacing: 0.10em; text-transform: uppercase;
    font-weight: 600;
  }

  h1 {
    font-size: clamp(40px, 6vw, 72px);
    line-height: 1.02;
    letter-spacing: -0.025em;
    margin: 16px 0 8px;
    font-weight: 700;
  }
  h1 em { font-style: normal; color: var(--brand); }
  h2 {
    font-size: 22px; font-weight: 700; letter-spacing: -0.01em;
    margin: 56px 0 14px;
  }
  .lede { color: var(--muted); font-size: 17px; margin: 0; }

  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 36px 0 8px; }
  .stat {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px 18px;
  }
  .stat .label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.10em; }
  .stat .value { font-size: 26px; font-weight: 700; margin-top: 4px; letter-spacing: -0.01em; }
  .stat .value.accent { color: var(--brand); }
  @media (max-width: 720px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }

  .archetype-card {
    background: linear-gradient(180deg, rgba(245, 180, 82, 0.10), transparent 60%), var(--elevated);
    border: 1px solid var(--brand);
    border-radius: 16px;
    padding: 32px;
    margin-top: 28px;
    text-align: center;
  }
  .archetype-card .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.10em; }
  .archetype-card .name {
    font-size: clamp(40px, 6vw, 64px);
    color: var(--brand);
    margin: 12px 0;
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  .archetype-card .rationale { color: var(--muted); margin: 0; font-size: 15px; max-width: 560px; margin-left: auto; margin-right: auto; }

  .hour-row {
    display: grid;
    grid-template-columns: repeat(24, 1fr);
    gap: 4px;
    margin: 8px 0;
  }
  .hcell {
    aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
    border-radius: 4px; font-size: 9px; color: var(--text); font-weight: 500;
    border: 1px solid var(--border);
  }

  .dow-row {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 6px;
    margin: 8px 0;
  }
  .dcell {
    aspect-ratio: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    border-radius: 8px; font-size: 11px; color: var(--text); font-weight: 600;
    border: 1px solid var(--border);
  }
  .dcell small { font-weight: 400; color: var(--muted); margin-top: 2px; font-size: 10px; }

  .month-row {
    display: grid;
    grid-template-columns: 80px 1fr 110px 80px;
    align-items: center; gap: 12px;
    padding: 6px 0;
    border-bottom: 1px dashed var(--border);
    font-size: 13px;
  }
  .month-label { color: var(--muted); }
  .month-bar { background: var(--surface); border-radius: 4px; height: 8px; overflow: hidden; }
  .month-fill { height: 100%; background: var(--brand); border-radius: 4px; }
  .month-sessions { color: var(--text); }
  .month-cost { color: var(--muted); text-align: right; }

  .source-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    padding: 8px 0;
    border-bottom: 1px dashed var(--border);
    font-size: 14px;
  }
  .source-name { font-weight: 500; }
  .source-count { color: var(--muted); }
  .source-cost { text-align: right; color: var(--brand); font-weight: 600; }

  .project-list { list-style: none; margin: 0; padding: 0; }
  .project-list li {
    padding: 10px 0;
    border-bottom: 1px dashed var(--border);
    display: flex; justify-content: space-between;
    font-size: 14px;
  }
  .project-list li .name { color: var(--text); }
  .project-list li .count { color: var(--muted); font-variant-numeric: tabular-nums; }

  footer {
    margin-top: 64px;
    padding-top: 24px;
    border-top: 1px solid var(--border);
    color: var(--soft);
    font-size: 11px;
    display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px;
  }
  footer a { color: var(--muted); text-decoration: none; }
  footer a:hover { color: var(--brand); }
</style>
</head>
<body>
<div class="wrap">
  <span class="pill">Your ${data.year} in AI Coding</span>
  <h1>You wrote <em>${data.totalMessages.toLocaleString()}</em> messages.</h1>
  <p class="lede">Across ${data.totalSessions.toLocaleString()} sessions, ${totalHours} hours, and ~$${totalCost} in estimated spend.</p>

  <div class="stat-grid">
    <div class="stat"><div class="label">sessions</div><div class="value accent">${data.totalSessions.toLocaleString()}</div></div>
    <div class="stat"><div class="label">messages</div><div class="value">${data.totalMessages.toLocaleString()}</div></div>
    <div class="stat"><div class="label">hours</div><div class="value">${totalHours}</div></div>
    <div class="stat"><div class="label">est. spend</div><div class="value accent">$${totalCost}</div></div>
  </div>

  <div class="archetype-card">
    <div class="label">your archetype</div>
    <div class="name">${arch.label}</div>
    <p class="rationale">${escapeHtml(arch.rationale)}</p>
  </div>

  <h2>Hours of the day you actually code</h2>
  <p class="lede" style="margin-bottom: 6px;">Busiest hour: <strong>${
    data.busiestHour != null ? formatHour(data.busiestHour) : "—"
  }</strong>. Each cell is one hour, brighter = more user prompts.</p>
  <div class="hour-row">${hourCells}</div>

  <h2>Days of the week</h2>
  <div class="dow-row">${dowCells}</div>

  <h2>Month by month</h2>
  ${monthRows || "<p class='lede'>No monthly data yet.</p>"}

  <h2>${opts.anonymize ? "Top projects (anonymized)" : "Top projects"}</h2>
  <ul class="project-list">
    ${projects
      .map(
        (p) =>
          `<li><span class="name">${escapeHtml(p.project)}</span><span class="count">${p.count.toLocaleString()} sessions</span></li>`,
      )
      .join("")}
  </ul>

  <h2>Where the time went</h2>
  <div class="source-list">
    ${sourceRows}
  </div>

  <footer>
    <span>Generated ${new Date().toISOString().slice(0, 10)} by Crixin · local-only · zero data left this laptop.</span>
    <a href="https://github.com/THELAZIZAGROUP/crixin">github.com/THELAZIZAGROUP/crixin</a>
  </footer>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default:  return c;
    }
  });
}

function formatHour(h: number): string {
  const ampm = h < 12 ? "AM" : "PM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ampm}`;
}
