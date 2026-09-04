import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const TMP_HOME = mkdtempSync(join(tmpdir(), "crixin-sync-mig-"));
process.env["CRIXIN_HOME"] = TMP_HOME;

const { paths, ensureCrixinHome } = await import("../../src/lib/paths.ts");

describe("v4 → v5 schema migration", () => {
  before(() => {
    ensureCrixinHome();
    // Seed a DB that looks like v4 — has sessions + voice_calls but lacks
    // sync_devices / sync_outbox / sync_inbox. We do this by running the v4
    // subset of CREATE statements directly and stamping meta='4'.
    const db = new DatabaseSync(paths.dbFile);
    db.exec(`PRAGMA journal_mode = WAL;`);
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        project TEXT,
        started_at INTEGER,
        ended_at INTEGER,
        message_count INTEGER NOT NULL DEFAULT 0,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd_cents INTEGER NOT NULL DEFAULT 0,
        source_path TEXT NOT NULL,
        source_mtime INTEGER NOT NULL,
        source_size INTEGER NOT NULL,
        parent_session_id TEXT,
        pinned INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE voice_calls (
        sid TEXT PRIMARY KEY,
        account_sid TEXT,
        direction TEXT,
        from_number TEXT,
        to_number TEXT,
        status TEXT,
        started_at INTEGER,
        ended_at INTEGER,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        price_cents INTEGER NOT NULL DEFAULT 0,
        price_unit TEXT,
        recording_count INTEGER NOT NULL DEFAULT 0,
        transcript_text TEXT,
        transcript_language TEXT,
        transcript_confidence REAL,
        campaign TEXT,
        outcome TEXT,
        fetched_at INTEGER NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta(key, value) VALUES ('schema_version', '4');

      INSERT INTO sessions (id, source, project, started_at, ended_at, message_count,
                            prompt_tokens, output_tokens, cost_usd_cents,
                            source_path, source_mtime, source_size)
      VALUES ('preexisting-sess', 'claude-code', 'proj', 1, 2, 5, 10, 20, 30, '/tmp/x', 1, 1);

      INSERT INTO voice_calls (sid, direction, started_at, ended_at, duration_seconds,
                               price_cents, recording_count, fetched_at)
      VALUES ('CAxxx', 'outbound-api', 100, 200, 60, 25, 1, 200);
    `);
    db.close();
  });
  after(() => rmSync(TMP_HOME, { recursive: true, force: true }));

  it("opens cleanly and bumps schema_version to 5", async () => {
    const { getDb, closeDb } = await import("../../src/db/init.ts");
    const db = getDb();
    const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string };
    assert.equal(row.value, "5");

    // Pre-existing rows survive the upgrade.
    const s = db.prepare(`SELECT id FROM sessions WHERE id = 'preexisting-sess'`).get();
    assert.ok(s, "pre-existing session row was wiped during migration");
    const v = db.prepare(`SELECT sid FROM voice_calls WHERE sid = 'CAxxx'`).get();
    assert.ok(v, "pre-existing voice_calls row was wiped during migration");

    // New tables exist and are empty.
    const dev = db.prepare(`SELECT COUNT(*) AS n FROM sync_devices`).get() as { n: number };
    const out = db.prepare(`SELECT COUNT(*) AS n FROM sync_outbox`).get() as { n: number };
    const inn = db.prepare(`SELECT COUNT(*) AS n FROM sync_inbox`).get() as { n: number };
    assert.equal(dev.n, 0);
    assert.equal(out.n, 0);
    assert.equal(inn.n, 0);

    closeDb();
  });
});
