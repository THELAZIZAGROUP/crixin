import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mutateMcpServer,
  removeMcpServer,
  parseToml,
  sectionMatches,
  serializeMcpSection,
} from "../../src/lib/toml-mcp.ts";

const entry = { command: "npx", args: ["-y", "crixin", "voice", "mcp"] };

describe("toml-mcp · serializeMcpSection", () => {
  it("emits a canonical block with double-quoted strings", () => {
    const out = serializeMcpSection("crixin-voice", entry);
    assert.ok(out.includes('[mcp_servers.crixin-voice]'));
    assert.ok(out.includes('command = "npx"'));
    assert.ok(out.includes('args = ["-y", "crixin", "voice", "mcp"]'));
    assert.ok(out.endsWith("\n\n"), "ends with trailing blank line");
  });

  it("escapes quotes in args correctly", () => {
    const tricky = { command: "node", args: ['--flag="value"', 'name with spaces'] };
    const out = serializeMcpSection("test", tricky);
    assert.ok(out.includes('args = ["--flag=\\"value\\"", "name with spaces"]'));
  });
});

describe("toml-mcp · parseToml", () => {
  it("parses empty input", () => {
    const p = parseToml("");
    assert.equal(p.preamble, "");
    assert.equal(p.sections.length, 0);
  });

  it("treats pure preamble as no sections", () => {
    const p = parseToml("# a comment\n# another\n");
    assert.equal(p.sections.length, 0);
    assert.ok(p.preamble.includes("a comment"));
  });

  it("splits sections cleanly", () => {
    const src = `# comment
[a]
x = 1
[b]
y = 2
`;
    const p = parseToml(src);
    assert.equal(p.sections.length, 2);
    assert.equal(p.sections[0]!.name, "a");
    assert.equal(p.sections[1]!.name, "b");
    assert.ok(p.preamble.includes("comment"));
  });

  it("preserves blank lines between sections", () => {
    const src = `[a]\nx = 1\n\n[b]\ny = 2\n`;
    const p = parseToml(src);
    // Section a should include its trailing blank line
    assert.ok(p.sections[0]!.rawBlock.includes("\n\n"));
  });
});

describe("toml-mcp · mutateMcpServer · empty file", () => {
  it("creates a section in an empty file", () => {
    const r = mutateMcpServer("", "crixin-voice", entry);
    assert.equal(r.changed, true);
    assert.equal(r.replaced, false);
    assert.ok(r.toml.includes("[mcp_servers.crixin-voice]"));
    assert.ok(r.toml.includes('command = "npx"'));
  });

  it("creates a section in a file with only comments", () => {
    const src = "# user comment\n# do not touch\n";
    const r = mutateMcpServer(src, "crixin-voice", entry);
    assert.equal(r.changed, true);
    assert.ok(r.toml.startsWith("# user comment"), "preamble preserved");
    assert.ok(r.toml.includes("[mcp_servers.crixin-voice]"));
  });
});

describe("toml-mcp · mutateMcpServer · existing sections", () => {
  it("appends after existing unrelated sections", () => {
    const src = `[other]\nkey = "val"\n`;
    const r = mutateMcpServer(src, "crixin-voice", entry);
    assert.equal(r.changed, true);
    assert.equal(r.replaced, false);
    assert.ok(r.toml.includes("[other]"), "existing section preserved");
    assert.ok(r.toml.includes("[mcp_servers.crixin-voice]"));
    // The existing section must come before the new one
    assert.ok(r.toml.indexOf("[other]") < r.toml.indexOf("[mcp_servers.crixin-voice]"));
  });

  it("appends after existing other mcp_servers entries", () => {
    const src = `[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]
`;
    const r = mutateMcpServer(src, "crixin-voice", entry);
    assert.equal(r.changed, true);
    assert.ok(r.toml.includes("[mcp_servers.context7]"), "other MCP preserved");
    assert.ok(r.toml.includes("[mcp_servers.crixin-voice]"));
  });
});

describe("toml-mcp · mutateMcpServer · idempotency", () => {
  it("returns changed=false when section already matches", () => {
    const first = mutateMcpServer("", "crixin-voice", entry);
    const second = mutateMcpServer(first.toml, "crixin-voice", entry);
    assert.equal(second.changed, false);
    assert.equal(second.replaced, false);
    assert.equal(second.toml, first.toml, "byte-identical on no-op");
  });

  it("re-running 5 times produces identical output", () => {
    let current = "# baseline comment\n";
    for (let i = 0; i < 5; i++) {
      const r = mutateMcpServer(current, "crixin-voice", entry);
      current = r.toml;
    }
    // After 5 runs, only one section should exist
    const occurrences = (current.match(/\[mcp_servers\.crixin-voice\]/g) || []).length;
    assert.equal(occurrences, 1, "should not duplicate the section");
  });
});

