import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP_HOME = mkdtempSync(join(tmpdir(), "crixin-sync-meta-"));
process.env["CRIXIN_HOME"] = TMP_HOME;

const { getDb, closeDb } = await import("../../src/db/init.ts");
const {
  extractSyncRecords,
  deriveRecordId,
  isValidSyncRecord,
  SYNC_RECORD_KEYS,
} = await import("../../src/sync/metadata.ts");

const UID = "uid-test-12345678";
const DEVICE = "dev-1234567890abcdef";

describe("sync metadata extractor", () => {
  before(() => {
    const db = getDb();
    // Seed a coder session with everything populated, plus a `messages` row
    // whose body MUST NEVER appear in extractor output.
    db.exec(`
      INSERT INTO sessions (id, source, project, started_at, ended_at, message_count,
                            prompt_tokens, output_tokens, cost_usd_cents,
                            source_path, source_mtime, source_size)
      VALUES ('sess-aaa', 'claude-code', 'my-project', 1700000000000, 1700000600000,
              42, 1234, 5678, 1500,
              '/tmp/sess-aaa.jsonl', 1700000600000, 4096);
    `);
    db.exec(`
      INSERT INTO messages (session_id, idx, role, content, ts, model, tokens)
      VALUES ('sess-aaa', 0, 'user', 'SECRET-MESSAGE-BODY-DO-NOT-LEAK', 1700000000000, 'claude-sonnet', 100);
    `);

    // Seed a voice_calls row with a transcript that MUST NEVER appear in extractor output.
    db.exec(`
      INSERT INTO voice_calls (sid, direction, from_number, to_number, status,
                               started_at, ended_at, duration_seconds, price_cents,
                               recording_count, transcript_text, transcript_language,
                               campaign, outcome, fetched_at)
      VALUES ('CAxxx', 'outbound-api', '+15551234567', '+15557654321', 'completed',
              1700100000000, 1700100120000, 120, 250,
              1, 'SECRET-TRANSCRIPT-DO-NOT-LEAK', 'en',
              'private-campaign-name', 'private-outcome', 1700100120000);
    `);
  });
  after(() => {
    closeDb();
    rmSync(TMP_HOME, { recursive: true, force: true });
  });

  it("extracts both sessions and voice_calls", () => {
    const records = extractSyncRecords({ uid: UID, device_id: DEVICE });
    const sources = new Set(records.map((r) => r.source));
    assert.ok(sources.has("claude-code"), "should include claude-code session");
    assert.ok(sources.has("voice"), "should include voice call");
  });

  it("NEVER includes raw message bodies or transcripts", () => {
    const records = extractSyncRecords({ uid: UID, device_id: DEVICE });
    const blob = JSON.stringify(records);
    assert.ok(!blob.includes("SECRET-MESSAGE-BODY"), "message content leaked");
    assert.ok(!blob.includes("SECRET-TRANSCRIPT"), "transcript leaked");
    assert.ok(!blob.includes("+15551234567"), "from_number leaked");
    assert.ok(!blob.includes("+15557654321"), "to_number leaked");
    assert.ok(!blob.includes("private-campaign-name"), "campaign tag leaked");
    assert.ok(!blob.includes("private-outcome"), "outcome tag leaked");
  });

  it("output records contain ONLY allowlisted keys", () => {
    const records = extractSyncRecords({ uid: UID, device_id: DEVICE });
    for (const r of records) {
      for (const k of Object.keys(r)) {
        assert.ok(
          SYNC_RECORD_KEYS.includes(k as (typeof SYNC_RECORD_KEYS)[number]),
          `unexpected key in output: ${k}`,
        );
      }
    }
  });

  it("record_id is deterministic for same uid + source + local_id", () => {
    const a = deriveRecordId(UID, "claude-code", "sess-aaa");
    const b = deriveRecordId(UID, "claude-code", "sess-aaa");
    assert.equal(a, b);
    const c = deriveRecordId(UID, "claude-code", "sess-bbb");
    assert.notEqual(a, c, "different local_id must produce a different record_id");
    const d = deriveRecordId("other-uid", "claude-code", "sess-aaa");
    assert.notEqual(a, d, "different uid must produce a different record_id");
  });

  it("content_hash changes when ended_at or counts change", () => {
    const db = getDb();
    const records1 = extractSyncRecords({ uid: UID, device_id: DEVICE });
    const sess1 = records1.find((r) => r.local_id === "sess-aaa")!;
    assert.ok(sess1);

    db.exec(`UPDATE sessions SET message_count = 99 WHERE id = 'sess-aaa'`);
    const records2 = extractSyncRecords({ uid: UID, device_id: DEVICE });
    const sess2 = records2.find((r) => r.local_id === "sess-aaa")!;
    assert.notEqual(sess1.content_hash, sess2.content_hash, "content_hash should follow message_count");

    // Restore for downstream tests
    db.exec(`UPDATE sessions SET message_count = 42 WHERE id = 'sess-aaa'`);
  });

  it("isValidSyncRecord rejects records with extra keys", () => {
    const records = extractSyncRecords({ uid: UID, device_id: DEVICE });
    assert.ok(isValidSyncRecord(records[0]));
    const tampered = { ...records[0], rogue_key: "uh-oh" };
    assert.equal(isValidSyncRecord(tampered), false);
  });

  it("since filter excludes older rows", () => {
    const recordsAll = extractSyncRecords({ uid: UID, device_id: DEVICE });
    const sinceFuture = extractSyncRecords({ uid: UID, device_id: DEVICE, since: 9_999_999_999_999 });
    assert.ok(recordsAll.length > 0);
    assert.equal(sinceFuture.length, 0);
  });
});
