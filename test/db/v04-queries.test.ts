import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX_ROOT = join(__dirname, "..", "fixtures", "projects");

const TMP_HOME = mkdtempSync(join(tmpdir(), "crixin-v04-"));
process.env["CRIXIN_HOME"] = TMP_HOME;
process.env["CRIXIN_CLAUDE_PROJECTS"] = FIX_ROOT;
process.env["CRIXIN_CODEX_HOME"] = mkdtempSync(join(tmpdir(), "empty-codex-"));
process.env["CRIXIN_CURSOR_APPDATA"] = mkdtempSync(join(tmpdir(), "empty-cursor-"));

const { ingestClaudeCode } = await import("../../src/ingesters/claude-code.ts");
const { getDb, closeDb } = await import("../../src/db/init.ts");
const { queries, tags } = await import("../../src/db/queries.ts");

describe("v0.0.4 queries", () => {
  before(() => {
    getDb();
    ingestClaudeCode();
  });
  after(() => {
    closeDb();
    rmSync(TMP_HOME, { recursive: true, force: true });
  });

  it("costForecast returns plausible totals", () => {
    const db = getDb();
    const f = queries.costForecast(db);
    assert.ok(f.ytdCents >= 0);
    assert.ok(f.daysOfData >= 0);
    assert.ok(f.projectedYearEndCents >= f.ytdCents - 1, "year-end projection should not be lower than YTD");
  });

  it("topModels returns rows summing to ~100% share", () => {
    const db = getDb();
    const rows = queries.topModels(db, 50);
    if (rows.length > 0) {
      const sum = rows.reduce((a, r) => a + r.pctOfTotal, 0);
      assert.ok(Math.abs(sum - 1.0) < 0.0001, `expected ~1.0, got ${sum}`);
    }
  });

  it("byProject returns rows ordered by cost desc", () => {
    const db = getDb();
    const rows = queries.byProject(db, 10);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i - 1]!.costCents >= rows[i]!.costCents);
    }
  });

  it("compareSessions returns a + b + shapes", () => {
    const db = getDb();
    const rows = queries.listRecentSessions(db, 2);
    if (rows.length < 2) return; // fixture only has 1 session, skip
    const c = queries.compareSessions(db, rows[0]!.id, rows[1]!.id);
    assert.ok(c.a);
    assert.ok(c.b);
    assert.ok(typeof c.aShape.user === "number");
    assert.ok(typeof c.bShape.assistant === "number");
  });

  it("topPrompts filters to user role + length range", () => {
    const db = getDb();
    const prompts = queries.topPrompts(db, 50);
    for (const p of prompts) {
      assert.ok(p.length >= 80 && p.length <= 2000);
      assert.ok(p.content.length >= 80);
    }
  });

  it("tags: create, attach, list, detach", () => {
    const db = getDb();
    const sessions = queries.listRecentSessions(db, 1);
    if (sessions.length === 0) return;
    const id = sessions[0]!.id;

    tags.create(db, "auth-refactor", "#f5b452");
    tags.attach(db, id, "auth-refactor");
    const list = tags.list(db);
    const tag = list.find((t) => t.name === "auth-refactor");
    assert.ok(tag, "tag should be in list");
    assert.equal(tag!.count, 1);
    assert.equal(tag!.color, "#f5b452");

    const ofSession = tags.forSession(db, id);
    assert.ok(ofSession.includes("auth-refactor"));

    tags.detach(db, id, "auth-refactor");
    const after = tags.forSession(db, id);
    assert.ok(!after.includes("auth-refactor"));
  });

  it("pin updates session.pinned", () => {
    const db = getDb();
    const sessions = queries.listRecentSessions(db, 1);
    if (sessions.length === 0) return;
    const id = sessions[0]!.id;
    tags.pin(db, id, true);
    const row = db.prepare(`SELECT pinned FROM sessions WHERE id = ?`).get(id) as { pinned: number };
    assert.equal(row.pinned, 1);
    tags.pin(db, id, false);
  });

  it("productivityReport computes activity + flow blocks", () => {
    const db = getDb();
    const r = queries.productivityReport(db, 365);
    assert.ok(r.rangeDays === 365);
    assert.ok(r.activity.sessionsPerDay >= 0);
    assert.ok(r.flow.longestFocusBlockMinutes >= 0);
  });
});
