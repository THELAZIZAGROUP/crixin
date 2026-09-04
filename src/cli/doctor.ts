/**
 * `crixin doctor` — the support engineer embedded into the CLI.
 *
 * One command, comprehensive health report. Every problem answers:
 *   1. What happened?
 *   2. Why does it matter?
 *   3. How do I fix it?
 *
 * Sections (in fixed order so output is consistent across runs):
 *   - Runtime          Node version, platform
 *   - MCP install      per-host crixin-voice + crixin-coder registration
 *   - Storage          local SQLite + schema version
 *   - Twilio           env + live account-fetch probe (skip with --no-network)
 *   - Deepgram         env + live key-verify probe (skip with --no-network)
 *   - License          Free / Pro
 *
 * Exit codes:
 *   0  healthy enough to use
 *   1  user-actionable failure (something needs fixing)
 *   2  unexpected doctor runtime error (the doctor itself broke)
 *
 * Twilio-specific deep diagnostics live in `crixin voice doctor`.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { platform, arch } from "node:os";
import { getDb } from "../db/init.js";
import { paths } from "../lib/paths.js";
import { isPro } from "../license/features.js";
import { log } from "../lib/log.js";
import { getHostTargets, checkEntryPresent, type EntryStatus, type HostTarget } from "../lib/install-targets.js";
import { loadEnv, CrixinVoiceConfigError } from "../voice/env.js";
import { TwilioClient, TwilioApiError } from "../voice/twilio/client.js";
import kleur from "kleur";

export interface DoctorOpts {
  /** If false, skip outbound API probes (Twilio account fetch, Deepgram key verify). Default: true. */
  network?: boolean;
  /** If true, include raw error messages / stack traces. Default: false. */
  verbose?: boolean;
}

export interface DoctorCheck {
  section: "runtime" | "install" | "storage" | "twilio" | "deepgram" | "license";
  name: string;
  status: "ok" | "warn" | "fail" | "info";
  detail: string;
  /** Optional multi-line fix instructions, printed under the check when status is "fail" or "warn". */
  fix?: string;
}

export async function runDoctor(opts: DoctorOpts = {}): Promise<number> {
  const network = opts.network !== false;
  const checks: DoctorCheck[] = [];

  try {
    checks.push(...checkRuntime());
    checks.push(...checkMcpInstall());
    checks.push(...checkStorage(Boolean(opts.verbose)));
    checks.push(...await checkTwilio({ network, verbose: Boolean(opts.verbose) }));
    checks.push(...await checkDeepgram({ network, verbose: Boolean(opts.verbose) }));
    checks.push(...checkLicense());
  } catch (err) {
    // Doctor itself broke — exit code 2 distinguishes from user-actionable failures
    log.error("doctor: unexpected runtime error");
    log.error(err instanceof Error ? err.message : String(err));
    if (opts.verbose && err instanceof Error && err.stack) log.error(err.stack);
    return 2;
  }

  printReport(checks);

  const failed = checks.filter((c) => c.status === "fail").length;
  return failed > 0 ? 1 : 0;
}

// ─── Section: Runtime ─────────────────────────────────────────────────────────

export function checkRuntime(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const nodeVer = process.versions.node;
  const major = parseInt(nodeVer.split(".")[0] ?? "0", 10);
  if (major >= 22) {
    checks.push({
      section: "runtime",
      name: "Node.js",
      status: "ok",
      detail: `v${nodeVer}`,
    });
  } else {
    checks.push({
      section: "runtime",
      name: "Node.js",
      status: "fail",
      detail: `v${nodeVer} — Crixin requires Node ≥ 22`,
      fix: [
        "Install Node 22 or newer:",
        "    https://nodejs.org/en/download",
        "  Or via Homebrew:",
        "    brew install node",
        "  Then re-run: crixin doctor",
      ].join("\n"),
    });
  }
  checks.push({
    section: "runtime",
    name: "Platform",
    status: "info",
    detail: `${platform()} ${arch()}`,
  });
  return checks;
}

// ─── Section: MCP host registrations ──────────────────────────────────────────

export function checkMcpInstall(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const hosts = getHostTargets();
  for (const t of hosts) {
    const voice = checkEntryPresent(t, "crixin-voice");
    const coder = checkEntryPresent(t, "crixin-coder");
    const c = aggregateHostStatus(t, voice, coder);
    checks.push(c);
  }
  return checks;
}

