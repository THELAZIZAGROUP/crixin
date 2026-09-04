/**
 * Server-rendered HTML for the v0.1 dashboard. Single page, vanilla JS, no build step.
 * Visuals match the marketing site (web/styles.css) — same dark Tokyo-Night palette,
 * same amber accent, same type stack, same focus rings.
 *
 * v0.2 will replace this with a Vite + React build, served from the same Hono app.
 */
export const dashboardHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>crixin · local dashboard</title>
  <link rel="icon" href="data:," />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg-base:      #0b0d12;
      --bg-surface:   #14161e;
      --bg-elevated:  #1c1f29;
      --border-subtle: #232631;
      --border-strong: #353945;

      --text-primary:   #ecedf1;
      --text-secondary: #989ba9;
      --text-muted:     #5e6373;

      --brand:      #f5b452;
      --brand-deep: #d68f2c;
      --brand-soft: #fad08e;

      /* Soft amber for the heatmap so we have a single accent family. */
      --accent:    #f5b452;

      --success: #7bd88f;
      --warning: #e0af68;
      --danger:  #f7768e;

      --font-sans: "Geist", -apple-system, "SF Pro Display", system-ui, sans-serif;
      --font-display: "Instrument Serif", Georgia, serif;
      --font-mono: "Geist Mono", "JetBrains Mono", ui-monospace, monospace;

      --radius-sm: 4px;
      --radius-md: 8px;
      --radius-lg: 14px;

      --ease: cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; padding: 0; }
    /* Hide all scrollbars across the dashboard. Scrolling still works. */
    *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
    * { scrollbar-width: none; }

    body {
      min-height: 100%;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      overflow: hidden;
      position: relative;
      background:
        radial-gradient(1100px 600px at 78% -10%, rgba(245, 180, 82, 0.06), transparent 60%),
        radial-gradient(900px 500px at 8% 110%, rgba(245, 180, 82, 0.04), transparent 60%),
        linear-gradient(180deg, #0a0c11 0%, #0c0f15 50%, #0a0c11 100%);
      color: var(--text-primary);
      font-family: var(--font-sans);
      font-size: 14.5px;
      line-height: 1.55;
      letter-spacing: -0.005em;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    /* Subtle film grain — breaks digital flatness without competing with content. */
    body::after {
      content: "";
      position: fixed; inset: 0;
      pointer-events: none;
      z-index: 50;
      opacity: 0.04;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.85 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
    }

    code, pre, .mono { font-family: var(--font-mono); font-size: 0.92em; }
    button, input { font: inherit; }
    button { color: inherit; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { color: var(--brand); text-decoration: underline; text-underline-offset: 3px; }

    ::selection { background: rgba(245, 180, 82, 0.28); color: var(--text-primary); }

    :focus-visible {
      outline: 2px solid var(--brand);
      outline-offset: 3px;
      border-radius: var(--radius-sm);
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { transition: none !important; animation: none !important; }
    }

    /* ---- Top command bar ---- */
    .topbar {
      z-index: 10;
      display: grid;
      grid-template-columns: minmax(208px, auto) minmax(260px, 1fr) auto;
      align-items: center;
      gap: 12px;
      padding: 12px 18px;
      background: rgba(11, 13, 18, 0.94);
      border-bottom: 1px solid var(--border-subtle);
    }
    .brand-stack { min-width: 0; }
    .brand-row { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .brand-mark {
      font-weight: 700; font-size: 18px; color: var(--brand);
      letter-spacing: -0.01em;
    }
    .status-pill {
      display: inline-flex; align-items: center; gap: 6px;
      height: 24px; padding: 0 8px;
      border: 1px solid rgba(123, 216, 143, 0.34);
      border-radius: 9999px;
      background: rgba(123, 216, 143, 0.08);
      color: var(--success);
      font-size: 11px; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.07em;
      white-space: nowrap;
    }
    .status-dot {
      width: 6px; height: 6px; border-radius: 9999px;
      background: currentColor;
      box-shadow: 0 0 0 3px rgba(123, 216, 143, 0.10);
    }
    .top-meta {
      display: flex; gap: 10px; min-width: 0;
      margin-top: 3px;
      color: var(--text-muted);
      font-size: 11px;
      white-space: nowrap;
    }
    .top-meta strong { color: var(--text-secondary); font-weight: 600; }

    .top-search {
      display: grid;
      grid-template-columns: 16px minmax(0, 1fr);
      align-items: center;
      gap: 9px;
      min-width: 0;
      max-width: 680px;
      padding: 8px 11px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-md);
      background: #0f1219;
      color: var(--text-muted);
      transition: border-color 120ms var(--ease), box-shadow 160ms var(--ease), background 120ms var(--ease);
    }
    .top-search:focus-within {
      border-color: var(--brand);
      background: #11141c;
      box-shadow: 0 0 0 3px rgba(245, 180, 82, 0.16);
    }
    .top-search svg,
    .icon-button svg {
      width: 16px; height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .top-search input {
      min-width: 0;
      width: 100%;
      height: 24px;
      padding: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--text-primary);
    }
    .top-search input::placeholder { color: var(--text-muted); }

    .source-filter {
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      padding: 8px 10px;
      white-space: nowrap;
      transition: background 120ms var(--ease), color 120ms var(--ease), box-shadow 120ms var(--ease);
    }
    .source-filter:hover { color: var(--text-primary); background: rgba(255, 255, 255, 0.03); }
    .source-filter.active {
      color: var(--text-primary);
      background: var(--bg-elevated);
      box-shadow: inset 0 0 0 1px rgba(245, 180, 82, 0.22);
    }
    .top-actions { display: flex; gap: 8px; }
    .icon-button {
      width: 36px; height: 36px;
      display: grid; place-items: center;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      background: var(--bg-surface);
      color: var(--text-secondary);
      cursor: pointer;
      transition: border-color 120ms var(--ease), color 120ms var(--ease), background 120ms var(--ease);
    }
    .icon-button:hover:not(:disabled) {
      border-color: var(--border-strong);
      background: var(--bg-elevated);
      color: var(--text-primary);
    }
    .icon-button:disabled {
      cursor: not-allowed;
      opacity: 0.42;
    }
    .icon-button.copied {
      color: var(--success);
      border-color: rgba(123, 216, 143, 0.48);
    }

    /* ---- Wrapped strip (under header, summary moments) ---- */
    .wrapped-strip {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      padding: 12px 18px;
      border-bottom: 1px solid var(--border-subtle);
      background: #0d1017;
    }
    .wrap-card {
      min-width: 0;
      background: linear-gradient(180deg, rgba(31, 35, 48, 0.86), rgba(22, 25, 34, 0.86));
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 12px 14px;
    }
    .wrap-card .label {
      font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.10em;
    }
    .wrap-card .value {
      font-size: 18px; font-weight: 600; color: var(--text-primary); margin-top: 4px;
      letter-spacing: -0.01em;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .wrap-card .sub {
      font-size: 11px; color: var(--text-secondary); margin-top: 2px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .wrap-card .value.accent { color: var(--brand); }

    /* ---- Two-pane main ---- */
    main {
      display: grid;
      grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
      min-height: 0;
    }
    .pane { min-height: 0; overflow: auto; }
    .pane.left  {
      border-right: 1px solid var(--border-subtle);
      background: rgba(13, 16, 23, 0.58);
    }

    .list-head {
      position: sticky; top: 0; z-index: 5;
      display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
      padding: 13px 16px;
      border-bottom: 1px solid var(--border-subtle);
      background: rgba(13, 16, 23, 0.94);
    }
    .list-head-titleblock {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1 1 auto;
    }
    .list-title { color: var(--text-primary); font-size: 13px; font-weight: 600; }
    .list-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 3px;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      background: #0f1219;
      align-self: flex-start;
    }
    .list-filters .source-filter {
      font-size: 11px;
      padding: 6px 9px;
    }
    .list-count {
      color: var(--text-secondary);
      font-size: 11px;
      white-space: nowrap;
      padding-top: 4px;
    }

    /* ---- Session list ---- */
    .bucket-header {
      font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.10em;
      padding: 14px 16px 6px;
      border-top: 1px solid var(--border-subtle);
      background: rgba(11, 13, 18, 0.4);
    }
    .bucket-header:first-child { border-top: none; }

    .session-list { list-style: none; margin: 0; padding: 0; }
    .session-row {
      position: relative;
      display: grid;
      grid-template-columns: auto 1fr auto auto;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle);
      cursor: pointer;
      user-select: none;
      transition: background 140ms var(--ease), transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 140ms var(--ease);
    }
    .session-row:hover { background: var(--bg-surface); }
    .session-row:hover .title { color: var(--brand); }
    .session-row:active { transform: scale(0.985); transition-duration: 80ms; }
    .session-row.active {
      background: var(--bg-elevated);
      box-shadow: inset 2px 0 0 var(--brand);
    }
    .session-row.search-hit { grid-template-columns: auto 1fr auto auto; grid-auto-rows: auto; }
    .session-row.search-hit .snippet {
      grid-column: 1 / -1;
      color: var(--text-secondary); font-size: 12.5px;
      margin-top: 4px;
      overflow: hidden; text-overflow: ellipsis;
      white-space: nowrap;
    }
    .session-row .badge-source,
    .meta-line .badge-source {
      font-size: 9.5px; font-weight: 600;
      padding: 2px 7px;
      border-radius: 9999px;
      background: rgba(245, 180, 82, 0.10);
      color: var(--brand);
      border: 1px solid rgba(245, 180, 82, 0.35);
      text-transform: uppercase; letter-spacing: 0.06em;
      flex-shrink: 0;
    }
    /* Per-source badge colors so the eye can distinguish sources at a glance. */
    .badge-source[data-source="codex"] {
      background: rgba(123, 216, 143, 0.10);
      color: var(--success);
      border-color: rgba(123, 216, 143, 0.35);
    }
    .badge-source[data-source="cursor"] {
      background: rgba(122, 162, 247, 0.10);
      color: var(--accent);
      border-color: rgba(122, 162, 247, 0.35);
    }
    .badge-source[data-source="match"] {
      background: rgba(144, 151, 168, 0.10);
      color: var(--text-secondary);
      border-color: rgba(144, 151, 168, 0.28);
    }
    .session-row .title {
      color: var(--text-primary); font-weight: 500; font-size: 13px;
      min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      transition: color 140ms var(--ease);
    }
    .session-row .msg-count {
      color: var(--text-muted); font-size: 11px;
      font-family: var(--font-mono);
      white-space: nowrap;
    }
    .session-row .meta {
      color: var(--text-muted); font-size: 11.5px;
      white-space: nowrap;
    }
    .session-row .snippet {
      color: var(--text-secondary); font-size: 12.5px;
      margin-top: 4px;
      overflow: hidden; text-overflow: ellipsis;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }

    /* ---- Session detail ---- */
    .session-detail {
      width: min(100%, 1120px);
      margin: 0 auto;
      padding: 28px 32px 80px;
    }
    .detail-head {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      align-items: flex-start;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .detail-title { min-width: 0; }
    .session-detail h2 {
      margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.01em;
      overflow-wrap: anywhere;
    }
    .detail-path {
      margin-top: 4px;
      color: var(--text-muted);
      font-size: 11.5px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 760px;
    }
    .session-detail .meta-line {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 7px;
      color: var(--text-muted); font-size: 12px; margin-top: 8px;
    }
    .meta-dot { color: var(--text-muted); }

    /* Moments strip — Wrapped-flavored summary inside one session */
    .moments {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin: 18px 0 18px;
    }
    .moment {
      background: var(--bg-surface);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 10px 12px;
    }
    .moment .label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.10em; }
    .moment .value { font-size: 16px; font-weight: 600; margin-top: 3px; }
    .moment .value.accent { color: var(--brand); }
    /* Resume command — terminal-style with mac traffic lights */
    .resume-cmd {
      position: relative;
      background: #0a0c11;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 30px 16px 14px;
      font-family: var(--font-mono);
      font-size: 12.5px;
      color: var(--text-primary);
      cursor: pointer;
      margin-bottom: 22px;
      overflow-x: auto;
      transition: border-color 120ms var(--ease);
    }
    .resume-cmd::before {
      content: "";
      position: absolute; top: 11px; left: 13px;
      width: 8px; height: 8px; border-radius: 9999px;
      background: var(--danger);
      box-shadow: 14px 0 0 0 var(--warning), 28px 0 0 0 var(--success);
    }
    .resume-cmd::after {
      content: "click to copy";
      position: absolute; top: 9px; right: 12px;
      font-family: var(--font-sans); font-size: 10px; letter-spacing: 0.06em;
      color: var(--text-muted); text-transform: uppercase;
    }
    .resume-cmd:hover { border-color: var(--brand); }
    .resume-cmd .prompt { color: var(--brand); user-select: none; margin-right: 6px; }
    .resume-cmd.copied::after { content: "copied"; color: var(--success); }

    /* Messages */
    .messages { display: flex; flex-direction: column; gap: 10px; }
    .message {
      padding: 12px 14px;
      border-radius: var(--radius-md);
      border: 1px solid var(--border-subtle);
      background: var(--bg-surface);
      white-space: pre-wrap; word-break: break-word;
      font-size: 14px;
      line-height: 1.6;
    }
    .message.role-user        { border-left: 2px solid var(--accent); }
    .message.role-assistant   { border-left: 2px solid var(--brand); }
    .message.role-system,
    .message.role-tool_result { border-left: 2px solid var(--text-muted); opacity: 0.85; }
    .message .role-strip {
      display: flex; align-items: center; justify-content: space-between;
      font-size: 10.5px; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.08em;
      margin-bottom: 8px;
    }
    .message .role-strip .role { color: var(--text-secondary); }
    .message pre, .message code {
      background: #0a0c11;
      padding: 1px 5px;
      border-radius: 3px;
      border: 1px solid var(--border-subtle);
      color: var(--brand);
    }
    .message pre {
      padding: 10px 12px; margin: 8px 0;
      overflow-x: auto;
      color: var(--text-primary);
    }
    .message pre code { padding: 0; border: none; background: transparent; color: inherit; }

    /* ---- Hero block (default right-pane view) ---- */
    .hero-block {
      position: relative;
      padding: 44px 48px 48px;
      max-width: 820px;
      animation: heroFadeIn 600ms cubic-bezier(0.22, 1, 0.36, 1) both;
    }
    @keyframes heroFadeIn {
      0% { opacity: 0; transform: translateY(8px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    .hero-greet {
      font-family: var(--font-display);
      font-size: 38px; line-height: 1.1; letter-spacing: -0.02em;
      font-weight: 400;
      color: var(--text-primary);
      margin: 0 0 4px;
      text-wrap: balance;
    }
    .hero-greet em {
      font-style: italic;
      color: var(--brand);
    }
    .hero-kicker {
      color: var(--text-muted);
      font-size: 13px;
      letter-spacing: 0.02em;
      margin: 0 0 32px;
    }
    /* Tabs row — text-only with brand underline on active. No pills. */
    .hero-tabrow {
      display: flex; align-items: center; justify-content: space-between;
      gap: 12px; margin-bottom: 24px;
      border-bottom: 1px solid var(--border-subtle);
      padding-bottom: 0;
    }
    .hero-tabs { display: flex; gap: 22px; }
    .hero-tab {
      position: relative;
      background: transparent; border: 0; color: var(--text-muted);
      font-size: 13px; font-weight: 500;
      padding: 6px 0 10px; cursor: pointer;
      transition: color 160ms var(--ease);
    }
    .hero-tab::after {
      content: "";
      position: absolute; left: 0; right: 0; bottom: -1px; height: 1.5px;
      background: var(--brand);
      transform: scaleX(0);
      transform-origin: left;
      transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .hero-tab:hover { color: var(--text-secondary); }
    .hero-tab.active { color: var(--text-primary); }
    .hero-tab.active::after { transform: scaleX(1); }

    .hero-filters { display: flex; gap: 2px; }
    .hero-filter {
      background: transparent; border: 0; color: var(--text-muted);
      font-size: 12px; font-weight: 500;
      padding: 4px 10px; cursor: pointer;
      transition: color 160ms var(--ease);
      font-feature-settings: "tnum";
    }
    .hero-filter:hover { color: var(--text-secondary); }
    .hero-filter.active { color: var(--text-primary); }

    /* Stats grid — first card spans 2 cols and gets a featured value treatment. */
    .hero-stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 1px;
      background: var(--border-subtle);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      overflow: hidden;
      margin-bottom: 28px;
    }
    .hero-stat {
      position: relative;
      background: rgba(20, 22, 30, 0.92);
      padding: 18px 18px 16px;
      min-height: 92px;
      animation: statFade 480ms cubic-bezier(0.22, 1, 0.36, 1) both;
      transition: background 200ms var(--ease);
    }
    .hero-stat:hover { background: rgba(28, 31, 41, 0.98); }
    .hero-stat:nth-child(1) { animation-delay: 80ms; }
    .hero-stat:nth-child(2) { animation-delay: 130ms; }
    .hero-stat:nth-child(3) { animation-delay: 180ms; }
    .hero-stat:nth-child(4) { animation-delay: 230ms; }
    .hero-stat:nth-child(5) { animation-delay: 280ms; }
    .hero-stat:nth-child(6) { animation-delay: 330ms; }
    .hero-stat:nth-child(7) { animation-delay: 380ms; }
    .hero-stat:nth-child(8) { animation-delay: 430ms; }
    @keyframes statFade {
      0%   { opacity: 0; transform: translateY(6px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    .hero-stat .label {
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.02em;
      margin-bottom: 6px;
      text-transform: lowercase;
    }
    .hero-stat .value {
      font-family: var(--font-display);
      color: var(--text-primary);
      font-size: 26px;
      font-weight: 400;
      line-height: 1;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .hero-stat.featured {
      grid-column: span 2;
      grid-row: span 1;
      background: linear-gradient(135deg, rgba(245, 180, 82, 0.06) 0%, rgba(20, 22, 30, 0.92) 60%);
    }
    .hero-stat.featured .value {
      font-size: 44px;
      color: var(--brand-soft);
    }
    .hero-stat.featured .label { color: var(--brand); letter-spacing: 0.06em; text-transform: uppercase; font-size: 10.5px; }

    /* Models tab — swaps the 4-col grid for a 2-col, taller-card layout */
    .hero-stats.models { grid-template-columns: repeat(2, 1fr); }
    .hero-stats.models .hero-stat {
      min-height: 110px;
      padding: 18px 20px 16px;
    }
    .hero-stats.models .hero-stat .label {
      font-size: 12px;
      color: var(--text-secondary);
      letter-spacing: 0;
      text-transform: none;
      margin-bottom: 8px;
    }
    .hero-stats.models .hero-stat .value {
      font-size: 30px;
      color: var(--brand-soft);
    }
    .hero-stats.models .hero-stat .sub {
      color: var(--text-muted);
      font-size: 11px;
      font-family: var(--font-mono);
      margin-top: 10px;
    }
    .hero-stats.models .hero-stat:first-child {
      background: linear-gradient(135deg, rgba(245, 180, 82, 0.08) 0%, rgba(20, 22, 30, 0.92) 60%);
    }
    .hero-stats.models .hero-stat:first-child .label { color: var(--brand); }

    /* Heatmap — bigger cells, brand amber, breathing room. */
    .hero-heatmap-wrap {
      margin: 0 0 4px;
    }
    .hero-heatmap-head {
      display: flex; align-items: baseline; justify-content: space-between;
      margin-bottom: 12px;
    }
    .hero-heatmap-head .label {
      color: var(--text-muted);
      font-size: 11px;
      letter-spacing: 0.02em;
      text-transform: lowercase;
    }
    .hero-heatmap-head .legend {
      display: flex; align-items: center; gap: 6px;
      color: var(--text-muted); font-size: 10.5px;
    }
    .hero-heatmap-head .legend .swatch {
      display: inline-flex; gap: 2px;
    }
    .hero-heatmap-head .legend .swatch span {
      width: 9px; height: 9px; border-radius: 2px;
      background: var(--bg-elevated);
    }
    .hero-heatmap {
      display: grid;
      grid-template-columns: repeat(26, 1fr);
      grid-auto-rows: 1fr;
      gap: 3px;
      aspect-ratio: 26 / 7;
    }
    .heat-cell {
      background: rgba(255, 255, 255, 0.025);
      border-radius: 2px;
      animation: heatPop 360ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
      animation-delay: calc(var(--cell-i, 0) * 4ms + 320ms);
      transition: transform 180ms var(--ease), background 180ms var(--ease);
    }
    .heat-cell:hover { transform: scale(1.6); z-index: 2; position: relative; box-shadow: 0 0 0 2px rgba(245, 180, 82, 0.4); }
    @keyframes heatPop {
      0%   { opacity: 0; transform: scale(0.5); }
      100% { opacity: 1; transform: scale(1); }
    }
    .heat-cell.l1 { background: rgba(245, 180, 82, 0.22); }
    .heat-cell.l2 { background: rgba(245, 180, 82, 0.45); }
    .heat-cell.l3 { background: rgba(245, 180, 82, 0.72); }
    .heat-cell.l4 { background: var(--brand); box-shadow: 0 0 12px rgba(245, 180, 82, 0.4); }
    .legend .swatch span:nth-child(1) { background: rgba(255,255,255,0.025); }
    .legend .swatch span:nth-child(2) { background: rgba(245, 180, 82, 0.22); }
    .legend .swatch span:nth-child(3) { background: rgba(245, 180, 82, 0.45); }
    .legend .swatch span:nth-child(4) { background: rgba(245, 180, 82, 0.72); }
    .legend .swatch span:nth-child(5) { background: var(--brand); }

    /* Empty + loading states */
    .empty {
      padding: 80px 24px; text-align: center; color: var(--text-secondary);
    }
    .empty h3 { color: var(--text-primary); margin: 0 0 8px; font-size: 17px; }
    .empty .hint { color: var(--text-muted); font-size: 13px; }

    .skeleton-row {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .skeleton-bar {
      height: 12px; background: var(--bg-surface); border-radius: 4px;
      animation: shimmer 1.4s ease-in-out infinite;
    }
    .skeleton-bar.short { width: 40%; }
    .skeleton-bar + .skeleton-bar { margin-top: 8px; }
    @keyframes shimmer {
      0% { opacity: 0.4; }
      50% { opacity: 0.7; }
      100% { opacity: 0.4; }
    }

    @media (max-width: 1100px) {
      .topbar {
        grid-template-columns: minmax(190px, auto) minmax(240px, 1fr) auto;
      }
      .top-actions { justify-self: end; }
    }

    @media (max-width: 720px) {
      body {
        min-height: 100%;
        display: block;
        overflow: auto;
      }
      .topbar {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: start;
        padding: 12px;
      }
      .top-search {
        grid-column: 1 / -1;
      }
      .top-actions {
        grid-column: 2;
        grid-row: 1;
        align-self: start;
      }
      .top-meta { flex-wrap: wrap; white-space: normal; }
      .wrapped-strip {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        padding: 10px 12px;
      }
      .wrap-card { min-width: 190px; }
      main {
        display: grid;
        grid-template-columns: 1fr;
        min-height: 0;
      }
      .pane { min-height: auto; overflow: visible; }
      /* Hero "What's up next" reads above the long recent-sessions list on phones. */
      .pane.right { order: 1; border-bottom: 1px solid var(--border-subtle); }
      .pane.left  { order: 2; border-right: 0; }
      .list-head { position: static; }
      .session-detail { padding: 20px 16px 56px; }
      .detail-head { display: block; }
      .moments { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand-stack">
      <div class="brand-row">
        <span class="brand-mark">crixin</span>
        <span class="status-pill"><span class="status-dot"></span>local-only</span>
      </div>
      <div class="top-meta">
        <span><strong id="stat-sessions">—</strong> sessions</span>
        <span><strong id="stat-messages">—</strong> msgs</span>
        <span><strong id="stat-sources">—</strong> sources</span>
      </div>
    </div>

    <label class="top-search" for="search">
      <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5"></circle><path d="m10.5 10.5 3 3"></path></svg>
      <input id="search" placeholder="Search sessions and messages" autocomplete="off" />
    </label>

    <div class="top-actions">
      <button class="icon-button" type="button" id="refresh" title="Refresh sessions" aria-label="Refresh sessions">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M14 3v4h-4"></path><path d="M2 13V9h4"></path><path d="M12.8 6A5 5 0 0 0 4 3.2L2 5"></path><path d="M3.2 10A5 5 0 0 0 12 12.8L14 11"></path></svg>
      </button>
      <button class="icon-button" type="button" id="copy-resume" title="Copy resume command" aria-label="Copy resume command" disabled>
        <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="6" y="6" width="7" height="7" rx="1.5"></rect><path d="M4 10H3.5A1.5 1.5 0 0 1 2 8.5v-5A1.5 1.5 0 0 1 3.5 2h5A1.5 1.5 0 0 1 10 3.5V4"></path></svg>
      </button>
    </div>
  </header>

  <section class="wrapped-strip" id="wrapped-strip">
    <div class="wrap-card"><div class="label">top project</div><div class="value accent" id="wrap-project">—</div><div class="sub" id="wrap-project-sub"></div></div>
    <div class="wrap-card"><div class="label">busiest hour</div><div class="value" id="wrap-hour">—</div><div class="sub" id="wrap-hour-sub"></div></div>
    <div class="wrap-card"><div class="label">total time</div><div class="value" id="wrap-time">—</div><div class="sub" id="wrap-time-sub"></div></div>
    <div class="wrap-card"><div class="label">api-equivalent</div><div class="value accent" id="wrap-cost">—</div><div class="sub" id="wrap-cost-sub"></div></div>
  </section>

  <main>
    <section class="pane left">
      <div class="list-head">
        <div class="list-head-titleblock">
          <div class="list-title" id="list-title">Recent sessions</div>
          <nav class="list-filters" aria-label="Filter sessions by source">
            <button class="source-filter active" type="button" data-source="all">All sources</button>
            <button class="source-filter" type="button" data-source="claude-code">Claude</button>
            <button class="source-filter" type="button" data-source="codex">Codex</button>
            <button class="source-filter" type="button" data-source="cursor">Cursor</button>
          </nav>
        </div>
        <div class="list-count" id="list-count">loading</div>
      </div>
      <ul class="session-list" id="session-list">
        <li class="skeleton-row"><div class="skeleton-bar"></div><div class="skeleton-bar short"></div></li>
        <li class="skeleton-row"><div class="skeleton-bar"></div><div class="skeleton-bar short"></div></li>
        <li class="skeleton-row"><div class="skeleton-bar"></div><div class="skeleton-bar short"></div></li>
      </ul>
    </section>
    <section class="pane right">
      <div class="session-detail" id="session-detail">
        <div class="hero-block" id="hero-block">
          <h2 class="hero-greet" id="hero-greet">What's up next, <em>friend</em>.</h2>
          <p class="hero-kicker" id="hero-kicker">Picking up where you left off — across all your sessions.</p>

          <div class="hero-tabrow">
            <div class="hero-tabs" role="tablist">
              <button class="hero-tab active" type="button" data-tab="overview">Overview</button>
              <button class="hero-tab" type="button" data-tab="models">Models</button>
            </div>
            <div class="hero-filters" role="group" aria-label="Time range">
              <button class="hero-filter active" type="button" data-range="all">All</button>
              <button class="hero-filter" type="button" data-range="30">30d</button>
              <button class="hero-filter" type="button" data-range="7">7d</button>
            </div>
          </div>

          <div class="hero-stats" id="hero-stats"></div>

          <div class="hero-heatmap-wrap">
            <div class="hero-heatmap-head">
              <span class="label">last 26 weeks</span>
              <span class="legend">
                less <span class="swatch"><span></span><span></span><span></span><span></span><span></span></span> more
              </span>
            </div>
            <div class="hero-heatmap" id="hero-heatmap" aria-label="Session activity heatmap (last 26 weeks)"></div>
          </div>
        </div>
      </div>
    </section>
  </main>

  <script type="module">
    const $ = (s) => document.querySelector(s);
    const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;",
    }[c]));

    const SOURCE_LABELS = {
      "claude-code": "Claude",
      codex: "Codex",
      cursor: "Cursor",
      match: "Match",
    };

    let allSessions = [];
    let activeSource = "all";
    let activeRowKey = null;
    let activeResumeCmd = "";
    let searchTimer;
    let searchRequestId = 0;

    function fmtNumber(n) { return Number(n ?? 0).toLocaleString(); }
    function countLabel(n, singular, plural) {
      return fmtNumber(n) + " " + (n === 1 ? singular : plural);
    }
    function sourceLabel(source) {
      return SOURCE_LABELS[source] ?? source ?? "Unknown";
    }
    function shortId(id) {
      const bare = String(id ?? "");
      return bare.length > 18 ? bare.slice(0, 8) + "…" + bare.slice(-6) : bare;
    }
    function projectParts(project) {
      const raw = project || "(no project)";
      if (raw === "(no project)") return { label: raw, path: "" };
      const cleaned = String(raw).replace(/[\\/]+$/g, "");
      const pieces = cleaned.split(/[\\/]/).filter(Boolean);
      return {
        label: pieces.length ? pieces[pieces.length - 1] : cleaned,
        path: cleaned,
      };
    }
    function fmtAbsolute(ms) { return ms ? new Date(ms).toLocaleString() : "—"; }
    function fmtRelative(ms) {
      if (!ms) return "—";
      const diff = Date.now() - ms;
      const s = Math.round(diff / 1000);
      if (s < 60) return s + "s ago";
      const m = Math.round(s / 60);
      if (m < 60) return m + "m ago";
      const h = Math.round(m / 60);
      if (h < 36) return h + "h ago";
      const d = Math.round(h / 24);
      if (d < 7) return d + "d ago";
      return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    function fmtDuration(ms) {
      if (!ms || ms <= 0) return "—";
      const m = Math.round(ms / 60000);
      if (m < 60) return m + "m";
      const h = Math.floor(m / 60);
      const rm = m % 60;
      return rm > 0 ? h + "h " + rm + "m" : h + "h";
    }
    function fmtTotalTime(ms) {
      if (!ms || ms <= 0) return "—";
      const h = ms / 3.6e6;
      if (h < 1) return Math.round(ms / 60000) + "m";
      if (h < 100) return h.toFixed(1) + "h";
      return Math.round(h) + "h";
    }
    function fmtCostCents(c) {
      if (c == null || c <= 0) return "—";
      if (c < 100) return "$" + (c / 100).toFixed(2);
      if (c < 100000) return "$" + (c / 100).toFixed(2);
      return "$" + Math.round(c / 100).toLocaleString();
    }
    function fmtHour(h) {
      if (h == null) return "—";
      const ampm = h < 12 ? "AM" : "PM";
      const hr = h % 12 === 0 ? 12 : h % 12;
      return hr + ampm;
    }
    function bucketOf(ms) {
      if (!ms) return "Earlier";
      const diff = Date.now() - ms;
      const d = diff / 86400000;
      if (d < 1) return "Today";
      if (d < 2) return "Yesterday";
      if (d < 7) return "This week";
      if (d < 30) return "This month";
      return "Earlier";
    }
    function roleLabel(role) {
      if (role === "tool_result") return "tool";
      return role || "message";
    }

    let heroRange = "all";   // "all" | "30" | "7"
    let heroTab   = "overview"; // "overview" | "models"
    let heroData  = null;       // cached /api/hero response for fast tab swaps

    function fmtTokens(n) {
      if (n == null) return "—";
      if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B";
      if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
      if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
      return String(n);
    }
    function fmtPeakHour(h) {
      if (h == null) return "—";
      if (h === 0) return "12 AM";
      if (h === 12) return "12 PM";
      return h < 12 ? h + " AM" : (h - 12) + " PM";
    }
    function shortModel(name) {
      if (!name) return "—";
      // claude-opus-4-7-20260101 → "Opus 4.7"
      const m = String(name).match(/(opus|sonnet|haiku)[-_]?(\d+(?:[.\-]\d+)?)/i);
      if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() + " " + m[2].replace("-", ".");
      return String(name).length > 20 ? String(name).slice(0, 18) + "…" : String(name);
    }
    function renderHeatmap(byDay) {
      const el = $("#hero-heatmap");
      el.innerHTML = "";
      // 26 cols × 7 rows. byDay is 182 entries oldest→newest. Map row=dayOfWeek, col=week.
      const cells = (byDay || []).slice(-182);
      // CSS uses grid-auto-flow row-major (default). We want column-major (week column). Swap.
      const grid = Array.from({ length: 7 }, () => Array(26).fill(null));
      for (let i = 0; i < cells.length; i++) {
        const col = Math.floor(i / 7);
        const row = i % 7;
        if (col < 26 && row < 7) grid[row][col] = cells[i];
      }
      // Compute level thresholds based on max in the window.
      const max = Math.max(1, ...cells.map(c => c?.count ?? 0));
      const lvl = (n) => {
        if (!n) return 0;
        const r = n / max;
        if (r > 0.66) return 4;
        if (r > 0.33) return 3;
        if (r > 0.10) return 2;
        return 1;
      };
      // Render row by row so day-of-week is consistent across columns.
      let n = 0;
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 26; col++) {
          const cell = grid[row][col];
          const div = document.createElement("div");
          div.className = "heat-cell" + (cell ? " l" + lvl(cell.count) : "");
          // Stagger by column so the ripple flows left→right across weeks.
          div.style.setProperty("--cell-i", String(col));
          if (cell) div.title = cell.date + " · " + cell.count + " session" + (cell.count === 1 ? "" : "s");
          el.appendChild(div);
          n++;
        }
      }
    }
    function renderOverviewStats(r) {
      const grid = $("#hero-stats");
      grid.className = "hero-stats";
      grid.innerHTML =
        '<div class="hero-stat featured"><div class="label">current streak</div><div class="value">' + (r.currentStreak || 0) + ' days</div></div>' +
        '<div class="hero-stat"><div class="label">sessions</div><div class="value">' + fmtNumber(r.sessions) + '</div></div>' +
        '<div class="hero-stat"><div class="label">total tokens</div><div class="value">' + fmtTokens(r.totalTokens) + '</div></div>' +
        '<div class="hero-stat"><div class="label">active days</div><div class="value">' + fmtNumber(r.activeDays) + '</div></div>' +
        '<div class="hero-stat"><div class="label">longest streak</div><div class="value">' + (r.longestStreak || 0) + ' days</div></div>' +
        '<div class="hero-stat"><div class="label">peak hour</div><div class="value">' + fmtPeakHour(r.peakHour) + '</div></div>' +
        '<div class="hero-stat"><div class="label">favorite model</div><div class="value">' + escapeHtml(shortModel(r.favoriteModel)) + '</div></div>';
    }

    async function renderModelsView() {
      const grid = $("#hero-stats");
      grid.className = "hero-stats models";
      grid.innerHTML = '<div class="hero-stat"><div class="label">loading…</div><div class="value">—</div></div>';
      try {
        const r = await fetch("/api/models?limit=4").then(r => r.json());
        const models = r.models || [];
        if (models.length === 0) {
          grid.innerHTML = '<div class="hero-stat"><div class="label">no model data yet</div><div class="value">—</div></div>';
          return;
        }
        grid.innerHTML = models.slice(0, 4).map(function (m) {
          const cost = "$" + ((m.costCents || 0) / 100).toFixed(2);
          return '<div class="hero-stat">' +
                   '<div class="label">' + escapeHtml(shortModel(m.model)) + '</div>' +
                   '<div class="value">' + cost + '</div>' +
                   '<div class="sub">' + fmtNumber(m.sessions) + ' sessions · ' + fmtNumber(m.messages) + ' msgs</div>' +
                 '</div>';
        }).join("");
      } catch (e) {
        grid.innerHTML = '<div class="hero-stat"><div class="label">load failed</div><div class="value">—</div></div>';
      }
    }

    async function loadHero() {
      try {
        const url = heroRange === "all" ? "/api/hero" : "/api/hero?days=" + heroRange;
        const r = await fetch(url).then(r => r.json());
        heroData = r;
        const greet = $("#hero-greet");
        if (greet && r.user) {
          greet.innerHTML = 'What’s up next, <em>' + escapeHtml(r.user) + '</em>.';
        }
        const kicker = $("#hero-kicker");
        if (kicker) {
          const range = heroRange === "all" ? "across all your sessions" :
                        heroRange === "30"  ? "last 30 days" : "last 7 days";
          kicker.textContent = "Picking up where you left off — " + range + ".";
        }
        if (heroTab === "overview") renderOverviewStats(r);
        else renderModelsView();
        renderHeatmap(r.byDay);
      } catch (e) {
        console.error("hero load failed:", e);
      }
    }

    function bindHero() {
      document.querySelectorAll(".hero-filter").forEach(btn => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".hero-filter").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          heroRange = btn.dataset.range;
          loadHero();
        });
      });
      document.querySelectorAll(".hero-tab").forEach(btn => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".hero-tab").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          heroTab = btn.dataset.tab;
          if (heroTab === "models") renderModelsView();
          else if (heroData) renderOverviewStats(heroData);
        });
      });
    }

    async function loadStats() {
      try {
        const r = await fetch("/api/wrapped").then(r => r.json());
        $("#stat-sessions").textContent = fmtNumber(r.sessions);
        $("#stat-messages").textContent = fmtNumber(r.messages);
        $("#stat-sources").textContent  = fmtNumber(r.sources);

        const top = r.topProjects?.[0];
        const topProject = projectParts(top?.project);
        $("#wrap-project").textContent = top ? topProject.label : "—";
        $("#wrap-project").title = top?.project ?? "";
        $("#wrap-project-sub").textContent = top ? countLabel(top.count, "session", "sessions") : "";

        $("#wrap-hour").textContent = fmtHour(r.busiestHour);
        $("#wrap-hour-sub").textContent = r.busiestHour != null ? "most active" : "no data yet";

        $("#wrap-time").textContent = fmtTotalTime(r.totalDurationMs);
        $("#wrap-time-sub").textContent = "across all sessions";

        $("#wrap-cost").textContent = fmtCostCents(r.totalCostCents);
        const tokens = (r.totalPromptTokens ?? 0) + (r.totalOutputTokens ?? 0);
        $("#wrap-cost-sub").textContent = tokens
          ? "vs flat subscription · " + (tokens / 1e6).toFixed(1) + "M tokens"
          : "vs flat subscription";
      } catch (e) {
        console.error(e);
      }
    }

    async function loadSessions() {
      const r = await fetch("/api/sessions").then(r => r.json());
      allSessions = r.sessions ?? [];
      const q = $("#search").value.trim();
      if (q) {
        runSearch(q);
      } else {
        renderSessions(filterBySource(allSessions));
      }
    }

    function filterBySource(rows) {
      if (activeSource === "all") return rows;
      return rows.filter(row => row.source === activeSource);
    }

    function setListHeader(mode, count) {
      $("#list-title").textContent = mode === "search" ? "Search results" : "Recent sessions";
      $("#list-count").textContent = mode === "search"
        ? countLabel(count, "match", "matches")
        : countLabel(count, "session", "sessions");
    }

    function setActiveSource(source) {
      activeSource = source;
      document.querySelectorAll(".source-filter").forEach(btn => {
        const active = btn.dataset.source === source;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", active ? "true" : "false");
      });
      const q = $("#search").value.trim();
      if (q) {
        runSearch(q);
      } else {
        renderSessions(filterBySource(allSessions));
      }
    }

    function renderSessions(sessions) {
      const ul = $("#session-list");
      ul.innerHTML = "";
      setListHeader("recent", sessions.length);
      if (!sessions.length) {
        ul.innerHTML = '<li class="empty"><h3>No sessions</h3><p class="hint">Change the source filter or run <code class="mono">npx crixin ingest</code>.</p></li>';
        return;
      }
      let lastBucket = null;
      for (const s of sessions) {
        const b = bucketOf(s.started_at);
        if (b !== lastBucket) {
          const h = document.createElement("li");
          h.className = "bucket-header";
          h.textContent = b;
          ul.appendChild(h);
          lastBucket = b;
        }
        const parts = projectParts(s.project);
        const li = document.createElement("li");
        li.className = "session-row";
        li.dataset.id = s.id;
        li.dataset.rowKey = s.id;
        li.classList.toggle("active", s.id === activeRowKey);
        li.title = (s.project ?? "") + (s.project ? " · " : "") + s.id;
        li.innerHTML =
          '<span class="badge-source" data-source="' + escapeHtml(s.source) + '">' + escapeHtml(sourceLabel(s.source)) + '</span>' +
          '<span class="title">' + escapeHtml(parts.label) + '</span>' +
          '<span class="msg-count">' + fmtNumber(s.message_count) + ' msgs</span>' +
          '<span class="meta">' + fmtRelative(s.started_at) + '</span>';
        li.addEventListener("click", () => selectSession(s.id, s.id));
        ul.appendChild(li);
      }
    }

    function markActiveRow(rowKey) {
      document.querySelectorAll(".session-row").forEach(el => {
        el.classList.toggle("active", el.dataset.rowKey === rowKey);
      });
    }

    async function selectSession(id, rowKey = id) {
      activeRowKey = rowKey;
      markActiveRow(rowKey);
      const r = await fetch("/api/sessions/" + encodeURIComponent(id)).then(r => r.json());
      const detail = $("#session-detail");
      const session = r.session;
      const messages = r.messages ?? [];
      const cwd = session.project ?? "~";
      const resumeCmd = buildResumeCmd(session.source, cwd, id);
      activeResumeCmd = resumeCmd;
      $("#copy-resume").disabled = false;

      const dur = (session.ended_at && session.started_at) ? session.ended_at - session.started_at : 0;
      const userMsgs = messages.filter(m => m.role === "user").length;
      const asstMsgs = messages.filter(m => m.role === "assistant").length;
      const project = projectParts(session.project);
      const path = project.path
        ? '<div class="detail-path mono" title="' + escapeHtml(project.path) + '">' + escapeHtml(project.path) + '</div>'
        : "";

      detail.innerHTML =
        '<div class="detail-head">' +
          '<div class="detail-title">' +
            '<h2>' + escapeHtml(project.label) + '</h2>' +
            path +
            '<div class="meta-line">' +
              '<span class="badge-source" data-source="' + escapeHtml(session.source) + '">' + escapeHtml(sourceLabel(session.source)) + '</span>' +
              '<span class="meta-dot">·</span><span>' + fmtAbsolute(session.started_at) + '</span>' +
              '<span class="meta-dot">·</span><span class="mono">' + escapeHtml(session.id) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="moments">' +
          '<div class="moment"><div class="label">duration</div><div class="value accent">' + fmtDuration(dur) + '</div></div>' +
          '<div class="moment"><div class="label">messages</div><div class="value">' + fmtNumber(session.message_count) + '</div></div>' +
          '<div class="moment"><div class="label">you / asst</div><div class="value">' + userMsgs + " / " + asstMsgs + '</div></div>' +
          '<div class="moment"><div class="label">api-equiv</div><div class="value accent">' + fmtCostCents(session.cost_usd_cents) + '</div></div>' +
        '</div>' +
        '<div class="resume-cmd" id="resume-cmd"><span class="prompt">$</span>' + escapeHtml(resumeCmd) + '</div>' +
        '<div class="messages"></div>';

      const messagesEl = detail.querySelector(".messages");
      for (const m of messages) {
        const div = document.createElement("div");
        const safeRole = String(m.role || "message").replace(/[^a-z0-9_-]/gi, "_");
        const ts = m.ts ? fmtRelative(m.ts) : "";
        div.className = "message role-" + safeRole;
        div.innerHTML =
          '<div class="role-strip">' +
            '<span class="role">' + escapeHtml(roleLabel(m.role)) + '</span>' +
            (ts ? '<span>' + escapeHtml(ts) + '</span>' : "") +
          '</div>' +
          '<div>' + renderContent(m.content ?? "") + '</div>';
        messagesEl.appendChild(div);
      }

      const cmd = detail.querySelector("#resume-cmd");
      cmd.addEventListener("click", async () => {
        await copyToClipboard(resumeCmd);
        flashCopied(cmd);
        flashCopied($("#copy-resume"));
      });
    }

    function buildResumeCmd(source, cwd, id) {
      const bare = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
      if (source === "claude-code") return "cd " + (cwd === "(no project)" ? "~" : cwd) + " && claude --resume " + bare;
      if (source === "codex") return "codex resume " + bare;
      if (source === "cursor") return "# Cursor: open the chat tab and find session " + bare.slice(0, 8);
      return "# resume: " + bare;
    }

    function renderContent(s) {
      const parts = [];
      let i = 0;
      const fence = String.fromCharCode(96, 96, 96);
      const re = new RegExp(fence + "(\\\\w*)\\\\n([\\\\s\\\\S]*?)" + fence, "g");
      let match;
      while ((match = re.exec(s)) !== null) {
        if (match.index > i) parts.push(escapeHtml(s.slice(i, match.index)));
        parts.push("<pre><code>" + escapeHtml(match[2]) + "</code></pre>");
        i = re.lastIndex;
      }
      if (i < s.length) parts.push(escapeHtml(s.slice(i)));
      return parts.join("");
    }

    async function copyToClipboard(text) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }

    function flashCopied(el) {
      if (!el) return;
      el.classList.add("copied");
      setTimeout(() => el.classList.remove("copied"), 1500);
    }

    $("#search").addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      const q = e.target.value.trim();
      searchTimer = setTimeout(() => runSearch(q), 180);
    });

    document.querySelectorAll(".source-filter").forEach(btn => {
      btn.setAttribute("aria-pressed", btn.classList.contains("active") ? "true" : "false");
      btn.addEventListener("click", () => setActiveSource(btn.dataset.source || "all"));
    });

    $("#refresh").addEventListener("click", async () => {
      await Promise.all([loadStats(), loadSessions()]);
    });

    $("#copy-resume").addEventListener("click", async () => {
      if (!activeResumeCmd) return;
      await copyToClipboard(activeResumeCmd);
      flashCopied($("#copy-resume"));
      flashCopied($("#resume-cmd"));
    });

    document.addEventListener("keydown", (e) => {
      const tag = document.activeElement?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        $("#search").focus();
      }
      if (e.key === "Escape" && document.activeElement === $("#search")) {
        $("#search").value = "";
        runSearch("");
      }
    });

    async function runSearch(q) {
      const requestId = ++searchRequestId;
      if (!q) {
        renderSessions(filterBySource(allSessions));
        return;
      }
      const r = await fetch("/api/search?q=" + encodeURIComponent(q)).then(r => r.json());
      if (requestId !== searchRequestId) return;
      const hits = filterBySource(r.hits ?? []);
      const ul = $("#session-list");
      ul.innerHTML = "";
      setListHeader("search", hits.length);
      if (!hits.length) {
        ul.innerHTML = '<li class="empty"><h3>No matches</h3><p class="hint">Try another word or change the source filter.</p></li>';
        return;
      }
      for (const hit of hits) {
        const parts = projectParts(hit.project);
        const li = document.createElement("li");
        const rowKey = hit.session_id + ":" + (hit.idx ?? 0);
        li.className = "session-row search-hit";
        li.dataset.id = hit.session_id;
        li.dataset.rowKey = rowKey;
        li.classList.toggle("active", rowKey === activeRowKey);
        li.title = (hit.project ?? "") + (hit.project ? " · " : "") + hit.session_id;
        li.innerHTML =
          '<span class="badge-source" data-source="' + escapeHtml(hit.source ?? "match") + '">' + escapeHtml(sourceLabel(hit.source ?? "match")) + '</span>' +
          '<span class="title">' + escapeHtml(parts.label) + '</span>' +
          '<span class="msg-count">msg ' + fmtNumber((hit.idx ?? 0) + 1) + '</span>' +
          '<span class="meta">' + fmtRelative(hit.ts) + '</span>' +
          '<div class="snippet">…' + escapeHtml(hit.snippet) + '…</div>';
        li.addEventListener("click", () => selectSession(hit.session_id, rowKey));
        ul.appendChild(li);
      }
    }

    loadStats();
    loadSessions();
    bindHero();
    loadHero();
  </script>
</body>
</html>`;
