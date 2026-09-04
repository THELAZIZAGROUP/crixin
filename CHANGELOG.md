# Changelog

All notable changes land here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.2] — 2026-09-04

### Changed

- **Public repository** — the code now lives at `https://github.com/THELAZIZAGROUP/crixin` (org level, public, clean history). Package, registry entry, bundle manifest, CLI help and site links point there.

## [0.7.1] — 2026-09-04

### Changed

- **Tool annotations on the stdio Voice MCP** — every tool now carries a `title` and MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). `make_call` and `send_sms` are marked destructive because a placed call or a sent SMS cannot be undone; hosts that gate destructive tools behind a confirmation now do so. Both Anthropic's and OpenAI's directory reviews require this.
- Desktop-extension manifest points `author` at the GitHub organization and names the repository, as the extension submission form requires.

## [0.7.0] — 2026-09-04

**Remote Voice MCP + one price.** The six voice tools are now also served over Streamable HTTP, and platform mode runs on a single plan.

### Added

- **Remote Voice MCP** at `https://crixin-platform.vercel.app/api/mcp` — Streamable HTTP, same `crx_live_…` key as platform mode. Any host that can reach an HTTPS MCP endpoint (Claude Code `claude mcp add --transport http`, Cursor, VS Code, ChatGPT developer-mode connectors) gets `make_call`, `get_call`, `list_calls`, `list_recordings`, `transcribe_call`, `send_sms` without installing this package. Tools carry MCP annotations (`readOnlyHint` etc.) so hosts can gate the side-effecting ones. The npm package is unchanged and remains the local/BYO-Twilio path.
- **Registry metadata** — `server.json` + `mcpName` in package.json describe both the npm package and the remote endpoint for the official MCP registry; `manifest.json` is the Claude Desktop extension bundle manifest.

### Changed

- **Platform mode pricing** — one plan: Crixin Unlimited, $9.99/mo, unlimited calls. Quality steps premium → standard → basic at 60/300 minutes and never blocks; one call at a time per account. `crixin voice doctor` prints the current rung and premium minutes left; `make_call` responses carry `quality`.
- Platform-side geo-gate: the hosted API now enforces the same consent attestation the CLI enforces locally, so the remote endpoint cannot bypass it.

## [0.6.0] — 2026-06-10

**Voice MCP platform mode.** Set `CRIXIN_API_KEY` (a `crx_live_…` key issued by the Crixin dashboard) and all six voice tools route through Crixin's hosted platform REST API — no Twilio account, no TWILIO_* creds on the machine. Without the key, nothing changes: BYO Twilio keeps working exactly as before.

### Added

- **Platform mode via `CRIXIN_API_KEY`** — when set, `make_call`, `get_call`, `list_calls`, `list_recordings`, `send_sms`, and `transcribe_call` all hit `{base}/api/v1/mcp/*` with `Authorization: Bearer` instead of api.twilio.com. The MCP server, `crixin voice call`, and `crixin voice sms` pick the backend lazily per invocation; tool input/output schemas are unchanged.
- **`CRIXIN_API_BASE` override** — points the client at a different platform origin (staging, self-hosted). Defaults to `https://crixin-platform.vercel.app`; trailing slashes are stripped.
- **`PlatformClient` + `PlatformApiError`** (`src/voice/platform/client.ts`) — minimal fetch-based client that unwraps the `{ success, data, meta }` envelope and surfaces platform errors with status + code + message (non-JSON bodies become code `HTTP_ERROR`). Exported from `crixin/voice` alongside the Twilio client.
- **Platform tool handlers** (`src/voice/platform/tools.ts`) — same signatures and return shapes as the direct-Twilio handlers, so library consumers can swap backends without touching call sites. `transcribe_call` runs Deepgram server-side in platform mode — no local `DEEPGRAM_API_KEY` needed.
- **Doctor platform check** — `crixin voice doctor` in platform mode probes `GET /me` and prints plan, minutes used / included, and the provisioned from-number; a 401 gets a clear "key rejected — generate a fresh one from the dashboard" hint. `crixin doctor` reports platform mode instead of flagging absent Twilio creds.
- **Tests** — `test/voice/platform.test.ts` covers auth headers, base-URL override, envelope unwrapping, error mapping, platform-mode `loadEnv`, the local geo-gate firing before any network call, and the camelCase → snake_case wire mapping.

### Unchanged on purpose

- **The geo-gate stays local.** `make_call` runs `checkDestination` on this machine before any bytes leave it — platform mode doesn't outsource compliance. US/UK/EU/AU destinations still require `consented: true`.
- **BYO Twilio is still the default.** No `CRIXIN_API_KEY` → identical behavior to 0.5.x, including all error messages and the Twilio doctor probe.
- **`loadEnv` still validates TWILIO_* when present** — platform mode only makes them optional, it doesn't ignore them. Twilio-only paths (`crixin voice ingest`) keep using them.

## [0.5.1] — 2026-05-14

**Crixin Sync v1.** Pro has advertised cross-machine memory sync since v0.4.0; this ships a narrow, truthful first version of that promise. Metadata-only, manual, opt-in. Raw session bodies and call transcripts stay on the local machine.

### Added

