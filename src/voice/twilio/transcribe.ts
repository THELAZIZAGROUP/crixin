import { TwilioClient } from "./client.js";

/**
 * Pull a recording's audio bytes from Twilio (auth required) and run them
 * through Deepgram for high-quality transcription. Deepgram supports 30+
 * languages including Arabic dialects, which Twilio's built-in transcription
 * does not.
 *
 * Pass DEEPGRAM_API_KEY in env or `apiKey` in opts.
 */

export interface TranscribeOptions {
  /** Recording SID from listRecordingsForCall(). */
  recordingSid: string;
  /** Deepgram model — 'nova-2' (default), 'nova-2-general', 'enhanced', 'base'. */
  model?: string;
  /** ISO 639-1 language tag, e.g. 'en', 'ar', 'es'. Pass 'auto' to detect. */
  language?: string;
  /** Detect speakers (true/false). Adds latency. */
  diarize?: boolean;
  /** Punctuate the output. Default true. */
  punctuate?: boolean;
  /** Deepgram API key (overrides env). */
  apiKey?: string;
}

export interface TranscriptionResult {
  recordingSid: string;
  language: string | null;
  durationSeconds: number | null;
  transcript: string;
  confidence: number | null;
  words: Array<{ word: string; start: number; end: number; confidence?: number }>;
  raw: unknown;
}

export async function transcribeRecording(
  client: TwilioClient,
  opts: TranscribeOptions,
  apiKey: string | undefined = process.env["DEEPGRAM_API_KEY"],
): Promise<TranscriptionResult> {
  const key = opts.apiKey ?? apiKey;
  if (!key) {
    throw new Error(
      "transcribeRecording: no Deepgram API key. Set DEEPGRAM_API_KEY in env or pass `apiKey`.",
    );
  }

  // Pull the audio from Twilio. We need the auth header — public anonymous
  // download doesn't work even though the URL is HTTPS.
  const audioRes = await client.getRaw(`/Recordings/${opts.recordingSid}.mp3`);
  if (!audioRes.ok) {
    throw new Error(`Twilio recording fetch failed: ${audioRes.status} ${audioRes.statusText}`);
  }
  const audioBuf = Buffer.from(await audioRes.arrayBuffer());

  const params = new URLSearchParams();
  params.set("model", opts.model ?? "nova-2");
  if (opts.language) params.set("language", opts.language);
  params.set("punctuate", opts.punctuate === false ? "false" : "true");
  if (opts.diarize) params.set("diarize", "true");

  const dgRes = await fetch(
    `https://api.deepgram.com/v1/listen?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${key}`,
        "Content-Type": "audio/mp3",
      },
      body: audioBuf,
    },
  );
  if (!dgRes.ok) {
    const text = await dgRes.text().catch(() => "");
    throw new Error(`Deepgram transcribe failed (${dgRes.status}): ${text}`);
  }
  const json = (await dgRes.json()) as DeepgramResponse;
  const channel = json.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];

  return {
    recordingSid: opts.recordingSid,
    language: channel?.detected_language ?? opts.language ?? null,
    durationSeconds: json.metadata?.duration ?? null,
    transcript: alt?.transcript ?? "",
    confidence: alt?.confidence ?? null,
    words: alt?.words ?? [],
    raw: json,
  };
}

interface DeepgramResponse {
  metadata?: { duration?: number };
  results?: {
    channels?: Array<{
      detected_language?: string;
      alternatives?: Array<{
        transcript?: string;
        confidence?: number;
        words?: Array<{ word: string; start: number; end: number; confidence?: number }>;
      }>;
    }>;
  };
}
