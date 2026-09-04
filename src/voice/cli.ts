/**
 * `crixin voice <subcommand>` — sub-router for the voice subsystem.
 *
 * Routes positional + flag args from src/cli/index.ts into:
 *   - call      — place a one-off call from the CLI
 *   - sms       — send an SMS / MMS
 *   - doctor    — verify Twilio creds against the live API (no charges)
 *   - install   — wire the voice MCP into Claude Code / Cursor / Codex / Desktop
 *   - mcp       — run as the stdio MCP server (used by AI hosts via npx)
 *   - help      — print the voice help block
 */
import kleur from "kleur";
import { log } from "../lib/log.js";
import { loadEnv } from "./env.js";
import { TwilioClient, TwilioApiError } from "./twilio/client.js";
import { makeCall } from "./twilio/calls.js";
import { sendSms } from "./twilio/sms.js";
import { PlatformClient, PlatformApiError } from "./platform/client.js";
import { platformMakeCall, platformSendSms } from "./platform/tools.js";
import { runVoiceDoctor } from "./doctor.js";
import { runVoiceInstall } from "./install.js";
import { startVoiceMcpServer } from "./mcp.js";
import { runVoiceIngest } from "./ingest.js";
import { runVoiceWrapped, runCallerArchetype, runDucked } from "./analyze.js";

const VOICE_HELP = `${kleur.bold("crixin voice")} — Voice MCP. Phone access for AI agents through your own Twilio account.

${kleur.gray("Subcommands:")}
  ${kleur.cyan("crixin voice install")} ${kleur.gray("[--project] [--only=…] [--print]")}
                                  Wire the voice MCP into Claude Desktop / Claude Code / Cursor.
  ${kleur.cyan("crixin voice mcp")}              Run the stdio MCP server (used by AI hosts via npx).
  ${kleur.cyan("crixin voice doctor")}           Verify Twilio creds against the live API. No charges.
  ${kleur.cyan("crixin voice call")} ${kleur.gray("<to> [prompt]")}  Place a one-off call. \`to\` is E.164.
  ${kleur.cyan("crixin voice sms")}  ${kleur.gray("<to> <body>")}    Send an SMS through your Twilio number.

${kleur.gray("Analyze (reads your local DB after `crixin voice ingest`):")}
  ${kleur.cyan("crixin voice ingest")} ${kleur.gray("[--days N] [--no-transcribe]")}
                                  Mirror Twilio calls + Deepgram transcripts into local SQLite.
  ${kleur.cyan("crixin voice wrapped")} ${kleur.gray("[--year N]")}   Annual HTML report — your year on the phone (heatmap, archetype, top tags).
  ${kleur.cyan("crixin voice archetype")}         Caller archetype (Quick Pitcher / Patient Listener / Ducker / …).
  ${kleur.cyan("crixin voice ducked")} ${kleur.gray("[--limit N]")}    Phrases your AI uses to dodge questions on calls.

${kleur.gray("Required env (read at startup — BYO Twilio mode):")}
  TWILIO_ACCOUNT_SID
  TWILIO_AUTH_TOKEN
  TWILIO_PHONE_NUMBER         E.164 — the number you dial *from*

${kleur.gray("Platform mode (no Twilio creds needed):")}
  CRIXIN_API_KEY              crx_live_… from the Crixin dashboard — routes calls through the hosted platform
  CRIXIN_API_BASE             optional API origin override

${kleur.gray("Optional env:")}
  DEEPGRAM_API_KEY            for transcribe_call in BYO mode (platform mode transcribes server-side)
  ELEVENLABS_API_KEY          future use
  OPENAI_API_KEY              future use

${kleur.gray("Docs:")} https://crixin.com/voice  ·  https://github.com/THELAZIZAGROUP/crixin
`;

interface VoiceArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export async function runVoice(args: VoiceArgs): Promise<number> {
  const sub = args.positionals[0];

  // Allow `crixin voice --mcp` as an alias for `crixin voice mcp`. The global
  // parser already handles `--mcp` → command="mcp" for sessions; we honor the
  // same pattern here for symmetry with the standalone crixin-voice usage.
  if (sub === "mcp" || args.flags["mcp"]) {
    await startVoiceMcpServer(getCrixinVersion());
    return 0;
  }

  if (sub === "call") {
    const to = args.positionals[1];
    if (!to) {
      log.error("Usage: crixin voice call <to> [prompt] [--consented] [--voice=Polly.Joanna-Neural]");
      return 1;
    }
    const prompt =
      args.positionals.slice(2).join(" ").trim() ||
      "Hello, this is a test call from Crixin Voice.";
    return runOneOffCall(to, prompt, {
      consented: Boolean(args.flags["consented"]),
      voice: typeof args.flags["voice"] === "string" ? args.flags["voice"] : undefined,
    });
  }