- **`crixin sync …` subcommand** — `status` (Free; shows device + link state), `link` (opens browser to approve this device), `enable` / `disable` (Pro), `push` / `pull` (Pro; manual, foreground), `devices` (Pro; lists devices on this account). Wired into the top-level dispatcher.
- **Device link flow** — CLI mints a 32-hex `device_id`, browser at `/sync/link` requires the magic-link cookie, server returns an HMAC bearer token (90-day TTL) that the user pastes back into `crixin sync link --token <…>`. New page at `web/sync/link.html`.
- **Server endpoints under `api/sync/`** — `link.ts` (mint device token from session cookie), `device.ts` (list / heartbeat), `push.ts` (batch upsert; rejects any field outside the 15-key allowlist with HTTP 400), `pull.ts` (cursor-based metadata fetch). Revocation is a Firestore-doc delete; push/pull check both signature *and* doc presence.
- **`api/_lib/device-token.ts`** — HMAC-signed device tokens, reusing `AUTH_SESSION_SECRET`. Distinct `kind: "crixin_device"` claim prevents cross-replay with the session cookie.
- **DB schema v5** — additive only. New tables `sync_devices`, `sync_outbox`, `sync_inbox`. No existing rows touched; the v1/v2 wipe path is unchanged and doesn't trigger on v4 → v5.
- **Metadata extractor (`src/sync/metadata.ts`)** — the privacy floor. Reads `sessions` + `voice_calls` only, and only the allowlisted columns. The `messages`, `tool_uses`, `voice_recordings` tables, plus `transcript_text`, `from_number`, `to_number`, `campaign`, `outcome`, are never referenced. Both client and server enforce the same 15-key allowlist.
- **Sync state file** at `~/.crixin/sync.json` (chmod 0600 on POSIX) holding device_id, device_token, enabled flag, last push/pull cursors. `CRIXIN_SYNC_BASE` env overrides the server URL for tests/dev.
- **`api/_lib/firestore.ts`** — added `listDocs` (paginated) and `deleteDoc` (idempotent) helpers.
- **Privacy tests** — `test/sync/metadata.test.ts` seeds `messages.content`, `voice_calls.transcript_text`, phone numbers, and free-text tags with sentinel strings, then asserts none of them appear in the extractor output or in any record the extractor produces. Plus deterministic-`record_id` and `content_hash`-stability tests.
- **Schema-migration test** — `test/sync/schema-migration.test.ts` seeds a v4-shaped DB with pre-existing rows, opens it through `getDb()`, and verifies (a) `schema_version` advances to "5", (b) `sessions` and `voice_calls` rows survive, (c) the three new tables exist and are empty.
- **State + redaction tests** — `test/sync/state.test.ts` covers roundtrip, env override, malformed-file recovery, file-mode (0600), and that `redactedState` never exposes the full token.
- **Design note** — `.claude/backlog/2026-05-14-crixin-sync-v1.md` documents v1 scope, hard non-goals, privacy floor, the allowlist contract, dedupe + conflict model, and the deferred phase-2 items.

### Not included (intentional — deferred)

- **Raw log / transcript sync.** v1 is metadata only. Phase 2 may add an opt-in `--full-text` mode with client-side encryption.
- **Auto-sync.** No timer, no background daemon, no post-ingest hook. The user invokes `push` / `pull` explicitly every time.
- **Device revoke UX.** Works today via Firestore-doc delete; no CLI or dashboard button yet.
- **Dashboard view of `sync_inbox`.** Pulled records persist locally but aren't surfaced anywhere in the UI yet.
- **Selective sync.** No per-project filtering, no per-source toggle.
- **`crixin doctor` integration** for sync state.

### Notes

