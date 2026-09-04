/**
 * Real token counting via js-tiktoken (BPE) — replaces the v0.2 char heuristic
 * for known model families. Encodings are loaded lazily on first use so a
 * caller that only counts GPT models doesn't pay the Claude encoding cost.
 *
 * Anthropic doesn't publish a local tokenizer for Claude 4.x; their
 * recommended path is the /count_tokens API endpoint (network-only). We use
 * `o200k_base` as a close approximation — it's the same superset BPE used by
 * GPT-4o-class models, and Claude's vocabulary is similar enough that token
 * counts land within a few percent of the API answer in our experiments.
 *
 * v0.3 may add a network-backed counter behind an opt-in flag.
 */

import { Tiktoken, getEncoding, encodingForModel } from "js-tiktoken";

type EncodingName = "o200k_base" | "cl100k_base";

const cache = new Map<EncodingName, Tiktoken>();
let charHeuristicWarned = false;

function getEnc(name: EncodingName): Tiktoken {
  let enc = cache.get(name);
  if (!enc) {
    try {
      enc = getEncoding(name);
    } catch {
      // js-tiktoken falls back gracefully via encodingForModel if a name is unknown.
      enc = encodingForModel("gpt-4o");
    }
    cache.set(name, enc);
  }
  return enc;
}

/** Pick a tiktoken encoding by raw model-string prefix. */
function encodingFor(model: string | null | undefined): EncodingName {
  if (!model) return "o200k_base";
  const m = model.toLowerCase();
  if (m.startsWith("gpt-3.5") || m.startsWith("gpt-4-")) return "cl100k_base";
  if (m.startsWith("claude-3") || m.startsWith("claude-2") || m.startsWith("claude-1")) {
    return "cl100k_base";
  }
  // GPT-5/4o family + Claude 4.x default to o200k_base.
  return "o200k_base";
}

/** Count tokens for one piece of text under the given model's encoding. */
export function countTokens(text: string | null | undefined, model: string | null | undefined): number {
  if (!text) return 0;
  try {
    const enc = getEnc(encodingFor(model));
    return enc.encode(text).length;
  } catch {
    if (!charHeuristicWarned) {
      // Stderr only — never write to stdout (MCP host channel).
      process.stderr.write(
        "crixin: tiktoken init failed, falling back to ~4 chars/token heuristic\n",
      );
      charHeuristicWarned = true;
    }
    return Math.ceil(text.length / 4);
  }
}

/** True if BPE tokenization is available — useful for reporting in the UI. */
export function tokenizerAvailable(): boolean {
  try {
    getEnc("o200k_base");
    return true;
  } catch {
    return false;
  }
}
