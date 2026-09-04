import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getHostTargets, checkEntryPresent, computeHostTargets } from "../../src/lib/install-targets.ts";

let originalHome: string | undefined;
let tmpHome: string;

before(() => { originalHome = process.env["HOME"]; });
after(() => { if (originalHome !== undefined) process.env["HOME"] = originalHome; });
beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "install-targets-test-"));
  process.env["HOME"] = tmpHome;
});
function cleanup() { rmSync(tmpHome, { recursive: true, force: true }); }

describe("getHostTargets", () => {
  it("returns all four supported hosts", () => {
    const t = getHostTargets();
    const ids = t.map((h) => h.id);
    assert.deepEqual(ids.sort(), ["claude-code", "codex", "cursor", "desktop"]);
    cleanup();
  });

  it("Codex CLI uses TOML; everything else is JSON", () => {
    const t = getHostTargets();
    const codex = t.find((h) => h.id === "codex");
    const cursor = t.find((h) => h.id === "cursor");
    assert.equal(codex?.format, "toml");
    assert.equal(cursor?.format, "json");
    cleanup();
  });

  it("paths land under HOME", () => {
    const t = getHostTargets();
    for (const h of t) {
      assert.ok(h.path.startsWith(tmpHome), `${h.id} path under HOME`);
    }
    cleanup();
  });
});

describe("computeHostTargets · cross-platform paths", () => {
  it("macOS: Claude Desktop lives under Library/Application Support", () => {
    const t = computeHostTargets({ home: "/Users/jane", platform: "darwin" });
    const desktop = t.find((h) => h.id === "desktop")!;
    assert.equal(desktop.path, "/Users/jane/Library/Application Support/Claude/claude_desktop_config.json");
  });

  it("Windows: Claude Desktop uses %APPDATA% when set", () => {
    const t = computeHostTargets({
      home: "C:\\Users\\jane",
      platform: "win32",
      appdata: "C:\\Users\\jane\\AppData\\Roaming",
    });
    const desktop = t.find((h) => h.id === "desktop")!;
    // path.join uses platform separator; on macOS test runners this is /, but the
    // string still includes the AppData/Roaming prefix from the input.
    assert.ok(desktop.path.includes("AppData"));
    assert.ok(desktop.path.includes("Roaming"));
    assert.ok(desktop.path.includes("Claude"));
    assert.ok(desktop.path.includes("claude_desktop_config.json"));
  });

  it("Windows: falls back to home/AppData/Roaming when APPDATA absent", () => {
    const t = computeHostTargets({
      home: "C:\\Users\\jane",
      platform: "win32",
    });
    const desktop = t.find((h) => h.id === "desktop")!;
    assert.ok(desktop.path.includes("AppData"));
    assert.ok(desktop.path.includes("Roaming"));
  });

  it("Linux: Claude Desktop uses ~/.config/Claude (community convention)", () => {
    const t = computeHostTargets({ home: "/home/jane", platform: "linux" });
    const desktop = t.find((h) => h.id === "desktop")!;
    assert.equal(desktop.path, "/home/jane/.config/Claude/claude_desktop_config.json");
  });

  it("Unknown platforms fall back to Linux convention", () => {
    const t = computeHostTargets({ home: "/home/jane", platform: "freebsd" as NodeJS.Platform });
    const desktop = t.find((h) => h.id === "desktop")!;
    assert.equal(desktop.path, "/home/jane/.config/Claude/claude_desktop_config.json");
  });

  it("Claude Code / Cursor / Codex paths are identical across all platforms", () => {
    const platforms: NodeJS.Platform[] = ["darwin", "win32", "linux"];
    for (const platform of platforms) {
      const t = computeHostTargets({ home: "/H", platform });
      const claudeCode = t.find((h) => h.id === "claude-code")!;
      const cursor     = t.find((h) => h.id === "cursor")!;
      const codex      = t.find((h) => h.id === "codex")!;
      assert.ok(claudeCode.path.endsWith(".claude.json"));
      assert.ok(cursor.path.endsWith(".cursor/mcp.json"));
      assert.ok(codex.path.endsWith(".codex/config.toml"));
    }
  });

  it("returns all four host IDs regardless of platform", () => {
    const platforms: NodeJS.Platform[] = ["darwin", "win32", "linux", "freebsd" as NodeJS.Platform];
    for (const platform of platforms) {
      const ids = computeHostTargets({ home: "/H", platform }).map((h) => h.id).sort();
      assert.deepEqual(ids, ["claude-code", "codex", "cursor", "desktop"]);
    }
  });

  it("Codex CLI is always format=toml; everything else is format=json", () => {
    const platforms: NodeJS.Platform[] = ["darwin", "win32", "linux"];
    for (const platform of platforms) {
      const t = computeHostTargets({ home: "/H", platform });
      const codex = t.find((h) => h.id === "codex")!;
      assert.equal(codex.format, "toml");
      for (const other of t.filter((h) => h.id !== "codex")) {
        assert.equal(other.format, "json", `${other.id} should be json`);
      }
    }
  });
});