function aggregateHostStatus(target: HostTarget, voice: EntryStatus, coder: EntryStatus): DoctorCheck {
  // Worst-status wins (legacy/unreadable beat missing beat present)
  if (voice === "legacy-schema" || coder === "legacy-schema") {
    return {
      section: "install",
      name: target.label,
      status: "fail",
      detail: "legacy mcpServers array detected",
      fix: [
        `${target.path} uses the legacy array-shape mcpServers format.`,
        "Run:",
        "    crixin install --migrate-legacy",
        "This writes a .bak file before converting.",
      ].join("\n"),
    };
  }
  if (voice === "unreadable" || coder === "unreadable") {
    return {
      section: "install",
      name: target.label,
      status: "fail",
      detail: "host config unreadable (malformed JSON/TOML)",
      fix: [
        `${target.path} couldn't be parsed.`,
        "Inspect with:",
        `    cat "${target.path}"`,
        "Fix or move the file, then run:",
        "    crixin install",
      ].join("\n"),
    };
  }
  if (voice === "no-config" && coder === "no-config") {
    return {
      section: "install",
      name: target.label,
      status: "warn",
      detail: "no host config present",
      fix: [
        `${target.label} doesn't appear to be installed on this machine.`,
        `If you do use ${target.label}, run:`,
        "    crixin install",
        `If you don't, this warning is safe to ignore.`,
      ].join("\n"),
    };
  }
  if (voice === "present" && coder === "present") {
    return {
      section: "install",
      name: target.label,
      status: "ok",
      detail: "crixin-voice + crixin-coder",
    };
  }
  const missing: string[] = [];
  if (voice !== "present") missing.push("crixin-voice");
  if (coder !== "present") missing.push("crixin-coder");
  return {
    section: "install",
    name: target.label,
    status: "fail",
    detail: `missing: ${missing.join(", ")}`,
    fix: "Run:\n    crixin install",
  };
}

// ─── Section: Storage ─────────────────────────────────────────────────────────

export function checkStorage(verbose: boolean): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  if (!existsSync(paths.dbFile)) {
    checks.push({
      section: "storage",
      name: "SQLite database",
      status: "info",
      detail: `not yet created (${paths.dbFile})`,
      fix: [
        "This is normal if you haven't ingested anything yet. To populate:",
        "    crixin coder ingest        # ingest AI coding history",
        "    crixin voice ingest        # mirror Twilio calls + transcripts",
      ].join("\n"),
    });
    return checks;
  }

  let sizeMb = 0;
  try {
    sizeMb = statSync(paths.dbFile).size / (1024 * 1024);
  } catch {
    checks.push({
      section: "storage",
      name: "SQLite database",
      status: "fail",
      detail: `${paths.dbFile} exists but can't be stat'd`,
      fix: "Check filesystem health. As a last resort, delete the file and re-run crixin coder ingest.",
    });
    return checks;
  }

  let schemaVersion: string | undefined;
  let tableCount = 0;
  let voiceCallCount = 0;
  let sessionCount = 0;
  try {
    const db = getDb();
    schemaVersion = (db
      .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
      .get() as { value?: string } | undefined)?.value;
    tableCount = (db
      .prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
      .get() as { n: number }).n;
    voiceCallCount = (db
      .prepare(`SELECT COUNT(*) AS n FROM voice_calls`)
      .get() as { n: number }).n;
    sessionCount = (db
      .prepare(`SELECT COUNT(*) AS n FROM sessions`)
      .get() as { n: number }).n;
  } catch (err) {
    checks.push({
      section: "storage",
      name: "SQLite database",
      status: "fail",
      detail: `database exists but can't be queried`,
      fix: [
        "This usually means schema corruption or a version mismatch.",
        "Try:",
        `    ls -la "${paths.dbFile}"`,
        "    crixin doctor --verbose       # for the full error",
        "Last resort: back up and delete the DB, then run crixin coder ingest.",
        verbose && err instanceof Error ? `\n  Raw: ${err.message}` : "",
      ].join("\n"),
    });
    return checks;
  }

  checks.push({
    section: "storage",
    name: "SQLite database",
    status: "ok",
    detail: `${paths.dbFile} (${sizeMb.toFixed(1)} MB · ${tableCount} tables)`,
  });
  checks.push({
    section: "storage",
    name: "Schema",
    status: schemaVersion ? "ok" : "warn",
    detail: schemaVersion ? `v${schemaVersion}` : "schema_version row missing (older install?)",
    fix: schemaVersion ? undefined : [
      "The meta table doesn't have a schema_version row.",
      "This is harmless but means migrations can't version-gate.",
      "Re-running an ingest command will repair it:",
      "    crixin coder ingest",
    ].join("\n"),
  });
  checks.push({
    section: "storage",
    name: "Data",
    status: "info",
    detail: `${voiceCallCount.toLocaleString()} call${voiceCallCount === 1 ? "" : "s"} · ${sessionCount.toLocaleString()} coding session${sessionCount === 1 ? "" : "s"}`,
  });
  return checks;
}

