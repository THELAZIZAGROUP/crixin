import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferToolArchetype } from "../../src/wrapped/tool-archetype.ts";

const baseline = {
  source: "claude-code",
  assistantMessages: 1000,
  avgAssistantLength: 500,
  avgUserLength: 200,
  skipRate: 0,
  apologizeRate: 0,
  hedgeRate: 0,
  reverseRate: 0,
  optimistRate: 0,
  debugRate: 0,
  questionRate: 0.1,
  codeBlockRate: 0.4,
};

describe("tool archetype inference", () => {
  it("Diligent wins when nothing else triggers", () => {
    const r = inferToolArchetype(baseline);
    assert.equal(r.label, "Diligent");
  });

  it("Skipper requires real signal (>=3% skip rate)", () => {
    // 1.5% — below threshold, should NOT be Skipper
    const weak = inferToolArchetype({ ...baseline, skipRate: 0.015 });
    assert.notEqual(weak.label, "Skipper");
    // 5% — clear signal
    const strong = inferToolArchetype({ ...baseline, skipRate: 0.05 });
    assert.equal(strong.label, "Skipper");
  });

  it("Apologizer needs >=2.5% apology rate", () => {
    const weak = inferToolArchetype({ ...baseline, apologizeRate: 0.015 });
    assert.notEqual(weak.label, "Apologizer");
    const strong = inferToolArchetype({ ...baseline, apologizeRate: 0.04 });
    assert.equal(strong.label, "Apologizer");
  });

  it("Hedger requires >=8% hedge rate", () => {
    const weak = inferToolArchetype({ ...baseline, hedgeRate: 0.05 });
    assert.notEqual(weak.label, "Hedger");
    const strong = inferToolArchetype({ ...baseline, hedgeRate: 0.12 });
    assert.equal(strong.label, "Hedger");
  });

  it("Reverser needs >=1.5% (low threshold OK — flip-flops are expensive)", () => {
    const r = inferToolArchetype({ ...baseline, reverseRate: 0.02 });
    assert.equal(r.label, "Reverser");
  });

  it("Optimist needs >=4% false-completion rate", () => {
    const r = inferToolArchetype({ ...baseline, optimistRate: 0.05 });
    assert.equal(r.label, "Optimist");
  });

  it("Yes-Man triggers on short replies + low question rate", () => {
    const r = inferToolArchetype({
      ...baseline, avgAssistantLength: 100, avgUserLength: 200, questionRate: 0.02, codeBlockRate: 0.05,
    });
    assert.equal(r.label, "Yes-Man");
  });

  it("Lecturer triggers on long prose-heavy replies", () => {
    const r = inferToolArchetype({
      ...baseline,
      avgAssistantLength: 5000, avgUserLength: 200, // 25× ratio
      codeBlockRate: 0.05, // prose-heavy
    });
    assert.equal(r.label, "Lecturer");
  });

  it("Stack-Tracer triggers on >=10% debug rate", () => {
    const r = inferToolArchetype({ ...baseline, debugRate: 0.15, codeBlockRate: 0.10 });
    assert.equal(r.label, "Stack-Tracer");
  });

  it("rationale always references real numbers", () => {
    const r = inferToolArchetype({ ...baseline, skipRate: 0.10 });
    assert.match(r.rationale, /\d/);
  });

  it("topSignals returns the two highest raw signals", () => {
    const r = inferToolArchetype({
      ...baseline, hedgeRate: 0.20, codeBlockRate: 0.50, skipRate: 0.01,
    });
    assert.equal(r.topSignals.length, 2);
    // codeBlockRate (0.50) and hedgeRate (0.20) should be the top two
    const names = r.topSignals.map((s) => s.name).sort();
    assert.deepEqual(names, ["codeBlockRate", "hedgeRate"]);
  });

  it("Skipper beats Apologizer in tie-break order (more actionable)", () => {
    // Both signals strong — actionable diagnosis (Skipper) wins
    const r = inferToolArchetype({
      ...baseline,
      skipRate: 0.06,
      apologizeRate: 0.06,
    });
    assert.equal(r.label, "Skipper");
  });
});
