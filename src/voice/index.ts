// Public library surface — anyone importing `crixin/voice` programmatically
// gets these. The CLI dispatcher lives in src/cli/index.ts and routes
// `crixin voice ...` into src/voice/cli.ts.

export { loadEnv, CrixinVoiceConfigError } from "./env.js";
export type { CrixinVoiceEnv } from "./env.js";

export { TwilioClient, TwilioApiError } from "./twilio/client.js";

export {
  makeCall,
  getCall,
  listCalls,
  listRecordingsForCall,
} from "./twilio/calls.js";
export type {
  MakeCallOptions,
  ListCallsOptions,
  CallResource,
  CallRecording,
} from "./twilio/calls.js";

export { sendSms } from "./twilio/sms.js";
export type { SendSmsOptions, MessageResource } from "./twilio/sms.js";

export { transcribeRecording } from "./twilio/transcribe.js";
export type { TranscribeOptions, TranscriptionResult } from "./twilio/transcribe.js";

export {
  PlatformClient,
  PlatformApiError,
  DEFAULT_PLATFORM_BASE_URL,
} from "./platform/client.js";
export type { PlatformClientOptions } from "./platform/client.js";
export {
  platformMakeCall,
  platformGetCall,
  platformListCalls,
  platformListRecordings,
  platformSendSms,
  platformTranscribeCall,
  platformWhoami,
} from "./platform/tools.js";
export type { PlatformAccount } from "./platform/tools.js";

export {
  say,
  record,
  pause,
  hangup,
  promptAndRecord,
  speakOnly,
  wrap,
  escapeXml,
} from "./twiml/templates.js";

export { startVoiceMcpServer } from "./mcp.js";
export { runVoice } from "./cli.js";
