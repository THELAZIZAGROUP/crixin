import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferArchetype } from "../../src/wrapped/archetype.ts";

describe("archetype inference", () => {
  it("labels short fast sessions as Cowboy", () => {
    const r = inferArchetype({
      totalSessions: 200,
      totalMessages: 800,
      totalDurationMs: 0,
      userToAssistantRatio: 1.0,
      meanMessagesPerSession: 4,
      longSessionCount: 0,
    });
    assert.equal(r.label, "Cowboy");
  });

  it("labels long deep sessions as Architect", () => {
    const r = inferArchetype({
      totalSessions: 30,
      totalMessages: 1500,
      totalDurationMs: 3.6e6 * 80,
      userToAssistantRatio: 1.0,
      meanMessagesPerSession: 50,
      longSessionCount: 20,
    });
    assert.equal(r.label, "Architect");
  });

  it("labels heavy user-led sessions as Prompter-First", () => {
    const r = inferArchetype({
      totalSessions: 50,
      totalMessages: 600,
      totalDurationMs: 0,
      userToAssistantRatio: 1.4,
      meanMessagesPerSession: 12,
      longSessionCount: 0,
    });
    assert.equal(r.label, "Prompter-First");
  });

  it("rationale contains the relevant numbers", () => {
    const r = inferArchetype({
      totalSessions: 91,
      totalMessages: 17013,
      totalDurationMs: 7.3e9,
      userToAssistantRatio: 0.95,
      meanMessagesPerSession: 16,
      longSessionCount: 25,
    });
    assert.match(r.rationale, /\d/);
  });
});
