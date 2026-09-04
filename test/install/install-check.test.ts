/**
 * Tests for `crixin install --check` — the non-mutating audit command.
 * Verifies exit codes, output shape, and edge cases (legacy schema,
 * no-config, partial install, malformed config).
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runVoiceInstall } from "../../src/voice/install.ts";
import { runCoderInstall } from "../../src/coder/install.ts";
import { runInstallCheck } from "../../src/cli/index.ts";

let originalHome: string | undefined;
let tmpHome: string;
let capturedStdout: string[];
let originalStdoutWrite: typeof process.stdout.write;

before(() => { originalHome = process.env["HOME"]; });
after(() => { if (originalHome !== undefined) process.env["HOME"] = originalHome; });

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "install-check-test-"));
  process.env["HOME"] = tmpHome;
  capturedStdout = [];
  originalStdoutWrite = process.stdout.write.bind(process.stdout);
  (process.stdout.write as unknown as (msg: string) => boolean) = (msg: string) => {
    capturedStdout.push(typeof msg === "string" ? msg : msg.toString());
    return true;
  };
});

function endCapture() {
  (process.stdout.write as unknown as typeof originalStdoutWrite) = originalStdoutWrite;
}
function cleanup() {
  endCapture();
  rmSync(tmpHome, { recursive: true, force: true });
}
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
function output(): string {
  return stripAnsi(capturedStdout.join(""));
}

describe("install --check · no install yet", () => {
  it("returns 1 and reports 'no host config' for every host", () => {
    const code = runInstallCheck();
    assert.equal(code, 1);
    const out = output();
    assert.ok(out.includes("Overall: FAILED"));
    assert.ok(out.includes("no host config"));
    // Every host appears
    for (const label of ["Claude Desktop", "Claude Code", "Cursor", "Codex CLI"]) {
      assert.ok(out.includes(label), `${label} in output`);
    }
    cleanup();
  });
});

describe("install --check · fully installed", () => {
  it("returns 0 and reports OK after install of both MCPs", () => {
    runVoiceInstall({});
    runCoderInstall({});
    const code = runInstallCheck();
    assert.equal(code, 0);
    const out = output();
    assert.ok(out.includes("Overall: OK"));
    // Every host shows the green ✓
    assert.ok(out.includes("Claude Desktop"));
    assert.ok(out.includes("Codex CLI"));
    assert.ok(!out.includes("Overall: FAILED"));
    cleanup();
  });
});

describe("install --check · partial install (voice only)", () => {
  it("returns 1 and reports missing coder per host", () => {
    runVoiceInstall({});
    const code = runInstallCheck();
    assert.equal(code, 1);
    const out = output();
    assert.ok(out.includes("Overall: FAILED"));
    assert.ok(out.includes("missing crixin-coder"));
    assert.ok(!out.includes("missing crixin-voice"));
    cleanup();
  });
});

describe("install --check · partial install (coder only)", () => {
  it("returns 1 and reports missing voice per host", () => {
    runCoderInstall({});
    const code = runInstallCheck();
    assert.equal(code, 1);
    const out = output();
    assert.ok(out.includes("missing crixin-voice"));
    cleanup();
  });
});

describe("install --check · legacy schema detected", () => {
  it("flags legacy mcpServers array and recommends --migrate-legacy", () => {
    // Set up a legacy ~/.claude.json
    writeFileSync(join(tmpHome, ".claude.json"), JSON.stringify({
      mcpServers: [{ name: "x", command: "y" }],
    }));
    const code = runInstallCheck();
    assert.equal(code, 1);
    const out = output();
    assert.ok(out.includes("legacy mcpServers"));
    assert.ok(out.includes("--migrate-legacy"));
    cleanup();
  });
});

describe("install --check · malformed config", () => {
  it("flags unreadable config without crashing", () => {
    mkdirSync(join(tmpHome, ".cursor"), { recursive: true });
    writeFileSync(join(tmpHome, ".cursor/mcp.json"), "{ this is not valid");
    const code = runInstallCheck();
    assert.equal(code, 1);
    const out = output();
    assert.ok(out.includes("config unreadable") || out.includes("unreadable"));
    cleanup();
  });
});

describe("install --check · mixed host states", () => {
  it("shows ✓ for ready hosts and ✗ for partial ones in the same run", () => {
    // Voice installs both MCPs in Cursor only
    runVoiceInstall({ only: "cursor" });
    runCoderInstall({ only: "cursor" });
    // Voice installs only itself in Codex (no coder)
    runVoiceInstall({ only: "codex" });

    const code = runInstallCheck();
    assert.equal(code, 1);
    const out = output();
    // Cursor should be ✓
    assert.ok(/✓\s+Cursor/.test(out), `Cursor green — got:\n${out}`);
    // Codex should be ✗ with "missing crixin-coder"
    assert.ok(/✗\s+Codex CLI/.test(out), `Codex red — got:\n${out}`);
    assert.ok(out.includes("missing crixin-coder"));
    // Claude Code + Desktop have no config at all
    assert.ok(/✗\s+Claude Code/.test(out));
    assert.ok(/✗\s+Claude Desktop/.test(out));
    cleanup();
  });
});

describe("install --check · output format", () => {
  it("includes the 'crixin install --check' header", () => {
    runInstallCheck();
    assert.ok(output().includes("crixin install --check"));
    cleanup();
  });

  it("ends with a single 'Overall:' line", () => {
    runInstallCheck();
    const matches = output().match(/Overall:/g) || [];
    assert.equal(matches.length, 1);
    cleanup();
  });
});
