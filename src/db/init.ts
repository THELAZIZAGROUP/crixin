import { DatabaseSync } from "node:sqlite";
import { paths, ensureCrixinHome } from "../lib/paths.js";
import { SCHEMA, SCHEMA_VERSION } from "./schema.js";

let _db: DatabaseSync | undefined;

/**
 * Open (and lazily create) the local SQLite database. Idempotent.
 *
 * Migration policy:
 *   We have to ALTER existing tables BEFORE running the v3 SCHEMA string,
 *   because that string contains `CREATE INDEX … ON sessions(pinned)` which
 *   would fail on a v2 sessions table that doesn't have the column. The
 *   schema string itself is `CREATE TABLE IF NOT EXISTS …` so existing
 *   tables aren't recreated; only the new tables (tags, alerts, share_tokens)
 *   get created.
 */
export function getDb(): DatabaseSync {
  if (_db) return _db;
  ensureCrixinHome();
  const db = new DatabaseSync(paths.dbFile);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA synchronous = NORMAL;");

  // Pre-flight: read schema_version cheaply if the meta table exists.
  let stored: string | null = null;
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
    const row = db
      .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
      .get() as { value?: string } | undefined;
    stored = row?.value ?? null;
  } catch {
    stored = null;
  }

  // ALTER TABLE additions (idempotent — try/catch each in case it's already there).
  if (stored !== SCHEMA_VERSION) {
    // Only relevant when the sessions table already exists (i.e. upgrade path).
    try { db.exec(`ALTER TABLE sessions ADD COLUMN parent_session_id TEXT`); } catch {}
    try { db.exec(`ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`); } catch {}
  }

  // Now apply the schema (creates anything missing; harmless on existing).
  // v4 adds voice_calls + voice_recordings — these are CREATE TABLE IF NOT
  // EXISTS so no manual migration is needed for existing v3 DBs.
  db.exec(SCHEMA);

  if (stored !== SCHEMA_VERSION) {
    try {
      // v2 → v3 path: cost-model changed, sessions data was wiped. We don't
      // wipe again on v3 → v4 because nothing about the existing sessions
      // table semantically changed; v4 just adds new tables alongside it.
      if (stored === null || stored === "1" || stored === "2") {
        db.exec(`DELETE FROM sessions`);
      }
      db.exec(
        `INSERT INTO meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      );
    } catch {
      // Best-effort. If migration fails the user can blow away ~/.crixin/crixin.db manually.
    }
  }

  _db = db;
  return db;
}

/** Close the DB if it's been opened. Safe to call repeatedly. */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = undefined;
  }
}
