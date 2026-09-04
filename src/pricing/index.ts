import { countTokens } from "./tokenizer.js";

/**
 * Token + cost accounting (v0.0.3).
 *
 * Two paths:
 *   1. AUTHORITATIVE — when the source records the API's `usage` block (Claude
 *      Code's JSONL does, every assistant message has it). We sum the four
 *      counts (input, output, cache_creation, cache_read) and price them with
 *      Anthropic's real cache-aware rates. This is the API-equivalent dollar
 *      amount the Anthropic API would charge for that exact usage.
 *   2. ESTIMATED — when there's no usage block (Codex CLI, Cursor, sub-agent
 *      Claude Code lines without API responses). We tokenize the message text
 *      with js-tiktoken and apply list prices.
 *
 * Note for users on flat-rate subscriptions (Claude Pro $20/mo, Codex CLI Plus,
 * Cursor Pro): the marginal cost of any one session is $0 — the dashboard
 * number is what the equivalent usage WOULD cost on pay-as-you-go API.
 */

export interface ModelPrice {
  /** USD per 1,000,000 input tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens. */
  outputPerMillion: number;
  /** Provider label for grouping in dashboards. */
  provider: "anthropic" | "openai" | "unknown";
}

/**
 * Pricing table — list prices as of 2026-04. Keys are normalized model ids.
 * Aliases (e.g. "claude-opus-4-7-20251201") resolve via {@link normalizeModel}.
 */
export const PRICING: Record<string, ModelPrice> = {
  // Anthropic — Claude 4.x family
  "claude-opus-4-7":   { inputPerMillion: 15.00, outputPerMillion: 75.00, provider: "anthropic" },
  "claude-opus-4-6":   { inputPerMillion: 15.00, outputPerMillion: 75.00, provider: "anthropic" },
  "claude-sonnet-4-6": { inputPerMillion: 3.00,  outputPerMillion: 15.00, provider: "anthropic" },
  "claude-haiku-4-5":  { inputPerMillion: 0.80,  outputPerMillion: 4.00,  provider: "anthropic" },

  // OpenAI — GPT-5 family (Codex CLI default in 2026)
  "gpt-5":      { inputPerMillion: 10.00, outputPerMillion: 30.00, provider: "openai" },
  "gpt-5-mini": { inputPerMillion: 1.25,  outputPerMillion: 5.00,  provider: "openai" },
  "gpt-5-nano": { inputPerMillion: 0.10,  outputPerMillion: 0.40,  provider: "openai" },

  // Fallback for unknown models — deliberately mid-range so estimates aren't
  // wildly wrong for a model we haven't priced yet.
  "default": { inputPerMillion: 5.00, outputPerMillion: 15.00, provider: "unknown" },
};

/** Map raw model strings to canonical ids in {@link PRICING}. */
export function normalizeModel(raw: string | null | undefined): string {
  if (!raw) return "default";
  const lower = raw.toLowerCase();
  // Strip date suffixes like "claude-opus-4-7-20251201".
  const stripped = lower.replace(/-\d{8}$/, "");
  if (stripped in PRICING) return stripped;
  // Family-level fallbacks.
  if (stripped.startsWith("claude-opus-4")) return "claude-opus-4-7";
  if (stripped.startsWith("claude-sonnet-4")) return "claude-sonnet-4-6";
  if (stripped.startsWith("claude-haiku-4")) return "claude-haiku-4-5";
  if (stripped.startsWith("gpt-5-mini") || stripped.startsWith("gpt-5.1-mini")) return "gpt-5-mini";
  if (stripped.startsWith("gpt-5-nano") || stripped.startsWith("gpt-5.1-nano")) return "gpt-5-nano";
  if (stripped.startsWith("gpt-5") || stripped.startsWith("gpt-5.1")) return "gpt-5";
  return "default";
}

/**
 * Token count for `text` under `model`'s tokenizer. Uses real BPE counts
 * via js-tiktoken (`o200k_base` for GPT-5 family + Claude 4.x; `cl100k_base`
 * for older Claude 3.x), with a ~4 chars/token char fallback if the encoder
 * fails to initialize at runtime.
 */
export function estimateTokens(
  text: string | null | undefined,
  model: string | null = null,
): number {
  if (!text) return 0;
  return countTokens(text, model);
}

/**
 * Estimate the USD cost (in cents, integer math) of a single message.
 * `role` decides whether we charge the input or output rate.
 */
export function estimateMessageCostCents(
  content: string | null | undefined,
  role: string,
  model: string | null | undefined,
): number {
  const tokens = estimateTokens(content);
  if (tokens === 0) return 0;
  const price = PRICING[normalizeModel(model)] ?? PRICING["default"]!;
  const perMillion =
    role === "assistant" ? price.outputPerMillion : price.inputPerMillion;
  // tokens × usd/M × 100 cents/usd ÷ 1M
  return Math.round((tokens * perMillion * 100) / 1_000_000);
}

/** Sum cost for a whole session given its messages. */
export function estimateSessionCostCents(
  messages: { content: string | null; role: string }[],
  model: string | null,
): number {
  let total = 0;
  for (const m of messages) {
    total += estimateMessageCostCents(m.content, m.role, model);
  }
  return total;
}

/** Format a cents value as USD ($1.23 / $0.04 / —). */
export function formatCostCents(cents: number | null | undefined): string {
  if (cents == null || cents <= 0) return "—";
  if (cents < 100) return `$${(cents / 100).toFixed(2)}`;
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// AUTHORITATIVE pricing — Anthropic / OpenAI usage-block-aware.
// Cache pricing (Anthropic):
//   - cache_read_input_tokens  → 10%  of input rate (90% discount)
//   - cache_creation_input_tokens (5-min default ttl) → 125% of input rate
//   - cache_creation_input_tokens (1-hour ttl)        → 200% of input rate
// Source: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
// We pessimistically apply the 1.25x rate (Claude Code uses 5-min cache
// almost exclusively).
// ---------------------------------------------------------------------------

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/** Cents = real Anthropic API equivalent for the given usage block + model. */
export function anthropicCostCents(
  usage: AnthropicUsage,
  model: string | null | undefined,
): number {
  const price = PRICING[normalizeModel(model)] ?? PRICING["default"]!;
  if (price.provider !== "anthropic") {
    // Fall through with neutral rates if the model isn't tagged Anthropic; the
    // caller should be using the right path for their provider.
  }
  const ipm = price.inputPerMillion;
  const opm = price.outputPerMillion;

  const inp = usage.input_tokens ?? 0;
  const out = usage.output_tokens ?? 0;
  const creat = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;

  // microUSD = tokens × usd/M
  const microInput = inp * ipm;
  const microOutput = out * opm;
  const microCacheCreat = creat * ipm * 1.25;
  const microCacheRead = read * ipm * 0.10;
  const usd = (microInput + microOutput + microCacheCreat + microCacheRead) / 1_000_000;
  return Math.round(usd * 100);
}

/** Total tokens (sum of all 4 usage fields). Useful for a "total tokens" stat. */
export function anthropicTotalTokens(usage: AnthropicUsage): number {
  return (
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}
