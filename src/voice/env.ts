/**
 * Voice credential loader. Pulls Twilio creds (and optional Deepgram /
 * ElevenLabs keys for future TTS / transcription enrichment) from env vars.
 *
 * crixin voice intentionally does NOT call Doppler / Vault / 1Password — the
 * user injects whatever secret manager they prefer through env. This keeps
 * the package zero-dependency at runtime.
 *
 * Platform mode: when CRIXIN_API_KEY is set (crx_live_…), the voice tools
 * route through Crixin's hosted platform and the TWILIO_* vars become
 * optional. They're still validated and included when present, so a machine
 * with both configured can keep using direct-Twilio paths (e.g. ingest).
 */

import { DEFAULT_PLATFORM_BASE_URL } from "./platform/client.js";

export interface CrixinVoiceEnv {
  twilio: {
    /** Empty string in platform mode when TWILIO_ACCOUNT_SID isn't set. */
    accountSid: string;
    /** Empty string in platform mode when TWILIO_AUTH_TOKEN isn't set. */
    authToken: string;
    /** E.164 number to place outbound calls from. Empty string in platform mode when unset. */
    fromNumber: string;
    /**
     * Optional: when set, all calls go through this subaccount. Lets a single
     * Twilio master account fan out to multiple isolated workspaces.
     */
    subaccountSid?: string;
    subaccountToken?: string;
  };
  /** Set when CRIXIN_API_KEY is present — voice tools route through the platform. */
  platform?: {
    apiKey: string;
    /** Origin (no trailing slash). CRIXIN_API_BASE override or the default. */
    baseUrl: string;
  };
  /** Optional: only needed if you ask `transcribe_call` to use Deepgram. */
  deepgramApiKey?: string;
  /** Optional: only needed if you ask `make_call` for ElevenLabs voices. */
  elevenLabsApiKey?: string;
  /** Optional: lets the MCP tool render LLM-driven prompts via OpenAI. */
  openaiApiKey?: string;
}

export class CrixinVoiceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrixinVoiceConfigError";
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): CrixinVoiceEnv {
  const apiKey = source["CRIXIN_API_KEY"];
  const platform = apiKey
    ? {
        apiKey,
        baseUrl: (source["CRIXIN_API_BASE"] ?? DEFAULT_PLATFORM_BASE_URL).replace(/\/+$/, ""),
      }
    : undefined;

  const accountSid = source["TWILIO_ACCOUNT_SID"];
  const authToken = source["TWILIO_AUTH_TOKEN"];
  const fromNumber = source["TWILIO_PHONE_NUMBER"] ?? source["TWILIO_FROM_NUMBER"];

  if (!platform) {
    if (!accountSid) {
      throw new CrixinVoiceConfigError(
        "Missing TWILIO_ACCOUNT_SID. Export it from your secrets manager or set it in the host's env.",
      );
    }
    if (!authToken) {
      throw new CrixinVoiceConfigError(
        "Missing TWILIO_AUTH_TOKEN. Export it from your secrets manager or set it in the host's env.",
      );
    }
    if (!fromNumber) {
      throw new CrixinVoiceConfigError(
        "Missing TWILIO_PHONE_NUMBER (or TWILIO_FROM_NUMBER). Set the E.164 number you want to dial from.",
      );
    }
  }
  if (fromNumber && !fromNumber.startsWith("+")) {
    throw new CrixinVoiceConfigError(
      `TWILIO_PHONE_NUMBER must be E.164 (start with '+'). Got: ${fromNumber}`,
    );
  }

  return {
    twilio: {
      accountSid: accountSid ?? "",
      authToken: authToken ?? "",
      fromNumber: fromNumber ?? "",
      subaccountSid: source["TWILIO_SUBACCOUNT_SID"],
      subaccountToken: source["TWILIO_SUBACCOUNT_TOKEN"],
    },
    platform,
    deepgramApiKey: source["DEEPGRAM_API_KEY"],
    elevenLabsApiKey: source["ELEVENLABS_API_KEY"],
    openaiApiKey: source["OPENAI_API_KEY"],
  };
}
