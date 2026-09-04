import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX_ROOT = join(__dirname, "..", "fixtures", "projects");

const TMP_HOME = mkdtempSync(join(tmpdir(), "crixin-agg-test-"));
process.env["CRIXIN_HOME"] = TMP_HOME;
process.env["CRIXIN_CLAUDE_PROJECTS"] = FIX_ROOT;

const { ingestClaudeCode } = await import("../../src/ingesters/claude-code.ts");
const { getDb, closeDb } = await import("../../src/db/init.ts");
const { queries } = await import("../../src/db/queries.ts");

describe("aggregates", () => {
  before(() => {
    getDb();
    ingestClaudeCode();
  });
  after(() => {
    closeDb();
    rmSync(TMP_HOME, { recursive: true, force: true });
  });

  it("returns top projects, by-source breakdown, and a busiest hour", () => {
    const db = getDb();
    const agg = queries.aggregates(db);
    assert.equal(agg.topProjects.length, 1);
    assert.equal(agg.topProjects[0]!.project, "sample-project");
    assert.equal(agg.bySource.length, 1);
    assert.equal(agg.bySource[0]!.source, "claude-code");
    assert.notEqual(agg.busiestHour, null);
  });

  it("computes total duration as ended_at - started_at across sessions", () => {
    const db = getDb();
    const agg = queries.aggregates(db);
    assert.equal(agg.totalDurationMs, 32000);
  });
});
