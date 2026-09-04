# Architecture

## One-line shape

```
npx crixin
  └─ scan ~/.claude/projects/*.jsonl (and friends)
  └─ ingest → DuckDB at ~/.crixin/db.duckdb
  └─ start local HTTP server on 127.0.0.1:<random-port>
  └─ open http://127.0.0.1:<port> in default browser
```

Everything is local. No outbound network calls except (a) checking for tool updates (opt-out) and (b) verifying license signature with Stripe/Polar/Lemonsqueezy webhook signatures (offline-verifiable, no callback to us).

## Stack (tentative)

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node ≥ 20, distributed via npm | `npx crixin` works on any machine with Node — biggest reach for indie devs. Bun/Deno later as alt entrypoints. |
| Language | TypeScript | Type safety + npm ecosystem. |
| Local DB | DuckDB (`@duckdb/node-api`) | Columnar analytics on millions of message rows. SQLite was option B but DuckDB wins on dashboard queries. |
| HTTP | Hono | Tiny, fast, runs on Node + Bun + Cloudflare. Future-proof for a hosted-tier we don't ship yet. |
| UI | Vite + React (SSR off — SPA loaded from local server) | Familiar; Wrapped-style animated cards need real DOM. |
| Charts | Visx or Observable Plot | Honest, dev-aesthetic. Avoid Chart.js / Recharts — they look 2015. |
| MCP | `@modelcontextprotocol/sdk` | First-class MCP server mode for Claude Code / Cursor users. |
| License | Polar.sh checkout → signed JWT license keys → offline verify | No license server we have to keep alive. |

## Data sources (ingesters)

The plan is one ingester per AI coding tool. v0.1 ships Claude Code only.

| Source | Path | Status |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | v0.1 |
| Codex CLI | `~/.codex/sessions/**` + `~/.codex/history.jsonl` | v0.2 |
| Cursor | `~/Library/Application Support/Cursor/...` (TBD) | v0.3 |
| OpenAI SDK app traces (opt-in) | env-var-driven proxy / Otel exporter | v1.0 |
| Anthropic SDK app traces (opt-in) | same | v1.0 |

## DB schema (sketch)

Each ingester normalizes into a small set of tables:

```sql
sessions(
  id            TEXT PRIMARY KEY,        -- session UUID from source
  source        TEXT NOT NULL,           -- 'claude-code' | 'codex' | 'cursor' | 'sdk'
  project       TEXT,                    -- repo path / project name
  started_at    TIMESTAMP,
  ended_at      TIMESTAMP,
  message_count INTEGER,
  prompt_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd      DECIMAL(10,4)
)

messages(
  session_id    TEXT NOT NULL,
  idx           INTEGER NOT NULL,
  role          TEXT NOT NULL,           -- 'user' | 'assistant' | 'tool_result'
  content       TEXT,                    -- full text
  ts            TIMESTAMP,
  model         TEXT,
  tokens        INTEGER,
  PRIMARY KEY (session_id, idx)
)

tool_uses(
  session_id    TEXT,
  idx           INTEGER,
  tool_name     TEXT,
  ok            BOOLEAN,
  duration_ms   INTEGER
)
```

Full-text search via DuckDB's `fts` extension or via a derived virtual table; benchmark when v0.2 lands.

## CLI surface (planned)

```sh
npx crixin                    # ingest + open dashboard (default)
npx crixin --no-open          # start server, print URL, don't open browser
npx crixin --port 7470        # override port
npx crixin reindex            # full re-ingest (after upgrade)
npx crixin search "keyword"   # CLI-only deep search (offline)
npx crixin export <session>   # dump a session as markdown
npx crixin --mcp              # run as MCP server on stdio
```

## License model (offline)

1. User pays via Polar.sh checkout (Polar handles taxes; ~5% fee).
2. Polar emits a signed JWT license key (Ed25519) to user's email.
3. User runs `npx crixin license activate <key>` — key is verified against the public key we ship with the binary, stored at `~/.crixin/license.json`.
4. Pro features check the local license at runtime. No network call.
5. License expiry: 12 months from activation; renewal re-issues a new JWT.

This means we can fully kill our infrastructure and existing customers keep working. The license keys are valid until they expire.

## What we are NOT building

- No central database
- No hosted UI
- No team accounts
- No SSO
- No customer-data ingestion at our end

## Open architectural questions

- **Bundling**: ship as a `pkg`-style standalone binary, or pure npm? Likely pure npm for v0.1 (lower distribution friction); standalone binary later for non-Node users.
- **Dashboard hosting in dev**: Vite dev server during local dev, or always serve the built bundle? Probably always serve built bundle so `npx crixin` is always one launch path.
- **Auto-update**: do we auto-update the npm package on `npx`, or pin? Default behavior of `npx` already pulls latest — accepted default.
- **Telemetry**: zero by default. If we add an opt-in usage ping later, it must be aggregate-only and clearly disclosed.
