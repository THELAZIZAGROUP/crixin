import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX_CODEX_HOME = join(__dirname, "..", "fixtures", "codex");

const TMP_HOME = mkdtempSync(join(tmpdir(), "crixin-codex-test-"));
process.env["CRIXIN_HOME"] = TMP_HOME;
// Point the ingester at our codex fixture as if it were ~/.codex.
// The ingester reads from `<CRIXIN_CODEX_HOME>/sessions/...`, but our fixture
// puts files directly under fixtures/codex/2026/...; adjust by setting
// CRIXIN_CODEX_HOME to a parent and arranging the fixture as 'sessions/'.
const CODEX_HOME_FIX = mkdtempSync(join(tmpdir(), "crixin-codex-home-"));
mkdirSync(join(CODEX_HOME_FIX, "sessions"), { recursive: true });
// Symlink-or-copy: simplest is to copy into the right shape.
import { cpSync } from "node:fs";
cpSync(FIX_CODEX_HOME, join(CODEX_HOME_FIX, "sessions"), { recursive: true });
process.env["CRIXIN_CODEX_HOME"] = CODEX_HOME_FIX;
// Avoid dragging Claude Code's real ingester into the test.
process.env["CRIXIN_CLAUDE_PROJECTS"] = mkdtempSync(join(tmpdir(), "crixin-empty-claude-"));

const { ingestCodex } = await import("../../src/ingesters/codex.ts");
const { getDb, closeDb } = await import("../../src/db/init.ts");
const { queries } = await import("../../src/db/queries.ts");

describe("codex ingester", () => {
  before(() => {
    getDb();
  });
  after(() => {
    closeDb();
    rmSync(TMP_HOME, { recursive: true, force: true });
    rmSync(CODEX_HOME_FIX, { recursive: true, force: true });
  });

  it("ingests a Codex rollout session", () => {
    const summary = ingestCodex();
    assert.equal(summary.scanned, 1);
    assert.equal(summary.inserted, 1);
    assert.equal(summary.failed, 0);
  });

  it("re-ingest is idempotent", () => {
    const summary = ingestCodex();
    assert.equal(summary.skippedUnchanged, 1);
    assert.equal(summary.inserted, 0);
  });

  it("session id is namespaced under codex/ and project comes from cwd", () => {
    const db = getDb();
    const sessions = queries.listRecentSessions(db, 10);
    const codex = sessions.find((s) => s.source === "codex");
    assert.ok(codex, "expected one codex session");
    assert.equal(codex!.id, "codex/019dde00-aaaa-7bbb-cccc-dddd00000001");
    assert.equal(codex!.project, "/Users/test/myapp");
  });

  it("extracts only response_item messages and maps developer→system", () => {
    const db = getDb();
    const messages = queries.getMessages(
      db,
      "codex/019dde00-aaaa-7bbb-cccc-dddd00000001",
    );
    // Fixture: 1 developer + 2 user + 2 assistant = 5 message rows
    // (event_msg and turn_context are correctly skipped).
    assert.equal(messages.length, 5);
    assert.equal(messages[0]!.role, "system");
    assert.equal(messages[1]!.role, "user");
    assert.equal(messages[2]!.role, "assistant");
    assert.match(messages[2]!.content!, /serde_json/);
  });

  it("captures the model from turn_context", () => {
    const db = getDb();
    const messages = queries.getMessages(
      db,
      "codex/019dde00-aaaa-7bbb-cccc-dddd00000001",
    );
    assert.equal(messages[0]!.model, "gpt-5");
  });
});
