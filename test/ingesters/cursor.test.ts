import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

/**
 * Cursor's app-data layout is the only thing that's stable across versions:
 *   <CursorAppData>/User/globalStorage/state.vscdb
 *   <CursorAppData>/User/workspaceStorage/<id>/state.vscdb
 * Each state.vscdb has a `cursorDiskKV(key TEXT, value BLOB)` table where
 * Cursor stores composer chats under `composerData:<uuid>` keys.
 *
 * We synthesize a minimal-but-realistic fixture that exercises all three of
 * the message shapes our ingester knows how to parse:
 *   1. `conversation` — older Cursor: array of {role, message:{content}, timestamp}
 *   2. `conversationMap` — newer Cursor: object keyed by bubbleId
 *   3. `fullConversationHeadersOnly` — header-only (no body) fallback
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
void __dirname;

// Build a temporary Cursor app-data directory before the ingester loads.
const TMP_HOME = mkdtempSync(join(tmpdir(), "crixin-cursor-test-"));
const TMP_CURSOR = mkdtempSync(join(tmpdir(), "crixin-cursor-app-"));
process.env["CRIXIN_HOME"] = TMP_HOME;
process.env["CRIXIN_CURSOR_APPDATA"] = TMP_CURSOR;
// Block the other ingesters from reading real user data during this test.
process.env["CRIXIN_CLAUDE_PROJECTS"] = mkdtempSync(join(tmpdir(), "empty-claude-"));
process.env["CRIXIN_CODEX_HOME"] = mkdtempSync(join(tmpdir(), "empty-codex-"));

// Seed the synthetic globalStorage/state.vscdb with three composer rows.
const globalStorageDir = join(TMP_CURSOR, "User", "globalStorage");
mkdirSync(globalStorageDir, { recursive: true });
const dbPath = join(globalStorageDir, "state.vscdb");
seedCursorDb(dbPath);

const { ingestCursor } = await import("../../src/ingesters/cursor.ts");
const { getDb, closeDb } = await import("../../src/db/init.ts");
const { queries } = await import("../../src/db/queries.ts");

describe("cursor ingester", () => {
  before(() => {
    getDb();
  });
  after(() => {
    closeDb();
    rmSync(TMP_HOME, { recursive: true, force: true });
    rmSync(TMP_CURSOR, { recursive: true, force: true });
  });

  it("ingests three composer rows (one per shape)", () => {
    const summary = ingestCursor();
    assert.equal(summary.scanned, 3);
    assert.equal(summary.inserted, 3);
    assert.equal(summary.failed, 0);
  });

  it("re-ingest is idempotent — fingerprint matches", () => {
    const summary = ingestCursor();
    assert.equal(summary.skippedUnchanged, 3);
    assert.equal(summary.inserted, 0);
  });

  it("session ids are namespaced under cursor/", () => {
    const db = getDb();
    const sessions = queries.listRecentSessions(db, 50);
    const cursorSessions = sessions.filter((s) => s.source === "cursor");
    assert.equal(cursorSessions.length, 3);
    for (const s of cursorSessions) {
      assert.match(s.id, /^cursor\//);
    }
  });

  it("extracts messages from `conversation` array shape", () => {
    const db = getDb();
    const messages = queries.getMessages(
      db,
      "cursor/00000001-0000-0000-0000-000000000001",
    );
    assert.equal(messages.length, 4);
    assert.equal(messages[0]!.role, "user");
    assert.match(messages[0]!.content!, /add a route handler/);
    assert.equal(messages[1]!.role, "assistant");
  });

  it("extracts messages from `conversationMap` object shape", () => {
    const db = getDb();
    const messages = queries.getMessages(
      db,
      "cursor/00000002-0000-0000-0000-000000000002",
    );
    assert.equal(messages.length, 2);
    const roles = messages.map((m) => m.role).sort();
    assert.deepEqual(roles, ["assistant", "user"]);
  });

  it("falls back to header-only labels when bodies are missing", () => {
    const db = getDb();
    const messages = queries.getMessages(
      db,
      "cursor/00000003-0000-0000-0000-000000000003",
    );
    assert.equal(messages.length, 2);
    // Headers had no `text` so the ingester emits a [no content captured…] label.
    assert.match(messages[0]!.content!, /\[no content captured/);
  });

  it("captures the model from modelConfig.modelName", () => {
    const db = getDb();
    const messages = queries.getMessages(
      db,
      "cursor/00000001-0000-0000-0000-000000000001",
    );
    // First message inherits the session model (no per-message model in our fixture).
    assert.equal(messages[0]!.model, "claude-opus-4-7");
  });
});

/**
 * Build the SQLite fixture from scratch. Schema mirrors what Cursor writes,
 * including the BLOB column type for `value`.
 */
function seedCursorDb(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE cursorDiskKV (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);`);
  db.exec(`CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB);`);

  const insert = db.prepare(`INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)`);

  // Shape 1: conversation array
  insert.run(
    "composerData:00000001-0000-0000-0000-000000000001",
    JSON.stringify({
      composerId: "00000001-0000-0000-0000-000000000001",
      createdAt: 1735776000000,
      modelConfig: { modelName: "claude-opus-4-7" },
      conversation: [
        { role: "user", message: { content: "Can you add a route handler for /api/health?" }, timestamp: 1735776001000 },
        { role: "assistant", message: { content: "Done — the new handler returns {\"ok\":true}." }, timestamp: 1735776002000 },
        { role: "user", message: { content: "Make it include the version too." }, timestamp: 1735776003000 },
        { role: "assistant", message: { content: "Updated — pulls from package.json at boot." }, timestamp: 1735776004000 },
      ],
    }),
  );

  // Shape 2: conversationMap object
  insert.run(
    "composerData:00000002-0000-0000-0000-000000000002",
    JSON.stringify({
      composerId: "00000002-0000-0000-0000-000000000002",
      createdAt: 1735862400000,
      modelConfig: { modelName: "gpt-5" },
      conversationMap: {
        "bub-001": { type: "user", text: "rename selectedTab to activeTab everywhere", timestamp: 1735862401000 },
        "bub-002": { type: "assistant", text: "Renamed across 11 files; tests still green.", timestamp: 1735862403000 },
      },
    }),
  );

  // Shape 3: headers only (no message bodies)
  insert.run(
    "composerData:00000003-0000-0000-0000-000000000003",
    JSON.stringify({
      composerId: "00000003-0000-0000-0000-000000000003",
      createdAt: 1735948800000,
      modelConfig: { modelName: "claude-sonnet-4-6" },
      fullConversationHeadersOnly: [
        { type: "user", bubbleId: "bub-h1", timestamp: 1735948801000 },
        { type: "assistant", bubbleId: "bub-h2", timestamp: 1735948803000 },
      ],
    }),
  );

  db.close();
}
