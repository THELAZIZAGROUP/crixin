/**
 * Tool archetype inference — F16.
 *
 * 10 labels, calibrated against author's corpus + small private beta.
 * Thresholds are intentionally **higher** than feel "interesting" — the
 * goal is "this label tells you something true" not "this label is fun".
 * If a 1.5% rate gets a label, the label is noise. Real signal starts at
 * 3-5% for most phrase-based patterns.
 *
 * Tie-break order favors the more **actionable** diagnoses (Skipper,
 * Reverser, Optimist) over the affirmative ones (Diligent).
 */

export type ToolArchetype =
  | "Skipper"        // declines work via "pre-existing" / "out of scope"
  | "Reverser"       // flip-flops; says "actually..." after committing
  | "Optimist"       // declares "all done!" prematurely; false-completion patterns
  | "Apologizer"     // "you're right" / "my mistake" — defers to pushback often
  | "Hedger"         // "I think" / "probably" / "might" — vague, low confidence
  | "Stack-Tracer"   // dominated by error/exception/traceback content (debug-heavy)
  | "Lecturer"       // long prose-heavy replies, low code-block rate
  | "Over-Explainer" // long replies vs short user prompts (verbosity outpaces input)
  | "Yes-Man"        // short replies, low pushback (replies < 0.6× user)
  | "Diligent";      // ships code, low skip / hedge / reverse rates

export interface ToolArchetypeInput {
  source: string;
  assistantMessages: number;
  avgAssistantLength: number;
  avgUserLength: number;
  skipRate: number;
  apologizeRate: number;
  hedgeRate: number;
  reverseRate: number;
  optimistRate: number;
  debugRate: number;
  questionRate: number;
  codeBlockRate: number;
}

export interface ToolArchetypeResult {
  source: string;
  label: ToolArchetype;
  rationale: string;
  scores: Record<ToolArchetype, number>;
  /** Two strongest signals (raw rates) for the rationale. */
  topSignals: { name: string; value: number }[];
}

export function inferToolArchetype(input: ToolArchetypeInput): ToolArchetypeResult {
  const scores: Record<ToolArchetype, number> = {
    Skipper: 0, Reverser: 0, Optimist: 0, Apologizer: 0,
    Hedger: 0, "Stack-Tracer": 0, Lecturer: 0,
    "Over-Explainer": 0, "Yes-Man": 0, Diligent: 0,
  };

  // ---- Phrase-based signals (calibrated for visible signal) ----
  // Skipper — needs to be visibly often before it earns the label.
  if (input.skipRate >= 0.03) scores.Skipper += 2;
  if (input.skipRate >= 0.06) scores.Skipper += 2;
  if (input.skipRate >= 0.10) scores.Skipper += 1;

  // Reverser — flip-flops are catastrophic; lower threshold OK.
  if (input.reverseRate >= 0.015) scores.Reverser += 2;
  if (input.reverseRate >= 0.03) scores.Reverser += 2;

  // Optimist — false completion is one of the worst patterns.
  // Strong weight: even one phrase per 25 replies (4%) deserves the label
  // because the failure mode (trusting "all done!") is so costly.
  if (input.optimistRate >= 0.04) scores.Optimist += 5;
  if (input.optimistRate >= 0.08) scores.Optimist += 2;

  // Apologizer — high deference to pushback.
  if (input.apologizeRate >= 0.025) scores.Apologizer += 2;
  if (input.apologizeRate >= 0.05) scores.Apologizer += 2;

  // Hedger — high uncertainty word rate.
  if (input.hedgeRate >= 0.08) scores.Hedger += 2;
  if (input.hedgeRate >= 0.15) scores.Hedger += 2;

  // Stack-Tracer — debug-heavy use is real but uncommon. Strong weight
  // because the signal is unambiguous (literal Tracebacks + Errors).
  if (input.debugRate >= 0.10) scores["Stack-Tracer"] += 3;
  if (input.debugRate >= 0.18) scores["Stack-Tracer"] += 2;

  // ---- Length-based signals ----
  const replyRatio = input.avgUserLength > 0 ? input.avgAssistantLength / input.avgUserLength : 1;

  // Yes-Man: short replies vs user prompts + few questions back.
  if (replyRatio < 0.6 && input.questionRate < 0.05) scores["Yes-Man"] += 2;
  if (replyRatio < 0.4) scores["Yes-Man"] += 1;

  // Over-Explainer: replies dominate user input.
  if (replyRatio > 5) scores["Over-Explainer"] += 2;
  if (replyRatio > 10) scores["Over-Explainer"] += 1;

  // Lecturer: long replies + low code-block rate (prose-heavy).
  // More specific than Over-Explainer (which only checks length), so weight
  // higher to win the tie-break when both fire.
  if (replyRatio > 4 && input.codeBlockRate < 0.10) scores.Lecturer += 3;
  if (replyRatio > 6 && input.codeBlockRate < 0.05) scores.Lecturer += 2;

  // ---- Diligent: the "boring, correct" baseline ----
  // Only score Diligent when there's NO actionable signal firing — otherwise
  // a 30% code-rate could beat a real Skipper / Optimist diagnosis.
  const anyActionable =
    input.skipRate >= 0.03 ||
    input.reverseRate >= 0.015 ||
    input.optimistRate >= 0.04 ||
    input.apologizeRate >= 0.025 ||
    input.hedgeRate >= 0.08 ||
    input.debugRate >= 0.10;
  if (!anyActionable) {
    if (input.codeBlockRate >= 0.30) scores.Diligent += 2;
    if (input.codeBlockRate >= 0.50) scores.Diligent += 1;
    if (input.skipRate < 0.01 && input.reverseRate < 0.01 && input.hedgeRate < 0.05) {
      scores.Diligent += 2;
    }
    if (replyRatio >= 1.0 && replyRatio <= 4.0) scores.Diligent += 1;
  }

  // ---- Pick winner ----
  // Tie-break order: actionable labels first, Diligent last.
  const order: ToolArchetype[] = [
    "Skipper", "Reverser", "Optimist", "Apologizer",
    "Hedger", "Stack-Tracer", "Lecturer",
    "Over-Explainer", "Yes-Man", "Diligent",
  ];
  let best: ToolArchetype = order[0]!;
  let bestScore = -1;
  for (const k of order) {
    if (scores[k] > bestScore) {
      best = k;
      bestScore = scores[k];
    }
  }

  // Two strongest raw signals for transparency.
  const allSignals: { name: string; value: number }[] = [
    { name: "skipRate", value: input.skipRate },
    { name: "apologizeRate", value: input.apologizeRate },
    { name: "hedgeRate", value: input.hedgeRate },
    { name: "reverseRate", value: input.reverseRate },
    { name: "optimistRate", value: input.optimistRate },
    { name: "debugRate", value: input.debugRate },
    { name: "questionRate", value: input.questionRate },
    { name: "codeBlockRate", value: input.codeBlockRate },
  ];
  const topSignals = allSignals.sort((a, b) => b.value - a.value).slice(0, 2);

  return {
    source: input.source,
    label: best,
    rationale: rationaleFor(best, input),
    scores,
    topSignals,
  };
}