// ─── Section: Twilio ──────────────────────────────────────────────────────────

interface AccountResource {
  sid: string;
  friendly_name: string;
  status: string;
  type: string;
  date_created: string;
}

export async function checkTwilio(opts: { network: boolean; verbose: boolean }): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  // Try to load env. Bail out cleanly on missing vars.
  let env;
  try {
    env = loadEnv();
  } catch (caught) {
    if (caught instanceof CrixinVoiceConfigError) {
      const sid = process.env["TWILIO_ACCOUNT_SID"];
      const tok = process.env["TWILIO_AUTH_TOKEN"];
      const num = process.env["TWILIO_PHONE_NUMBER"] ?? process.env["TWILIO_FROM_NUMBER"];
      const missing = [
        !sid && "TWILIO_ACCOUNT_SID",
        !tok && "TWILIO_AUTH_TOKEN",
        !num && "TWILIO_PHONE_NUMBER",
      ].filter(Boolean).join(", ");
      checks.push({
        section: "twilio",
        name: "Credentials",
        status: "warn",
        detail: `missing: ${missing}`,
        fix: [
          "Voice MCP needs these in the env your AI host launches from:",
          "    export TWILIO_ACCOUNT_SID=AC……",
          "    export TWILIO_AUTH_TOKEN=……",
          "    export TWILIO_PHONE_NUMBER=+15555550100",
          "Then re-run: crixin doctor",
          "Without these, make_call won't work — but Coder MCP is unaffected.",
        ].join("\n"),
      });
      return checks;
    }
    throw caught;
  }

  // Platform mode — voice routes through the hosted Crixin API; Twilio creds
  // are optional. Only run the Twilio checks if they're actually set.
  if (env.platform) {
    checks.push({
      section: "twilio",
      name: "Platform",
      status: "ok",
      detail: `platform mode — CRIXIN_API_KEY set, voice routes via ${env.platform.baseUrl}`,
    });
    if (!env.twilio.accountSid && !env.twilio.authToken) {
      checks.push({
        section: "twilio",
        name: "Credentials",
        status: "info",
        detail: "TWILIO_* not set (not needed in platform mode)",
      });
      return checks;
    }
  }

  // Env present — quick structural sanity checks (catches bad copy-paste)
  if (!env.twilio.accountSid.startsWith("AC") || env.twilio.accountSid.length !== 34) {
    checks.push({
      section: "twilio",
      name: "Credentials",
      status: "fail",
      detail: `TWILIO_ACCOUNT_SID malformed (${env.twilio.accountSid.length} chars, expected 34 starting with 'AC')`,
      fix: "Re-copy TWILIO_ACCOUNT_SID from https://console.twilio.com/ Account Info.",
    });
    return checks;
  }
  if (env.twilio.authToken.length !== 32) {
    checks.push({
      section: "twilio",
      name: "Credentials",
      status: "fail",
      detail: `TWILIO_AUTH_TOKEN malformed (${env.twilio.authToken.length} chars, expected 32)`,
      fix: "Re-copy TWILIO_AUTH_TOKEN from https://console.twilio.com/.",
    });
    return checks;
  }
  checks.push({
    section: "twilio",
    name: "Credentials",
    status: "ok",
    detail: `SID ${maskSid(env.twilio.accountSid)} · from ${env.twilio.fromNumber}`,
  });

  // Live probe — skippable
  if (!opts.network) {
    checks.push({
      section: "twilio",
      name: "Account",
      status: "info",
      detail: "live probe skipped (--no-network)",
    });
    return checks;
  }

  try {
    const client = new TwilioClient(env);
    const account = await client.get<AccountResource>(`.json`);
    if (account.status === "active") {
      const trialNote = account.type === "Trial" ? " · trial (verified caller IDs only)" : "";
      checks.push({
        section: "twilio",
        name: "Account",
        status: "ok",
        detail: `active · type ${account.type}${trialNote}`,
      });
      if (account.type === "Trial") {
        checks.push({
          section: "twilio",
          name: "Trial limit",
          status: "warn",
          detail: "Trial accounts can only dial verified caller IDs and prepend a trial message",
          fix: [
            "To dial real customers:",
            "  • Verify destination numbers in the Twilio console, or",
            "  • Upgrade by adding a payment method at https://console.twilio.com/billing",
          ].join("\n"),
        });
      }
    } else {
      checks.push({
        section: "twilio",
        name: "Account",
        status: "fail",
        detail: `status=${account.status}`,
        fix: `Account is "${account.status}". Calls will fail. Check billing at https://console.twilio.com/billing`,
      });
    }
  } catch (caught) {
    if (caught instanceof TwilioApiError) {
      const isAuth = caught.twilioCode === 20003 || caught.status === 401;
      const isNotFound = caught.status === 404;
      checks.push({
        section: "twilio",
        name: "Account",
        status: "fail",
        detail: isAuth
          ? "auth rejected (token rotated or invalid)"
          : isNotFound
            ? "account not found (wrong SID)"
            : `API error: ${caught.message}`,
        fix: isAuth
          ? [
              "TWILIO_AUTH_TOKEN was rotated or never matched. Most common cause: secrets manager out of sync with the live console.",
              "Re-copy from https://console.twilio.com/ and re-export, then:",
              "    crixin doctor",
            ].join("\n")
          : isNotFound
            ? "TWILIO_ACCOUNT_SID points to an account that doesn't exist or isn't visible to your credentials."
            : `Twilio returned ${caught.status}. Detail: ${caught.message}`,
      });
    } else {
      checks.push({
        section: "twilio",
        name: "Account",
        status: "fail",
        detail: "couldn't reach api.twilio.com",
        fix: [
          "Network probe failed. Possible causes:",
          "  • No internet connection",
          "  • Firewall / VPN blocking api.twilio.com",
          "  • Twilio outage (rare — check https://status.twilio.com)",
          opts.verbose && caught instanceof Error ? `\n  Raw: ${caught.message}` : "",
          "",
          "To skip this probe: crixin doctor --no-network",
        ].filter(Boolean).join("\n"),
      });
    }
  }
  return checks;
}

