import { TwilioClient } from "./client.js";
import { promptAndRecord, speakOnly } from "../twiml/templates.js";
import { checkDestination } from "../geo-gate.js";

export interface MakeCallOptions {
  /** E.164 destination number, e.g. +201234567890 */
  to: string;
  /**
   * What the assistant should say when the recipient picks up. If `record` is
   * true, they'll be invited to leave a recorded reply after the prompt.
   */
  prompt?: string;
  /** When true, a closing line is spoken before hangup. */
  closingMessage?: string;
  /**
   * Inline TwiML XML to use instead of the built-in prompt/record flow.
   * If you pass this, `prompt` and `record` are ignored.
   */
  twiml?: string;
  /** Public URL that returns TwiML — used instead of inline `twiml`. */
  url?: string;
  /** Whether to record the recipient's response. Default true if `prompt` is set. */
  record?: boolean;
  /** Voice + language for the prompt. Defaults to American English (Polly.Joanna-Neural). */
  voice?: string;
  language?: string;
  /** Max recording length in seconds. */
  maxRecordingSeconds?: number;
  /** Optional URL Twilio hits when call status changes (queued → ringing → in-progress → completed). */
  statusCallback?: string;
  /** Send a transcription request through Twilio's built-in service (English-only). */
  twilioAutoTranscribe?: boolean;
  /** Automatically detect machine pickup vs human; default 'Enable'. */
  machineDetection?: "Enable" | "DetectMessageEnd" | "none";
  /**
   * Attest that the recipient has given prior express consent (and, where
   * required, prior express *written* consent) to receive AI voice calls.
   * Required for destinations in jurisdictions with strict consent regimes
   * (US, UK, EU, etc.). See `src/voice/geo-gate.ts` for the full policy.
   */
  consented?: boolean;
}

export interface CallResource {
  sid: string;
  status: string;
  to: string;
  from: string;
  direction: string;
  duration?: string;
  start_time?: string | null;
  end_time?: string | null;
  price?: string | null;
  price_unit?: string | null;
  uri: string;
}

export class CrixinVoiceGeoError extends Error {
  constructor(
    message: string,
    public readonly country: string,
    public readonly status: string,
  ) {
    super(message);
    this.name = "CrixinVoiceGeoError";
  }
}

export async function makeCall(
  client: TwilioClient,
  opts: MakeCallOptions,
): Promise<CallResource> {
  // Geo-gate: refuse before we hit Twilio, regardless of geo permissions on
  // the Twilio account. Compliance is a product-side concern, not just a
  // carrier-side one.
  const gate = checkDestination(opts.to, { consented: opts.consented });
  if (!gate.ok) {
    throw new CrixinVoiceGeoError(
      `Outbound blocked: ${gate.reason}`,
      gate.country,
      gate.status,
    );
  }

  const body: Record<string, string> = {
    To: opts.to,
    From: client.fromNumber,
  };

  if (opts.url) {
    body["Url"] = opts.url;
  } else {
    const inlineTwiml = opts.twiml ?? buildDefaultTwiml(opts);
    body["Twiml"] = inlineTwiml;
  }

  if (opts.statusCallback) {
    body["StatusCallback"] = opts.statusCallback;
    body["StatusCallbackMethod"] = "POST";
    body["StatusCallbackEvent"] = "initiated ringing answered completed";
  }

  if (opts.machineDetection && opts.machineDetection !== "none") {
    body["MachineDetection"] = opts.machineDetection;
  }

  return client.post<CallResource>("/Calls.json", body);
}

function buildDefaultTwiml(opts: MakeCallOptions): string {
  if (!opts.prompt) {
    throw new Error(
      "makeCall: pass either `twiml`, `url`, or a `prompt` (with optional `record`).",
    );
  }
  const shouldRecord = opts.record !== false;
  if (!shouldRecord) {
    return speakOnly(opts.prompt, opts.voice, opts.language);
  }
  return promptAndRecord({
    prompt: opts.prompt,
    voice: opts.voice,
    language: opts.language,
    closingMessage: opts.closingMessage,
    recordOptions: {
      maxLength: opts.maxRecordingSeconds ?? 60,
      transcribe: opts.twilioAutoTranscribe ?? false,
    },
  });
}

export async function getCall(
  client: TwilioClient,
  callSid: string,
): Promise<CallResource> {
  return client.get<CallResource>(`/Calls/${callSid}.json`);
}

export interface ListCallsOptions {
  to?: string;
  from?: string;
  status?: string;
  /** ISO date — only return calls started after this. */
  startTimeAfter?: string;
  pageSize?: number;
}

interface CallsListResponse {
  calls: CallResource[];
  uri: string;
  next_page_uri?: string | null;
  page: number;
  page_size: number;
}

export async function listCalls(
  client: TwilioClient,
  opts: ListCallsOptions = {},
): Promise<CallResource[]> {
  const query: Record<string, string> = {};
  if (opts.to) query["To"] = opts.to;
  if (opts.from) query["From"] = opts.from;
  if (opts.status) query["Status"] = opts.status;
  if (opts.startTimeAfter) query["StartTime>"] = opts.startTimeAfter;
  query["PageSize"] = String(Math.min(opts.pageSize ?? 50, 1000));
  const res = await client.get<CallsListResponse>("/Calls.json", query);
  return res.calls;
}

export interface CallRecording {
  sid: string;
  call_sid: string;
  duration: string;
  status: string;
  uri: string;
  /** Direct media URL (need the auth header to fetch). */
  media_url: string;
}

interface RecordingsListResponse {
  recordings: Array<{
    sid: string;
    call_sid: string;
    duration: string;
    status: string;
    uri: string;
  }>;
}

export async function listRecordingsForCall(
  client: TwilioClient,
  callSid: string,
): Promise<CallRecording[]> {
  const res = await client.get<RecordingsListResponse>(`/Calls/${callSid}/Recordings.json`);
  return res.recordings.map((r) => ({
    ...r,
    media_url: `https://api.twilio.com/2010-04-01/Accounts${r.uri.replace(/^\/2010-04-01\/Accounts/, "").replace(/\.json$/, ".mp3")}`,
  }));
}
