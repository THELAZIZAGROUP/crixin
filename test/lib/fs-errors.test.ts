import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { friendlyFsError } from "../../src/lib/fs-errors.ts";

function errno(code: string, message: string): Error & { code: string } {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  return e;
}

describe("friendlyFsError · permission denied", () => {
  it("EACCES produces actionable message with chown hint", () => {
    const msg = friendlyFsError(
      errno("EACCES", "EACCES: permission denied, open '/x'"),
      "/x",
      "Claude Code",
    );
    assert.ok(msg.includes("permission denied"));
    assert.ok(msg.includes("Claude Code"));
    assert.ok(msg.includes("sudo chown"));
    assert.ok(msg.includes("Raw error:"));
  });

  it("EPERM behaves the same as EACCES", () => {
    const msg = friendlyFsError(errno("EPERM", "EPERM: operation not permitted"), "/x", "Cursor");
    assert.ok(msg.includes("permission denied"));
    assert.ok(msg.includes("chown"));
  });
});

describe("friendlyFsError · structural errors", () => {
  it("EISDIR explains the path is a directory", () => {
    const msg = friendlyFsError(errno("EISDIR", "EISDIR: illegal op"), "/x", "Cursor");
    assert.ok(msg.includes("found a directory"));
    assert.ok(msg.includes('ls -la "/x"'));
  });

  it("ENOTDIR explains parent-is-a-file case", () => {
    const msg = friendlyFsError(errno("ENOTDIR", "ENOTDIR: not a directory"), "/x", "Codex CLI");
    assert.ok(msg.includes("parent path"));
  });

  it("EROFS explains read-only filesystem", () => {
    const msg = friendlyFsError(errno("EROFS", "EROFS: read-only file system"), "/x", "Claude Desktop");
    assert.ok(msg.includes("read-only"));
  });
});

describe("friendlyFsError · resource errors", () => {
  it("ENOSPC explains disk-full case", () => {
    const msg = friendlyFsError(errno("ENOSPC", "ENOSPC: no space left"), "/x", "Cursor");
    assert.ok(msg.includes("no space left"));
  });

  it("EMFILE / ENFILE explain open-file-limit case", () => {
    const m1 = friendlyFsError(errno("EMFILE", "EMFILE: too many open files"), "/x", "X");
    const m2 = friendlyFsError(errno("ENFILE", "ENFILE: file table overflow"), "/x", "Y");
    assert.ok(m1.includes("too many open files"));
    assert.ok(m2.includes("too many open files"));
  });

  it("ENOENT explains missing-path case", () => {
    const msg = friendlyFsError(errno("ENOENT", "ENOENT: no such file"), "/x", "Cursor");
    assert.ok(msg.includes("doesn't exist"));
  });
});

describe("friendlyFsError · unknown errors", () => {
  it("falls back to structured form with raw message", () => {
    const msg = friendlyFsError(errno("EWEIRD", "EWEIRD: something exotic"), "/x", "Cursor");
    assert.ok(msg.includes("Cursor"));
    assert.ok(msg.includes("Raw error:"));
    assert.ok(msg.includes("EWEIRD"));
  });

  it("handles non-Error throwables gracefully", () => {
    const msg = friendlyFsError("just a string", "/x", "Y");
    assert.ok(msg.includes("just a string"));
  });

  it("handles undefined error code", () => {
    const msg = friendlyFsError(new Error("plain error"), "/x", "Y");
    assert.ok(msg.includes("plain error"));
  });
});

describe("friendlyFsError · output shape", () => {
  it("always includes the label, the path, and Raw error: line", () => {
    const msg = friendlyFsError(errno("EACCES", "x"), "/foo/bar", "MyLabel");
    assert.ok(msg.includes("MyLabel"));
    assert.ok(msg.includes("/foo/bar"));
    assert.ok(msg.includes("Raw error:"));
  });
});
