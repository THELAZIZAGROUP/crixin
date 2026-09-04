/**
 * TwiML helpers. Twilio Programmable Voice expects an XML document at the
 * `Url` you pass to its REST `Calls` endpoint, OR you can pass the XML
 * inline through the `Twiml` parameter (preferred — no public webhook needed).
 *
 * Voices reference: https://www.twilio.com/docs/voice/twiml/say/text-speech
 *   - `Polly.Hala-Neural`     — Egyptian Arabic (female)
 *   - `Polly.Zeina`           — Modern Standard Arabic (female)
 *   - `Polly.Joanna-Neural`   — US English (female, neural)
 *   - `Google.en-US-Wavenet-D` — Google Wavenet en-US (male)
 */

interface SayOptions {
  voice?: string;
  language?: string;
  loop?: number;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function say(text: string, opts: SayOptions = {}): string {
  const attrs: string[] = [];
  if (opts.voice) attrs.push(`voice="${escapeXml(opts.voice)}"`);
  if (opts.language) attrs.push(`language="${escapeXml(opts.language)}"`);
  if (opts.loop != null) attrs.push(`loop="${opts.loop}"`);
  return `<Say ${attrs.join(" ")}>${escapeXml(text)}</Say>`;
}

interface RecordOptions {
  /** seconds; default 30; max 14400 */
  maxLength?: number;
  /** seconds of silence before recording stops; default 5 */
  timeout?: number;
  /** key that the recipient can press to end the recording early; default '#' */
  finishOnKey?: string;
  /** automatic Twilio transcription (English-only, charged separately). Default false. */
  transcribe?: boolean;
  /** beep before recording starts; default true */
  playBeep?: boolean;
  /** absolute URL Twilio POSTs to once recording is ready (optional). */
  recordingStatusCallback?: string;
}

export function record(opts: RecordOptions = {}): string {
  const attrs: string[] = [];
  attrs.push(`maxLength="${opts.maxLength ?? 60}"`);
  attrs.push(`timeout="${opts.timeout ?? 5}"`);
  attrs.push(`finishOnKey="${opts.finishOnKey ?? "#"}"`);
  attrs.push(`playBeep="${opts.playBeep === false ? "false" : "true"}"`);
  if (opts.transcribe) attrs.push('transcribe="true"');
  if (opts.recordingStatusCallback) {
    attrs.push(
      `recordingStatusCallback="${escapeXml(opts.recordingStatusCallback)}"`,
      'recordingStatusCallbackMethod="POST"',
    );
  }
  return `<Record ${attrs.join(" ")} />`;
}

export function pause(seconds: number): string {
  return `<Pause length="${Math.max(0, Math.floor(seconds))}" />`;
}

export function hangup(): string {
  return `<Hangup />`;
}

interface PromptAndRecordOptions {
  prompt: string;
  voice?: string;
  language?: string;
  recordOptions?: RecordOptions;
  closingMessage?: string;
}

/**
 * Common pattern: speak a prompt, beep, record up to N seconds, optional
 * closing message, hang up. This is what `make_call` uses by default when
 * you pass a `prompt` instead of a full TwiML payload.
 */
export function promptAndRecord(opts: PromptAndRecordOptions): string {
  const parts: string[] = [];
  parts.push(say(opts.prompt, { voice: opts.voice, language: opts.language }));
  parts.push(pause(1));
  parts.push(record(opts.recordOptions ?? {}));
  if (opts.closingMessage) {
    parts.push(say(opts.closingMessage, { voice: opts.voice, language: opts.language }));
  }
  parts.push(hangup());
  return wrap(parts.join(""));
}

/**
 * Speak-only: read a script and hang up. No recording, no recipient input.
 */
export function speakOnly(message: string, voice?: string, language?: string): string {
  return wrap(say(message, { voice, language }) + hangup());
}

/** Wrap a fragment in the required `<Response>` envelope. */
export function wrap(twimlFragment: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${twimlFragment}</Response>`;
}
