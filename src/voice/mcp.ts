import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadEnv } from "./env.js";
import { TwilioClient } from "./twilio/client.js";
import {
  makeCall,
  getCall,
  listCalls,
  listRecordingsForCall,
} from "./twilio/calls.js";
import type {
  MakeCallOptions,
  ListCallsOptions,
  CallResource,
  CallRecording,
} from "./twilio/calls.js";
import { sendSms } from "./twilio/sms.js";
import type { SendSmsOptions, MessageResource } from "./twilio/sms.js";
import { transcribeRecording } from "./twilio/transcribe.js";
import type { TranscribeOptions, TranscriptionResult } from "./twilio/transcribe.js";
import { PlatformClient } from "./platform/client.js";
import {
  platformMakeCall,
  platformGetCall,
  platformListCalls,
  platformListRecordings,
  platformSendSms,
  platformTranscribeCall,
} from "./platform/tools.js";

/** Backend-agnostic surface the tool dispatcher routes through. */
interface VoiceToolHandlers {
  makeCall(opts: MakeCallOptions): Promise<CallResource>;
  getCall(callSid: string): Promise<CallResource>;
  listCalls(opts: ListCallsOptions): Promise<CallResource[]>;
  listRecordings(callSid: string): Promise<CallRecording[]>;
  sendSms(opts: SendSmsOptions): Promise<MessageResource>;
  transcribeCall(opts: TranscribeOptions): Promise<TranscriptionResult>;
}

function buildHandlers(): VoiceToolHandlers {
  const env = loadEnv();

  if (env.platform) {
    // Platform mode — every tool routes through the hosted Crixin API.
    const client = new PlatformClient(env.platform);
    return {
      makeCall: (opts) => platformMakeCall(client, opts),
      getCall: (sid) => platformGetCall(client, sid),
      listCalls: (opts) => platformListCalls(client, opts),
      listRecordings: (sid) => platformListRecordings(client, sid),
      sendSms: (opts) => platformSendSms(client, opts),
      transcribeCall: (opts) => platformTranscribeCall(client, opts),
    };
  }

  // BYO Twilio — unchanged direct path.
  const client = new TwilioClient(env);
  return {
    makeCall: (opts) => makeCall(client, opts),
    getCall: (sid) => getCall(client, sid),
    listCalls: (opts) => listCalls(client, opts),
    listRecordings: (sid) => listRecordingsForCall(client, sid),
    sendSms: (opts) => sendSms(client, opts),
    transcribeCall: (opts) => transcribeRecording(client, opts),
  };
}

/**
 * crixin voice MCP server (stdio).
 *
 * Tools exposed to LLM hosts (Claude Code, Cursor, Codex CLI, Claude Desktop):
 *   - make_call           — place a Twilio outbound voice call
 *   - get_call            — fetch the status / metadata of a call by SID
 *   - list_calls          — list recent calls (filter by direction/status/range)
 *   - list_recordings     — list recordings for a call SID
 *   - transcribe_call     — transcribe a recording via Deepgram
 *   - send_sms            — send an SMS / MMS message
 *
 * Auth: read from process.env at startup. Two modes:
 *   - Platform mode — CRIXIN_API_KEY set (crx_live_…): tools route through
 *     Crixin's hosted platform API. No TWILIO_* creds needed locally.
 *   - BYO Twilio — no CRIXIN_API_KEY: tools hit Twilio directly with the
 *     TWILIO_* creds. The host can pass them via Doppler / 1Password / a
 *     plain `.env` — crixin voice doesn't care.
 *
 * The server lazily constructs the backend on first tool call so a
 * misconfigured environment doesn't crash MCP host startup.
 */
// Directory review rules (Anthropic, OpenAI): every tool carries a title and
// readOnlyHint / destructiveHint. A placed call or a sent SMS cannot be undone,
// so the two side-effecting tools are marked destructive — hosts then confirm.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const SIDE_EFFECT = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;