// ─── Section: Deepgram ────────────────────────────────────────────────────────

export async function checkDeepgram(opts: { network: boolean; verbose: boolean }): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const key = process.env["DEEPGRAM_API_KEY"];
  if (!key) {
    checks.push({
      section: "deepgram",
      name: "API key",
      status: "info",
      detail: "DEEPGRAM_API_KEY not set",
      fix: [
        "Deepgram is optional. Without it, calls still work but transcription, Voice Wrapped,",
        "Caller Archetype, and Ducked-phrase analysis are unavailable.",
        "To enable: get a key at https://console.deepgram.com/ and:",
        "    export DEEPGRAM_API_KEY=……",
      ].join("\n"),
    });
    return checks;
  }
  checks.push({
    section: "deepgram",
    name: "API key",
    status: "ok",
    detail: `set (${key.slice(0, 6)}…)`,
  });

  if (!opts.network) {
    checks.push({
      section: "deepgram",
      name: "Reachable",
      status: "info",
      detail: "live probe skipped (--no-network)",
    });
    return checks;
  }

  try {
    // Cheapest probe: GET /v1/projects with the API key. Returns 200 + JSON on success;
    // 401 on bad key; network error on no connectivity. Zero cost.
    const r = await fetch("https://api.deepgram.com/v1/projects", {
      method: "GET",
      headers: { Authorization: `Token ${key}` },
    });
    if (r.ok) {
      checks.push({
        section: "deepgram",
        name: "Reachable",
        status: "ok",
        detail: "api.deepgram.com responded (transcribe_call ready)",
      });
    } else if (r.status === 401) {
      checks.push({
        section: "deepgram",
        name: "Reachable",
        status: "fail",
        detail: "API key rejected (401)",
        fix: [
          "DEEPGRAM_API_KEY is set but Deepgram returned 401. The key was rotated,",
          "revoked, or never matched. Re-copy from https://console.deepgram.com/ and re-export.",
        ].join("\n"),
      });
    } else if (r.status === 429) {
      checks.push({
        section: "deepgram",
        name: "Reachable",
        status: "warn",
        detail: "Deepgram rate-limited (429)",
        fix: "You've hit a rate or quota limit. Check https://console.deepgram.com/usage. Wait and retry.",
      });
    } else {
      checks.push({
        section: "deepgram",
        name: "Reachable",
        status: "fail",
        detail: `Deepgram returned ${r.status}`,
        fix: opts.verbose ? `Status ${r.status}. Run with --verbose for the response body.` : "Run crixin doctor --verbose for more.",
      });
    }
  } catch (caught) {
    checks.push({
      section: "deepgram",
      name: "Reachable",
      status: "fail",
      detail: "couldn't reach api.deepgram.com",
      fix: [
        "Network probe failed. Possible causes:",
        "  • No internet connection",
        "  • Firewall / VPN blocking api.deepgram.com",
        opts.verbose && caught instanceof Error ? `\n  Raw: ${caught.message}` : "",
        "",
        "To skip this probe: crixin doctor --no-network",
      ].filter(Boolean).join("\n"),
    });
  }
  return checks;
}

