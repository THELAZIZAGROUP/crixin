# Installing Crixin as an MCP server

This is how you give Claude Code, Cursor, or Codex CLI the ability to search your AI coding session history as a tool. Each host has its own one-shot install flow below — pick yours.

The package is on npm as **`crixin`**, so all three install paths use `npx -y crixin --mcp` and need no clone or local build. Node ≥22 required.

## Cursor — one-click

Use the deep-link installer at <https://crixin.com> ("Add to Cursor" button) — it pre-populates Cursor's MCP config with the right command and you confirm in-app.

## Claude Code — one CLI command

```sh
claude mcp add crixin -- npx -y crixin --mcp
```

That's it. Restart Claude Code; the four tools (`search_sessions`, `list_recent_sessions`, `get_session`, `stats`) become callable.

If you'd rather edit the file by hand:

```jsonc
// ~/.claude/mcp.json
{
  "mcpServers": {
    "crixin": {
      "command": "npx",
      "args": ["-y", "crixin", "--mcp"]
    }
  }
}
```

Restart Claude Code. The four tools (`search_sessions`, `list_recent_sessions`, `get_session`, `stats`) are now callable. Try:

> *"Use crixin to find the auth refactor I did three weeks ago."*

## Codex CLI (`~/.codex/config.toml`)

Append:

```toml
[mcp_servers.crixin]
command = "npx"
args = ["-y", "crixin", "--mcp"]
```

Codex picks up MCP servers from this file on every launch.

## First-launch warm-up

The MCP server runs `ingestAll()` on startup, which BPE-encodes every message in `~/.claude/projects/`, `~/.codex/sessions/`, and Cursor's `state.vscdb`. On a 1.6 GB / 17,000-message corpus that's ~80s the first time. Subsequent launches reuse `~/.crixin/crixin.db` and start in <1s thanks to the `(source_path, mtime, size)` fingerprint.

To pre-warm before configuring the MCP server:

```sh
node ~/Documents/crixin/dist/cli/index.js ingest
```

## Smoketest (no fresh session needed)

Talk to the MCP server over stdio the way Claude Code would, without restarting anything:

```sh
cd ~/Documents/crixin
node --import tsx scripts/mcp-smoketest.ts
```

You'll see the 4 tools listed, then real responses to `stats`, `list_recent_sessions`, and three `search_sessions` calls. If any tool errors out, the harness surfaces the JSON-RPC error code immediately.

## Tools the host sees

| Tool | Use it for |
|---|---|
| `search_sessions` `(query, limit?)` | "Find the session where I discussed X." Returns matched sessions with a snippet, ISO timestamp, source, and a ready-to-paste resume command (`claude --resume <uuid>` / `codex resume <uuid>`). |
| `list_recent_sessions` `(limit?)` | "What did I do today?" Most recent sessions across all sources, newest first. Includes message count + estimated cost per session. |
| `get_session` `(session_id)` | "Show me the full content of session X." Returns the entire session as Markdown — header + every message in order. |
| `stats` `()` | "Give me totals." Sessions, messages, sources, total estimated cost, total time, busiest hour, top-5 projects. |

## Privacy posture

The server runs entirely on your machine. There's no outbound network call from the MCP layer — the only file system reads are the source tools' own session files plus `~/.crixin/crixin.db`. Stripe/Resend live in the **marketing** site (`api/`), not in the MCP layer.

## Removing

Delete the `crixin` block from `~/.claude/mcp.json` and the `[mcp_servers.crixin]` block from `~/.codex/config.toml`. Restart the host. `~/.crixin/` is yours to delete (`rm -rf`) — nothing else depends on it.
