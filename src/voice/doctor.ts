/**
 * `crixin voice doctor` — verify the voice setup before you try to dial a real
 * number. Catches the three classes of failure that otherwise show up
 * mid-conversation in front of a customer:
 *
 *   1. Missing env vars (loadEnv throws, we report which)
 *   2. Bad E.164 format on TWILIO_PHONE_NUMBER
 *   3. Stale / rotated TWILIO_AUTH_TOKEN — we hit GET /Accounts/{sid}.json
 *      and surface 20003 as "your token was rotated, re-copy from the console"
 *
 * Designed to be cheap (one round-trip, no charges) and safe to run in CI.
 */
import kleur from "kleur";
import { loadEnv, CrixinVoiceConfigError } from "./env.js";
import type { CrixinVoiceEnv } from "./env.js";
import { TwilioClient, TwilioApiError } from "./twilio/client.js";
import { PlatformClient, PlatformApiError } from "./platform/client.js";
import { platformWhoami } from "./platform/tools.js";

interface AccountResource {
  sid: string;
  friendly_name: string;
  status: string; // active | suspended | closed
  type: string;   // Trial | Full
  date_created: string;
}

export async function runVoiceDoctor(): Promise<number> {
  process.stdout.write(kleur.bold("crixin voice doctor\n\n"));

  // 1. Env vars present + structurally valid
  let env;
  try {
    env = loadEnv();
  } catch (caught) {
    if (caught instanceof CrixinVoiceConfigError) {
      printFail("env", caught.message);
      printHint(
        "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER — or set " +
          "CRIXIN_API_KEY (from the Crixin dashboard) to use platform mode without Twilio creds. " +
          "DEEPGRAM_API_KEY is optional (only needed for transcribe_call in BYO mode).",
      );
      return 1;
    }
    throw caught;
  }

  // Platform mode: probe the hosted platform instead of Twilio.
  if (env.platform) {
    return runPlatformDoctor(env.platform);
  }

  printOk("env", "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER all set");

  // Optional keys — surface as info so users know what's wired
  printInfo("DEEPGRAM_API_KEY", env.deepgramApiKey ? "set (transcribe_call ready)" : "not set (transcribe_call will fail)");
  printInfo("ELEVENLABS_API_KEY", env.elevenLabsApiKey ? "set" : "not set");
  printInfo("OPENAI_API_KEY", env.openaiApiKey ? "set" : "not set");

  // 2. SID format sanity (catches obvious copy-paste errors before we hit the API)
  if (!env.twilio.accountSid.startsWith("AC") || env.twilio.accountSid.length !== 34) {
    printFail(
      "format",
      `TWILIO_ACCOUNT_SID looks malformed (expected 34 chars starting with 'AC', got ${env.twilio.accountSid.length} chars). Re-copy from https://console.twilio.com/`,
    );
    return 1;
  }
  if (env.twilio.authToken.length !== 32) {
    printFail(
      "format",
      `TWILIO_AUTH_TOKEN looks malformed (expected 32 chars, got ${env.twilio.authToken.length}). Re-copy from https://console.twilio.com/`,
    );
    return 1;
  }
  printOk("format", `SID ${maskSid(env.twilio.accountSid)} · token len 32 · from ${env.twilio.fromNumber}`);

  // 3. Live probe — single GET to /Accounts/{sid}.json. This is the call that
  //    would have caught my own stale-token issue before I tried to dial.
  process.stdout.write(kleur.gray(`  ↪ probing api.twilio.com/2010-04-01/Accounts/${maskSid(env.twilio.accountSid)}.json …\n`));
  const client = new TwilioClient(env);
  try {
    const account = await client.get<AccountResource>(`.json`);
    printOk(
      "twilio",
      `account active — friendly_name="${account.friendly_name}", type=${account.type}, status=${account.status}`,
    );
    if (account.status !== "active") {
      printHint(
        `Account status is "${account.status}". Calls will fail until it's active again. Check billing at https://console.twilio.com/billing`,
      );
      return 1;
    }
  } catch (caught) {
    if (caught instanceof TwilioApiError) {
      printFail("twilio", caught.message);
      // Show actionable next step depending on Twilio error code
      if (caught.twilioCode === 20003 || caught.status === 401) {
        printHint(
          "Most common cause: TWILIO_AUTH_TOKEN was rotated in the console after you set it in your env / secrets manager. Re-copy and try again.",
        );
      } else if (caught.status === 404) {
        printHint(
          "TWILIO_ACCOUNT_SID points to an account that doesn't exist or you can't see. If you use subaccounts, set TWILIO_SUBACCOUNT_SID + TWILIO_SUBACCOUNT_TOKEN instead.",
        );
      }
      return 1;
    }
    printFail("twilio", caught instanceof Error ? caught.message : String(caught));
    return 1;
  }

  // 4. Geo permissions hint for the most common destinations — don't probe,
  //    just remind. Geo permissions live at the parent account level and
  //    fail per-call (error 21215), not at /Accounts.
  process.stdout.write(
    "\n" +
      kleur.gray(
        "  Outbound geo permissions are per-country. If a real call to (e.g.) Egypt errors with 21215, enable it at:\n  ",
      ) +
      kleur.cyan("https://console.twilio.com/us1/develop/voice/manage/geo-permissions\n"),
  );

  process.stdout.write(kleur.green("\n✓ ready to dial.\n"));
  return 0;
}

