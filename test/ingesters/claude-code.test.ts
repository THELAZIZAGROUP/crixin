import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Point CRIXIN_HOME and CRIXIN_CLAUDE_PROJECTS at temp dirs BEFORE importing the modules
// that read those paths, so we don't pollute the user's real ~/.claude or ~/.crixin.
const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX_ROOT = join(__dirname, "..", "fixtures", "projects");

const TMP_HOME = mkdtempSync(join(tmpdir(), "crixin-test-"));
process.env["CRIXIN_HOME"] = TMP_HOME;
process.env["CRIXIN_CLAUDE_PROJECTS"] = FIX_ROOT;

const { ingestClaudeCode } = await import("../../src/ingesters/claude-code.ts");
const { getDb, closeDb } = await import("../../src/db/init.ts");
const { queries } = await import("../../src/db/queries.ts");

describe("claude-code ingester", () => {
  before(() => {
    getDb();
  });

  after(() => {
    closeDb();
    rmSync(TMP_HOME, { recursive: true, force: true });
  });

  it("ingests a sample session and returns expected counts", () => {
    const summary = ingestClaudeCode();
    assert.equal(summary.scanned, 1);
    assert.equal(summary.inserted, 1);
    assert.equal(summary.skippedUnchanged, 0);
    assert.equal(summary.failed, 0);
  });

  it("re-ingest is idempotent (no double-insert)", () => {
    const summary = ingestClaudeCode();
    assert.equal(summary.scanned, 1);
    assert.equal(summary.inserted, 0);
    assert.equal(summary.skippedUnchanged, 1);
  });

  it("session row has the right shape", () => {
    const db = getDb();
    const sessions = queries.listRecentSessions(db, 10);
    assert.equal(sessions.length, 1);
    const s = sessions[0]!;
    assert.equal(s.id, "01934567-89ab-cdef-0123-456789abcdef");
    assert.equal(s.source, "claude-code");
    assert.equal(s.project, "sample-project");
    assert.equal(s.message_count, 4);
  });

  it("messages preserve role and content", () => {
    const db = getDb();
    const messages = queries.getMessages(db, "01934567-89ab-cdef-0123-456789abcdef");
    assert.equal(messages.length, 4);
    assert.equal(messages[0]!.role, "user");
    assert.match(messages[0]!.content!, /vitest/i);
    assert.equal(messages[1]!.role, "assistant");
    assert.match(messages[1]!.content!, /devDependency/i);
  });

  it("search finds messages by substring", () => {
    const db = getDb();
    const hits = queries.searchMessages(db, "tsconfig");
    assert.ok(hits.length >= 1);
    assert.match(hits[0]!.snippet, /tsconfig/i);
  });

  it("stats reflect the loaded data", () => {
    const db = getDb();
    const stats = queries.stats(db);
    assert.equal(stats.sessions, 1);
    assert.equal(stats.messages, 4);
    assert.equal(stats.sources, 1);
  });
});