- No new env vars required. The server endpoints reuse `AUTH_SESSION_SECRET` (already set for `/api/auth/session`) and the existing `FIREBASE_*` credentials.
- Test suite: 70 → 204 (added 16 sync-specific tests; rest is existing coverage that the migration didn't break).

## [0.5.0] — 2026-05-12

**The recommitment.** v0.4.0 declared the MCP-toolkit positioning. v0.5.0 backs it up across every surface — CLI help, generated reports, deep-dive pages, docs, MCP server identity. The strategy doc is no longer aspirational: the audit fixes are shipped.

### Critical fixes (surfaces that contradicted the homepage)

- **CLI help** no longer advertises a `crixin team` hosted SaaS, no longer says "two products", no longer calls the Voice Wrapped output "your AI sales team by the numbers". Top-level help is now MCP-toolkit framed; voice/coder sub-helps are scoped to their capability.
- **Coder MCP server identity** — `src/mcp/server.ts` now reports `name: "crixin-coder"` with the actual package version. Was `name: "crixin"` with hardcoded `version: "0.0.1"`. MCP hosts listing servers now see the correct identity.
- **Voice Wrapped HTML h1** — generated reports now say "Your year on the phone" instead of "Your AI sales team, by the numbers". This is the highest-conviction artifact a user produces; the previous text directly contradicted the rest of the brand.
- **`web/llms.txt`** rewritten from scratch — the file LLM crawlers ingest. Was the worst-offender for "AI sales team / hosted tier" residuals.
- **`api/waitlist.ts`** deleted. Caller-less since v0.4.0. `waitlistWelcome` template removed from `api/_lib/email.ts`.
- **`crixin install`** now wires BOTH MCPs in one shot (was: alias for `crixin voice install` in v0.4.0). Escape hatches `crixin voice install` and `crixin coder install` preserved.

### Marketing surface

- **`/voice/agents` rewritten** — was "Four voices, four personas, sixteen agents — hire one in code via `hireAgent()`". Now "Voice is a parameter, not a roster" — voices documented as `make_call` arguments, no `hireAgent()` abstraction, no AgentPersona system. "Personas" section reframed as "Prompt patterns (not personas)" — system-prompt suggestions, not a configurable abstraction.
- **`/voice/agentic` rewritten** — was "Sub-agents fan out and dial 5 pizza restaurants in parallel". Now "Voice MCP places ONE call — every stage is visible". Reel structure preserved; the fanout grid now shows the five stages of a single `make_call` (dial → speak → record → transcribe → return), not five parallel sub-agents.
- **`/install` tightened to 5 steps** — npm install → `crixin install` → set Twilio creds → `crixin coder ingest` → ask your AI host. Per-host install grid now shows BOTH MCP entries for each host.
- **AI sales team / managed Twilio / hosted plans residuals scrubbed** from `web/index.html`, `web/account.html`, `web/wrapped.html`, `web/faq.html`, `web/voice/index.html`.
- **`web/voice/index.html`** "Hire a roster, not a script. Four voices. Four personas." section rewritten to "Pick a voice. Per call." — voices documented as MCP tool parameters with Polly voice IDs, no roster/persona abstraction.

### Internal docs

- **`AGENTS.md`** fully rewritten — MCP-toolkit framing, locked naming table, explicit banned-terms list, third-MCP-test as the strategic compass.
- **`docs/pitch.md`** fully rewritten — strategy-grade pitch doc explaining why MCP, what $5/mo Pro actually is, the third-MCP test, what success/failure looks like at year 1.

### Code

- **`topCampaigns` label in Voice Wrapped** renamed to "Top tags" in UI (column name preserved for schema compat).
- **`src/db/schema.ts:144`** comment cleaned — was "user-tag: which campaign / agent / persona", now "user-supplied free-text tag (legacy column name; treat as 'tag')".

### Preserved (back-compat)

- npm package name stays `crixin`.
- All CLI subcommands stay under `crixin voice …` / `crixin coder …`.
- MCP entry names in host configs stay `crixin-voice` / `crixin-coder`.
- SQLite schema unchanged (still v4).
- `crixin voice install` still works as a one-half install.

70/70 tests passing. Typecheck clean.

## [0.4.0] — 2026-05-12

**The cut.** One product, two capability modules, dropped the hosted-SaaS arm.

Three competing stories were splitting focus: an AI voice teams platform, an AI call assistant, and the MCP toolkit. Only one was structurally differentiated. The other two pulled us into telecom-SaaS territory where Telnyx / Vapi / Bland have more carriers, more money, and more sales motion. So we cut.

| Removed | Why |
|---|---|
| **Crixin Call Teams** (hosted SaaS arm) | Hosted-platform expectations — SLAs, telecom support, enterprise onboarding, multi-tenant admin — was eating velocity for "maybe revenue" that diluted the core narrative. |
| **`/api/teams-waitlist.ts`** | No more waitlist endpoint. Application form + Firestore write + Resend confirmation all removed. |
| **Waitlist modal in `/voice/pricing`** | The 200-line form-and-modal block in pricing.html is gone. Pricing is now self-serve. |
| **Starter ($59) / Pro ($99) / Business ($199) hosted tiers** | Collapsed to two tiers: Free (open-source) and Pro ($5/mo for hosted Wrapped + cross-machine memory sync). |

### Reframed

Positioning compresses to one sticky sentence:

> **Crixin — give your AI a phone and a memory.**

The marketing site is now built around it. The two MCPs (Voice + Coder) are no longer parallel products with separate brands — they are capability modules of one MCP toolkit, sharing one install, one SQLite, one pricing page, one nav.

### Added

- **`crixin install`** is now an umbrella installer that wires both Voice MCP + Coder MCP into every supported AI host in one shot. Escape hatches preserved: `crixin voice install` and `crixin coder install` still work for one-half installs.
- Hero on every top-level page: "Give your AI a phone and a memory."
- Homepage "Two MCPs. One toolkit." section replaces the prior "One engine. Three jobs." pillars (receptionist / sales team / confirmation line).
- README rewritten — leads with the MCP-toolkit pitch, documents both halves side-by-side, single per-host install block covers both entries.

### Changed

- Every page brand-mark now reads `v0.4.0` (sub-pages: `v0.4.0 · voice mcp` or `v0.4.0 · coder mcp`).
- Top-nav across all pages standardized: **Voice MCP · Coder MCP · Wrapped · Install · Docs · Pricing · GitHub**. Killed the legacy "Assistant" label.
- `package.json` description rewritten to the MCP-toolkit pitch.
- Homepage JSON-LD — alternateName "Crixin Call Assistant" → "Crixin MCP Toolkit", offers reduced to Free + Pro $5/mo.
- `voice/pricing` collapsed from 4 tiers to 2 (Free + Pro $5/mo).
- All marketing-surface mentions of "Crixin Call Assistant" → "Voice MCP" or "the Crixin MCP toolkit" depending on context.
- The "Why this is open" section on `/voice` now explains the cut honestly: hosted SaaS was a trap, MCP-first is the moat.

### Preserved (for back-compat)

- npm package name stays `crixin`.
- All CLI subcommands stay under `crixin voice …` and `crixin coder …`.
- MCP entry names in host configs stay `crixin-voice` and `crixin-coder` — existing wirings keep working.
- URL paths under `/voice/*` and `/coder` unchanged — SEO and bookmarks survive.
- Both Wrapped engines, both Archetype engines, all 11 archetypes, all 6 Voice MCP tools, all 4 Coder MCP tools — all unchanged.

70/70 tests still passing.

## [0.3.0] — 2026-05-11

**Rename + Call Teams waitlist.** The two product surfaces now have clearer public names:

| Old | New |
|---|---|
| Crixin Voice | **Crixin Call Assistant** |
| Crixin Team (hosted tier) | **Crixin Call Teams** |

The CLI, npm package, and MCP entry names are unchanged — `crixin voice install`, `crixin voice call`, etc. still work for back-compat. Only the marketing surface flipped.

### Added

- **Structured Call Teams waitlist.** `/voice/pricing` now opens an in-page modal form with the fields needed to vet applicants for legal use: company, primary use case (B2B / B2C / receptionist / appointments / callbacks / other), monthly call volume, country focus, TCPA / consent posture. Replaces the three mailto links.
- **`api/teams-waitlist.ts`** — POST endpoint. Validates, rate-limits (5/IP/15min), writes to Firestore `crixin_teams_waitlist/<auto-id>`, sends a themed Resend confirmation to the applicant, fires a founder notification to `RESEND_NOTIFY_TO` with the reply-to set to the applicant's email.
- **Hero eyebrow + receipt canvas version stamps** bumped to v0.3.0.

### Changed

- All `/voice/*` page brand-marks now read `v0.3.0 · assistant`.
- Top-nav label across pages: "Voice" → "Assistant" (link target unchanged — still `/voice`).
- `/voice/pricing` hero copy now explicitly names "Crixin Call Assistant" and "Crixin Call Teams" so the product split is legible at a glance.

### Preserved (for back-compat)

- npm package name stays `crixin`.
- All CLI subcommands stay under `crixin voice ...`.
- MCP entry names in host configs stay `crixin-voice` (Call Assistant MCP) and `crixin-coder` (Coder MCP).
- URL paths under `/voice/*` unchanged — protects SEO + any saved bookmarks.

70/70 tests still passing.

## [0.2.0] — 2026-05-10

**Coder is back.** v0.1.0 retired the AI-coding-session analyzer to make the
voice product the front door. Tonight we realized the session analyzer was
solving a unique pain — *being known by your AI* — that nothing else delivers.
v0.2.0 brings it back as a sibling product alongside voice, both shipping in
the same npm package under namespaced subcommands.

### What's now in `crixin@0.2.0`

Two products, one CLI, one local SQLite, one shared brand:

- `crixin voice …` — MCP + CLI for AI agents to make real phone calls
  (unchanged from v0.1.0, except top-level help now reflects the new dual-product layout).
- `crixin coder …` — observability for your AI coding sessions
  (Claude Code, Codex CLI, Cursor JSONLs → Wrapped, Archetype, Skipped, Search, …).

### `crixin coder` subcommands

Restored from the v0.0.9 surface, namespaced under `coder`:

| Command | What it does |
|---|---|
| `crixin coder install` | Wire the sessions MCP into Claude Desktop / Claude Code / Cursor (entry name `crixin-coder`, separate from the voice MCP). |
| `crixin coder ingest` | Re-scan `~/.claude/projects/`, `~/.codex/sessions/`, Cursor's app data → local SQLite. |
| `crixin coder dashboard` | Ingest + start the in-product 127.0.0.1 dashboard (the original v0.0.x experience). |
| `crixin coder mcp` | Run as the sessions MCP server (stdio). |
| `crixin coder search <query>` | Sub-second deep search across every ingested message. |
| `crixin coder export <id>` | Dump a session as Markdown. |
| `crixin coder wrapped [--year N]` | Annual recap (HTML) — your year of AI coding, in receipts. |
| `crixin coder archetype [me\|tool]` | Cowboy / Architect / Debugger / Tinkerer / … |
| `crixin coder skipped` | Phrases your coding AI uses to skip work ("pre-existing", "out of scope", …). |
| `crixin coder forecast` | Cost forecast — Free: YTD; Pro: + projections. |
| `crixin coder digest [--days 7]` | 7-day deterministic digest. |
| `crixin coder report (Pro)` | DORA/SPACE-aligned report. |
| `crixin coder models` / `prompts` / `projects` / `compare` / `tag` / `pin` / `alert` / `share` / `verify` | Full v0.0.9 surface restored. |

### Restored

`src/ingesters/{claude-code,codex,cursor,index,types}.ts`,
`src/wrapped/{archetype,render,tool-archetype}.ts`,
`src/mcp/server.ts` (sessions MCP server),
`src/server/{index,views}.ts` (in-product dashboard),
`src/pricing/{anthropic-counter,index,tokenizer}.ts`,
`src/db/queries.ts`, `src/lib/{browser,port,paths}.ts`,
all 16 session-side `src/cli/*.ts` files, plus all session-side tests
(`test/wrapped/`, `test/ingesters/`, `test/db/`, `test/fixtures/`,
`test/license-gate.test.ts`, `test/pricing.test.ts`).

### Added

`src/coder/cli.ts` — the `crixin coder` sub-router (mirrors `src/voice/cli.ts`).
`src/coder/install.ts` — coder MCP wiring (entry name `crixin-coder`,
launch command `npx -y crixin coder mcp`).

### Restored deps

`hono` and `@hono/node-server` (dashboard server), `js-tiktoken` (BPE token
counts for cost estimation), `open` (browser launcher for `crixin coder dashboard`).

### Top-level command behavior

- `crixin` (no args) — prints a two-product quickstart with live counts
  from both `voice_calls` and `sessions` tables.
- `crixin install`, `crixin --mcp`, `crixin ingest` — still alias to voice
  (v0.1.0 muscle memory preserved).
- `crixin coder install`, `crixin coder mcp`, `crixin coder ingest` — explicit
  coder paths.

### Migration from v0.1.x

Just `npm install -g crixin@0.2.0`. The DB schema is unchanged from v4
(both `voice_calls` and `sessions` tables already coexist). If you were
on v0.0.9 and skipped v0.1.x: also unchanged — your existing v3 SQLite
upgrades to v4 cleanly the first time `crixin coder ingest` runs.

70/70 tests passing (same suite as v0.0.9, plus the v0.1.0 voice tests).
Tarball: ~135 KB.

## [0.1.0] — 2026-05-10

**The pivot.** Crixin is now an MCP server, CLI, and local analytics for AI-placed phone calls. The session-analyzer surface (Claude Code / Codex CLI / Cursor JSONL ingestion + the dashboard + every coding-session CLI command) has been retired. Same engines, new corpus.

### What `crixin` is now

- **MCP server** exposing `make_call`, `send_sms`, `transcribe_call`, `get_call`, `list_calls`, `list_recordings` to Claude Code, Cursor, Codex CLI, and Claude Desktop.
- **CLI** for one-off calls, SMS, MCP wiring, and call ingest.
- **Local analytics** — Voice Wrapped, Caller Archetype, Ducked-phrase scanning, all running against your own SQLite mirror of your Twilio data.

### New CLI surface

- `crixin voice install` — wire the voice MCP into Claude Desktop / Claude Code / Cursor (atomic, idempotent, with `--project` / `--only=` / `--print` / `--uninstall`).
- `crixin voice doctor` — live-probe Twilio with a single GET `/Accounts/{sid}.json`. Catches stale `TWILIO_AUTH_TOKEN` (error 20003) before you try to dial a customer. Friendly error messages for all common Twilio failure codes.
- `crixin voice mcp` — run as the stdio MCP server (used by AI hosts via npx).
- `crixin voice call <to> [prompt]` — place a one-off call from the CLI.
- `crixin voice sms <to> <body>` — send an SMS through your Twilio number.
- `crixin voice ingest [--days N] [--no-transcribe]` — pull recent Twilio Calls + Recordings + (optional) Deepgram transcripts into local SQLite.
- `crixin voice wrapped [--year N]` — annual recap (HTML) — your AI sales team by the numbers.
- `crixin voice archetype` — caller archetype classifier (Quick Pitcher / Patient Listener / Ducker / Hard Closer / Discovery Caller / Voicemail Whisperer / Lead Burner / Steady Operator).
- `crixin voice ducked [--limit N]` — phrases your AI uses to dodge questions on calls. Pattern-based, deterministic.

Top-level aliases for muscle memory: `crixin install` → `crixin voice install`, `crixin --mcp` → `crixin voice mcp`, `crixin ingest` → `crixin voice ingest`.

### New schema (v4)

- `voice_calls` table — one row per Twilio Call SID, with `from_number`, `to_number`, `status`, `duration_seconds`, `price_cents`, joined `transcript_text` + `transcript_language`, plus `campaign` and `outcome` user-tags.
- `voice_recordings` table — per-recording details with `media_url` and `transcript_text` (when transcribed).
- v3 sessions/messages/tool_uses tables remain in place for users with legacy data; new tables are CREATE TABLE IF NOT EXISTS so existing v3 DBs migrate cleanly.

### Deleted

- The session-analyzer ingesters: `src/ingesters/{claude-code,codex,cursor,index,types}.ts`.
- The session-analyzer CLI commands: `wrapped`, `archetype`, `skipped`, `verify`, `prompts`, `projects`, `models`, `compare`, `forecast`, `digest`, `report`, `search`, `export`, `tag`, `pin`, `alert`, `share` (top-level versions). Voice-flavored replacements live under `crixin voice`.
- The session-analyzer dashboard server (`src/server/`) and the per-session MCP server (`src/mcp/`).
- The pricing/tokenizer module (`src/pricing/`) — token counting was a session-analyzer concern.
- Per-host marketing pages (`/claude`, `/codex`, `/cursor`, `/compare`).

### Marketing site

- New homepage built around three use cases: AI receptionist (inbound), AI sales team (outbound), AI confirmation line (transactional). The 3D receipt now mixes outcomes across all three (orders, meetings, reservations) with a sales-pitch line at the bottom.
- `/wrapped` and `/archetype` rewritten for Voice Wrapped + Caller Archetype.
- `/install` rewritten for the `npm i -g crixin && crixin voice install` flow.
- `/faq` rewritten with honest answers about what does + doesn't leave your laptop.

### Friendlier Twilio errors

- `TwilioApiError` now parses the Twilio response body and surfaces the most common failure modes with actionable next steps:
  - **20003** — auth rejected. "Your TWILIO_AUTH_TOKEN may have been rotated. Re-copy and verify with `crixin voice doctor`."
  - **20404** — resource not found.
  - **21211 / 21214 / 21217** — invalid destination number (E.164 hint).
  - **21606 / 21210** — invalid From number.
  - **21215** — geo-permissions blocked. Direct link to the console.
  - 401/403 fallback with the doctor hint.

### Migration from v0.0.x

- Pin to `crixin@0.0.9` in `package.json` if you depend on the session-analyzer flow. v0.1.0 has no path back to JSONL ingestion.
- Existing v3 SQLite DBs at `~/.crixin/crixin.db` are *not* wiped — the v4 migration only adds tables alongside the v3 schema. Your old session data stays readable via direct SQL if you want it.

## [0.0.9] — 2026-05-07

### Dashboard

- **Models tab** is no longer a no-op. Click it and the 7-stat overview swaps for a 2×2 grid of your top 4 models, each card showing model name, total spend, sessions, and message count. Tab swap is instant — hero data is cached after the first /api/hero round-trip.
- Animations preserved: stat cards still spring-pop in, heatmap still ripple-renders.

### CLI

- `crixin install --uninstall` — removes the Crixin MCP entry from Claude Desktop, Claude Code, and Cursor configs. Atomic temp+rename writes (same safety as install). Idempotent: re-running on an already-clean target is a no-op.
- Combined with `--project` and `--print`: `crixin install --uninstall --project --print` previews removing from `./.mcp.json`.

### Marketing site (also live, deployed separately)

- All 8 secondary pages (/install, /wrapped, /archetype, /compare, /faq, /claude, /codex, /cursor) refreshed to match the homepage: dissolved scroll-aware header, full-page pulsing-ember canvas via shared `web/site.js`, italic-amber serif brand-mark, single amber accent palette, hidden scrollbars.
- 3D receipt is now scroll-driven — receipt rotates, recedes, and fades as you scroll past the hero. Camera zooms out with you, stars drift, glow dims.
- Sitemap rewritten to clean URLs only (was emitting `.html` paths that 308-redirect, which Google flagged as "Page with redirect"). Added missing canonical tags on `/claude`, `/codex`, `/cursor`.

## [0.0.8] — 2026-05-06

The "dashboard right pane is no longer empty" release. Editorial design pass.

### What's up next, *<user>*.

The default right-pane state — previously a "Select a session" empty-state — is now a hero block with the seven things you actually want at a glance: current streak (featured), sessions, total tokens, active days, longest streak, peak hour, favorite model. Plus a 26-week activity heatmap in brand amber.

- New `/api/hero` endpoint backed by `queries.heroSummary` — single round-trip, computes streaks, peak hour, favorite model, and 182-day session histogram.
- All/30d/7d range filter (re-fetches with `?days=`).
- Overview / Models tabs (Models tab is a placeholder for v0.0.9).

### Design pass

- Typography: swap to Geist Sans + Instrument Serif. Numbers are tabular; the headline and big values are in italic Instrument Serif.
- Single accent: drop the secondary blue, unify on amber across heatmap + hover states.
- Scrollbars hidden globally (scrolling still works), film-grain SVG overlay for texture, subtle radial-gradient ambient glow in the page background.
- Session rows simplified to a single line — `[badge] project · N msgs · time-ago`. Full path + ID move to a hover tooltip. Whole row presses on click.

## [0.0.7] — 2026-05-05

The "every AI host knows about Crixin in one command" release.

### `crixin install`

New CLI subcommand that writes the Crixin MCP server entry into every AI coding host config we know about, in one shot. After `npm i -g crixin && crixin install`, Claude Desktop, Claude Code (`~/.claude.json`), and Cursor (`~/.cursor/mcp.json`) all see Crixin as a tool — no per-host wizardry. Idempotent (re-run safe), atomic writes (temp + rename so a crash mid-write can't corrupt your `~/.claude.json`), supports `--project` for repo-scoped `.mcp.json` and `--print` for a dry run.

### Webhook hardening

- **Idempotency** on `/api/stripe-webhook` keyed on `event.id`: a duplicate Stripe delivery now short-circuits with `{idempotent: true}` instead of sending a second trial-started email or minting a fresh license JWT.
- **Rate limit** on `/api/checkout`, `/api/portal`, `/api/waitlist` (10 req/min/IP) and `/api/share` (30 req/min/IP). In-memory token bucket on Fluid Compute instances.
- **Surfaced silent errors** in waitlist + webhook side-effects — bare `.catch(() => {})` replaced with logged catches so a Firestore or Resend hiccup is no longer invisible.

### Marketing copy

- README and `/install` now lead with `npm i -g crixin && crixin install`. The bare `crixin` command is now reliable in any terminal — including in unrelated projects where another AI assistant reaches for it.

## [0.0.6] — 2026-05-05

The "your AI's behavior, measured" release. Two new commands surface a category of question Crixin had no answer for: **what does the LLM do, repeatedly?**

### F15 — `crixin skipped`

- Detects assistant messages that contain skip phrases ("pre-existing", "out of scope", "won't fix", "not related to this", "leaving as is", 19 phrases total).
- Output: per-source skip rate, top 25 projects by skip count, the actual recent skip lines with the matched phrase highlighted + a copy-paste session id.
- Free tier. SQL uses a CTE to compute the skip-flag once and reuse it across the by-source / by-project rollups (a node:sqlite quirk: same `?` placeholder can't be bound twice).

### F16 — `crixin archetype` (10 LLM archetypes)

Mirror of the dev archetype but inferred from assistant-message patterns. **9 distinct pattern signals** drive the labeling:

- `skipRate` — "pre-existing" / "out of scope" / "won't fix"
- `apologizeRate` — "you're right" / "I apologize" / "my mistake"
- `hedgeRate` — "I think" / "probably" / "might" / "perhaps"
- `reverseRate` — "actually" / "let me revise" / "wait, that's wrong"
- `optimistRate` — "all set" / "looks good" / "done!" / "complete"
- `debugRate` — Traceback / Error / Exception / stack trace
- `questionRate` — replies ending with "?"
- `codeBlockRate` — replies containing ``` fence
- `replyRatio` — avg assistant length / avg user length

10 archetypes (with thresholds calibrated for **real signal**, not noise — most need ≥3% rate to fire, except Reverser at 1.5% because flip-flops are catastrophic):

| Label | Triggers when |
|---|---|
| **Skipper** | ≥3% skip rate. Audit with `crixin skipped`. |
| **Reverser** | ≥1.5% "actually" / "let me revise". Flip-flops after committing. |
| **Optimist** | ≥4% false-completion phrases. Test before trusting "done!". |
| **Apologizer** | ≥2.5% "you're right" / "my mistake" / "I apologize". |
| **Hedger** | ≥8% uncertainty words. Push for definitive answers. |
| **Stack-Tracer** | ≥10% Traceback / Error content. The model lives in debug mode. |
| **Lecturer** | replies > 4× user length, code-block rate < 10%. Prose-heavy. |
| **Over-Explainer** | replies > 5× user length. Verbose. |
| **Yes-Man** | replies < 0.6× user length, low question rate. |
| **Diligent** | high code-ship rate, no actionable signals firing. The "boring correct" label. |

Tie-break order favors actionable diagnoses (Skipper, Reverser, Optimist) over affirmative ones (Diligent). **Diligent only scores when no actionable signal is firing** — preventing a high code-block rate from masking a real Skipper or Apologizer pattern.

### `crixin archetype` CLI

```sh
crixin archetype          # both: dev + each tool source side-by-side
crixin archetype me       # just the dev archetype (Cowboy/Architect/etc)
crixin archetype tool     # just the LLM archetype(s)
crixin archetype tool --source claude-code   # one source only
```

Output shows the label, a rationale referencing the strongest raw rate, and the full 9-signal grid:

```
You · the developer
  Architect             861.6 messages per session on average …

Your tools
  claude-code     Diligent  (3,527 replies)
    ─ 3.74% of replies ship code; 0.88% skip rate, 0.17% reverse rate. …
    skip:0.88%   apology:1.56%   hedge:2.95%   reverse:0.17%
    optim:1.05%  debug:  0.96%   ques:  9.04%  code:    3.74%
    reply/user: 0.3×  avg reply len: 485 chars
```

### Real data on author's machine (post-v0.0.6 ingest)

```
Claude Code: Diligent (3,527 replies)
Codex:       Yes-Man  (1,684 replies)
27 skip phrases this week across 8 projects
Top offenders: project-a (21 skips), project-b (12)
```

### Tests

- 55/55 pass — added 11 archetype-inference tests including threshold sanity (1.5% does NOT trigger Skipper, 5% does), Diligent-suppression-when-actionable, tie-break order.

### Bug fixes

- `skipStats` rewritten with a CTE so it actually runs against node:sqlite (the previous `.all(...placeholders, ...placeholders)` hit "column index out of range" because node:sqlite refuses to bind the same param twice).

## [0.0.5] — 2026-05-05

The "production-grade" release. Two scaffolded items in v0.0.4 are now real:

### License gate — real Ed25519 verification

- `src/license/jwt.ts` (new) — 60-line offline EdDSA verifier using `node:crypto` (no `jsonwebtoken` dep). Verifies against the public key embedded at `src/license/keys.ts`.
- `api/_lib/license-jwt.ts` (new) — server-side mint, called by the Stripe webhook on `customer.subscription.created`.
- The Stripe webhook now mints a JWT scoped to the Stripe customer id (sub), the user's email, the tier (`pro` / `lifetime`), and an exp 30 days past the current period end (so a missed renewal webhook doesn't leave Pro users offline).
- `api/_lib/email.ts` — the trial-started email now embeds the JWT in a code block with three-line install instructions.
- `crixin license activate <token>` runs the full Ed25519 verification before persisting; bad tokens print a useful error.
- `crixin license status` now prints the user's email + renewal date from the verified JWT claims.

### F14 share — real Vercel upload + serve

- `api/share.ts` (new, POST `/api/share`) — verifies the caller's license JWT, validates the body (token/scope/year/html), persists to Firestore at `crixin_shares/<token>` with the owner sub, expires_at, and revoked flag.
- `api/share/[token].ts` (new, GET `/api/share/:token`) — serves the stored HTML directly with `Content-Type: text/html` and a 5-minute CDN cache. 404s on revoked or expired tokens.
- `crixin share` now builds the Wrapped HTML locally, POSTs it to crixin.com, and prints the live shareable URL. The local copy is also written to disk so the user can audit what was uploaded.
- Always-anonymized: `crixin share` ignores `--no-anonymize` for safety; project paths are stripped before upload.

### Verified live

```
POST /api/share without auth      → HTTP 401 {"error":"missing license token"}
GET  /api/share/<short-id>        → HTTP 400  (token shape validation)
GET  /api/share/<not-found-id>    → HTTP 404  ("This share link is gone")
```

### Vercel env vars added

- `LICENSE_PRIV_KEY_B64` — raw 32-byte Ed25519 private key (encrypted).
- `LICENSE_PUBLIC_KEY_RAW_B64` — same public key embedded in the npm package, mirrored on Vercel for the share-upload verifier.

### Tests

- 43/43 pass — added 5 license-gate tests including a forged-signature-rejection test that proves the verifier won't accept tokens signed by a key other than ours.

## [0.0.4] — 2026-05-05

The "fully fledged" release. 14 features ship across Free + Pro, with a license gate so the same binary serves both tiers.

### Added — feature matrix

| # | Command | Tier | Notes |
|---|---------|------|-------|
| F1 | `crixin forecast` | Free YTD · Pro projections | YTD spend (Free) · 30/90 day burn + month-end + year-end projections + per-project breakdown (Pro) |
| F2 | `crixin models` | Free top 3 · Pro drill-down | model · share % (Free) · + cost · session count · message count for top 20 (Pro) |
| F3 | `crixin ingest --include-subagents` | Free | Walks `subagents/` dirs and attributes to parent session via `parent_session_id` column |
| F4 | dashboard source / project / tag filter | Free | New `?source=`, `?project=`, `?tag=` query params on `/api/sessions` |
| F5 | `crixin doctor` | Free | Health check: Node version, BPE tokenizer, DB schema version, ingest snapshot, source files per ingester, license tier |
| F6 | `crixin prompts` | Free top 3 · Pro top 200 + filter + JSON | Top user prompts by length within 80–2000 char range |
| F7 | `crixin digest` | Free deterministic · Pro + AI paragraph (BYOK) | Deterministic 7-day summary always works; if `ANTHROPIC_API_KEY` is set + Pro license, also generates an AI paragraph via Sonnet 4.6 |
| F8 | `crixin tag/pin/unpin` | Free 5 tags max · Pro unlimited | Tags + colors + per-session attach/detach + pin-to-top |
| F9 | `crixin alert add/list/rm/check` | Pro | Daily / weekly / monthly cost thresholds (per-project optional) → macOS notifications via osascript |
| F10 | `crixin verify <id>` | Free, BYOK | Calls Anthropic `/v1/messages/count_tokens` with the user's `ANTHROPIC_API_KEY` to spot-check our local count vs ground truth |
| F11 | `crixin report` | Pro | DORA/SPACE-aligned proxies: Activity (sessions/day, projects), Performance ($/Ktok), Efficiency (avg duration), Flow (longest contiguous block). Outputs term + HTML for hand-off. |
| F12 | `crixin projects` | Pro | Side-by-side: cost / sessions / msgs / tokens / avg duration per project, ordered by cost desc |
| F13 | `crixin compare <a> <b>` | Free | Two-session diff |
| F14 | `crixin share / share list / share revoke` | Pro | Generates an Ed25519-tokenized share record locally; v0.0.5 will add the Vercel `/api/share` upload endpoint |

### License gate

- `src/license/features.ts` adds `isPro()` + `gate(free, pro)` helpers, used by every Pro-gated command.
- License file at `~/.crixin/license.json` (existing path); permissive verification in v0.0.4 — any non-empty token + non-expired `expiresAt` is accepted. v0.0.5 plugs in real Ed25519 verification once Stripe webhooks emit signed JWTs.
- Env override: `CRIXIN_PRO=1` for testing/dev. Cached for 30s to keep `gate()` cheap inside hot loops.
- `PRO_BADGE` and `PRO_UPGRADE_HINT` strings standardize the upgrade messaging.

### Schema migration (v2 → v3)

- New columns: `sessions.parent_session_id` (sub-agent attribution), `sessions.pinned`.
- New tables: `tags`, `session_tags`, `alerts`, `share_tokens`.
- Migration runs `ALTER TABLE` before re-applying SCHEMA so the `CREATE INDEX` statements that reference new columns succeed on existing v2 DBs.
- After migration, `DELETE FROM sessions` forces re-ingest under v0.0.3's cache-aware pricing.

### Tests

- 42/42 pass — added 4 license-gate tests + 7 v0.0.4 query tests (forecast, topModels, byProject, compareSessions, topPrompts, tags CRUD, productivity report).

### Real-data smoke (author's machine, post-migration)

- 87 sessions across 3 sources (claude-code: 55, codex: 30, cursor: 2), 17,500+ messages
- YTD API-equivalent: $1,840.52 · 30-day burn: $1,638.38 · projected year-end: $15,002
- Top model: claude-opus-4-7 at 38.0% (2,093 messages, $1,437.77)
- Top project: example-project at $891.79

## [0.0.3] — 2026-05-04

### Changed — cost accounting is now authoritative for Claude Code

The dashboard's cost number was previously a `js-tiktoken` estimate against pay-as-you-go API list prices. Two problems:

1. Most Crixin users are on **flat-rate subscriptions** (Claude Pro / Claude Max / Codex CLI Plus / Cursor Pro), not pay-as-you-go API. The marginal cost of any one session for them is $0; they pay a monthly subscription.
2. Claude Code's JSONL files **already contain Anthropic's authoritative `usage` blocks** for every assistant message — `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`. We were estimating when the data was sitting right there.

Both fixed:

- The Claude Code ingester now extracts `message.usage` per line and applies Anthropic's **cache-aware pricing** (cache reads at 10% of input rate, cache creation at 125% of input rate). The cost figure is now the API-equivalent dollar amount Anthropic would have charged for that exact usage.
- The dashboard label changes from "EST. SPEND" to "API-EQUIVALENT" with a footer note: *"API-equivalent shown — your subscription bills flat-rate."*
- The per-session moments card label changes from "est. cost" to "api-equiv".
- Codex CLI and Cursor sources still use the tokenizer-estimate path (they don't expose API usage); the dashboard treats them identically.

### Migration

`SCHEMA_VERSION` bumped to `2`. On launch, an existing v1 DB at `~/.crixin/crixin.db` has its `sessions` table cleared (cascades to `messages`, `tool_uses`). The next ingest pass repopulates with cache-aware values. Source files on disk are never touched.

### Numbers from the author's machine before/after

| | Before (v0.0.2 estimate) | After (v0.0.3 authoritative) |
|---|---|---|
| Total tokens | 5.45 M | **601.64 M** |
| API-equivalent cost | $26.90 | **$1,710.87** |
| Sessions | 92 | 92 |

The 100× difference is real: Anthropic counts every token sent per turn (full prior conversation + cached context + tool defs), so a 30-turn session bills the same context up to 30 times. Cache reads bring that down to 10%, but the absolute number still dwarfs a naive char-count.

For subscription users this reframes the dashboard from *"how much did I spend"* to *"what would I pay without my subscription"* — which is the more useful question.

### Notes
- Codex CLI may also expose authoritative tokens in its rollout files; v0.0.4 will check.
- The estimate path (Codex/Cursor and any pre-modern Claude Code line without a `usage` block) is unchanged.

## [0.0.2] — 2026-05-03

### Changed
- README polish for the npm registry page: badges (version, downloads, license, Node), inline install table, condensed structure, copy-paste install commands per host (Cursor / Claude Code / Codex CLI).
- `package.json` description tightened to mention all three sources by name and the MCP role.

### Docs
- New `/install` route on `crixin.com` with detailed per-host instructions, troubleshooting, and the Cursor deep-link installer.

No code changes from `0.0.1`. The runtime behavior, CLI surface, and MCP tool list are identical.

## [0.0.1] — 2026-05-02

### Added
- First public release.
- Multi-source ingester: Claude Code (`~/.claude/projects/*.jsonl`), OpenAI Codex CLI (`~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl`), and Cursor (`state.vscdb` → `cursorDiskKV` → `composerData:<uuid>`). Idempotent re-ingest by `(source_path, mtime, size)` fingerprint.
- Local SQLite database via `node:sqlite` (zero native deps; Node ≥22).
- Browser dashboard (Hono + server-rendered HTML, dark Tokyo-Night palette) with bucketed session list, per-session moments, traffic-light terminal-style resume command, search.
- Real BPE token counting via `js-tiktoken` (`o200k_base` for GPT-5 family + Claude 4.x; `cl100k_base` for older Claude 3.x). Cost estimation in cents stored per session.
- Annual `crixin wrapped` HTML export — archetype reveal (Cowboy / Architect / Debugger / Tinkerer / Prompter-First), hour-of-day heatmap, day-of-week strip, month-by-month bars, top projects, source breakdown. PII-stripped by default.
- MCP server (`crixin --mcp`) over stdio with four tools: `search_sessions`, `list_recent_sessions`, `get_session`, `stats`. Compatible with Claude Code (`~/.claude/mcp.json`) and Codex CLI (`~/.codex/config.toml`).
- 30 tests (Node's built-in `node:test` runner): tokenizer, archetype inference, ingester behavior across all three sources (synthetic Cursor `.vscdb` fixture), aggregates, idempotency.

### Notes
- v0.0.1 is a CLI/library release. The Pro tier (license enforcement, premium dashboard packs) is documented but not yet gated; everything is functionally free until v0.0.3.
- First-run ingest of a 17,000-message corpus takes ~80s due to BPE tokenization. Subsequent runs are <1s thanks to the mtime cache.
- Cursor message extraction is best-effort across three observed shapes (`conversation` array, `conversationMap` object, `fullConversationHeadersOnly` headers). Power-user feedback wanted.
