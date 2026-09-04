/**
 * F10 — Anthropic count_tokens API client (Free, opt-in).
 *
 * The user provides their own ANTHROPIC_API_KEY. We hit
 * `POST https://api.anthropic.com/v1/messages/count_tokens` to get the
 * authoritative token count for a single message — the exact number Anthropic
 * would charge against. Crixin never bundles a key.
 *
 * Used by `crixin verify <session-id>` to spot-check a session's token count
 * against the JSONL `usage` block. If the numbers diverge, your data is
 * either stale or you've found a bug — both useful signals.
 */

export interface CountTokensRequest {
  model: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  system?: string;
}

export interface CountTokensResponse {
  input_tokens: number;
}

export async function anthropicCountTokens(
  req: CountTokensRequest,
  apiKey: string,
): Promise<CountTokensResponse | { error: string }> {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(req),
    });
    if (!r.ok) {
      return { error: `${r.status}: ${(await r.text()).slice(0, 240)}` };
    }
    return (await r.json()) as CountTokensResponse;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
