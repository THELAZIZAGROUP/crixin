/**
 * Top-level CLI dispatcher.
 *
 * v0.5.0 — Crixin is the MCP toolkit for AI agents. Two capability modules
 * share one CLI, one local SQLite, one install:
 *   crixin voice …    Voice MCP — phone access through your own Twilio
 *   crixin coder …    Coder MCP — memory across every AI coding session
 *
 * Top-level commands:
 *   crixin                → quickstart summary (calls + sessions counts)
 *   crixin install        → umbrella installer (wires BOTH MCPs into every host)
 *   crixin doctor         → health check (DB, license, env, both MCPs reachable)
 *   crixin license …      → activate / status / deactivate Pro license
 *   crixin --mcp          → alias for `crixin voice mcp` (legacy v0.1 wiring)
 *   crixin ingest         → alias for `crixin voice ingest` (legacy)
 *   crixin voice …        → Voice MCP subsystem
 *   crixin coder …        → Coder MCP subsystem
 */
import { runDefault } from "./default.js";
import { runIngest } from "./ingest.js";
import { runLicense } from "./license.js";
import { runDoctor } from "./doctor.js";
import { runVoice } from "../voice/cli.js";
import { runCoder } from "../coder/cli.js";
import { runSync } from "../sync/cli.js";
import { log } from "../lib/log.js";
import { getHostTargets, checkEntryPresent, type EntryStatus } from "../lib/install-targets.js";
import kleur from "kleur";

/**
 * `crixin install --check` — non-mutating audit of every supported host.
 * Returns the process exit code: 0 if every host has both crixin-voice and
 * crixin-coder registered, 1 if any host is missing one or both.
 *
 * Output is one line per host, ✓ or ✗, with a brief reason for failures.
 * Machine-readable enough for CI scripts; readable enough for humans.
 */
export function runInstallCheck(): number {
  const targets = getHostTargets();
  let anyFailure = false;

  process.stdout.write(kleur.bold("crixin install --check\n\n"));

  for (const t of targets) {
    const voice = checkEntryPresent(t, "crixin-voice");
    const coder = checkEntryPresent(t, "crixin-coder");

    if (voice === "present" && coder === "present") {
      process.stdout.write(`  ${kleur.green("✓")} ${t.label.padEnd(16)} ${kleur.gray("crixin-voice + crixin-coder")}\n`);
      continue;
    }

    anyFailure = true;
    const reasons: string[] = [];
    function reason(name: string, status: EntryStatus): string {
      switch (status) {
        case "present":      return "";
        case "missing":      return `missing ${name}`;
        case "no-config":    return `no host config`;
        case "unreadable":   return `${name}: config unreadable`;
        case "legacy-schema":return `legacy mcpServers array — run with --migrate-legacy`;
      }
    }
    // Coalesce no-config / legacy-schema (those affect both entries equally)
    if (voice === "no-config" || coder === "no-config") {
      reasons.push("no host config");
    } else if (voice === "legacy-schema" || coder === "legacy-schema") {
      reasons.push("legacy mcpServers array — run with --migrate-legacy");
    } else {
      const r1 = reason("crixin-voice", voice);
      const r2 = reason("crixin-coder", coder);
      if (r1) reasons.push(r1);
      if (r2) reasons.push(r2);
    }
    process.stdout.write(
      `  ${kleur.red("✗")} ${t.label.padEnd(16)} ${kleur.gray(reasons.join(" · "))}\n`,
    );
  }

  process.stdout.write("\n");
  if (anyFailure) {
    process.stdout.write(kleur.red(kleur.bold("Overall: FAILED")) + " — run " + kleur.cyan("crixin install") + " to fix.\n");
    return 1;
  }
  process.stdout.write(kleur.green(kleur.bold("Overall: OK")) + " — both MCPs registered in every supported host.\n");
  return 0;
}

const HELP = `${kleur.bold("crixin")} — the MCP toolkit for AI agents. Give your AI a phone and a memory.

${kleur.gray("Two MCPs, one CLI, one local SQLite:")}
  ${kleur.cyan("crixin voice …")}                  Voice MCP — real phone calls + SMS through your own Twilio
  ${kleur.cyan("crixin coder …")}                  Coder MCP — memory across every Claude Code / Codex / Cursor session

${kleur.gray("Get running in 30 seconds:")}
  ${kleur.cyan("crixin install")}                  wire BOTH MCPs into Claude Code / Cursor / Codex CLI / Desktop
  ${kleur.cyan("crixin doctor")}                   health check — DB + license + env + both MCPs

${kleur.gray("Voice MCP (needs TWILIO_* env):")}
  ${kleur.cyan("crixin voice doctor")}             probe Twilio creds against the live API (no charges)
  ${kleur.cyan("crixin voice call")} ${kleur.gray("<to> [prompt]")}     place a one-off call from the CLI
  ${kleur.cyan("crixin voice sms")}  ${kleur.gray("<to> <body>")}       send an SMS
  ${kleur.cyan("crixin voice ingest")}             mirror Twilio + Deepgram → local SQLite
  ${kleur.cyan("crixin voice wrapped")} ${kleur.gray("[--year N]")}     annual HTML report — your year on the phone
  ${kleur.cyan("crixin voice archetype")}          caller archetype (Quick Pitcher / Patient Listener / Ducker / …)

${kleur.gray("Coder MCP (no extra env — reads what your AI host already wrote to disk):")}
  ${kleur.cyan("crixin coder ingest")}             rescan ~/.claude / ~/.codex / Cursor → local DB
  ${kleur.cyan("crixin coder dashboard")}          ingest + open the local dashboard
  ${kleur.cyan("crixin coder search")} ${kleur.gray("<query>")}        deep-search every session
  ${kleur.cyan("crixin coder wrapped")} ${kleur.gray("[--year N]")}    annual HTML report — your year of AI pair-programming
  ${kleur.cyan("crixin coder archetype")} ${kleur.gray("[me|tool]")}   Cowboy / Architect / Debugger / Tinkerer / …

${kleur.gray("Sync (Pro — metadata across your machines):")}
  ${kleur.cyan("crixin sync status")}              show device + link state
  ${kleur.cyan("crixin sync link")}                approve this device via browser
  ${kleur.cyan("crixin sync push")}                send metadata to the server
  ${kleur.cyan("crixin sync pull")}                fetch peer metadata
  ${kleur.cyan("crixin sync devices")}             list devices on this account

${kleur.gray("Aliases:")}
  ${kleur.cyan("crixin")}                          quickstart summary
  ${kleur.cyan("crixin --mcp")}                    legacy alias for ${kleur.cyan("crixin voice mcp")}
  ${kleur.cyan("crixin ingest")}                   legacy alias for ${kleur.cyan("crixin voice ingest")}
  ${kleur.cyan("crixin license activate|status|deactivate")}

${kleur.gray("Env (Voice MCP only):")}
  TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
  DEEPGRAM_API_KEY (optional, for transcribe_call)

${kleur.gray("Pricing:")} Free forever (OSS). Pro \$5/mo adds hosted Wrapped + cross-machine memory sync.

${kleur.gray("Docs:")} https://crixin.com  ·  https://github.com/THELAZIZAGROUP/crixin
`;

