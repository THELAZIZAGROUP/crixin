/**
 * Platform-mode implementations of the six voice tools. Same signatures and
 * return shapes as the direct-Twilio handlers in src/voice/twilio/, so the
 * MCP dispatcher and CLI can swap backends without touching call sites.
 *
 * The geo-gate stays LOCAL even in platform mode: we refuse before any bytes
 * leave the machine, exactly like src/voice/twilio/calls.ts does.
 */

import { PlatformClient } from "./client.js";
import { checkDestination } from "../geo-gate.js";
import { CrixinVoiceGeoError } from "../twilio/calls.js";
import type {
  MakeCallOptions,
  ListCallsOptions,
  CallResource,
  CallRecording,
} from "../twilio/calls.js";
import type { SendSmsOptions, MessageResource } from "../twilio/sms.js";
import type { TranscribeOptions, TranscriptionResult } from "../twilio/transcribe.js";

export async function platformMakeCall(
  client: PlatformClient,
  opts: MakeCallOptions,
): Promise<CallResource> {
  // Geo-gate before the wire — compliance is enforced client-side regardless
  // of what the platform allows.
  const gate = checkDestination(opts.to, { consented: opts.consented });
  if (!gate.ok) {
    throw new CrixinVoiceGeoError(
      `Outbound blocked: ${gate.reason}`,
      gate.country,
      gate.status,
    );
  }

  return client.post<CallResource>("/calls", {
    to: opts.to,
    prompt: opts.prompt,
    closing_message: opts.closingMessage,
    twiml: opts.twiml,
    url: opts.url,
    record: opts.record,
    voice: opts.voice,
    language: opts.language,
    max_recording_seconds: opts.maxRecordingSeconds,
    machine_detection: opts.machineDetection,
    consented: opts.consented,
  });
}

export async function platformGetCall(
  client: PlatformClient,
  callSid: string,
): Promise<CallResource> {
  return client.get<CallResource>(`/calls/${callSid}`);
}

export async function platformListCalls(
  client: PlatformClient,
  opts: ListCallsOptions = {},
): Promise<CallResource[]> {
  return client.get<CallResource[]>("/calls", {
    to: opts.to,
    from: opts.from,
    status: opts.status,
    start_time_after: opts.startTimeAfter,
    page_size: opts.pageSize,
  });
}

export async function platformListRecordings(
  client: PlatformClient,
  callSid: string,
): Promise<CallRecording[]> {
  return client.get<CallRecording[]>(`/calls/${callSid}/recordings`);
}

export async function platformSendSms(
  client: PlatformClient,
  opts: SendSmsOptions,
): Promise<MessageResource> {
  return client.post<MessageResource>("/sms", {
    to: opts.to,
    body: opts.body,
    media_url: opts.mediaUrl,
  });
}

interface PlatformTranscriptionPayload {
  recording_sid: string;
  language: string | null;
  duration_seconds: number | null;
  transcript: string;
  confidence: number | null;
  words: Array<{ word: string; start: number; end: number; confidence?: number }>;
}

export async function platformTranscribeCall(
  client: PlatformClient,
  opts: TranscribeOptions,
): Promise<TranscriptionResult> {
  // The platform runs Deepgram server-side — no local DEEPGRAM_API_KEY needed.
  const data = await client.post<PlatformTranscriptionPayload>("/transcribe", {
    recording_sid: opts.recordingSid,
    language: opts.language,
    model: opts.model,
    diarize: opts.diarize,
  });
  return {
    recordingSid: data.recording_sid,
    language: data.language ?? null,
    durationSeconds: data.duration_seconds ?? null,
    transcript: data.transcript ?? "",
    confidence: data.confidence ?? null,
    words: data.words ?? [],
    raw: data,
  };
}

export interface PlatformAccount {
  user_id: string;
  plan: string;
  included_minutes: number;
  minutes_used: number;
  from_number: string | null;
  /** Unlimited plan: minutes never block; quality steps down instead. */
  unlimited?: boolean;
  /** Rung the next call runs at. */
  quality?: "premium" | "standard" | "basic";
  premium_minutes_used?: number;
  premium_minutes_remaining?: number | null;
  /** Per-call cap once past the fair-use line, else null. */
  call_time_limit_seconds?: number | null;
}

/** GET /me — used by `crixin voice doctor` to verify the API key + show quota. */
export async function platformWhoami(client: PlatformClient): Promise<PlatformAccount> {
  return client.get<PlatformAccount>("/me");
}