export async function startVoiceMcpServer(version: string): Promise<void> {
  let handlers: VoiceToolHandlers | null = null;
  const getHandlers = (): VoiceToolHandlers => {
    if (!handlers) handlers = buildHandlers();
    return handlers;
  };

  const server = new Server(
    { name: "crixin-voice", version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "make_call",
        title: "Place a phone call",
        annotations: { title: "Place a phone call", ...SIDE_EFFECT },
        description:
          "Place an outbound voice call through Twilio. Pass a `to` number (E.164 like +201234567890) and either a `prompt` (the assistant will speak it; recipient response is recorded by default) or raw `twiml` for full control. Returns the Call SID and initial status.",
        inputSchema: {
          type: "object",
          properties: {
            to: {
              type: "string",
              description: "E.164 destination number, e.g. +201234567890",
            },
            prompt: {
              type: "string",
              description:
                "What the assistant should say when the recipient picks up. If `record` is not false, a recording prompt is appended.",
            },
            closing_message: {
              type: "string",
              description: "Optional final line spoken before hangup.",
            },
            twiml: {
              type: "string",
              description:
                "Inline TwiML XML to use instead of the prompt/record flow. If set, `prompt` is ignored.",
            },
            url: {
              type: "string",
              description:
                "Public URL Twilio fetches for TwiML. Use this only if you need stateful flows. Leave empty to inline TwiML.",
            },
            record: {
              type: "boolean",
              default: true,
              description:
                "Whether to record the recipient's reply after the prompt. Ignored when `twiml` or `url` is supplied.",
            },
            voice: {
              type: "string",
              description:
                "Twilio TTS voice. e.g. 'Polly.Joanna-Neural' (en-US), 'Polly.Hala-Neural' (ar-EG), 'Polly.Zeina' (ar-MSA), 'Google.en-US-Wavenet-D'. Default Polly.Joanna-Neural.",
              default: "Polly.Joanna-Neural",
            },
            language: {
              type: "string",
              description: "Locale tag matching the voice, e.g. 'en-US', 'ar-EG'.",
            },
            max_recording_seconds: {
              type: "integer",
              minimum: 1,
              maximum: 14400,
              default: 60,
            },
            machine_detection: {
              type: "string",
              enum: ["Enable", "DetectMessageEnd", "none"],
              default: "Enable",
              description:
                "Whether Twilio should detect voicemail. 'DetectMessageEnd' waits for the beep before TwiML runs.",
            },
            status_callback: {
              type: "string",
              description:
                "Optional public URL Twilio POSTs to as the call progresses (initiated → ringing → answered → completed).",
            },
            consented: {
              type: "boolean",
              default: false,
              description:
                "Attest that the recipient has given prior express consent (and, where required by law, prior express WRITTEN consent) to receive this AI voice call. Required for destinations in strict-consent jurisdictions (US, UK, EU, AU, NZ). Leave false for permissive jurisdictions (Egypt, UAE, KSA, etc.) — the geo-gate will allow those by default.",
            },
          },
          required: ["to"],
        },
      },
      {
        name: "get_call",
        title: "Get call status",
        annotations: { title: "Get call status", ...READ_ONLY },
        description: "Look up a single call by SID. Returns status, duration, price, timestamps.",
        inputSchema: {
          type: "object",
          properties: { call_sid: { type: "string" } },
          required: ["call_sid"],
        },
      },
      {
        name: "list_calls",
        title: "List recent calls",
        annotations: { title: "List recent calls", ...READ_ONLY },
        description:
          "List recent calls. Filter by `to`, `from`, `status`, or `start_time_after` (ISO timestamp).",
        inputSchema: {
          type: "object",
          properties: {
            to: { type: "string" },
            from: { type: "string" },
            status: {
              type: "string",
              enum: [
                "queued",
                "ringing",
                "in-progress",
                "completed",
                "busy",
                "failed",
                "no-answer",
                "canceled",
              ],
            },
            start_time_after: {
              type: "string",
              description: "ISO 8601 timestamp.",
            },
            page_size: {
              type: "integer",
              default: 50,
              minimum: 1,
              maximum: 1000,
            },
          },
        },
      },
      {
        name: "list_recordings",
        title: "List call recordings",
        annotations: { title: "List call recordings", ...READ_ONLY },
        description:
          "List recordings attached to a call. Returns SIDs, durations, and direct media URLs (auth-protected).",
        inputSchema: {
          type: "object",
          properties: { call_sid: { type: "string" } },
          required: ["call_sid"],
        },
      },
      {
        name: "transcribe_call",
        title: "Transcribe a recording",
        annotations: { title: "Transcribe a recording", ...READ_ONLY },
        description:
          "Transcribe a Twilio recording via Deepgram. Supports Arabic (ar), English (en), Spanish (es), and 30+ other languages. Requires DEEPGRAM_API_KEY in env.",
        inputSchema: {
          type: "object",
          properties: {
            recording_sid: { type: "string" },
            language: {
              type: "string",
              description: "ISO 639-1 code, e.g. 'ar', 'en'. Pass 'auto' to detect.",
            },
            model: {
              type: "string",
              default: "nova-2",
              description: "Deepgram model name. Default 'nova-2'.",
            },
            diarize: {
              type: "boolean",
              default: false,
              description: "Detect distinct speakers.",
            },
          },
          required: ["recording_sid"],
        },
      },
      {
        name: "send_sms",
        title: "Send an SMS",
        annotations: { title: "Send an SMS", ...SIDE_EFFECT },
        description:
          "Send an SMS or MMS via Twilio. Pass `media_url` for MMS. Use `messaging_service_sid` for sticky-sender behavior.",
        inputSchema: {
          type: "object",
          properties: {
            to: { type: "string", description: "E.164 destination" },
            body: { type: "string", description: "Message text. SMS auto-segments past 160 chars." },
            messaging_service_sid: { type: "string" },
            media_url: { type: "string" },
            status_callback: { type: "string" },
          },
          required: ["to", "body"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;

    try {
      const tools = getHandlers();

      if (name === "make_call") {
        const result = await tools.makeCall({
          to: requireString(args, "to"),
          prompt: optionalString(args, "prompt"),
          closingMessage: optionalString(args, "closing_message"),
          twiml: optionalString(args, "twiml"),
          url: optionalString(args, "url"),
          record: args["record"] !== false,
          voice: optionalString(args, "voice") ?? "Polly.Joanna-Neural",
          language: optionalString(args, "language"),
          maxRecordingSeconds: optionalInt(args, "max_recording_seconds") ?? 60,
          machineDetection:
            (optionalString(args, "machine_detection") as
              | "Enable"
              | "DetectMessageEnd"
              | "none"
              | undefined) ?? "Enable",
          statusCallback: optionalString(args, "status_callback"),
          consented: args["consented"] === true,
        });
        return ok({
          sid: result.sid,
          status: result.status,
          to: result.to,
          from: result.from,
          direction: result.direction,
          start_time: result.start_time ?? null,
        });
      }

      if (name === "get_call") {
        const result = await tools.getCall(requireString(args, "call_sid"));
        return ok(result);
      }

      if (name === "list_calls") {
        const result = await tools.listCalls({
          to: optionalString(args, "to"),
          from: optionalString(args, "from"),
          status: optionalString(args, "status"),
          startTimeAfter: optionalString(args, "start_time_after"),
          pageSize: optionalInt(args, "page_size"),
        });
        return ok(result);
      }

      if (name === "list_recordings") {
        const result = await tools.listRecordings(requireString(args, "call_sid"));
        return ok(result);
      }

      if (name === "transcribe_call") {
        const result = await tools.transcribeCall({
          recordingSid: requireString(args, "recording_sid"),
          language: optionalString(args, "language"),
          model: optionalString(args, "model"),
          diarize: args["diarize"] === true,
        });
        return ok({
          recording_sid: result.recordingSid,
          language: result.language,
          duration_seconds: result.durationSeconds,
          transcript: result.transcript,
          confidence: result.confidence,
          word_count: result.words.length,
        });
      }

      if (name === "send_sms") {
        const result = await tools.sendSms({
          to: requireString(args, "to"),
          body: requireString(args, "body"),
          messagingServiceSid: optionalString(args, "messaging_service_sid"),
          mediaUrl: optionalString(args, "media_url"),
          statusCallback: optionalString(args, "status_callback"),
        });
        return ok({
          sid: result.sid,
          status: result.status,
          to: result.to,
          num_segments: result.num_segments,
          date_created: result.date_created,
        });
      }

      return err(`Unknown tool: ${name}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return err(message);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required string argument: ${key}`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalInt(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return parseInt(value, 10);
  return undefined;
}

function ok(payload: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
  };
}

function err(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}
