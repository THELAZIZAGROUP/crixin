import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";

const TMP_HOME = mkdtempSync(join(tmpdir(), "crixin-sync-state-"));
process.env["CRIXIN_HOME"] = TMP_HOME;
delete process.env["CRIXIN_SYNC_BASE"];

const { readSyncState, writeSyncState, patchSyncState, redactedState } = await import(
  "../../src/sync/state.ts"
);
const { paths } = await import("../../src/lib/paths.ts");

describe("sync state", () => {
  beforeEach(() => {
    try { rmSync(join(paths.crixinHome, "sync.json")); } catch {}
    delete process.env["CRIXIN_SYNC_BASE"];
  });
  after(() => rmSync(TMP_HOME, { recursive: true, force: true }));

  it("returns defaults when no state file exists", () => {
    const s = readSyncState();
    assert.equal(s.device_id, null);
    assert.equal(s.enabled, false);
    assert.equal(s.server, "https://crixin.com");
  });

  it("persists and reloads state", () => {
    writeSyncState({
      device_id: "abc123",
      device_token: "tok.xyz.sig",
      device_name: "test-host",
      account_email: "you@example.com",
      account_uid: "user-uid-123",
      server: "https://crixin.com",
      enabled: true,
      last_pushed_at: 123,
      last_pulled_at: 456,
      last_pull_cursor: 789,
    });
    const s = readSyncState();
    assert.equal(s.device_id, "abc123");
    assert.equal(s.account_email, "you@example.com");
    assert.equal(s.enabled, true);
    assert.equal(s.last_pull_cursor, 789);
  });

  it("CRIXIN_SYNC_BASE overrides server", () => {
    process.env["CRIXIN_SYNC_BASE"] = "http://localhost:3000";
    writeSyncState({
      device_id: null, device_token: null, device_name: null,
      account_email: null, account_uid: null,
      server: "https://crixin.com",
      enabled: false, last_pushed_at: null, last_pulled_at: null, last_pull_cursor: null,
    });
    const s = readSyncState();
    assert.equal(s.server, "http://localhost:3000");
  });

  it("patchSyncState merges over existing", () => {
    writeSyncState({
      device_id: "d1", device_token: null, device_name: null,
      account_email: null, account_uid: null,
      server: "https://crixin.com",
      enabled: false, last_pushed_at: null, last_pulled_at: null, last_pull_cursor: null,
    });
    const next = patchSyncState({ enabled: true, last_pushed_at: 999 });
    assert.equal(next.device_id, "d1");
    assert.equal(next.enabled, true);
    assert.equal(next.last_pushed_at, 999);
  });

  it("file is written 0600 on POSIX", () => {
    writeSyncState({
      device_id: "abc", device_token: "tok.x.y", device_name: null,
      account_email: null, account_uid: null,
      server: "https://crixin.com",
      enabled: false, last_pushed_at: null, last_pulled_at: null, last_pull_cursor: null,
    });
    if (platform() === "win32") return;
    const mode = statSync(join(paths.crixinHome, "sync.json")).mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it("redactedState hides the token but reports presence", () => {
    const s = redactedState({
      device_id: "abc", device_token: "secret-token-value-12345",
      device_name: null, account_email: null, account_uid: null,
      server: "https://crixin.com",
      enabled: false, last_pushed_at: null, last_pulled_at: null, last_pull_cursor: null,
    });
    assert.equal(s.device_token_present, true);
    assert.ok(!s.device_token?.includes("secret-token-value-12345"));
    assert.ok(s.device_token?.endsWith("…"));
  });

  it("survives a malformed sync.json file", () => {
    writeFileSync(join(paths.crixinHome, "sync.json"), "not-json", "utf8");
    const s = readSyncState();
    assert.equal(s.device_id, null);
    assert.equal(s.enabled, false);
  });

  it("existsSync confirms the sync.json file is created", () => {
    writeSyncState({
      device_id: "x", device_token: null, device_name: null,
      account_email: null, account_uid: null,
      server: "https://crixin.com",
      enabled: false, last_pushed_at: null, last_pulled_at: null, last_pull_cursor: null,
    });
    assert.ok(existsSync(join(paths.crixinHome, "sync.json")));
  });
});