// ─── Section: License ─────────────────────────────────────────────────────────

export function checkLicense(): DoctorCheck[] {
  return [
    {
      section: "license",
      name: "Tier",
      status: "info",
      detail: isPro() ? "Pro" : "Free",
      fix: isPro() ? undefined : "Pro ($5/mo) adds hosted Wrapped + cross-machine memory sync. https://crixin.com/install",
    },
  ];
}

// ─── Output rendering ─────────────────────────────────────────────────────────

function maskSid(sid: string): string {
  return sid.length > 10 ? `${sid.slice(0, 6)}…${sid.slice(-4)}` : sid;
}

function dot(status: DoctorCheck["status"]): string {
  switch (status) {
    case "ok":   return kleur.green("✓");
    case "warn": return kleur.yellow("!");
    case "fail": return kleur.red("✗");
    case "info": return kleur.gray("·");
  }
}

const SECTION_LABELS: Record<DoctorCheck["section"], string> = {
  runtime: "Runtime",
  install: "MCP host registrations",
  storage: "Storage",
  twilio:  "Twilio",
  deepgram: "Deepgram",
  license: "License",
};

const SECTION_ORDER: DoctorCheck["section"][] = ["runtime", "install", "storage", "twilio", "deepgram", "license"];

export function printReport(checks: DoctorCheck[]): void {
  process.stdout.write("\n" + kleur.bold("crixin doctor") + "\n");

  for (const section of SECTION_ORDER) {
    const inSection = checks.filter((c) => c.section === section);
    if (inSection.length === 0) continue;
    process.stdout.write("\n" + kleur.bold(SECTION_LABELS[section]) + "\n");
    for (const c of inSection) {
      const namePad = c.name.padEnd(20);
      process.stdout.write(`  ${dot(c.status)} ${namePad} ${kleur.gray(c.detail)}\n`);
      if (c.fix && (c.status === "fail" || c.status === "warn")) {
        for (const line of c.fix.split("\n")) {
          process.stdout.write("      " + kleur.gray(line) + "\n");
        }
      }
    }
  }

  process.stdout.write("\n");
  const failed = checks.filter((c) => c.status === "fail");
  const warned = checks.filter((c) => c.status === "warn");
  if (failed.length === 0 && warned.length === 0) {
    process.stdout.write(kleur.green(kleur.bold("Overall: HEALTHY")) + " — ready to use.\n");
  } else if (failed.length === 0) {
    process.stdout.write(kleur.yellow(kleur.bold(`Overall: USABLE`)) + ` — ${warned.length} warning${warned.length === 1 ? "" : "s"} above.\n`);
  } else {
    process.stdout.write(
      kleur.red(kleur.bold("Overall: NEEDS ATTENTION")) +
        ` — ${failed.length} failing check${failed.length === 1 ? "" : "s"} above.\n`,
    );
  }
}
