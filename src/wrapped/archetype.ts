/**
 * Coder-archetype inference. Heuristic v0.2; the real version (v0.4) ships
 * after we have customer data to tune against.
 *
 * The five archetypes mirror the Spotify Wrapped pattern (typology that flatters
 * and entertains, not a clinical assessment).
 */

export type Archetype = "Cowboy" | "Architect" | "Debugger" | "Tinkerer" | "Prompter-First";

export interface ArchetypeInput {
  totalSessions: number;
  totalMessages: number;
  totalDurationMs: number;
  /** ratio of user → assistant messages (proxy for "I lead vs Claude leads") */
  userToAssistantRatio: number;
  /** mean messages per session */
  meanMessagesPerSession: number;
  /** count of sessions whose duration exceeds 1 hour */
  longSessionCount: number;
}

export function inferArchetype(input: ArchetypeInput): {
  label: Archetype;
  rationale: string;
  scores: Record<Archetype, number>;
} {
  const scores: Record<Archetype, number> = {
    "Cowboy": 0,
    "Architect": 0,
    "Debugger": 0,
    "Tinkerer": 0,
    "Prompter-First": 0,
  };

  // Cowboy: many short sessions
  if (input.meanMessagesPerSession < 8) scores["Cowboy"] += 2;
  if (input.totalSessions > 100 && input.meanMessagesPerSession < 12) scores["Cowboy"] += 1;

  // Architect: fewer sessions, but each goes long
  if (input.meanMessagesPerSession >= 30) scores["Architect"] += 2;
  if (input.longSessionCount >= 10) scores["Architect"] += 1;

  // Debugger: very high message count concentrated, mid-length sessions
  if (input.totalMessages > 5000 && input.meanMessagesPerSession >= 15 && input.meanMessagesPerSession < 30) {
    scores["Debugger"] += 2;
  }

  // Tinkerer: many sessions, each short, lots of source diversity (we approximate)
  if (input.totalSessions > 60 && input.meanMessagesPerSession < 15) scores["Tinkerer"] += 1;

  // Prompter-First: more user messages than assistant — they steer hard
  if (input.userToAssistantRatio > 1.05) scores["Prompter-First"] += 2;
  else if (input.userToAssistantRatio > 0.95) scores["Prompter-First"] += 1;

  // Pick the highest-scoring; ties broken by preferred order
  const order: Archetype[] = ["Architect", "Debugger", "Prompter-First", "Tinkerer", "Cowboy"];
  let best: Archetype = order[0]!;
  let bestScore = -1;
  for (const k of order) {
    if (scores[k] > bestScore) {
      best = k;
      bestScore = scores[k];
    }
  }

  const rationale = rationaleFor(best, input);
  return { label: best, rationale, scores };
}

function rationaleFor(label: Archetype, i: ArchetypeInput): string {
  const mpS = i.meanMessagesPerSession.toFixed(1);
  const r = i.userToAssistantRatio.toFixed(2);
  switch (label) {
    case "Cowboy":
      return `${i.totalSessions} sessions, ${mpS} messages each on average — short, decisive, fast turnaround.`;
    case "Architect":
      return `${mpS} messages per session on average across ${i.longSessionCount} long-form runs — you stay in the flow.`;
    case "Debugger":
      return `${i.totalMessages.toLocaleString()} messages across ${i.totalSessions} sessions — concentrated, deep work.`;
    case "Tinkerer":
      return `${i.totalSessions} sessions with a wide spread — lots of small experiments rather than one big bet.`;
    case "Prompter-First":
      return `User-to-assistant message ratio is ${r} — you talk more than you listen, and your prompts do the heavy lifting.`;
  }
}
