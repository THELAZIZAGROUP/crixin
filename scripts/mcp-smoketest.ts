/**
 * Talk to the Crixin MCP server over stdio the same way Claude Code or Codex
 * would. Exercises every tool and prints framed JSON-RPC responses.
 *
 * This is the test that simulates "Claude Code running with Crixin as an MCP
 * server, asking the tool questions" without needing a fresh Claude Code
 * session. It also catches regressions before you ship.
 *
 * Usage:
 *   npm run build
 *   node --import tsx scripts/mcp-smoketest.ts
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const BIN = resolve(ROOT, "dist", "cli", "index.js");

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

const proc = spawn("node", [BIN, "--mcp"], {
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
const pending = new Map<number, (r: JsonRpcResponse) => void>();

proc.stdout.on("data", (chunk: Buffer) => {
  buf += chunk.toString("utf8");
  // MCP over stdio uses newline-delimited JSON.
  let nl: number;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line) as JsonRpcResponse;
      const cb = typeof msg.id === "number" ? pending.get(msg.id) : undefined;
      cb?.(msg);
    } catch {
      // Ignore non-JSON lines (e.g. warnings).
    }
  }
});

let nextId = 1;
function call(method: string, params?: unknown): Promise<JsonRpcResponse> {
  const id = nextId++;
  const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
  return new Promise((res) => {
    pending.set(id, (r) => {
      pending.delete(id);
      res(r);
    });
    proc.stdin.write(JSON.stringify(req) + "\n");
  });
}

function fmt(r: JsonRpcResponse): string {
  if (r.error) return `ERROR ${r.error.code}: ${r.error.message}`;
  const result = r.result as { content?: { type: string; text: string }[] } | undefined;
  if (result?.content?.[0]?.text) {
    const text = result.content[0].text;
    const head = text.split("\n").slice(0, 6).join(" / ");
    return head.length > 240 ? head.slice(0, 237) + "..." : head;
  }
  return JSON.stringify(r.result).slice(0, 240);
}

await new Promise((r) => setTimeout(r, 800)); // give server a beat to start

console.log("==========================================================");
console.log("  Crixin MCP smoketest — pretending to be Claude Code");
console.log("==========================================================\n");

console.log("→ initialize");
const init = await call("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: { tools: {} },
  clientInfo: { name: "crixin-smoketest", version: "0.0.1" },
});
console.log("  " + fmt(init) + "\n");

console.log("→ tools/list");
const listed = await call("tools/list");
const tools = (listed.result as { tools: { name: string; description: string }[] })?.tools ?? [];
for (const t of tools) console.log(`  - ${t.name}: ${t.description.slice(0, 90)}…`);
console.log();

console.log("→ tools/call: stats");
const stats = await call("tools/call", { name: "stats", arguments: {} });
console.log("  " + fmt(stats) + "\n");

console.log("→ tools/call: list_recent_sessions { limit: 3 }");
const recent = await call("tools/call", { name: "list_recent_sessions", arguments: { limit: 3 } });
console.log("  " + fmt(recent) + "\n");

console.log("→ tools/call: search_sessions { query: 'crixin', limit: 3 }");
const search = await call("tools/call", {
  name: "search_sessions",
  arguments: { query: "crixin", limit: 3 },
});
console.log("  " + fmt(search) + "\n");

console.log("→ tools/call: search_sessions { query: 'auth refactor', limit: 2 }");
const auth = await call("tools/call", {
  name: "search_sessions",
  arguments: { query: "auth refactor", limit: 2 },
});
console.log("  " + fmt(auth) + "\n");

console.log("→ tools/call: search_sessions { query: 'stripe price', limit: 2 }  // simulating the cross-session 'what was the price id we set?' question");
const stripe = await call("tools/call", {
  name: "search_sessions",
  arguments: { query: "stripe price", limit: 2 },
});
console.log("  " + fmt(stripe) + "\n");

console.log("→ shutdown");
proc.kill();
console.log("\n==========================================================");
console.log("  Smoketest complete.");
console.log("==========================================================\n");