describe("toml-mcp · mutateMcpServer · replace in place", () => {
  it("replaces a section with different command", () => {
    const src = `[mcp_servers.crixin-voice]
command = "old-binary"
args = ["x"]
`;
    const r = mutateMcpServer(src, "crixin-voice", entry);
    assert.equal(r.changed, true);
    assert.equal(r.replaced, true);
    assert.ok(r.toml.includes('command = "npx"'));
    assert.ok(!r.toml.includes("old-binary"), "old command removed");
  });

  it("preserves unrelated sections during replace", () => {
    const src = `[other]
key = "val"

[mcp_servers.crixin-voice]
command = "stale"
args = []

[trailing]
last = true
`;
    const r = mutateMcpServer(src, "crixin-voice", entry);
    assert.equal(r.changed, true);
    assert.equal(r.replaced, true);
    assert.ok(r.toml.includes("[other]"));
    assert.ok(r.toml.includes("[trailing]"));
    assert.ok(r.toml.includes('command = "npx"'));
    assert.ok(!r.toml.includes("stale"));
    // Order preserved
    assert.ok(r.toml.indexOf("[other]") < r.toml.indexOf("[mcp_servers.crixin-voice]"));
    assert.ok(r.toml.indexOf("[mcp_servers.crixin-voice]") < r.toml.indexOf("[trailing]"));
  });
});

describe("toml-mcp · removeMcpServer", () => {
  it("removes a section cleanly", () => {
    const src = mutateMcpServer("", "crixin-voice", entry).toml;
    const r = removeMcpServer(src, "crixin-voice");
    assert.equal(r.changed, true);
    assert.ok(!r.toml.includes("[mcp_servers.crixin-voice]"));
  });

  it("returns changed=false when section is absent", () => {
    const src = `[other]\nkey = "val"\n`;
    const r = removeMcpServer(src, "crixin-voice");
    assert.equal(r.changed, false);
    assert.equal(r.toml, src);
  });

  it("preserves unrelated sections", () => {
    const src = `[a]
x = 1

[mcp_servers.crixin-voice]
command = "npx"
args = ["-y", "crixin", "voice", "mcp"]

[b]
y = 2
`;
    const r = removeMcpServer(src, "crixin-voice");
    assert.equal(r.changed, true);
    assert.ok(r.toml.includes("[a]"));
    assert.ok(r.toml.includes("[b]"));
    assert.ok(!r.toml.includes("[mcp_servers.crixin-voice]"));
  });
});

describe("toml-mcp · sectionMatches", () => {
  it("matches identical entry regardless of whitespace", () => {
    const block = `[mcp_servers.x]\ncommand   =   "npx"\nargs    =    ["-y", "crixin"]\n`;
    assert.equal(sectionMatches(block, { command: "npx", args: ["-y", "crixin"] }), true);
  });

  it("returns false for different command", () => {
    const block = `[mcp_servers.x]\ncommand = "node"\nargs = ["-y", "crixin"]\n`;
    assert.equal(sectionMatches(block, { command: "npx", args: ["-y", "crixin"] }), false);
  });

  it("returns false for different args", () => {
    const block = `[mcp_servers.x]\ncommand = "npx"\nargs = ["something-else"]\n`;
    assert.equal(sectionMatches(block, { command: "npx", args: ["-y", "crixin"] }), false);
  });
});

describe("toml-mcp · adversarial inputs", () => {
  it("handles CRLF line endings", () => {
    const src = "[other]\r\nkey = 1\r\n";
    const r = mutateMcpServer(src, "crixin-voice", entry);
    assert.equal(r.changed, true);
    assert.ok(r.toml.includes("[mcp_servers.crixin-voice]"));
  });

  it("handles trailing whitespace in section headers", () => {
    const src = `[other]   \nx = 1\n`;
    const p = parseToml(src);
    assert.equal(p.sections.length, 1);
    assert.equal(p.sections[0]!.name, "other");
  });

  it("does not touch a section with a similar but different name", () => {
    const src = `[mcp_servers.crixin-voice-old]
command = "stale"
args = []
`;
    const r = mutateMcpServer(src, "crixin-voice", entry);
    assert.equal(r.changed, true);
    assert.ok(r.toml.includes("[mcp_servers.crixin-voice-old]"), "similar-named section preserved");
    assert.ok(r.toml.includes("[mcp_servers.crixin-voice]"));
  });
});
