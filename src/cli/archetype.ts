/**
 * `crixin archetype` — F16 + the existing dev archetype, unified.
 *
 *   crixin archetype          → both side by side: dev + each tool source
 *   crixin archetype me       → just the dev archetype
 *   crixin archetype tool     → just the tool archetype(s)
 *   crixin archetype tool --source claude-code   → one source only
 */
import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";
import { inferArchetype } from "../wrapped/archetype.js";
import { inferToolArchetype } from "../wrapped/tool-archetype.js";
import kleur from "kleur";

interface ArchetypeArgs {
  who?: "me" | "tool" | undefined;
  source?: string;
}

export function runArchetype(args: ArchetypeArgs): void {
  const db = getDb();
  const showMe = !args.who || args.who === "me";
  const showTool = !args.who || args.who === "tool";

  if (showMe) {
    printDevArchetype();
  }
  if (showMe && showTool) {
    console.log("");
  }
  if (showTool) {
    printToolArchetypes(args.source);
  }

  if (showMe && showTool) {
    console.log("");
    console.log(kleur.gray("  Tip: `crixin skipped` shows the actual skip lines behind a Skipper label."));
  }

  function printDevArchetype() {
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS sessions, COALESCE(SUM(message_count),0) AS messages,
                COALESCE(SUM(COALESCE(ended_at,0)-COALESCE(started_at,0)),0) AS dur,
                COALESCE(AVG(message_count),0) AS avgMsgs,
                SUM(CASE WHEN ended_at - started_at >= 3600000 THEN 1 ELSE 0 END) AS longSessions,
                SUM(CASE WHEN role='user' THEN 1 ELSE 0 END) AS u,
                SUM(CASE WHEN role='assistant' THEN 1 ELSE 0 END) AS a
           FROM (SELECT s.message_count, s.started_at, s.ended_at, m.role
                 FROM sessions s LEFT JOIN messages m ON s.id = m.session_id)`,
      )
      .get() as {
      sessions: number; messages: number; dur: number;
      avgMsgs: number; longSessions: number;
      u: number | null; a: number | null;
    };

    const u = totals.u ?? 0;
    const a = totals.a ?? 0;
    const ratio = a > 0 ? u / a : 0;
    const arch = inferArchetype({
      totalSessions: totals.sessions,
      totalMessages: totals.messages,
      totalDurationMs: totals.dur,
      userToAssistantRatio: ratio,
      meanMessagesPerSession: totals.avgMsgs,
      longSessionCount: totals.longSessions,
    });

    console.log("");
    console.log(kleur.bold("You · the developer"));
    console.log(kleur.gray("  " + "─".repeat(60)));
    console.log(`  ${kleur.cyan(arch.label.padEnd(20))}  ${kleur.gray(arch.rationale)}`);
  }

  function printToolArchetypes(source?: string) {
    const signals = queries.toolBehaviorSignals(db, source);
    if (signals.length === 0) {
      console.log(kleur.gray("  No assistant messages indexed yet — run `crixin ingest`."));
      return;
    }
    console.log(kleur.bold(signals.length === 1 ? "Your tool" : "Your tools"));
    console.log(kleur.gray("  " + "─".repeat(60)));
    for (const sig of signals) {
      const arch = inferToolArchetype(sig);
      const labelColor = labelToColor(arch.label);
      const pct = (n: number) => (n * 100).toFixed(2) + "%";
      const replyRatio = sig.avgUserLength > 0 ? (sig.avgAssistantLength / sig.avgUserLength).toFixed(1) : "—";

      console.log("");
      console.log(`  ${kleur.bold(sig.source.padEnd(14))}  ${labelColor(arch.label)}  ${kleur.gray(`(${sig.assistantMessages.toLocaleString()} replies)`)}`);
      // Wrap rationale so it doesn't blow past the terminal width
      for (const line of wrap(arch.rationale, 70)) {
        console.log(`  ${kleur.gray("  ─ ")}${line}`);
      }
      // Full signal grid — 8 numbers, two columns
      console.log("");
      console.log(`    ${kleur.gray("skip:")}${pad(pct(sig.skipRate), 8)}  ${kleur.gray("apology:")}${pad(pct(sig.apologizeRate), 8)}  ${kleur.gray("hedge:")}${pad(pct(sig.hedgeRate), 8)}  ${kleur.gray("reverse:")}${pad(pct(sig.reverseRate), 8)}`);
      console.log(`    ${kleur.gray("optim:")}${pad(pct(sig.optimistRate), 8)}  ${kleur.gray("debug:")}  ${pad(pct(sig.debugRate), 8)}  ${kleur.gray("ques:")} ${pad(pct(sig.questionRate), 8)}  ${kleur.gray("code:")}   ${pad(pct(sig.codeBlockRate), 8)}`);
      console.log(`    ${kleur.gray("reply/user:")} ${replyRatio}×  ${kleur.gray("avg reply len:")} ${Math.round(sig.avgAssistantLength)} chars`);
    }
  }
}

function pad(s: string, n: number): string { return s.padEnd(n); }

function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  const words = s.split(/\s+/);
  let line = "";
  for (const w of words) {
    if (line.length + w.length + 1 > width) {
      out.push(line);
      line = w;
    } else line = line ? line + " " + w : w;
  }
  if (line) out.push(line);
  return out;
}

function labelToColor(label: string): (s: string) => string {
  switch (label) {
    case "Skipper":         return kleur.yellow;
    case "Reverser":        return kleur.red;
    case "Optimist":        return kleur.magenta;
    case "Apologizer":      return kleur.cyan;
    case "Hedger":          return kleur.yellow;
    case "Stack-Tracer":    return kleur.gray;
    case "Lecturer":        return kleur.magenta;
    case "Over-Explainer":  return kleur.magenta;
    case "Yes-Man":         return kleur.gray;
    case "Diligent":        return kleur.green;
    default:                return (s: string) => s;
  }
}
