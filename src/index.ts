// Top-level export for tests / library consumers. The CLI is the primary surface.
export { getDb, closeDb } from "./db/init.js";
export { paths } from "./lib/paths.js";

// Voice subsystem — the entire product as of v0.1.0.
export {
  loadEnv as loadVoiceEnv,
  TwilioClient,
  TwilioApiError,
  PlatformClient,
  PlatformApiError,
  makeCall,
  getCall,
  listCalls,
  listRecordingsForCall,
  sendSms,
  transcribeRecording,
  startVoiceMcpServer,
} from "./voice/index.js";
export type {
  CrixinVoiceEnv,
  MakeCallOptions,
  ListCallsOptions,
  CallResource,
  CallRecording,
  SendSmsOptions,
  MessageResource,
  TranscribeOptions,
  TranscriptionResult,
} from "./voice/index.js";
