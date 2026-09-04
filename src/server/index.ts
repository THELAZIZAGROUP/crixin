import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { userInfo } from "node:os";
import { getDb } from "../db/init.js";
import { queries, tags as tagOps } from "../db/queries.js";
import { isPro } from "../license/features.js";
import { dashboardHtml } from "./views.js";

export interface ServerHandle {
  url: string;
  port: number;
  stop: () => Promise<void>;
}

export async function startServer(opts: { port: number }): Promise<ServerHandle> {
  const app = new Hono();

  app.get("/", (c) => c.html(dashboardHtml));

  app.get("/api/stats", (c) => {
    const db = getDb();
    return c.json(queries.stats(db));
  });

  app.get("/api/wrapped", (c) => {
    const db = getDb();
    const stats = queries.stats(db);
    const agg = queries.aggregates(db);
    return c.json({ ...stats, ...agg });
  });

  app.get("/api/hero", (c) => {
    const db = getDb();
    const days = c.req.query("days");
    const sinceMs = days ? Date.now() - Number(days) * 86400000 : undefined;
    const summary = queries.heroSummary(db, sinceMs);
    return c.json({ ...summary, user: userInfo().username });
  });

  app.get("/api/sessions", (c) => {
    const db = getDb();
    const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
    const source = c.req.query("source");           // F4 — filter chips
    const project = c.req.query("project");
    const tag = c.req.query("tag");                  // F8

    let sessions = queries.listRecentSessions(db, 500);
    if (source) sessions = sessions.filter((s) => s.source === source);
    if (project) sessions = sessions.filter((s) => s.project === project);
    if (tag) {
      const tagged = new Set(
        (db.prepare(`SELECT session_id FROM session_tags WHERE tag = ?`).all(tag) as { session_id: string }[]).map((r) => r.session_id),
      );
      sessions = sessions.filter((s) => tagged.has(s.id));
    }
    sessions = sessions.slice(0, limit);
    // Pinned sessions float to the top regardless of date order
    sessions.sort((a, b) => {
      const ap = (a as unknown as { pinned?: number }).pinned ?? 0;
      const bp = (b as unknown as { pinned?: number }).pinned ?? 0;
      if (ap !== bp) return bp - ap;
      return (b.started_at ?? 0) - (a.started_at ?? 0);
    });
    return c.json({ sessions });
  });

  // F1 — cost forecast
  app.get("/api/forecast", (c) => {
    const db = getDb();
    const f = queries.costForecast(db);
    return c.json({ ...f, isPro: isPro() });
  });

  // F2 — top models
  app.get("/api/models", (c) => {
    const db = getDb();
    const limit = isPro() ? Math.min(Number(c.req.query("limit") ?? "20"), 50) : 3;
    return c.json({ models: queries.topModels(db, limit), isPro: isPro() });
  });

  // F12 — by-project breakdown (Pro)
  app.get("/api/projects", (c) => {
    if (!isPro()) return c.json({ error: "pro_only" }, 402);
    const db = getDb();
    return c.json({ projects: queries.byProject(db, 25) });
  });

  // F11 — productivity report (Pro)
  app.get("/api/report", (c) => {
    if (!isPro()) return c.json({ error: "pro_only" }, 402);
    const db = getDb();
    const days = Math.min(Number(c.req.query("days") ?? "30"), 365);
    return c.json(queries.productivityReport(db, days));
  });

  // F6 — prompt library
  app.get("/api/prompts", (c) => {
    const db = getDb();
    const limit = isPro() ? Math.min(Number(c.req.query("limit") ?? "50"), 200) : 3;
    return c.json({ prompts: queries.topPrompts(db, limit), isPro: isPro() });
  });

  // F8 — tags
  app.get("/api/tags", (c) => c.json({ tags: tagOps.list(getDb()) }));
  app.post("/api/tags/:sessionId", async (c) => {
    const db = getDb();
    const sessionId = c.req.param("sessionId");
    const { tag } = (await c.req.json()) as { tag?: string };
    if (!tag) return c.json({ error: "tag required" }, 400);
    if (!isPro()) {
      const existing = tagOps.list(db);
      if (existing.length >= 5 && !existing.find((t) => t.name === tag)) {
        return c.json({ error: "free tier capped at 5 tags" }, 402);
      }
    }
    tagOps.attach(db, sessionId, tag);
    return c.json({ ok: true });
  });
  app.delete("/api/tags/:sessionId/:tag", (c) => {
    tagOps.detach(getDb(), c.req.param("sessionId"), c.req.param("tag"));
    return c.json({ ok: true });
  });
  app.post("/api/pin/:sessionId", async (c) => {
    const { pinned } = (await c.req.json().catch(() => ({}))) as { pinned?: boolean };
    tagOps.pin(getDb(), c.req.param("sessionId"), pinned ?? true);
    return c.json({ ok: true });
  });

  app.get("/api/sessions/:id", (c) => {
    const db = getDb();
    const id = c.req.param("id");
    const session = queries.getSession(db, id);
    if (!session) return c.json({ error: "not found" }, 404);
    const messages = queries.getMessages(db, id);
    return c.json({ session, messages });
  });

  app.get("/api/search", (c) => {
    const db = getDb();
    const q = (c.req.query("q") ?? "").trim();
    if (!q) return c.json({ hits: [] });
    const rawHits = queries.searchMessages(db, q, 30);
    // Enrich with session metadata so the dashboard can keep search results
    // visually consistent with the recent-session list.
    const hits = rawHits.map((h) => {
      const s = queries.getSession(db, h.session_id);
      return {
        ...h,
        project: s?.project ?? null,
        source: s?.source ?? null,
        message_count: s?.message_count ?? null,
      };
    });
    return c.json({ hits });
  });

  app.get("/health", (c) => c.json({ ok: true }));

  return new Promise<ServerHandle>((resolve) => {
    const server = serve(
      { fetch: app.fetch, hostname: "127.0.0.1", port: opts.port },
      (info) => {
        const port = info.port;
        const url = `http://127.0.0.1:${port}`;
        resolve({
          url,
          port,
          stop: () =>
            new Promise<void>((r, j) => {
              server.close((err) => (err ? j(err) : r()));
            }),
        });
      },
    );
  });
}
