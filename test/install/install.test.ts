/**
 * Integration tests for `crixin voice install` and `crixin coder install`.
 * These tests sandbox HOME to a tmp directory and run the real install code
 * against the real file system. They lock in the behaviors that matter for
 * the production-readiness 3-minute test: idempotency, atomicity, refusal to
 * overwrite malformed configs, and (the critical v0.5.x bug fix) Codex CLI
 * TOML support across all four supported hosts.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runVoiceInstall } from "../../src/voice/install.ts";
import { runCoderInstall } from "../../src/coder/install.ts";

const VOICE_ENTRY = "crixin-voice";
const CODER_ENTRY = "crixin-coder";

let originalHome: string | undefined;
let tmpHome: string;

// Paths matching what `targets()` produces on macOS. The tests run on macOS
// (this repo's primary dev machine); platform-specific paths are smoke-tested
// at integration boundaries elsewhere.
function paths(home: string) {
  return {
    desktop: join(home, "Library/Application Support/Claude/claude_desktop_config.json"),
    claudeCode: join(home, ".claude.json"),
    cursor: join(home, ".cursor/mcp.json"),
    codex: join(home, ".codex/config.toml"),
  };
}

before(() => {
  originalHome = process.env["HOME"];
});

after(() => {
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
});

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "crixin-install-test-"));
  process.env["HOME"] = tmpHome;
});

function cleanup() {
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
}

describe("install · fresh machine (no existing configs)", () => {
  it("voice install writes all four host configs", () => {
    runVoiceInstall({});
    const p = paths(tmpHome);
    assert.ok(existsSync(p.desktop),    "Claude Desktop config created");
    assert.ok(existsSync(p.claudeCode), "Claude Code config created");
    assert.ok(existsSync(p.cursor),     "Cursor config created");
    assert.ok(existsSync(p.codex),      "Codex CLI config created");
    cleanup();
  });

  it("each JSON host has the crixin-voice entry with the right shape", () => {
    runVoiceInstall({});
    const p = paths(tmpHome);
    for (const path of [p.desktop, p.claudeCode, p.cursor]) {
      const cfg = JSON.parse(readFileSync(path, "utf8"));
      assert.ok(cfg.mcpServers?.[VOICE_ENTRY], `${path}: voice entry exists`);
      assert.equal(cfg.mcpServers[VOICE_ENTRY].command, "npx");
      assert.deepEqual(cfg.mcpServers[VOICE_ENTRY].args, ["-y", "crixin", "voice", "mcp"]);
    }
    cleanup();
  });

  it("Codex CLI TOML has [mcp_servers.crixin-voice] with the right shape", () => {
    runVoiceInstall({});
    const content = readFileSync(paths(tmpHome).codex, "utf8");
    assert.ok(content.includes("[mcp_servers.crixin-voice]"), "section header present");
    assert.ok(content.includes('command = "npx"'),            "command line present");
    assert.ok(content.includes('args = ["-y", "crixin", "voice", "mcp"]'), "args line present");
    cleanup();
  });

  it("coder install writes all four host configs including Codex CLI", () => {
    runCoderInstall({});
    const p = paths(tmpHome);
    assert.ok(existsSync(p.desktop),    "Claude Desktop config created");
    assert.ok(existsSync(p.claudeCode), "Claude Code config created");
    assert.ok(existsSync(p.cursor),     "Cursor config created");
    assert.ok(existsSync(p.codex),      "Codex CLI config created");
    // The crixin-coder entry must be present in each
    for (const path of [p.desktop, p.claudeCode, p.cursor]) {
      const cfg = JSON.parse(readFileSync(path, "utf8"));
      assert.ok(cfg.mcpServers?.[CODER_ENTRY], `${path}: coder entry exists`);
    }
    const codexContent = readFileSync(p.codex, "utf8");
    assert.ok(codexContent.includes("[mcp_servers.crixin-coder]"));
    cleanup();
  });

  it("running both voice + coder installs leaves both entries in every host", () => {
    runVoiceInstall({});
    runCoderInstall({});
    const p = paths(tmpHome);
    for (const path of [p.desktop, p.claudeCode, p.cursor]) {
      const cfg = JSON.parse(readFileSync(path, "utf8"));
      assert.ok(cfg.mcpServers?.[VOICE_ENTRY], `${path}: voice entry exists`);
      assert.ok(cfg.mcpServers?.[CODER_ENTRY], `${path}: coder entry exists`);
    }
    const codexContent = readFileSync(p.codex, "utf8");
    assert.ok(codexContent.includes("[mcp_servers.crixin-voice]"));
    assert.ok(codexContent.includes("[mcp_servers.crixin-coder]"));
    cleanup();
  });
});

describe("install · idempotency", () => {
  it("voice install is byte-identical when re-run", () => {
    runVoiceInstall({});
    const p = paths(tmpHome);
    const before = readFileSync(p.claudeCode, "utf8");
    const beforeCodex = readFileSync(p.codex, "utf8");
    runVoiceInstall({});
    const after = readFileSync(p.claudeCode, "utf8");
    const afterCodex = readFileSync(p.codex, "utf8");
    assert.equal(before, after, "Claude Code JSON byte-identical");
    assert.equal(beforeCodex, afterCodex, "Codex TOML byte-identical");
    cleanup();
  });

  it("voice install run 5x does not duplicate the section in Codex TOML", () => {
    for (let i = 0; i < 5; i++) runVoiceInstall({});
    const content = readFileSync(paths(tmpHome).codex, "utf8");
    const occurrences = (content.match(/\[mcp_servers\.crixin-voice\]/g) || []).length;
    assert.equal(occurrences, 1);
    cleanup();
  });

  it("coder install is byte-identical when re-run", () => {
    runCoderInstall({});
    const p = paths(tmpHome);
    const before = readFileSync(p.cursor, "utf8");
    const beforeCodex = readFileSync(p.codex, "utf8");
    runCoderInstall({});
    const after = readFileSync(p.cursor, "utf8");
    const afterCodex = readFileSync(p.codex, "utf8");
    assert.equal(before, after);
    assert.equal(beforeCodex, afterCodex);
    cleanup();
  });
});

describe("install · preserves unrelated MCP servers", () => {
  it("voice install does not touch existing third-party MCP entries", () => {
    const p = paths(tmpHome);
    mkdirSync(join(tmpHome, ".cursor"), { recursive: true });
    // Pre-existing Cursor config with another MCP entry
    writeFileSync(p.cursor, JSON.stringify({
      mcpServers: {
        "context7": { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
        "filesystem": { command: "npx", args: ["-y", "filesystem-mcp"] },
      },
    }, null, 2));

    runVoiceInstall({});

    const cfg = JSON.parse(readFileSync(p.cursor, "utf8"));
    assert.ok(cfg.mcpServers["context7"],   "context7 preserved");
    assert.ok(cfg.mcpServers["filesystem"], "filesystem preserved");
    assert.ok(cfg.mcpServers[VOICE_ENTRY],  "crixin-voice added");
    cleanup();
  });

  it("voice install does not touch existing Codex CLI mcp_servers entries", () => {
    const p = paths(tmpHome);
    mkdirSync(join(tmpHome, ".codex"), { recursive: true });
    writeFileSync(p.codex, `# user comments preserved
[mcp_servers.other-mcp]
command = "node"
args = ["./my-mcp.js"]
`);
    runVoiceInstall({});
    const content = readFileSync(p.codex, "utf8");
    assert.ok(content.includes("# user comments preserved"));
    assert.ok(content.includes("[mcp_servers.other-mcp]"));
    assert.ok(content.includes("[mcp_servers.crixin-voice]"));
    cleanup();
  });
});

describe("install · refuses malformed configs", () => {
  it("voice install does not overwrite a malformed JSON file", () => {
    const p = paths(tmpHome);
    mkdirSync(join(tmpHome, ".cursor"), { recursive: true });
    const malformed = "{ this is not valid json";
    writeFileSync(p.cursor, malformed);

    runVoiceInstall({});

    // The malformed Cursor config is left untouched
    assert.equal(readFileSync(p.cursor, "utf8"), malformed);
    // Other hosts still get installed
    assert.ok(existsSync(p.claudeCode), "Claude Code config still created");
    cleanup();
  });
});

describe("install · uninstall path", () => {
  it("voice uninstall removes the crixin-voice entry from all hosts", () => {
    runVoiceInstall({});
    const p = paths(tmpHome);
    // Sanity: present after install
    assert.ok(JSON.parse(readFileSync(p.claudeCode, "utf8")).mcpServers[VOICE_ENTRY]);
    assert.ok(readFileSync(p.codex, "utf8").includes("[mcp_servers.crixin-voice]"));

    runVoiceInstall({ uninstall: true });

    const cfg = JSON.parse(readFileSync(p.claudeCode, "utf8"));
    assert.ok(!cfg.mcpServers?.[VOICE_ENTRY], "Claude Code voice entry removed");
    const codexContent = readFileSync(p.codex, "utf8");
    assert.ok(!codexContent.includes("[mcp_servers.crixin-voice]"), "Codex voice section removed");
    cleanup();
  });

  it("voice uninstall preserves coder entry and other MCPs", () => {
    runVoiceInstall({});
    runCoderInstall({});
    const p = paths(tmpHome);

    runVoiceInstall({ uninstall: true });

    const cfg = JSON.parse(readFileSync(p.claudeCode, "utf8"));
    assert.ok(!cfg.mcpServers?.[VOICE_ENTRY], "voice entry removed");
    assert.ok(cfg.mcpServers?.[CODER_ENTRY],  "coder entry preserved");
    const codexContent = readFileSync(p.codex, "utf8");
    assert.ok(!codexContent.includes("[mcp_servers.crixin-voice]"));
    assert.ok(codexContent.includes("[mcp_servers.crixin-coder]"));
    cleanup();
  });

  it("voice uninstall on a clean machine reports absent (no crash)", () => {
    assert.doesNotThrow(() => runVoiceInstall({ uninstall: true }));
    cleanup();
  });
});

describe("install · dry-run (--print)", () => {
  it("voice install --print does not write any files", () => {
    runVoiceInstall({ print: true });
    const p = paths(tmpHome);
    assert.ok(!existsSync(p.claudeCode), "Claude Code config NOT written in dry-run");
    assert.ok(!existsSync(p.cursor),     "Cursor config NOT written in dry-run");
    assert.ok(!existsSync(p.codex),      "Codex CLI config NOT written in dry-run");
    cleanup();
  });
});

describe("install · legacy mcpServers (array shape)", () => {
  it("refuses to silently rewrite an array-shaped mcpServers", () => {
    const p = paths(tmpHome);
    const legacy = {
      mcpServers: [
        { name: "filesystem", command: "npx", args: ["-y", "filesystem-mcp"] },
      ],
    };
    writeFileSync(p.claudeCode, JSON.stringify(legacy, null, 2));

    runVoiceInstall({});

    // File is unchanged — refusal is silent on disk
    const after = JSON.parse(readFileSync(p.claudeCode, "utf8"));
    assert.ok(Array.isArray(after.mcpServers), "still legacy array on disk");
    assert.equal(after.mcpServers.length, 1, "no entries lost or added");
    cleanup();
  });

  it("migrates and writes a .bak when --migrate-legacy is set", () => {
    const p = paths(tmpHome);
    const legacy = {
      mcpServers: [
        { name: "filesystem", command: "npx", args: ["-y", "filesystem-mcp"] },
        { name: "github",     command: "node", args: ["./gh.js"] },
      ],
      apiKey: "preserve-me",
    };
    writeFileSync(p.claudeCode, JSON.stringify(legacy, null, 2));

    runVoiceInstall({ migrateLegacy: true });

    // .bak exists with the original
    const bak = JSON.parse(readFileSync(`${p.claudeCode}.bak`, "utf8"));
    assert.ok(Array.isArray(bak.mcpServers), ".bak preserves legacy shape");

    // Live config is now object-shaped with all original entries + crixin-voice
    const live = JSON.parse(readFileSync(p.claudeCode, "utf8"));
    assert.equal(Array.isArray(live.mcpServers), false, "live is object");
    assert.ok(live.mcpServers["filesystem"], "filesystem preserved");
    assert.ok(live.mcpServers["github"],     "github preserved");
    assert.ok(live.mcpServers[VOICE_ENTRY],  "crixin-voice added");
    assert.equal(live.apiKey, "preserve-me", "non-mcpServers keys preserved");
    cleanup();
  });

  it("migration skips other hosts cleanly (one legacy, others modern)", () => {
    const p = paths(tmpHome);
    mkdirSync(join(tmpHome, ".cursor"), { recursive: true });
    // Claude Code is legacy, Cursor is modern
    writeFileSync(p.claudeCode, JSON.stringify({
      mcpServers: [{ name: "x", command: "y" }],
    }));
    writeFileSync(p.cursor, JSON.stringify({
      mcpServers: { other: { command: "z" } },
    }));

    runVoiceInstall({ migrateLegacy: true });

    // Both should now have crixin-voice
    const claudeCfg = JSON.parse(readFileSync(p.claudeCode, "utf8"));
    const cursorCfg = JSON.parse(readFileSync(p.cursor, "utf8"));
    assert.ok(claudeCfg.mcpServers[VOICE_ENTRY], "Claude Code migrated + voice added");
    assert.ok(cursorCfg.mcpServers[VOICE_ENTRY], "Cursor unaffected by migration, voice added");
    assert.ok(cursorCfg.mcpServers["other"],     "Cursor's other MCP preserved");
    // Claude Code got a .bak; Cursor did not
    assert.ok(existsSync(`${p.claudeCode}.bak`));
    assert.ok(!existsSync(`${p.cursor}.bak`));
    cleanup();
  });

  it("migration handles entries with id instead of name", () => {
    const p = paths(tmpHome);
    writeFileSync(p.claudeCode, JSON.stringify({
      mcpServers: [
        { id: "by-id", command: "x", args: [] },
        { name: "by-name", command: "y", args: [] },
      ],
    }));
    runVoiceInstall({ migrateLegacy: true });
    const live = JSON.parse(readFileSync(p.claudeCode, "utf8"));
    assert.ok(live.mcpServers["by-id"]);
    assert.ok(live.mcpServers["by-name"]);
    cleanup();
  });

  it("running install without --migrate-legacy after legacy detection leaves config untouched", () => {
    const p = paths(tmpHome);
    const original = JSON.stringify({
      mcpServers: [{ name: "x", command: "y" }],
    }, null, 2);
    writeFileSync(p.claudeCode, original);

    runVoiceInstall({});

    assert.equal(readFileSync(p.claudeCode, "utf8"), original, "byte-identical refusal");
    assert.ok(!existsSync(`${p.claudeCode}.bak`), "no .bak written on refusal");
    cleanup();
  });
});

describe("install · permission denied (EACCES)", () => {
  it("surfaces a friendly message when a host config is read-only", () => {
    const p = paths(tmpHome);
    mkdirSync(join(tmpHome, ".cursor"), { recursive: true });
    // Create the Cursor config, then make it unwritable. The install code
    // will try to rename a temp file over it; that succeeds (rename only
    // needs parent-dir perms), so simulate the failure by making the
    // parent directory read-only — which DOES block writes on macOS.
    writeFileSync(p.cursor, JSON.stringify({ mcpServers: {} }));
    chmodSync(join(tmpHome, ".cursor"), 0o555);

    const errors: string[] = [];
    const origStderr = process.stderr.write.bind(process.stderr);
    // Capture stderr (log.error writes there)
    (process.stderr.write as unknown as (msg: string) => boolean) = (msg: string) => {
      errors.push(typeof msg === "string" ? msg : msg.toString());
      return true;
    };
    try {
      runVoiceInstall({ only: "cursor" });
    } finally {
      (process.stderr.write as unknown as typeof origStderr) = origStderr;
      // restore perms so cleanup can remove the dir
      chmodSync(join(tmpHome, ".cursor"), 0o755);
    }

    const allOutput = errors.join("");
    // The friendly message must surface AND mention the path AND the label
    assert.ok(allOutput.includes("Cursor"),         "label appears");
    assert.ok(allOutput.includes(".cursor"),        "path appears");
    assert.ok(allOutput.includes("permission denied") || allOutput.includes("Raw error"),
      "friendly EACCES message or raw error surfaces");
    cleanup();
  });
});

describe("install · --only=<host>", () => {
  it("voice install --only=codex writes only the Codex config", () => {
    runVoiceInstall({ only: "codex" });
    const p = paths(tmpHome);
    assert.ok(existsSync(p.codex),       "Codex CLI config created");
    assert.ok(!existsSync(p.cursor),     "Cursor config NOT touched");
    assert.ok(!existsSync(p.claudeCode), "Claude Code config NOT touched");
    cleanup();
  });

  it("voice install --only=cursor writes only the Cursor config", () => {
    runVoiceInstall({ only: "cursor" });
    const p = paths(tmpHome);
    assert.ok(existsSync(p.cursor));
    assert.ok(!existsSync(p.codex));
    cleanup();
  });

  it("voice install --only=invalid throws with a helpful message", () => {
    assert.throws(
      () => runVoiceInstall({ only: "invalid-host" }),
      /desktop, claude-code, cursor, or codex/,
    );
    cleanup();
  });
});
