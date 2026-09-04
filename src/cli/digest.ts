/**
 * `crixin digest` — F7
 * Free: deterministic 1-paragraph summary of the last 7 days (no API key).
 * Pro:  full deterministic summary + (if ANTHROPIC_API_KEY is set) an
 *       AI-written paragraph from Claude Sonnet.
 *
 * The deterministic core works without any external auth; the AI paragraph
 * is opt-in by setting the env var. Crixin never bundles or fetches keys.
 */
import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";
import { isPro } from "../license/features.js";
import { log } from "../lib/log.js";
import kleur from "kleur";

interface DigestArgs {
  windowDays: number;
  ai: boolean;
}

export async function runDigest(args: DigestArgs): Promise<void> {
  const db = getDb();
  const since = Date.now() - args.windowDays * 86400000;
  const rangeLabel = `${args.windowDays}-day digest`;

  // ---- Deterministic core ---------------------------------------------------
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(message_count),0) AS messages,
              COALESCE(SUM(cost_usd_cents),0) AS cost,
              COALESCE(SUM(prompt_tokens),0) AS ptok,
              COALESCE(SUM(output_tokens),0) AS otok,
              COALESCE(SUM(COALESCE(ended_at,0)-COALESCE(started_at,0)),0) AS dur
         FROM sessions WHERE started_at >= ?`,
    )
    .get(since) as {
    sessions: number; messages: number; cost: number;
    ptok: number; otok: number; dur: number;
  };

  if (totals.sessions === 0) {
    console.log(kleur.gray(`No sessions in the last ${args.windowDays} days.`));
    return;
  }

  const topProjects = db
    .prepare(
      `SELECT COALESCE(project,'(no project)') AS project,
              COUNT(*) AS count,
              COALESCE(SUM(cost_usd_cents),0) AS cost
         FROM sessions WHERE started_at >= ?
       GROUP BY project ORDER BY count DESC LIMIT 5`,
    )
    .all(since) as { project: string; count: number; cost: number }[];

  const topModel = (db
    .prepare(
      `SELECT m.model, COUNT(*) AS n FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE s.started_at >= ? AND m.model IS NOT NULL
         GROUP BY m.model ORDER BY n DESC LIMIT 1`,
    )
    .get(since) as { model: string; n: number } | undefined)?.model ?? "(unknown)";

  const fmt$ = (c: number) => "$" + (c / 100).toFixed(2);
  const fmtH = (ms: number) => (ms / 3.6e6).toFixed(1) + "h";

  console.log("");
  console.log(kleur.bold(rangeLabel));
  console.log(kleur.gray("  ─".repeat(20)));
  console.log(`  Sessions:     ${kleur.cyan(totals.sessions.toLocaleString())}`);
  console.log(`  Messages:     ${totals.messages.toLocaleString()}`);
  console.log(`  Time:         ${fmtH(totals.dur)}`);
  console.log(`  API-equiv:    ${kleur.yellow(fmt$(totals.cost))}`);
  console.log(`  Top model:    ${topModel}`);
  console.log("");
  console.log(kleur.bold("Top projects"));
  for (const p of topProjects) {
    const proj = p.project.length > 40 ? "…" + p.project.slice(-39) : p.project;
    console.log(`  ${proj.padEnd(40)} ${String(p.count).padStart(4)} sessions   ${fmt$(p.cost).padStart(8)}`);
  }
  console.log("");

  // ---- AI paragraph (Pro + opt-in) -----------------------------------------
  if (args.ai && isPro()) {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) {
      log.warn("ANTHROPIC_API_KEY not set — skipping AI summary.");
      log.hint("Set it in your shell to enable: export ANTHROPIC_API_KEY=sk-ant-…");
      log.hint("This is opt-in; Crixin never ships or fetches keys.");
      return;
    }

    log.info("Generating AI summary via Anthropic API…");
    try {
      const sample = db
        .prepare(
          `SELECT m.role, m.content FROM messages m
             JOIN sessions s ON s.id = m.session_id
             WHERE s.started_at >= ? AND m.role = 'user' AND m.content IS NOT NULL
             ORDER BY LENGTH(m.content) DESC LIMIT 30`,
        )
        .all(since) as { role: string; content: string }[];

      const prompt = [
        `Summarize this developer's last ${args.windowDays} days of AI coding work in a single paragraph (4-6 sentences).`,
        `Focus on: what they were building, what problems they solved, what they struggled with. Tone: dry, accurate, observational.`,
        `Stats: ${totals.sessions} sessions, ${totals.messages.toLocaleString()} messages, ${fmtH(totals.dur)} total. Top projects: ${topProjects.slice(0, 3).map((p) => p.project.split("/").pop()).join(", ")}. Primary model: ${topModel}.`,
        ``,
        `Sample of their longest user prompts:`,
        ...sample.slice(0, 15).map((s, i) => `${i + 1}. "${s.content.slice(0, 280)}"`),
      ].join("\n");

      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 600,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!r.ok) {
        log.error(`Anthropic API ${r.status}: ${(await r.text()).slice(0, 200)}`);
        return;
      }
      const j = (await r.json()) as { content: { type: string; text: string }[] };
      const text = j.content.find((c) => c.type === "text")?.text ?? "(empty response)";
      console.log(kleur.bold("Summary"));
      console.log(kleur.gray("  ─".repeat(20)));
      for (const line of wrap(text, 78)) console.log("  " + line);
      console.log("");
    } catch (e) {
      log.error(`AI summary failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (args.ai && !isPro()) {
    log.warn("AI summaries are Pro-only.");
    log.hint("Pro · $5/mo with 3-day trial — https://crixin.com/install");
  }
}

function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  for (const para of s.split(/\n\n+/)) {
    let line = "";
    for (const w of para.split(/\s+/)) {
      if (line.length + w.length + 1 > width) {
        out.push(line);
        line = w;
      } else line = line ? line + " " + w : w;
    }
    if (line) out.push(line);
    out.push("");
  }
  return out.filter((l, i, a) => !(l === "" && a[i - 1] === ""));
}