describe("checkEntryPresent · no-config", () => {
  it("returns no-config when file does not exist", () => {
    const t = getHostTargets().find((h) => h.id === "cursor")!;
    assert.equal(checkEntryPresent(t, "anything"), "no-config");
    cleanup();
  });
});

describe("checkEntryPresent · JSON path", () => {
  it("returns present when entry exists", () => {
    const t = getHostTargets().find((h) => h.id === "cursor")!;
    mkdirSync(join(tmpHome, ".cursor"), { recursive: true });
    writeFileSync(t.path, JSON.stringify({ mcpServers: { "crixin-voice": { command: "x" } } }));
    assert.equal(checkEntryPresent(t, "crixin-voice"), "present");
    assert.equal(checkEntryPresent(t, "crixin-coder"), "missing");
    cleanup();
  });

  it("returns missing when mcpServers is empty", () => {
    const t = getHostTargets().find((h) => h.id === "cursor")!;
    mkdirSync(join(tmpHome, ".cursor"), { recursive: true });
    writeFileSync(t.path, JSON.stringify({ mcpServers: {} }));
    assert.equal(checkEntryPresent(t, "crixin-voice"), "missing");
    cleanup();
  });

  it("returns missing when mcpServers key is absent", () => {
    const t = getHostTargets().find((h) => h.id === "cursor")!;
    mkdirSync(join(tmpHome, ".cursor"), { recursive: true });
    writeFileSync(t.path, JSON.stringify({ someOtherKey: 1 }));
    assert.equal(checkEntryPresent(t, "crixin-voice"), "missing");
    cleanup();
  });

  it("returns unreadable when JSON is malformed", () => {
    const t = getHostTargets().find((h) => h.id === "cursor")!;
    mkdirSync(join(tmpHome, ".cursor"), { recursive: true });
    writeFileSync(t.path, "{ not valid json");
    assert.equal(checkEntryPresent(t, "crixin-voice"), "unreadable");
    cleanup();
  });

  it("returns legacy-schema when mcpServers is an array", () => {
    const t = getHostTargets().find((h) => h.id === "claude-code")!;
    writeFileSync(t.path, JSON.stringify({ mcpServers: [{ name: "x" }] }));
    assert.equal(checkEntryPresent(t, "crixin-voice"), "legacy-schema");
    cleanup();
  });
});

describe("checkEntryPresent · TOML path (Codex)", () => {
  it("returns present when section header exists", () => {
    const t = getHostTargets().find((h) => h.id === "codex")!;
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(t.path, `[mcp_servers.crixin-voice]\ncommand = "npx"\nargs = ["x"]\n`);
    assert.equal(checkEntryPresent(t, "crixin-voice"), "present");
    assert.equal(checkEntryPresent(t, "crixin-coder"), "missing");
    cleanup();
  });

  it("returns missing when TOML has other sections but not ours", () => {
    const t = getHostTargets().find((h) => h.id === "codex")!;
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(t.path, `[mcp_servers.something-else]\ncommand = "x"\n`);
    assert.equal(checkEntryPresent(t, "crixin-voice"), "missing");
    cleanup();
  });
});
