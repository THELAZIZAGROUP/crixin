# Design Theme

Visual direction. This is the spec a designer / dev hands a designer at v0.2.

## Aesthetic positioning

**Linear / Vercel / Tokyo Night** axis. Not Notion-playful, not Slack-friendly, not Buzzfeed-quiz. A senior engineer's tool that takes itself seriously without being cold.

## Color system

Dark by default. A light variant ships in v0.3.

### Dark palette (canonical)

| Role | Hex | Notes |
|---|---|---|
| Background — base | `#0b0d12` | Near-black with slight blue cast (not pure `#000`) |
| Background — surface | `#161922` | Cards, sidebars |
| Background — elevated | `#1f2330` | Modals, popovers |
| Border — subtle | `#272a35` | Default |
| Border — strong | `#3a3f4d` | Focus, active |
| Text — primary | `#e6e8ef` | Body |
| Text — secondary | `#9097a8` | Captions, metadata |
| Text — muted | `#5b6075` | Timestamps, helper |
| Accent — warm (highlight) | `#f5b452` | Amber. Marker / annotation / "found it" |
| Accent — cool (action) | `#7aa2f7` | Azure. Buttons, links, primary action |
| Status — success | `#7bd88f` | Green. Sparingly |
| Status — warning | `#e0af68` | Mustard |
| Status — danger | `#f7768e` | Coral red. Sparingly |

### Light palette (sketch)

| Role | Hex |
|---|---|
| Background — base | `#fbfbfb` |
| Background — surface | `#f3f4f6` |
| Border — subtle | `#e5e7eb` |
| Text — primary | `#0b0d12` |
| Text — secondary | `#4b5563` |
| Accent — warm | `#b8841f` |
| Accent — cool | `#3f6cd9` |

(Light palette is a v0.3 deliverable, not v0.1. Dark-first is correct for the audience.)

## Typography

### Type stack

```css
--font-sans: "Inter", -apple-system, "SF Pro Display", system-ui, sans-serif;
--font-mono: "JetBrains Mono", "SF Mono", "IBM Plex Mono", ui-monospace, monospace;
--font-display: "Inter", sans-serif;  /* same as sans for v0.1 */
```

Inter for everything except code/data. JetBrains Mono for code, identifiers, session IDs, raw JSONL excerpts.

### Scale (8px base, modular)

| Token | Size | Use |
|---|---|---|
| `text-xs` | 11px / 16px | Timestamps, captions |
| `text-sm` | 13px / 20px | Body small |
| `text-base` | 15px / 24px | Body |
| `text-lg` | 17px / 28px | Subheads |
| `text-xl` | 21px / 32px | Page heads |
| `text-2xl` | 28px / 36px | Hero subheads |
| `text-3xl` | 36px / 44px | Landing hero |
| `text-4xl` | 48px / 56px | Wrapped reveal cards |

### Weights

- Regular (400) — body
- Medium (500) — UI, buttons, table headers
- Semibold (600) — section heads
- Bold (700) — only on Wrapped reveal cards

No thin / light weights. They look fragile on dark backgrounds at small sizes.

## Spacing & radius

8px base. Use multiples of 4 only.

| Token | Px |
|---|---|
| `space-1` | 4 |
| `space-2` | 8 |
| `space-3` | 12 |
| `space-4` | 16 |
| `space-6` | 24 |
| `space-8` | 32 |
| `space-12` | 48 |
| `space-16` | 64 |

| Radius | Px | Use |
|---|---|---|
| `radius-sm` | 4 | Inputs, small buttons |
| `radius-md` | 8 | Cards, modals |
| `radius-lg` | 12 | Wrapped cards, hero panels |
| `radius-full` | 9999 | Avatars, pills |

## Iconography

- **Lucide** (icons) — open-source, neutral, fits Linear-aesthetic. 16px and 20px sizes ship; 24px reserved for hero / Wrapped reveal.
- No emoji icons in product UI. (Emoji is fine in marketing copy and Wrapped cards as accent — sparingly.)

## Charts & data viz

- **Visx** or **Observable Plot** for everything analytical.
- **Never Chart.js or Recharts** — they look 2015 and signal lazy.
- Default chart palette uses the accent colors above + 4 supporting hues from a perceptually-uniform sequence (Viridis or a Tokyo-Night-derived custom).
- Y-axis: never starts at non-zero unless we explicitly note "zoomed".
- Tooltips: monospace numbers, sans labels.

## Motion

- **Ease-out** for most transitions, 150-200ms.
- **No bounce / spring** in product UI. (Spring is fine on Wrapped reveal cards — that surface is allowed to be playful.)
- **Reduce-motion respected.** When `prefers-reduced-motion`, all animations become instant 0ms transitions.

## Wrapped cards (special surface)

Annual "Crixin Wrapped" gets its own visual language. Allowed:
- Saturated accent colors (deeper amber, electric cyan)
- Bold display type (700 weight on `text-3xl`+)
- Subtle particle / gradient effects
- One-line celebrations ("You're in the top 1% of late-night refactors")
- Spring motion on entrance

Wrapped cards must:
- Render as static HTML (so they're shareable as screenshots and exportable as PNG)
- Ship a `download as image` button
- Never include personal-identifying info (project paths, repo names) by default; user opts in to show specifics

## Brand mark (v0.1 placeholder)

For v0.1: lowercase wordmark `crixin` set in Inter Semibold, accent-warm color (`#f5b452`).
Custom logotype in v0.3 — not a priority before paid tier.

## What we explicitly avoid

| Anti-pattern | Why |
|---|---|
| Stock illustrations of people coding | Generic; signals zero taste |
| Glassmorphism / heavy blur | Dated trend; slow to render |
| Neon gradients | "Crypto bro" register |
| Skeuomorphic shadows | Doesn't fit dev-aesthetic |
| Round avatar placeholders with initials | We don't have users in product UI; nothing to avatar |
| "Powered by [Anthropic / OpenAI]" branding | Coupled to one vendor; we ingest from many |

## Accessibility

- WCAG AA contrast on all text and UI controls.
- All interactive elements keyboard-reachable.
- No color-only conveying of state (always pair with icon or label).
- Screen-reader labels on icon-only buttons.
- Focus states use border-strong + a 2px ring, visible against all backgrounds.