function rationaleFor(label: ToolArchetype, i: ToolArchetypeInput): string {
  const pct = (n: number) => (n * 100).toFixed(2) + "%";
  const replyRatio = i.avgUserLength > 0 ? (i.avgAssistantLength / i.avgUserLength).toFixed(1) : "—";

  switch (label) {
    case "Skipper":
      return `${pct(i.skipRate)} of replies contain skip phrases ("pre-existing", "out of scope", "won't fix"). Across ${i.assistantMessages.toLocaleString()} replies — real pattern, not noise. Audit with \`crixin skipped\`.`;
    case "Reverser":
      return `${pct(i.reverseRate)} of replies start with "actually" or "let me revise" — flip-flops after committing. The model second-guesses itself often; verify finals.`;
    case "Optimist":
      return `${pct(i.optimistRate)} of replies contain false-completion phrases ("all set!", "looks good", "done!"). Test before trusting "complete".`;
    case "Apologizer":
      return `${pct(i.apologizeRate)} of replies start with "you're right" / "my mistake" / "I apologize". The model defers to pushback often — sometimes warranted, sometimes a tell.`;
    case "Hedger":
      return `${pct(i.hedgeRate)} of replies contain "I think" / "probably" / "might" / "perhaps". Low confidence dominates — push for definitive answers.`;
    case "Stack-Tracer":
      return `${pct(i.debugRate)} of replies contain Traceback / Error / Exception. Most conversations are debugging — the model lives in the error-stack.`;
    case "Lecturer":
      return `${replyRatio}× longer replies than your prompts, but only ${pct(i.codeBlockRate)} contain code. Prose-heavy explanations dominate over actionable code.`;
    case "Over-Explainer":
      return `Replies average ${replyRatio}× the length of your prompts. Verbose. Skim-friendly only if you don't.`;
    case "Yes-Man":
      return `Replies average ${replyRatio}× user length, ${pct(i.questionRate)} question rate. Short, agreement-heavy responses dominate.`;
    case "Diligent":
      return `${pct(i.codeBlockRate)} of replies ship code; ${pct(i.skipRate)} skip rate, ${pct(i.reverseRate)} reverse rate. Doing the work — the "boring" label, usually the right one.`;
  }
}
