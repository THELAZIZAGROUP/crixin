# Product Overview

## What Crixin is

A single-binary CLI / `npx` command that turns your local AI-coding session history into a searchable, navigable dashboard. The dashboard runs on your laptop, opens in your browser, and never sends your data anywhere.

## Who it's for

**Primary:** Solo devs and indie hackers who use Claude Code, Cursor, or Codex daily and have accumulated multiple GB of session history in `~/.claude/projects/` (or equivalent). They want to:

- Find a past session by topic ("the auth refactor I did last month")
- See patterns in how they actually use AI ("I ask the same kind of question 11 times a week")
- Get cost / token analyses across sessions
- Reveal a "coder personality archetype" once a year as a Wrapped-style moment

**Secondary:** Curious developers who hear about the tool from a viral tweet, install it once for the personality reveal, and stay for the daily-use search/observability features.

**Not for:** Teams that need centralized audit, SSO, or compliance dashboards. That's the LangSmith / LangFuse / Anthropic-Enterprise lane.

## Core jobs-to-be-done

1. **Recall** — "Where did I solve X?" → 200ms search, copy-paste resume command.
2. **Reflect** — "How am I actually using AI?" → patterns, cost, time-of-day, language mix.
3. **Reveal** — "What kind of coder does my AI think I am?" → archetype, shareable card.

## What we don't do (and why)

| Not doing | Why |
|---|---|
| Cloud hosting | Defeats the privacy promise; forces accounts |
| Cross-device sync | Adds backend; not what solo devs ask for first |
| Team features (SSO, RBAC) | Different audience, different price point |
| AI / API call instrumentation in your apps | LangFuse / LangSmith already do this well |
| Live tail / production monitoring | Different problem (production observability, not personal recall) |

## Status

Pre-product. The repo is a fresh skeleton with `package.json`, `README`, `LICENSE`, `.gitignore`. Implementation hasn't started. Docs come first so the work is opinionated when it does start.

## Inspiration / adjacent

- [search-sessions](https://github.com/sinzin91/search-sessions) — solo-dev Rust binary for searching `~/.claude/projects`. Closest existing tool. We borrow the philosophy ("just search the JSONL directly") and add a dashboard layer.
- [claude-history](https://github.com/raine/claude-history) — TUI for fuzzy-searching Claude Code history. Different surface (terminal vs browser).
- Spotify Wrapped — the year-in-review format. Directly informs the personality-reveal hook.