  if (sub === "sms") {
    const to = args.positionals[1];
    const body = args.positionals.slice(2).join(" ").trim();
    if (!to || !body) {
      log.error("Usage: crixin voice sms <to> <body>");
      return 1;
    }
    return runOneOffSms(to, body);
  }

  if (sub === "doctor") {
    return runVoiceDoctor();
  }

  if (sub === "install") {
    runVoiceInstall({
      project: Boolean(args.flags["project"]),
      only: typeof args.flags["only"] === "string" ? args.flags["only"] : undefined,
      print: Boolean(args.flags["print"]),
      command: typeof args.flags["command"] === "string" ? args.flags["command"] : undefined,
      uninstall: Boolean(args.flags["uninstall"]),
      migrateLegacy: Boolean(args.flags["migrate-legacy"]),
    });
    return 0;
  }

  if (sub === "ingest") {
    try {
      await runVoiceIngest({
        sinceDays: args.flags["days"] ? Number(args.flags["days"]) : undefined,
        limit: args.flags["limit"] ? Number(args.flags["limit"]) : undefined,
        skipTranscribe: Boolean(args.flags["no-transcribe"]),
        reTranscribe: Boolean(args.flags["re-transcribe"]),
      });
      return 0;
    } catch {
      return 1;
    }
  }

  if (sub === "wrapped") {
    return runVoiceWrapped({
      year: args.flags["year"] ? Number(args.flags["year"]) : undefined,
      out: typeof args.flags["out"] === "string" ? args.flags["out"] : undefined,
    });
  }

  if (sub === "archetype") {
    return runCallerArchetype();
  }

  if (sub === "ducked") {
    return runDucked({
      limit: args.flags["limit"] ? Number(args.flags["limit"]) : undefined,
      json: Boolean(args.flags["json"]),
    });
  }

  if (!sub || sub === "help" || args.flags["help"] || args.flags["h"]) {
    process.stdout.write(VOICE_HELP);
    return 0;
  }

  log.error(`Unknown voice subcommand: ${sub}`);
  process.stdout.write(VOICE_HELP);
  return 1;
}

async function runOneOffCall(
  to: string,
  prompt: string,
  opts: { consented?: boolean; voice?: string } = {},
): Promise<number> {
  try {
    const env = loadEnv();
    const callOpts = {
      to,
      prompt,
      consented: opts.consented,
      voice: opts.voice,
    };
    const result = env.platform
      ? await platformMakeCall(new PlatformClient(env.platform), callOpts)
      : await makeCall(new TwilioClient(env), callOpts);
    log.success(`Call placed: ${result.sid} → ${result.status}`);
    log.hint(`Track with: crixin voice mcp  (or hit GET /Calls/${result.sid}.json)`);
    return 0;
  } catch (caught) {
    return reportError(caught);
  }
}

async function runOneOffSms(to: string, body: string): Promise<number> {
  try {
    const env = loadEnv();
    const result = env.platform
      ? await platformSendSms(new PlatformClient(env.platform), { to, body })
      : await sendSms(new TwilioClient(env), { to, body });
    log.success(`Message sent: ${result.sid} → ${result.status}`);
    return 0;
  } catch (caught) {
    return reportError(caught);
  }
}

function reportError(caught: unknown): number {
  if (caught instanceof PlatformApiError) {
    log.error(caught.message);
    if (caught.status === 401) {
      log.hint(
        "CRIXIN_API_KEY was rejected. Generate a fresh key from the Crixin dashboard, then run `crixin voice doctor`.",
      );
    }
    return 1;
  }
  if (caught instanceof TwilioApiError) {
    log.error(caught.message);
    if (caught.twilioCode === 20003 || caught.status === 401) {
      log.hint("Run `crixin voice doctor` to confirm whether your token works.");
    }
    return 1;
  }
  if (caught instanceof Error) {
    log.error(caught.message);
    return 1;
  }
  log.error(String(caught));
  return 1;
}

/**
 * Best-effort version lookup. Reads the same package.json that crixin's bin
 * resolves so the MCP server reports the right version to the host.
 */
function getCrixinVersion(): string {
  try {
    // dist/voice/cli.js → ../../package.json
    const url = new URL("../../package.json", import.meta.url);
    const txt = require("node:fs").readFileSync(url, "utf8") as string;
    const pkg = JSON.parse(txt) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