/**
 * Platform-mode doctor: one GET /me against the hosted Crixin API. Verifies
 * the API key and shows the plan + minute quota + provisioned caller number.
 */
async function runPlatformDoctor(platform: NonNullable<CrixinVoiceEnv["platform"]>): Promise<number> {
  printOk("env", "CRIXIN_API_KEY set — platform mode (Twilio creds not required)");
  printInfo("CRIXIN_API_BASE", platform.baseUrl);

  process.stdout.write(kleur.gray(`  ↪ probing ${platform.baseUrl}/api/v1/mcp/me …\n`));
  const client = new PlatformClient(platform);
  try {
    const me = await platformWhoami(client);
    const from = me.from_number ?? "no number provisioned yet";
    if (me.unlimited) {
      const premiumLeft =
        typeof me.premium_minutes_remaining === "number" ? `${me.premium_minutes_remaining} premium min left` : "premium minutes n/a";
      const cap = me.call_time_limit_seconds ? `, fair-use cap ${Math.round(me.call_time_limit_seconds / 60)} min/call` : "";
      printOk(
        "platform",
        `key valid — plan=${me.plan} (unlimited calls), next call runs ${me.quality ?? "premium"}, ${premiumLeft}, ${me.minutes_used} min used this period${cap}, from ${from}`,
      );
    } else {
      printOk(
        "platform",
        `key valid — plan=${me.plan}, minutes ${me.minutes_used}/${me.included_minutes} used, from ${from}`,
      );
    }
  } catch (caught) {
    if (caught instanceof PlatformApiError) {
      if (caught.status === 401) {
        printFail("platform", `API key rejected (401 ${caught.code}). ${caught.message}`);
        printHint(
          "CRIXIN_API_KEY is invalid or was revoked. Generate a fresh crx_live_… key from the Crixin dashboard and re-export it.",
        );
        return 1;
      }
      printFail("platform", `${caught.message} (HTTP ${caught.status}, code ${caught.code})`);
      return 1;
    }
    printFail("platform", caught instanceof Error ? caught.message : String(caught));
    printHint("Couldn't reach the platform API. Check your network, or CRIXIN_API_BASE if you've overridden it.");
    return 1;
  }

  process.stdout.write(kleur.green("\n✓ ready to dial (via the Crixin platform).\n"));
  return 0;
}

function printOk(label: string, msg: string): void {
  process.stdout.write(`  ${kleur.green("✓")} ${kleur.bold(label.padEnd(8))} ${msg}\n`);
}
function printFail(label: string, msg: string): void {
  process.stdout.write(`  ${kleur.red("✗")} ${kleur.bold(label.padEnd(8))} ${msg}\n`);
}
function printInfo(label: string, msg: string): void {
  process.stdout.write(`  ${kleur.gray("·")} ${kleur.gray(label.padEnd(20))} ${kleur.gray(msg)}\n`);
}
function printHint(msg: string): void {
  process.stdout.write(`    ${kleur.gray("→ " + msg)}\n`);
}
function maskSid(sid: string): string {
  // Show prefix + last 4 — enough to identify the account without leaking.
  return sid.length > 10 ? `${sid.slice(0, 6)}…${sid.slice(-4)}` : sid;
}
