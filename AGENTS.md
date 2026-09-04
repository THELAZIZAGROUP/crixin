# AGENTS.md — collaboration brief for AI coding agents

For Claude Code, OpenAI Codex, Cursor, and any other agent working on this codebase. Read this before writing code.

## What this repo is

**`crixin` — the MCP toolkit for AI agents.** Two MCP servers (`crixin-voice` + `crixin-coder`) in one npm package, sharing one local SQLite at `~/.crixin/crixin.db`.

- **Voice MCP** — gives AI agents phone access through your own Twilio account. Six tools: `make_call`, `send_sms`, `transcribe_call`, `get_call`, `list_calls`, `list_recordings`.
- **Coder MCP** — gives AI agents memory across every Claude Code, Codex CLI, and Cursor session. Four tools: `search_sessions`, `list_recent_sessions`, `get_session`, `stats`.

Positioning: protocol adapter / capability layer, NOT a hosted SaaS, NOT an "AI employee" or "AI sales team" product. Anything that drifts toward "hosted dashboard with campaigns and admin panels" violates the strategic position. See `CHANGELOG.md` `[0.4.0]` / `[0.5.0]` for the cut history.

## Repo layout

```
crixin/
├── README.md          # Front door — leads with the MCP-toolkit pitch
├── AGENTS.md          # This file
├── CLAUDE.md          # Project-specific Claude Code instructions (gitignored)
├── CHANGELOG.md       # Version history; the v0.4.0 + v0.5.0 entries explain the cut
├── LICENSE            # MIT
├── package.json
├── src/
│   ├── cli/           # top-level dispatcher (crixin / install / doctor / license)
│   ├── voice/         # Voice MCP — mcp server + cli + twilio + ingest + analyze
│   ├── coder/         # Coder MCP — cli router + install
│   ├── mcp/           # Coder MCP stdio server (name: "crixin-coder")
│   ├── ingesters/     # JSONL parsers for Claude Code / Codex / Cursor
│   ├── wrapped/       # Coder Wrapped engines
│   ├── server/        # Coder dashboard (Hono on 127.0.0.1)
│   ├── db/            # SQLite schema (v4) + queries
│   ├── pricing/       # Token-cost estimation (Coder)
│   ├── license/       # Pro license JWT verification
│   └── lib/           # log, paths, port helpers
├── api/               # Vercel serverless functions (Pro tier only)
│   ├── auth/          # magic-link auth (Firebase Identity Toolkit + Resend)
│   ├── voice/         # Wrapped snapshot endpoint
│   ├── checkout.ts    # Stripe Pro subscription
│   ├── portal.ts      # Stripe Customer Portal
│   ├── stripe-webhook.ts
│   └── share/         # Wrapped share-link API
├── web/               # Marketing site (Vercel static)
└── test/              # 70 tests across 9 suites; should always pass
```

## Conventions

### Branching & commits

- Default branch: `main`
- One concern per PR. No 800-line "improvements" PRs.
- Commit messages: present-tense, imperative. First line ≤ 70 chars. Body explains *why*, not *what*.
- Never commit secrets. The `.gitignore` is paranoid by default; verify any new file pattern won't bypass it.

### Code style

- TypeScript with `strict: true`, `verbatimModuleSyntax: true`, NodeNext modules.
- Prefer pure functions; isolate side effects.
- No comments unless WHY is non-obvious. Code's name should already say WHAT.
- One default export per file when the file is "the X module". Otherwise, named exports.
- Tests live in `test/` (parallel tree). Run via `npm test` — 70 tests, ~22 seconds.

### Naming (LOCKED in v0.5.0 — do not drift)

| Concept | Marketing display | CLI subcommand | MCP entry | Import path |
|---|---|---|---|---|
| Phone capability | **Voice MCP** | `crixin voice …` | `crixin-voice` | `crixin/voice` |
| Memory capability | **Coder MCP** | `crixin coder …` | `crixin-coder` | `crixin/coder` |
| Whole toolkit | **Crixin** | `crixin` | n/a | `crixin` |

