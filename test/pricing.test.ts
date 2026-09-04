import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokens,
  estimateMessageCostCents,
  estimateSessionCostCents,
  normalizeModel,
  formatCostCents,
} from "../src/pricing/index.ts";

describe("pricing", () => {
  it("token counting (real BPE via js-tiktoken)", () => {
    assert.equal(estimateTokens(""), 0);
    // BPE tokens, not char/4. "hello world" is 2 tokens under o200k_base.
    assert.equal(estimateTokens("hello world", "gpt-5"), 2);
    // Longer text — still well under the char/4 heuristic for repeat patterns.
    const ten = estimateTokens("x".repeat(40), "claude-opus-4-7");
    assert.ok(ten >= 1 && ten <= 20, `expected 1..20, got ${ten}`);
  });

  it("normalizes model ids and falls back to family-level pricing", () => {
    assert.equal(normalizeModel("claude-opus-4-7"), "claude-opus-4-7");
    assert.equal(normalizeModel("claude-opus-4-7-20251201"), "claude-opus-4-7");
    assert.equal(normalizeModel("claude-sonnet-4-9-experimental"), "claude-sonnet-4-6");
    assert.equal(normalizeModel("gpt-5-mini-future-tag"), "gpt-5-mini");
    assert.equal(normalizeModel("totally-unknown-model"), "default");
    assert.equal(normalizeModel(undefined), "default");
  });

  it("charges output rate for assistant role (real BPE)", () => {
    // BPE compresses repeated 'x' into ~500 tokens for 4000 chars.
    // 500 × $75/M = 0.0375 USD ≈ 4 cents.
    const c = estimateMessageCostCents("x".repeat(4000), "assistant", "claude-opus-4-7");
    assert.ok(c >= 1 && c <= 8, `expected 1..8, got ${c}`);
  });

  it("charges input rate for user role (real BPE)", () => {
    // 500 tokens × $15/M input = 0.0075 USD ≈ 1 cent.
    const c = estimateMessageCostCents("x".repeat(4000), "user", "claude-opus-4-7");
    assert.ok(c >= 0 && c <= 3, `expected 0..3, got ${c}`);
  });

  it("sums session cost across messages and orders correctly by role", () => {
    const userOnly = estimateSessionCostCents(
      [{ role: "user", content: "x".repeat(4000) }],
      "claude-opus-4-7",
    );
    const both = estimateSessionCostCents(
      [
        { role: "user", content: "x".repeat(4000) },
        { role: "assistant", content: "x".repeat(8000) },
      ],
      "claude-opus-4-7",
    );
    // Both > userOnly because the assistant message added cost.
    assert.ok(both > userOnly, `expected ${both} > ${userOnly}`);
  });

  it("formats cost values as USD or — when zero", () => {
    assert.equal(formatCostCents(0), "—");
    assert.equal(formatCostCents(99), "$0.99");
    assert.equal(formatCostCents(1234), "$12.34");
  });
});