interface Parsed {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgv(argv: string[]): Parsed {
  const out: Parsed = { command: "default", positionals: [], flags: {} };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out.flags[key] = next;
        i += 2;
      } else {
        out.flags[key] = true;
        i += 1;
      }
    } else {
      out.positionals.push(a);
      i += 1;
    }
  }
  if (out.positionals.length > 0) {
    const head = out.positionals[0]!;
    const knownCommands = [
      "voice", "coder", "sync", "ingest", "license", "doctor", "install", "help",
    ];
    if (knownCommands.includes(head)) {
      out.command = head;
      out.positionals.shift();
    }
  }
  // Global --mcp / --help only apply when no subcommand matched.
  if (out.flags["mcp"] && out.command === "default") out.command = "mcp";
  if ((out.flags["help"] || out.flags["h"]) && out.command === "default") {
    out.command = "help";
  }
  return out;
}

async function main(): Promise<void> {
  const parsed = parseArgv(process.argv.slice(2));

  switch (parsed.command) {
    case "help":
      console.log(HELP);
      return;

    case "ingest":
      await runIngest({
        sinceDays: parsed.flags["days"] ? Number(parsed.flags["days"]) : undefined,
        limit: parsed.flags["limit"] ? Number(parsed.flags["limit"]) : undefined,
        skipTranscribe: Boolean(parsed.flags["no-transcribe"]),
        reTranscribe: Boolean(parsed.flags["re-transcribe"]),
      });
      return;

    case "license": {
      const sub = parsed.positionals[0] as
        | "activate"
        | "status"
        | "deactivate"
        | undefined;
      if (!sub) {
        log.error("Pass a subcommand: crixin license activate|status|deactivate");
        process.exitCode = 1;
        return;
      }
      const token = parsed.positionals[1];
      runLicense({ sub, token });
      return;
    }

    case "doctor": {
      const code = await runDoctor({
        network: !parsed.flags["no-network"],
        verbose: Boolean(parsed.flags["verbose"]) || Boolean(parsed.flags["v"]),
      });
      if (code !== 0) process.exitCode = code;
      return;
    }

    case "install": {
      // Umbrella installer — wires BOTH MCPs (voice + coder) into every supported host.
      // Escape hatches remain: `crixin voice install` and `crixin coder install`.
      // `--check` runs a non-mutating audit (see runInstallCheck below).
      if (parsed.flags["check"]) {
        const code = runInstallCheck();
        process.exitCode = code;
        return;
      }
      const voiceCode = await runVoice({
        positionals: ["install"],
        flags: parsed.flags,
      });
      const coderCode = await runCoder({
        positionals: ["install"],
        flags: parsed.flags,
      });
      const code = voiceCode !== 0 ? voiceCode : coderCode;
      if (code !== 0) process.exitCode = code;
      return;
    }

    case "mcp": {
      // Top-level alias for `crixin voice mcp`. Lets `claude mcp add crixin
      // -- npx -y crixin --mcp` keep working for existing wirings.
      const code = await runVoice({
        positionals: ["mcp"],
        flags: parsed.flags,
      });
      if (code !== 0) process.exitCode = code;
      return;
    }

    case "voice": {
      const code = await runVoice({
        positionals: parsed.positionals,
        flags: parsed.flags,
      });
      if (code !== 0) process.exitCode = code;
      return;
    }

    case "coder": {
      const code = await runCoder({
        positionals: parsed.positionals,
        flags: parsed.flags,
      });
      if (code !== 0) process.exitCode = code;
      return;
    }

    case "sync": {
      const code = await runSync({
        positionals: parsed.positionals,
        flags: parsed.flags,
      });
      if (code !== 0) process.exitCode = code;
      return;
    }

    case "default":
    default: {
      const port = parsed.flags["port"] ? Number(parsed.flags["port"]) : undefined;
      const open = !parsed.flags["no-open"];
      await runDefault({ port, open });
      return;
    }
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
