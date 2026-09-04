import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isLegacyMcpServers,
  migrateLegacyMcpServers,
  legacyRefusalMessage,
} from "../../src/lib/legacy-mcp-servers.ts";

describe("isLegacyMcpServers", () => {
  it("detects array-shaped mcpServers", () => {
    assert.equal(isLegacyMcpServers({ mcpServers: [] }), true);
    assert.equal(isLegacyMcpServers({ mcpServers: [{ name: "x" }] }), true);
  });

  it("returns false for object-shaped mcpServers", () => {
    assert.equal(isLegacyMcpServers({ mcpServers: {} }), false);
    assert.equal(isLegacyMcpServers({ mcpServers: { x: { command: "y" } } }), false);
  });

  it("returns false for absent mcpServers", () => {
    assert.equal(isLegacyMcpServers({}), false);
    assert.equal(isLegacyMcpServers({ other: 1 }), false);
  });

  it("returns false for null / primitive mcpServers (not 'legacy', just weird)", () => {
    assert.equal(isLegacyMcpServers({ mcpServers: null }), false);
    assert.equal(isLegacyMcpServers({ mcpServers: "string" }), false);
    assert.equal(isLegacyMcpServers({ mcpServers: 42 }), false);
  });
});

describe("migrateLegacyMcpServers", () => {
  it("returns the input unchanged when already modern shape", () => {
    const cfg = { mcpServers: { x: { command: "y" } }, other: 1 };
    const r = migrateLegacyMcpServers(cfg);
    assert.equal(r.count, 0);
    assert.equal(r.converted, cfg);
  });

  it("converts a simple array to an object keyed by name", () => {
    const cfg = {
      mcpServers: [
        { name: "filesystem", command: "npx", args: ["-y", "filesystem-mcp"] },
        { name: "github",     command: "node", args: ["./gh.js"] },
      ],
    };
    const r = migrateLegacyMcpServers(cfg);
    assert.equal(r.count, 2);
    assert.equal(r.skipped.length, 0);
    const servers = r.converted["mcpServers"] as Record<string, unknown>;
    assert.deepEqual(servers["filesystem"], { command: "npx", args: ["-y", "filesystem-mcp"] });
    assert.deepEqual(servers["github"],     { command: "node", args: ["./gh.js"] });
  });

  it("falls back to id when name is absent", () => {
    const cfg = { mcpServers: [{ id: "x", command: "y", args: [] }] };
    const r = migrateLegacyMcpServers(cfg);
    assert.equal(r.count, 1);
    const servers = r.converted["mcpServers"] as Record<string, unknown>;
    assert.deepEqual(servers["x"], { command: "y", args: [] });
  });

  it("strips the name/id field from the converted value", () => {
    const cfg = { mcpServers: [{ name: "x", command: "y", args: [] }] };
    const r = migrateLegacyMcpServers(cfg);
    const value = (r.converted["mcpServers"] as Record<string, unknown>)["x"] as Record<string, unknown>;
    assert.equal("name" in value, false, "name field stripped");
    assert.equal("id" in value, false,   "id field stripped");
    assert.equal(value["command"], "y");
  });

  it("skips entries with neither name nor id", () => {
    const cfg = {
      mcpServers: [
        { name: "good", command: "x" },
        { command: "no-key" },
        { id: 42, command: "wrong-type" },  // id must be string
        null,
        "not-an-object",
      ],
    };
    const r = migrateLegacyMcpServers(cfg);
    assert.equal(r.count, 1);
    assert.equal(r.skipped.length, 4);
    const servers = r.converted["mcpServers"] as Record<string, unknown>;
    assert.ok("good" in servers);
  });

  it("preserves other top-level config keys", () => {
    const cfg = {
      mcpServers: [{ name: "x", command: "y" }],
      apiKey: "secret",
      theme: "dark",
    };
    const r = migrateLegacyMcpServers(cfg);
    assert.equal(r.converted["apiKey"], "secret");
    assert.equal(r.converted["theme"],  "dark");
  });

  it("last-write-wins on duplicate names (preserves array order)", () => {
    const cfg = {
      mcpServers: [
        { name: "x", command: "first" },
        { name: "x", command: "second" },
      ],
    };
    const r = migrateLegacyMcpServers(cfg);
    assert.equal(r.count, 2, "both entries counted as migrated");
    const servers = r.converted["mcpServers"] as Record<string, unknown>;
    assert.equal((servers["x"] as Record<string, string>)["command"], "second");
  });
});

describe("legacyRefusalMessage", () => {
  it("includes path, label, and the migrate command", () => {
    const msg = legacyRefusalMessage("/x/.claude.json", "Claude Code");
    assert.ok(msg.includes("Claude Code"));
    assert.ok(msg.includes("/x/.claude.json"));
    assert.ok(msg.includes("crixin install --migrate-legacy"));
    assert.ok(msg.includes(".bak"));
    assert.ok(msg.includes("Skipping this host for now"));
  });
});
