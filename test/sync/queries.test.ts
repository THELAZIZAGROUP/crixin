import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP_HOME = mkdtempSync(join(tmpdir(), "crixin-sync-q-"));
process.env["CRIXIN_HOME"] = TMP_HOME;

const { getDb, closeDb } = await import("../../src/db/init.ts");
const { outboxStats, inboxStats, listInbox } = await import("../../src/sync/queries.ts");

describe("sync queries", () => {
  before(() => {
    const db = getDb();
    // Outbox: 3 pending, 2 pushed, 1 errored.
    db.exec(`
      INSERT INTO sync_outbox (record_id, source, local_id, content_hash, payload_json, queued_at, pushed_at, push_error) VALUES
        ('rec-a', 'claude-code', 'sess-a', 'hash-a', '{}', 100, NULL, NULL),
        ('rec-b', 'claude-code', 'sess-b', 'hash-b', '{}', 200, NULL, NULL),
        ('rec-c', 'voice',       'CAxxx',  'hash-c', '{}', 300, 400,  NULL),
        ('rec-d', 'codex',       'sess-d', 'hash-d', '{}', 500, 600,  NULL),
        ('rec-e', 'cursor',      'sess-e', 'hash-e', '{}', 700, NULL, 'rejected: invalid'),
        ('rec-f', 'claude-code', 'sess-f', 'hash-f', '{}', 800, NULL, NULL);
    `);

    // Inbox: 4 records from 2 distinct devices, two sources.
    db.exec(`
      INSERT INTO sync_inbox (record_id, source, source_device_id, payload_json, updated_at, pulled_at) VALUES
        ('peer-1', 'claude-code', 'dev-aaa',
          '{"project":"work-repo","started_at":1700000000000,"ended_at":1700000600000,"message_count":42,"cost_usd_cents":150}',
          1700100000000, 1700100100000),
        ('peer-2', 'voice', 'dev-aaa',
          '{"duration_seconds":120,"started_at":1700200000000,"ended_at":1700200120000,"cost_usd_cents":25}',
          1700200200000, 1700200300000),
        ('peer-3', 'codex', 'dev-bbb',
          '{"project":"side-project","started_at":1700300000000,"ended_at":1700300700000,"message_count":17,"cost_usd_cents":80}',
          1700300800000, 1700300900000),
        ('peer-4', 'claude-code', 'dev-bbb',
          '{"project":"work-repo","started_at":1700400000000,"ended_at":1700400900000,"message_count":58,"cost_usd_cents":210}',
          1700401000000, 1700401100000);
    `);
  });
  after(() => {
    closeDb();
    rmSync(TMP_HOME, { recursive: true, force: true });
  });

  it("outboxStats counts pending/pushed/errored correctly", () => {
    const s = outboxStats();
    assert.equal(s.total, 6);
    assert.equal(s.pending, 4);     // a, b, e, f
    assert.equal(s.pushed, 2);      // c, d
    assert.equal(s.errored, 1);     // e
    assert.equal(s.latest_queued_at, 800);
    assert.equal(s.latest_pushed_at, 600);
  });

  it("inboxStats counts records, distinct devices, and per-source", () => {
    const s = inboxStats();
    assert.equal(s.total, 4);
    assert.equal(s.distinct_devices, 2);
    assert.equal(s.latest_updated_at, 1700401000000);
    assert.deepEqual(s.sources, { "claude-code": 2, voice: 1, codex: 1 });
  });

  it("listInbox returns rows newest-first with parsed payload", () => {
    const rows = listInbox(10);
    assert.equal(rows.length, 4);
    // DESC by updated_at — first row is peer-4.
    assert.equal(rows[0]!.record_id, "peer-4");
    assert.equal(rows[0]!.source, "claude-code");
    assert.equal(rows[0]!.project, "work-repo");
    assert.equal(rows[0]!.message_count, 58);
    assert.equal(rows[0]!.cost_usd_cents, 210);
    assert.equal(rows[0]!.source_device_id, "dev-bbb");
  });

  it("listInbox honors limit", () => {
    const rows = listInbox(2);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.record_id, "peer-4");
    assert.equal(rows[1]!.record_id, "peer-3");
  });

  it("listInbox skips rows with malformed payload", () => {
    const db = getDb();
    db.exec(`
      INSERT INTO sync_inbox (record_id, source, source_device_id, payload_json, updated_at, pulled_at)
      VALUES ('peer-broken', 'codex', 'dev-bbb', '{not-valid-json', 1700500000000, 1700500100000);
    `);
    const rows = listInbox(20);
    // Broken row is silently skipped — never surfaced as garbled.
    assert.ok(!rows.some((r) => r.record_id === "peer-broken"));
    // Cleanup so subsequent runs see a clean inbox count.
    db.exec(`DELETE FROM sync_inbox WHERE record_id = 'peer-broken'`);
  });

  it("voice records expose duration_seconds, not message_count", () => {
    const rows = listInbox(10);
    const voiceRow = rows.find((r) => r.record_id === "peer-2")!;
    assert.equal(voiceRow.duration_seconds, 120);
    assert.equal(voiceRow.message_count, null);
  });
});
