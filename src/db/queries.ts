import type { DatabaseSync } from "node:sqlite";

export interface SessionRow {
  id: string;
  source: string;
  project: string | null;
  started_at: number | null;
  ended_at: number | null;
  message_count: number;
  prompt_tokens: number;
  output_tokens: number;
  cost_usd_cents: number;
  source_path: string;
  source_mtime: number;
  source_size: number;
}

export interface MessageRow {
  session_id: string;
  idx: number;
  role: string;
  content: string | null;
  ts: number | null;
  model: string | null;
  tokens: number | null;
}

export const queries = {
  listRecentSessions: (db: DatabaseSync, limit = 50): SessionRow[] => {
    const stmt = db.prepare(
      `SELECT * FROM sessions ORDER BY COALESCE(started_at, 0) DESC LIMIT ?`,
    );
    return stmt.all(limit) as unknown as SessionRow[];
  },

  getSession: (db: DatabaseSync, id: string): SessionRow | undefined => {
    const stmt = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
    return stmt.get(id) as unknown as SessionRow | undefined;
  },

  getMessages: (db: DatabaseSync, sessionId: string): MessageRow[] => {
    const stmt = db.prepare(
      `SELECT * FROM messages WHERE session_id = ? ORDER BY idx ASC`,
    );
    return stmt.all(sessionId) as unknown as MessageRow[];
  },

  searchMessages: (
    db: DatabaseSync,
    needle: string,
    limit = 25,
  ): { session_id: string; idx: number; snippet: string; ts: number | null }[] => {
    // v0.1: simple LIKE match. v0.2 ships an FTS index.
    const stmt = db.prepare(
      `SELECT session_id, idx,
              substr(content, MAX(1, instr(LOWER(content), LOWER(?)) - 60), 220) AS snippet,
              ts
         FROM messages
        WHERE LOWER(content) LIKE LOWER(?)
        ORDER BY ts DESC
        LIMIT ?`,
    );
    return stmt.all(needle, `%${needle}%`, limit) as unknown as {
      session_id: string;
      idx: number;
      snippet: string;
      ts: number | null;
    }[];
  },

  /** Quick aggregate stats for the dashboard header. */
  stats: (db: DatabaseSync): { sessions: number; messages: number; sources: number } => {
    const s = db.prepare(`SELECT COUNT(*) AS n FROM sessions`).get() as { n: number };
    const m = db.prepare(`SELECT COUNT(*) AS n FROM messages`).get() as { n: number };
    const src = db.prepare(`SELECT COUNT(DISTINCT source) AS n FROM sessions`).get() as {
      n: number;
    };
    return { sessions: s.n, messages: m.n, sources: src.n };
  },

  /**
   * Wrapped-style aggregates for the dashboard header strip / future Wrapped export.
   * Cheap enough to compute on every page load for v0.1.
   */
  aggregates: (db: DatabaseSync): {
    topProjects: { project: string; count: number }[];
    byHour: { hour: number; count: number }[];
    byDayOfWeek: { dow: number; count: number }[];
    bySource: { source: string; count: number; costCents: number }[];
    byMonth: { month: string; sessions: number; costCents: number }[];
    busiestHour: number | null;
    totalDurationMs: number;
    totalCostCents: number;
    totalPromptTokens: number;
    totalOutputTokens: number;
  } => {
    const topProjects = db
      .prepare(
        `SELECT COALESCE(project, '(no project)') AS project, COUNT(*) AS count
           FROM sessions
       GROUP BY project
       ORDER BY count DESC
          LIMIT 5`,
      )
      .all() as unknown as { project: string; count: number }[];

    const bySource = db
      .prepare(
        `SELECT source,
                COUNT(*) AS count,
                COALESCE(SUM(cost_usd_cents), 0) AS costCents
           FROM sessions
       GROUP BY source
       ORDER BY count DESC`,
      )
      .all() as unknown as { source: string; count: number; costCents: number }[];

    const byDayOfWeek = db
      .prepare(
        `SELECT CAST(strftime('%w', ts/1000, 'unixepoch', 'localtime') AS INTEGER) AS dow,
                COUNT(*) AS count
           FROM messages
          WHERE role = 'user' AND ts IS NOT NULL
       GROUP BY dow
       ORDER BY dow ASC`,
      )
      .all() as unknown as { dow: number; count: number }[];

    const byMonth = db
      .prepare(
        `SELECT strftime('%Y-%m', started_at/1000, 'unixepoch', 'localtime') AS month,
                COUNT(*) AS sessions,
                COALESCE(SUM(cost_usd_cents), 0) AS costCents
           FROM sessions
          WHERE started_at IS NOT NULL
       GROUP BY month
       ORDER BY month ASC`,
      )
      .all() as unknown as { month: string; sessions: number; costCents: number }[];

    const tokenSums = db
      .prepare(
        `SELECT COALESCE(SUM(prompt_tokens), 0) AS p,
                COALESCE(SUM(output_tokens), 0) AS o,
                COALESCE(SUM(cost_usd_cents), 0) AS c
           FROM sessions`,
      )
      .get() as { p: number; o: number; c: number };

    // Hour-of-day histogram on user messages (proxy for "when do you actually code with AI").
    // SQLite has no extract(); use strftime on epoch-ms-derived value.
    const byHour = db
      .prepare(
        `SELECT CAST(strftime('%H', ts/1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
                COUNT(*) AS count
           FROM messages
          WHERE role = 'user' AND ts IS NOT NULL
       GROUP BY hour
       ORDER BY hour ASC`,
      )
      .all() as unknown as { hour: number; count: number }[];

    let busiestHour: number | null = null;
    let busiestCount = -1;
    for (const row of byHour) {
      if (row.count > busiestCount) {
        busiestCount = row.count;
        busiestHour = row.hour;
      }
    }

    const dur = db
      .prepare(
        `SELECT COALESCE(SUM(COALESCE(ended_at, 0) - COALESCE(started_at, 0)), 0) AS ms
           FROM sessions
          WHERE started_at IS NOT NULL AND ended_at IS NOT NULL`,
      )
      .get() as { ms: number };

    return {
      topProjects,
      byHour,
      byDayOfWeek,
      bySource,
      byMonth,
      busiestHour,
      totalDurationMs: dur.ms,
      totalCostCents: tokenSums.c,
      totalPromptTokens: tokenSums.p,
      totalOutputTokens: tokenSums.o,
    };
  },

  /** Source-file fingerprint for idempotent re-ingest. */
  getSourceFingerprint: (
    db: DatabaseSync,
    id: string,
  ): { source_mtime: number; source_size: number } | undefined => {
    const stmt = db.prepare(
      `SELECT source_mtime, source_size FROM sessions WHERE id = ?`,
    );
    return stmt.get(id) as unknown as
      | { source_mtime: number; source_size: number }
      | undefined;
  },

  // ---------------------------------------------------------------------------
  // v0.0.4 analytical queries
  // ---------------------------------------------------------------------------

  /**
   * F1 — Cost forecast.
   * Computes year-to-date, last-30-day burn, and a linear projection to the
   * end of the current month and year. Cents throughout for integer math.
   */
  costForecast: (db: DatabaseSync): {
    ytdCents: number;
    last30dCents: number;
    last7dCents: number;
    projectedMonthEndCents: number;
    projectedYearEndCents: number;
    daysOfData: number;
  } => {
    const now = Date.now();
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
    const last30 = now - 30 * 86400000;
    const last7 = now - 7 * 86400000;

    const ytd = (db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd_cents),0) AS c
           FROM sessions WHERE started_at >= ?`,
      )
      .get(yearStart) as { c: number }).c;
    const m30 = (db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd_cents),0) AS c
           FROM sessions WHERE started_at >= ?`,
      )
      .get(last30) as { c: number }).c;
    const w7 = (db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd_cents),0) AS c
           FROM sessions WHERE started_at >= ?`,
      )
      .get(last7) as { c: number }).c;

    // Days of data we actually have (vs days elapsed in year).
    const firstSession = (db
      .prepare(`SELECT MIN(started_at) AS m FROM sessions WHERE started_at IS NOT NULL`)
      .get() as { m: number | null }).m;
    const daysOfData = firstSession ? Math.max(1, Math.ceil((now - firstSession) / 86400000)) : 0;

    // Project forward using last-30-day daily burn (or all-time if shorter).
    const burnDaily = m30 > 0 ? m30 / Math.min(30, daysOfData) : (daysOfData > 0 ? ytd / daysOfData : 0);
    const today = new Date(now);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).getTime();
    const yearEnd = new Date(today.getFullYear(), 11, 31, 23, 59, 59).getTime();
    const daysToMonthEnd = Math.max(0, Math.ceil((monthEnd - now) / 86400000));
    const daysToYearEnd = Math.max(0, Math.ceil((yearEnd - now) / 86400000));

    const monthSoFar = (db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd_cents),0) AS c
           FROM sessions WHERE started_at >= ?`,
      )
      .get(new Date(today.getFullYear(), today.getMonth(), 1).getTime()) as { c: number }).c;

    return {
      ytdCents: ytd,
      last30dCents: m30,
      last7dCents: w7,
      projectedMonthEndCents: Math.round(monthSoFar + burnDaily * daysToMonthEnd),
      projectedYearEndCents: Math.round(ytd + burnDaily * daysToYearEnd),
      daysOfData,
    };
  },

  /**
   * F2 — Top models breakdown.
   * Aggregates per-model usage from the messages table when `model` is set
   * (Anthropic ingester populates this for every assistant message).
   */
  topModels: (db: DatabaseSync, limit = 10): {
    model: string;
    sessions: number;
    messages: number;
    costCents: number;
    pctOfTotal: number;
  }[] => {
    // Cost is sums-by-session (not per-message) — JOINing messages would
    // multiply the per-session cost by message count. Two-pass approach.
    const msgRows = db
      .prepare(
        `SELECT model AS model,
                COUNT(*) AS messages,
                COUNT(DISTINCT session_id) AS sessions
         FROM messages
         WHERE model IS NOT NULL AND model <> ''
         GROUP BY model
         ORDER BY messages DESC
         LIMIT ?`,
      )
      .all(limit) as { model: string; messages: number; sessions: number }[];

    const costStmt = db.prepare(
      `SELECT COALESCE(SUM(cost_usd_cents), 0) AS c
         FROM sessions
         WHERE id IN (SELECT DISTINCT session_id FROM messages WHERE model = ?)`,
    );
    const total = msgRows.reduce((a, r) => a + r.messages, 0) || 1;
    return msgRows.map((r) => ({
      model: r.model,
      sessions: r.sessions,
      messages: r.messages,
      costCents: (costStmt.get(r.model) as { c: number }).c,
      pctOfTotal: r.messages / total,
    }));
  },

  /**
   * F12 — Multi-project comparison.
   * Per-project: session count, total cost, total tokens, median session
   * length (approximated via avg). Sorted by cost desc.
   */
  byProject: (db: DatabaseSync, limit = 25): {
    project: string;
    sessions: number;
    messages: number;
    costCents: number;
    promptTokens: number;
    outputTokens: number;
    avgSessionMs: number;
  }[] => {
    return db
      .prepare(
        `SELECT
           COALESCE(project, '(no project)') AS project,
           COUNT(*) AS sessions,
           COALESCE(SUM(message_count), 0) AS messages,
           COALESCE(SUM(cost_usd_cents), 0) AS costCents,
           COALESCE(SUM(prompt_tokens), 0) AS promptTokens,
           COALESCE(SUM(output_tokens), 0) AS outputTokens,
           COALESCE(AVG(NULLIF(COALESCE(ended_at,0) - COALESCE(started_at,0), 0)), 0) AS avgSessionMs
         FROM sessions
         GROUP BY project
         ORDER BY costCents DESC, sessions DESC
         LIMIT ?`,
      )
      .all(limit) as {
      project: string;
      sessions: number;
      messages: number;
      costCents: number;
      promptTokens: number;
      outputTokens: number;
      avgSessionMs: number;
    }[];
  },

  /**
   * F13 — Compare two sessions side-by-side.
   * Returns the structured diff of two session rows, plus message-shape stats
   * (user/assistant counts, longest message length).
   */
  compareSessions: (
    db: DatabaseSync,
    aId: string,
    bId: string,
  ): {
    a: SessionRow | undefined;
    b: SessionRow | undefined;
    aShape: { user: number; assistant: number; longest: number };
    bShape: { user: number; assistant: number; longest: number };
  } => {
    const get = db.prepare(`SELECT * FROM sessions WHERE id = ?`);
    const a = get.get(aId) as unknown as SessionRow | undefined;
    const b = get.get(bId) as unknown as SessionRow | undefined;
    const shape = (id: string) => {
      const r = db
        .prepare(
          `SELECT
             SUM(CASE WHEN role='user' THEN 1 ELSE 0 END) AS u,
             SUM(CASE WHEN role='assistant' THEN 1 ELSE 0 END) AS a,
             COALESCE(MAX(LENGTH(content)), 0) AS longest
           FROM messages WHERE session_id = ?`,
        )
        .get(id) as { u: number | null; a: number | null; longest: number };
      return { user: r.u ?? 0, assistant: r.a ?? 0, longest: r.longest };
    };
    return { a, b, aShape: shape(aId), bShape: shape(bId) };
  },

  /**
   * F11 — DORA/SPACE-aligned proxies.
   * Maps session data onto industry-recognized productivity dimensions.
   * Activity: sessions/day · messages/day · projects touched
   * Performance: cost-per-output-token trend (rising = more efficient)
   * Efficiency: avg session duration · avg messages-per-session
   * Flow: longest contiguous "active" block (no gap > 30 min)
   */
  productivityReport: (db: DatabaseSync, sinceDays = 30): {
    rangeDays: number;
    activity: { sessionsPerDay: number; messagesPerDay: number; projectsTouched: number };
    performance: { costCentsPerOutputKtok: number; outputTokens: number };
    efficiency: { avgSessionMinutes: number; avgMessagesPerSession: number };
    flow: { longestFocusBlockMinutes: number; focusBlocksOverHour: number };
  } => {
    const since = Date.now() - sinceDays * 86400000;
    const totals = db
      .prepare(
        `SELECT
           COUNT(*) AS sessions,
           COALESCE(SUM(message_count),0) AS messages,
           COUNT(DISTINCT project) AS projects,
           COALESCE(SUM(cost_usd_cents),0) AS cost,
           COALESCE(SUM(output_tokens),0) AS otok,
           COALESCE(AVG(NULLIF(COALESCE(ended_at,0)-COALESCE(started_at,0),0)),0) AS avgMs,
           COALESCE(AVG(message_count),0) AS avgMsgs
         FROM sessions
         WHERE started_at >= ?`,
      )
      .get(since) as {
      sessions: number;
      messages: number;
      projects: number;
      cost: number;
      otok: number;
      avgMs: number;
      avgMsgs: number;
    };

    // Flow blocks: walk sessions chronologically, accumulate until a gap > 30 min.
    const sessions = db
      .prepare(
        `SELECT started_at, ended_at FROM sessions
         WHERE started_at IS NOT NULL AND started_at >= ?
         ORDER BY started_at ASC`,
      )
      .all(since) as { started_at: number; ended_at: number | null }[];
    const GAP = 30 * 60 * 1000;
    let blocks: number[] = [];
    let curStart: number | null = null;
    let curEnd: number | null = null;
    for (const s of sessions) {
      const end = s.ended_at ?? s.started_at;
      if (curStart === null) {
        curStart = s.started_at;
        curEnd = end;
      } else if (s.started_at - (curEnd ?? curStart) > GAP) {
        blocks.push((curEnd ?? curStart) - curStart);
        curStart = s.started_at;
        curEnd = end;
      } else {
        curEnd = Math.max(curEnd ?? 0, end);
      }
    }
    if (curStart !== null) blocks.push((curEnd ?? curStart) - curStart);
    const longestMs = blocks.length ? Math.max(...blocks) : 0;
    const overHour = blocks.filter((b) => b >= 3600 * 1000).length;

    return {
      rangeDays: sinceDays,
      activity: {
        sessionsPerDay: totals.sessions / sinceDays,
        messagesPerDay: totals.messages / sinceDays,
        projectsTouched: totals.projects,
      },
      performance: {
        costCentsPerOutputKtok: totals.otok > 0 ? (totals.cost / (totals.otok / 1000)) : 0,
        outputTokens: totals.otok,
      },
      efficiency: {
        avgSessionMinutes: totals.avgMs / 60000,
        avgMessagesPerSession: totals.avgMsgs,
      },
      flow: {
        longestFocusBlockMinutes: longestMs / 60000,
        focusBlocksOverHour: overHour,
      },
    };
  },

  /**
   * F15 — Skip-pattern detector.
   *
   * Scans assistant messages for phrases that mark a "I'm not going to fix
   * this" decision — sometimes legitimate, sometimes the model duck-typing
   * its way past a real bug. Surfaces both as a count and as concrete rows
   * the user can audit.
   *
   * The phrases are deliberately specific to avoid false positives on
   * benign uses ("the existing code" is fine; "this is a pre-existing
   * issue" is the signal we want).
   */
  skipPatterns: (
    db: DatabaseSync,
    opts: { sinceDays?: number; project?: string; limit?: number } = {},
  ): {
    sessionId: string;
    project: string | null;
    ts: number | null;
    snippet: string;
    phrase: string;
    source: string;
  }[] => {
    const phrases = [
      "pre-existing", "preexisting", "pre existing",
      "out of scope", "outside the scope", "out-of-scope",
      "separate issue", "separate concern",
      "not related to this", "unrelated to",
      "i'll skip", "i will skip",
      "moving on", "let me move on",
      "i won't fix this", "i wont fix this", "won't fix that",
      "leaving as is", "leave as is",
      "not part of", "outside this task",
      "won't touch", "wont touch",
    ];
    const sinceMs = opts.sinceDays != null ? Date.now() - opts.sinceDays * 86400000 : 0;
    const limit = Math.min(opts.limit ?? 50, 500);

    const params: (string | number)[] = [];
    const phraseClause = phrases.map(() => `LOWER(m.content) LIKE ?`).join(" OR ");
    for (const p of phrases) params.push(`%${p}%`);

    let where = `m.role = 'assistant' AND m.content IS NOT NULL AND (${phraseClause})`;
    if (sinceMs > 0) {
      where += ` AND m.ts >= ?`;
      params.push(sinceMs);
    }
    if (opts.project) {
      where += ` AND s.project = ?`;
      params.push(opts.project);
    }
    params.push(limit);

    const rows = db
      .prepare(
        `SELECT m.session_id, s.project, s.source, m.ts, m.content
         FROM messages m JOIN sessions s ON s.id = m.session_id
         WHERE ${where}
         ORDER BY m.ts DESC
         LIMIT ?`,
      )
      .all(...params) as { session_id: string; project: string | null; source: string; ts: number | null; content: string }[];

    return rows.map((r) => {
      // Find the phrase that matched + extract a snippet around it.
      const lower = r.content.toLowerCase();
      let phrase = "";
      let idx = -1;
      for (const p of phrases) {
        const i = lower.indexOf(p);
        if (i !== -1) { phrase = p; idx = i; break; }
      }
      const snippet = idx === -1
        ? r.content.slice(0, 200)
        : r.content.slice(Math.max(0, idx - 80), idx + 160).replace(/\s+/g, " ").trim();
      return {
        sessionId: r.session_id,
        project: r.project,
        ts: r.ts,
        snippet,
        phrase,
        source: r.source,
      };
    });
  },

  /**
   * F15 — Aggregate skip stats per source/project. Used by `crixin skipped`
   * for the summary header and by F16 (tool archetype) for the Skipper score.
   */
  skipStats: (db: DatabaseSync): {
    bySource: { source: string; assistantMessages: number; skips: number; rate: number }[];
    byProject: { project: string; assistantMessages: number; skips: number }[];
  } => {
    const phraseLikes = [
      "%pre-existing%", "%preexisting%", "%pre existing%",
      "%out of scope%", "%outside the scope%", "%out-of-scope%",
      "%separate issue%", "%separate concern%",
      "%not related to this%", "%unrelated to%",
      "%i'll skip%", "%i will skip%",
      "%moving on%",
      "%won't fix this%", "%wont fix this%", "%won't fix that%",
      "%leaving as is%", "%leave as is%",
      "%won't touch%", "%wont touch%",
    ];
    const orClause = phraseLikes.map(() => "LOWER(m.content) LIKE ?").join(" OR ");
    const placeholders = phraseLikes.map((p) => p.toLowerCase());

    // Use a CTE to compute the skip flag once — node:sqlite doesn't accept the
    // same parameter bound twice, so we can't use the OR clause in two places.
    const bySourceSql = `
      WITH msg_skip AS (
        SELECT m.session_id, m.role,
               (CASE WHEN m.role = 'assistant' AND (${orClause}) THEN 1 ELSE 0 END) AS isSkip
        FROM messages m
      )
      SELECT s.source AS source,
             SUM(CASE WHEN ms.role = 'assistant' THEN 1 ELSE 0 END) AS assistantMessages,
             SUM(ms.isSkip) AS skips
      FROM msg_skip ms JOIN sessions s ON s.id = ms.session_id
      GROUP BY s.source`;

    const byProjectSql = `
      WITH msg_skip AS (
        SELECT m.session_id, m.role,
               (CASE WHEN m.role = 'assistant' AND (${orClause}) THEN 1 ELSE 0 END) AS isSkip
        FROM messages m
      )
      SELECT COALESCE(s.project, '(no project)') AS project,
             SUM(CASE WHEN ms.role = 'assistant' THEN 1 ELSE 0 END) AS assistantMessages,
             SUM(ms.isSkip) AS skips
      FROM msg_skip ms JOIN sessions s ON s.id = ms.session_id
      GROUP BY project
      HAVING skips > 0
      ORDER BY skips DESC
      LIMIT 25`;

    const bySource = db.prepare(bySourceSql).all(...placeholders) as {
      source: string; assistantMessages: number; skips: number;
    }[];
    const byProject = db.prepare(byProjectSql).all(...placeholders) as {
      project: string; assistantMessages: number; skips: number;
    }[];

    return {
      bySource: bySource.map((r) => ({
        ...r,
        rate: r.assistantMessages > 0 ? r.skips / r.assistantMessages : 0,
      })),
      byProject,
    };
  },

  /**
   * F16 — Tool-side behavioral signals.
   *
   * Returns one row per source with **9 distinct pattern signals** computed
   * against assistant messages only. Used by `inferToolArchetype()` to label
   * the LLM behaviorally.
   *
   * Each signal is a percentage of assistant messages matching that phrase
   * cluster — meaningful thresholds tend to start at 3–5% (rates below that
   * are noise). Two volume signals (avg lengths) round it out.
   */
  toolBehaviorSignals: (
    db: DatabaseSync,
    sourceFilter?: string,
  ): {
    source: string;
    assistantMessages: number;
    avgAssistantLength: number;
    avgUserLength: number;
    skipRate: number;        // "pre-existing", "out of scope", "won't fix"
    apologizeRate: number;   // "you're right", "I apologize", "my mistake"
    hedgeRate: number;       // "I think", "probably", "might", "perhaps"
    reverseRate: number;     // "actually", "let me revise", "wait, that"
    optimistRate: number;    // "all set", "looks good", "done!", "complete"
    debugRate: number;       // "Traceback", "Error:", "Exception", "stack trace"
    questionRate: number;    // assistant messages ending with "?"
    codeBlockRate: number;   // contains ``` fence
  }[] => {
    // Phrase clusters — ordered for readability, kept conservative so the
    // base rates are interpretable (e.g. "I think" at >5% is real signal).
    const skip = [
      "%pre-existing%", "%preexisting%", "%pre existing%",
      "%out of scope%", "%outside the scope%",
      "%separate issue%", "%not related to this%",
      "%won't fix this%", "%wont fix this%",
      "%leaving as is%", "%won't touch%",
    ];
    const apology = [
      "%you're right%", "%youre right%",
      "%i apologize%", "%my apologies%",
      "%my mistake%", "%i was wrong%",
    ];
    const hedge = [
      "%i think %", "%i believe %", "%it seems %", "%it appears %",
      "%probably%", "%might be %", "%might work%",
      "%perhaps %", "%possibly %", "%could be %",
    ];
    const reverse = [
      "%actually,%", "%actually, %",
      "%let me revise%", "%on second thought%",
      "%wait, that%", "%scratch that%",
      "%i was incorrect%", "%i misread%",
    ];
    const optimist = [
      "%all set!%", "%all set.%",
      "%looks good!%", "%looks good.%",
      "%done!%", "%complete!%", "%complete.%",
      "%ready to go%", "%we're good%",
      "%everything works%", "%fully working%",
    ];
    const debug = [
      "%traceback%", "%error:%", "%exception%",
      "%stack trace%", "%uncaught%",
      "%failed with%", "%segmentation fault%",
    ];

    const ratePhrase = (alias: string, phrases: string[]): { sql: string; params: string[] } => {
      const orClause = phrases.map(() => "LOWER(m.content) LIKE ?").join(" OR ");
      return {
        sql: `SUM(CASE WHEN m.role = 'assistant' AND (${orClause}) THEN 1 ELSE 0 END) * 1.0
              / NULLIF(SUM(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END), 0) AS ${alias}`,
        params: phrases.map((p) => p.toLowerCase()),
      };
    };

    const r1 = ratePhrase("skipRate", skip);
    const r2 = ratePhrase("apologizeRate", apology);
    const r3 = ratePhrase("hedgeRate", hedge);
    const r4 = ratePhrase("reverseRate", reverse);
    const r5 = ratePhrase("optimistRate", optimist);
    const r6 = ratePhrase("debugRate", debug);

    const where = sourceFilter ? "AND s.source = ?" : "";

    const sql = `
      SELECT s.source AS source,
             SUM(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END) AS assistantMessages,
             AVG(CASE WHEN m.role = 'assistant' THEN LENGTH(m.content) END) AS avgAssistantLength,
             AVG(CASE WHEN m.role = 'user' THEN LENGTH(m.content) END) AS avgUserLength,
             ${r1.sql},
             ${r2.sql},
             ${r3.sql},
             ${r4.sql},
             ${r5.sql},
             ${r6.sql},
             SUM(CASE WHEN m.role = 'assistant' AND m.content LIKE '%?' THEN 1 ELSE 0 END) * 1.0
               / NULLIF(SUM(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END), 0) AS questionRate,
             SUM(CASE WHEN m.role = 'assistant' AND m.content LIKE '%\`\`\`%' THEN 1 ELSE 0 END) * 1.0
               / NULLIF(SUM(CASE WHEN m.role = 'assistant' THEN 1 ELSE 0 END), 0) AS codeBlockRate
      FROM messages m JOIN sessions s ON s.id = m.session_id
      WHERE 1 = 1 ${where}
      GROUP BY s.source
      HAVING assistantMessages > 0
      ORDER BY assistantMessages DESC`;

    const params = [
      ...r1.params, ...r2.params, ...r3.params,
      ...r4.params, ...r5.params, ...r6.params,
      ...(sourceFilter ? [sourceFilter] : []),
    ];

    return db.prepare(sql).all(...params) as {
      source: string;
      assistantMessages: number;
      avgAssistantLength: number;
      avgUserLength: number;
      skipRate: number;
      apologizeRate: number;
      hedgeRate: number;
      reverseRate: number;
      optimistRate: number;
      debugRate: number;
      questionRate: number;
      codeBlockRate: number;
    }[];
  },

  /**
   * F6 — Prompt library extraction.
   * Returns top user prompts ranked by length × distinctness. Useful, complex
   * prompts surface; boilerplate "ok" / "yes" / "fix" prompts get filtered.
   */
  topPrompts: (db: DatabaseSync, limit = 50): {
    sessionId: string;
    project: string | null;
    ts: number | null;
    content: string;
    length: number;
  }[] => {
    return db
      .prepare(
        `SELECT m.session_id AS sessionId, s.project, m.ts, m.content, LENGTH(m.content) AS length
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE m.role = 'user'
           AND m.content IS NOT NULL
           AND LENGTH(m.content) >= 80
           AND LENGTH(m.content) <= 2000
         ORDER BY length DESC
         LIMIT ?`,
      )
      .all(limit) as {
      sessionId: string;
      project: string | null;
      ts: number | null;
      content: string;
      length: number;
    }[];
  },

  /**
   * Hero-block summary for the in-product dashboard. Single round-trip,
   * mirrors the Claude-Desktop-style overview: total tokens, active days,
   * streaks, peak hour, favorite model, and a per-day session count series
   * for the heatmap. Optional `sinceMs` filters the counters; the heatmap
   * always returns the last 26 weeks so the calendar shape stays consistent.
   */
  heroSummary: (
    db: DatabaseSync,
    sinceMs?: number,
  ): {
    sessions: number;
    messages: number;
    totalTokens: number;
    activeDays: number;
    currentStreak: number;
    longestStreak: number;
    peakHour: number | null;
    favoriteModel: string | null;
    byDay: { date: string; count: number }[];
  } => {
    const sinceClause = sinceMs ? `WHERE started_at >= ${Number(sinceMs)}` : "";
    const sumRow = db
      .prepare(
        `SELECT COUNT(*) AS s,
                COALESCE(SUM(message_count), 0) AS m,
                COALESCE(SUM(prompt_tokens), 0) + COALESCE(SUM(output_tokens), 0) AS t
           FROM sessions ${sinceClause}`,
      )
      .get() as { s: number; m: number; t: number };

    const dayRows = db
      .prepare(
        `SELECT date(started_at/1000, 'unixepoch', 'localtime') AS d,
                COUNT(*) AS c
           FROM sessions
          WHERE started_at IS NOT NULL ${sinceMs ? `AND started_at >= ${Number(sinceMs)}` : ""}
       GROUP BY d
       ORDER BY d ASC`,
      )
      .all() as unknown as { d: string; c: number }[];

    const peakRow = db
      .prepare(
        `SELECT CAST(strftime('%H', ts/1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
                COUNT(*) AS count
           FROM messages
          WHERE role = 'user' AND ts IS NOT NULL
       GROUP BY hour
       ORDER BY count DESC
          LIMIT 1`,
      )
      .get() as { hour: number; count: number } | undefined;

    const modelRow = db
      .prepare(
        `SELECT model, COUNT(*) AS c
           FROM messages
          WHERE model IS NOT NULL AND model <> ''
       GROUP BY model
       ORDER BY c DESC
          LIMIT 1`,
      )
      .get() as { model: string; c: number } | undefined;

    const days = dayRows.map((r) => r.d);
    const daySet = new Set(days);
    const todayLocal = (() => {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${dd}`;
    })();
    const stepBack = (s: string, n: number): string => {
      const t = Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) - n * 86400000;
      const d = new Date(t);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    };

    let currentStreak = 0;
    if (daySet.has(todayLocal)) {
      currentStreak = 1;
      for (let i = 1; i < 10000; i++) {
        if (daySet.has(stepBack(todayLocal, i))) currentStreak++;
        else break;
      }
    } else if (daySet.has(stepBack(todayLocal, 1))) {
      currentStreak = 1;
      for (let i = 2; i < 10000; i++) {
        if (daySet.has(stepBack(todayLocal, i))) currentStreak++;
        else break;
      }
    }

    let longestStreak = 0;
    {
      const sorted = [...days].sort();
      let run = 0;
      let prev: string | null = null;
      for (const d of sorted) {
        if (prev === null || stepBack(d, 1) !== prev) run = 1;
        else run++;
        if (run > longestStreak) longestStreak = run;
        prev = d;
      }
    }

    const heatmap: { date: string; count: number }[] = [];
    for (let i = 181; i >= 0; i--) heatmap.push({ date: stepBack(todayLocal, i), count: 0 });
    const heatIdx = new Map(heatmap.map((h, i) => [h.date, i]));
    const recentRows = db
      .prepare(
        `SELECT date(started_at/1000, 'unixepoch', 'localtime') AS d,
                COUNT(*) AS c
           FROM sessions
          WHERE started_at >= ?
       GROUP BY d`,
      )
      .all(Date.now() - 182 * 86400000) as unknown as { d: string; c: number }[];
    for (const r of recentRows) {
      const i = heatIdx.get(r.d);
      if (i !== undefined) heatmap[i]!.count = r.c;
    }

    return {
      sessions: sumRow.s,
      messages: sumRow.m,
      totalTokens: Number(sumRow.t),
      activeDays: days.length,
      currentStreak,
      longestStreak,
      peakHour: peakRow?.hour ?? null,
      favoriteModel: modelRow?.model ?? null,
      byDay: heatmap,
    };
  },
};

// ---------------------------------------------------------------------------
// Tag operations (F8) — separate namespace so the analytical queries above
// stay focused.
// ---------------------------------------------------------------------------

export const tags = {
  list: (db: DatabaseSync): { name: string; color: string | null; count: number }[] => {
    return db
      .prepare(
        `SELECT t.name, t.color, COUNT(st.session_id) AS count
         FROM tags t LEFT JOIN session_tags st ON st.tag = t.name
         GROUP BY t.name ORDER BY count DESC, t.name ASC`,
      )
      .all() as { name: string; color: string | null; count: number }[];
  },

  create: (db: DatabaseSync, name: string, color: string | null = null): void => {
    db.prepare(
      `INSERT INTO tags (name, color, created_at) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET color = COALESCE(excluded.color, tags.color)`,
    ).run(name, color, Date.now());
  },

  attach: (db: DatabaseSync, sessionId: string, tag: string): void => {
    tags.create(db, tag);
    db.prepare(
      `INSERT OR IGNORE INTO session_tags (session_id, tag, added_at) VALUES (?, ?, ?)`,
    ).run(sessionId, tag, Date.now());
  },

  detach: (db: DatabaseSync, sessionId: string, tag: string): void => {
    db.prepare(
      `DELETE FROM session_tags WHERE session_id = ? AND tag = ?`,
    ).run(sessionId, tag);
  },

  forSession: (db: DatabaseSync, sessionId: string): string[] => {
    return (
      db
        .prepare(`SELECT tag FROM session_tags WHERE session_id = ?`)
        .all(sessionId) as { tag: string }[]
    ).map((r) => r.tag);
  },

  pin: (db: DatabaseSync, sessionId: string, pinned: boolean): void => {
    db.prepare(`UPDATE sessions SET pinned = ? WHERE id = ?`).run(pinned ? 1 : 0, sessionId);
  },
};