Banned terms (the v0.4 / v0.5 cut killed these — do not bring them back):
- "Call Teams" / "Crixin Team" / "Crixin Call Assistant"
- "AI sales team" / "AI receptionist" / "AI employees" / "AI teammates"
- "Hire agents" / "agent roster" / "personas" as configurable entities
- "Campaign" as a hosted-product abstraction (the SQLite column stays for back-compat, but the UI label is "tag")
- "Hosted Twilio" / "managed Twilio" / "telecom platform"

### Dependencies

- Lockfile committed (`package-lock.json`).
- No dependency added without justification in the PR description: what it does, what we'd write ourselves if we didn't take it, license.
- License audit: every direct dep must be MIT / BSD / Apache-2 / ISC. No GPL.
- Current runtime deps: `@modelcontextprotocol/sdk`, `kleur`, `hono`, `@hono/node-server`, `js-tiktoken`, `open`. Adding to this list needs justification.

## What you should and shouldn't do as an agent

### Do

- Read this file and `CHANGELOG.md` `[0.5.0]` before writing code. Especially the banned-terms list.
- Run `npm run typecheck` and `npm test` before claiming done. 70/70 must pass.
- When touching `src/voice/` or `src/coder/`, keep the parallel structure (both have `cli.ts`, `install.ts`, and a stdio `mcp.ts`).
- When touching marketing copy in `web/`, run a grep for the banned terms before committing.
- Smoke-test by opening the modified page in a browser before claiming done. Type-checking ≠ visual correctness.

### Don't

- Don't add hosted-SaaS abstractions: multi-tenant tables, org management, admin panels, "team" features. The Pro tier is two users in scope: the user, and an optional sync target. That's it.
- Don't add a third MCP yet. Strategic position is: v0.4–v0.5 settles before we expand the toolkit. Adding `crixin browser` or `crixin calendar` is v0.6+ work.
- Don't introduce telemetry that phones home. The only network traffic in the open-source path is Twilio API calls (Voice MCP) and Deepgram (optional). The Pro tier adds Firebase Auth + Stripe + Resend — those are scoped to authenticated users only.
- Don't paste any value that looks like a key (`sk_…`, `ghp_…`, `pcsk_…`, `dp.sa.…`, `AIzaSy…`, `BEGIN PRIVATE KEY`) into any file in this repo. The `.gitignore` is the safety net, not the policy.
- Don't reintroduce the `hireAgent()` / `AgentPersona` / `Campaign` orchestration layer. v0.5.0 explicitly removed the "hire agents" framing. Voice is a tool parameter, not a configured entity.

## Verification before claiming done

- [ ] `npm install` completes cleanly
- [ ] `npm run typecheck` — zero errors
- [ ] `npm test` — 70/70 passing
- [ ] No `.env` / `.env.*` (except `.env.example`) in `git status`
- [ ] `git diff main` reviewed for unintended changes
- [ ] No new dependencies without a reason in the PR description
- [ ] If web/*.html changed: page renders in a browser; banned terms greps come back empty
- [ ] If src/cli or src/voice or src/coder changed: `node dist/cli/index.js --help` reads correctly

## Stop-and-replan triggers

Stop and ask the human if any of these come up:

- A request implies adding a hosted-SaaS feature (admin panel, multi-tenant, team org management)
- A request implies reintroducing the "hire agents" / "personas" / "campaigns" abstractions
- A request implies emitting customer data to a third-party we don't already use (Twilio / Deepgram / Stripe / Firebase / Resend)
- A request asks for "AI features" that need a remote LLM call at runtime in the open-source path
- The work is taking 3+ attempts at the same approach

## Useful entry points

- Strategy: `CHANGELOG.md` `[0.5.0]` — explains the recommitment cut
- Marketing: `web/llms.txt` — canonical one-pager for LLM crawlers
- Architecture: `CLAUDE.md` (gitignored project doc)
- Tests: `test/` — 70 tests, run via `npm test`
- Live site: <https://crixin.com>
- npm: <https://www.npmjs.com/package/crixin>
