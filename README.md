# crixin

**The MCP toolkit for AI agents.** Two MCPs in one npm package, sharing one local SQLite, installing into the same MCP-aware hosts you already use.

- **Voice MCP** — give your AI a phone line. Real outbound calls + SMS + transcription through your own Twilio.
- **Coder MCP** — give your AI a memory. Reads back every Claude Code, Codex CLI, and Cursor session you've ever had.

[![npm version](https://img.shields.io/npm/v/crixin.svg?style=flat&color=f5b452&labelColor=0b0d12)](https://www.npmjs.com/package/crixin)
[![npm downloads](https://img.shields.io/npm/dm/crixin.svg?style=flat&color=7aa2f7&labelColor=0b0d12)](https://www.npmjs.com/package/crixin)
[![license](https://img.shields.io/npm/l/crixin.svg?style=flat&color=7bd88f&labelColor=0b0d12)](LICENSE)
[![node](https://img.shields.io/node/v/crixin.svg?style=flat&color=e0af68&labelColor=0b0d12)](https://nodejs.org)

![crixin — give your AI a phone and a memory. Local-first MCP toolkit.](https://crixin.com/og-image.png)

> Local-first. Bring your own Twilio. Bring your own LLM. No SaaS in the middle.

## Install

```sh
npm i -g crixin
crixin install                # writes BOTH MCPs (voice + coder) into Claude Desktop, Claude Code, Cursor, Codex CLI
```

Escape hatches if you want one half only:

```sh
crixin voice install          # only the phone half
crixin coder install          # only the memory half
```

For Voice MCP, set Twilio creds in the env your AI host launches from:

```sh
export TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export TWILIO_AUTH_TOKEN=your_auth_token
export TWILIO_PHONE_NUMBER=+15555550100
export DEEPGRAM_API_KEY=...   # optional — needed for Voice Wrapped + Caller Archetype
```

### Platform mode (no Twilio account needed)

Don't want to bring your own Twilio? Grab an API key from the Crixin dashboard and set it instead — all six voice tools route through Crixin's hosted platform:

```sh
CRIXIN_API_KEY=crx_live_... npx -y crixin voice mcp
```

No `TWILIO_*` vars, no `DEEPGRAM_API_KEY` (transcription runs server-side). `CRIXIN_API_BASE` overrides the API origin if you need to. The geo-gate still runs locally — strict-consent destinations (US/UK/EU/AU) require `consented: true` either way.

Verify before you dial:

```sh
crixin voice doctor           # BYO: one GET against Twilio. Platform mode: checks your key + minute quota. No charges.
```

For Coder MCP, ingest your AI coding history:

```sh
crixin coder ingest           # pulls Claude Code, Codex CLI, Cursor sessions → ~/.crixin/crixin.db
```

### Remote MCP (nothing to install)

The same six voice tools are served over Streamable HTTP by the hosted platform. Point any MCP host at the endpoint with your `crx_live_…` key:

```bash
claude mcp add --transport http crixin-voice https://crixin-platform.vercel.app/api/mcp \
  --header "Authorization: Bearer crx_live_..."
```

Cursor / VS Code: add an HTTP MCP server with the same URL and `Authorization` header. ChatGPT: Settings → Connectors → Developer mode → add the URL. The endpoint is stateless (POST only); tool names, arguments and results are identical to the local server.

## What each MCP exposes

### Voice MCP — `crixin-voice`

| Tool | What it does |
|---|---|
| `make_call` | Outbound voice call. `to` + `prompt` (assistant speaks it; recipient response recorded), or raw TwiML. |
| `get_call` | Status / duration / price / timestamps for one Call SID. |
| `list_calls` | Recent calls — filter by `to` / `from` / `status` / `start_time_after`. |
| `list_recordings` | Recordings + auth-protected media URLs for a Call SID. |
| `transcribe_call` | Run a recording through Deepgram. 30+ languages including Arabic. |
| `send_sms` | SMS / MMS through Twilio. Messaging Service support. |

### Coder MCP — `crixin-coder`

| Tool | What it does |
|---|---|
| `search_sessions` | Full-text search across every ingested Claude Code / Codex / Cursor session. |
| `list_recent_sessions` | Newest sessions first, with project + token counts. |
| `get_session` | Pull a full session transcript by ID. |
| `stats` | Aggregate counts across the local SQLite store. |

## Everyday commands

```sh
# Voice MCP
crixin voice doctor                # live-probe Twilio (no charges)
crixin voice call <to> [prompt]    # one-off call from the CLI
crixin voice sms  <to> <body>      # one-off SMS
crixin voice ingest                # pull recent Twilio calls + Deepgram transcripts → local SQLite
crixin voice wrapped --year 2026   # annual recap (HTML) — heatmaps, archetype, top destinations
crixin voice archetype             # caller archetype reveal (Quick Pitcher / Patient Listener / …)
crixin voice mcp                   # run as a stdio MCP server (used by AI hosts via npx)

# Coder MCP
crixin coder ingest                # ingest AI coding sessions → ~/.crixin/crixin.db
crixin coder search <query>        # CLI search across sessions
crixin coder dashboard             # local Hono dashboard on 127.0.0.1
crixin coder wrapped --year 2026   # annual recap (HTML) — top projects, monthly bars, archetype
crixin coder archetype             # 11 archetypes — 5 for you, 6 for your AI
crixin coder mcp                   # run as a stdio MCP server (used by AI hosts via npx)

# Sync (Pro) — one account, every machine, same session list
crixin sync status                 # device + link state + queue counts (works on Free)
crixin sync link                   # opens browser to approve this device
crixin sync push                   # send metadata to the server (manual, foreground)
crixin sync pull                   # fetch peer metadata into the local inbox
crixin sync inbox                  # latest pulled records from your other machines
```

> **Metadata only.** Sync v1 shares the session index across your machines — never message bodies, transcripts, credentials, phone numbers, or free-text tags. Your code never leaves your disk.

## Per-host install (manual)

```sh
# Claude Code
claude mcp add crixin-voice -- npx -y crixin voice mcp
claude mcp add crixin-coder -- npx -y crixin coder mcp

# Cursor — append to ~/.cursor/mcp.json
{
  "mcpServers": {
    "crixin-voice": { "command": "npx", "args": ["-y","crixin","voice","mcp"] },
    "crixin-coder": { "command": "npx", "args": ["-y","crixin","coder","mcp"] }
  }
}

# Codex CLI — append to ~/.codex/config.toml
[mcp_servers.crixin-voice]
command = "npx"
args = ["-y","crixin","voice","mcp"]

[mcp_servers.crixin-coder]
command = "npx"
args = ["-y","crixin","coder","mcp"]
```

Or just run `crixin install` and let it wire everything for you.

## Wrapped (the year-end receipt)

Both halves emit a self-contained HTML report.

```sh
crixin voice wrapped               # → ./crixin-voice-wrapped-2026.html
crixin coder wrapped               # → ./crixin-coder-wrapped-2026.html
```

Hour-of-day heatmaps, monthly bars, archetype reveal (Patient Listener / Hard Closer / Ducker / Cowboy / Architect / …), top destinations or top projects, top languages or top models. PII-stripped. Shareable as a screenshot. No upload.

## Stack

- **STT**: Deepgram Nova-2 (optional — `DEEPGRAM_API_KEY`).
- **TTS**: Twilio Polly + Google neural voices via TwiML `<Say>`. (Polly.Joanna-Neural for en-US, Polly.Hala-Neural for ar-EG, Polly.Lucia-Neural for es-ES, etc.)
- **LLM**: none in the open-source call path — your AI host decides what to say. Pro tier can plug in hosted Wrapped + memory sync.
- **Storage**: local SQLite at `~/.crixin/crixin.db`. Tables: `voice_calls`, `voice_recordings`, `sessions`, `messages`.

## Pricing

| Tier | Price | What you get |
|---|---|---|
| **Open Source** | Free forever | Both MCPs, all tools, all Wrapped, all archetypes. MIT-licensed. Bring your own Twilio. |
| **Crixin Unlimited** | $9.99/mo | Hosted calling with no Twilio account: unlimited calls, one monthly fee. Premium voice for the first 60 minutes each month, then standard, then basic — the call always gets made. One call at a time per account. Platform mode (`CRIXIN_API_KEY`) and the remote MCP run on this plan. |

Existing Coder Pro ($5/mo: hosted Wrapped + `crixin sync`) keeps working and is being folded into Unlimited.

[See full pricing](https://crixin-platform.vercel.app/pricing).

## Privacy posture

- Zero servers between you and Twilio. Calls hit `api.twilio.com` directly with your auth header.
- Coder MCP reads JSONLs your AI host already wrote to your disk. Nothing leaves your machine.

## Privacy Policy

Full policy: <https://crixin.com/legal/privacy> (effective June 17, 2026). In short:

- **Local mode (BYO Twilio):** this package collects nothing. Calls go straight to Twilio with your credentials; call history and transcripts live in `~/.crixin/crixin.db` on your machine. Your AI host sees tool results the same way it sees any other tool.
- **Hosted mode (`CRIXIN_API_KEY` or the remote MCP):** the Crixin platform stores call metadata (numbers, timestamps, duration, status), recordings and transcripts you request, and usage counters for billing. Calls are carried by Twilio; transcription runs on Deepgram; hosted voice calls use OpenAI, Deepgram and ElevenLabs models. We do not sell data.
- **Retention:** account data while the account is active, deleted within 30 days of account deletion; recordings and transcripts deleted with the account; payment records as required by law.
- **Contact:** privacy@crixin.com (privacy requests) · help@crixin.com (support).
- Transcripts and call recordings stay in your Twilio account and your local SQLite.
- No telemetry. No upload. No analytics pixels.

## Geo-gate (Voice MCP)

Outbound calls to strict-consent jurisdictions (US, Canada, UK, IE, FR, ES, IT, NL, AU, NZ) require an explicit `--consented` flag or `consented: true` in the MCP tool args. Permissive jurisdictions (Egypt, UAE, KSA, Jordan, Kuwait, Qatar, Bahrain, Oman, Lebanon, Nigeria, ZA) dial without the flag. Germany is blocked outright. Override with `CRIXIN_VOICE_ALLOWED_CC`.

## Docs

[Install](https://crixin.com/install) · [Voice MCP](https://crixin.com/voice) · [Coder MCP](https://crixin.com/coder) · [Wrapped](https://crixin.com/wrapped) · [Archetype](https://crixin.com/archetype) · [Pricing](https://crixin.com/voice/pricing) · [FAQ](https://crixin.com/faq)

## License

MIT. Built by [@Mrdopplereffekt](https://github.com/Mrdopplereffekt).
