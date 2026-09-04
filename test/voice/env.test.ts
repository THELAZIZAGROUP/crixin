import { test } from "node:test";
import { strict as assert } from "node:assert";
import { loadEnv, CrixinVoiceConfigError } from "../../src/voice/env.js";

test("voice loadEnv throws when TWILIO_ACCOUNT_SID is missing", () => {
  assert.throws(
    () =>
      loadEnv({
        TWILIO_AUTH_TOKEN: "x",
        TWILIO_PHONE_NUMBER: "+15555550100",
      } as unknown as NodeJS.ProcessEnv),
    CrixinVoiceConfigError,
  );
});

test("voice loadEnv throws when TWILIO_AUTH_TOKEN is missing", () => {
  assert.throws(
    () =>
      loadEnv({
        TWILIO_ACCOUNT_SID: "AC123",
        TWILIO_PHONE_NUMBER: "+15555550100",
      } as unknown as NodeJS.ProcessEnv),
    CrixinVoiceConfigError,
  );
});

test("voice loadEnv rejects non-E.164 numbers", () => {
  assert.throws(
    () =>
      loadEnv({
        TWILIO_ACCOUNT_SID: "AC123",
        TWILIO_AUTH_TOKEN: "tok",
        TWILIO_PHONE_NUMBER: "5555550100",
      } as unknown as NodeJS.ProcessEnv),
    /E\.164/,
  );
});

test("voice loadEnv accepts a complete config and surfaces optional keys", () => {
  const env = loadEnv({
    TWILIO_ACCOUNT_SID: "AC123",
    TWILIO_AUTH_TOKEN: "tok",
    TWILIO_PHONE_NUMBER: "+15555550100",
    TWILIO_SUBACCOUNT_SID: "AC456",
    TWILIO_SUBACCOUNT_TOKEN: "subtok",
    DEEPGRAM_API_KEY: "dg_x",
    OPENAI_API_KEY: "sk-x",
  } as unknown as NodeJS.ProcessEnv);

  assert.equal(env.twilio.accountSid, "AC123");
  assert.equal(env.twilio.authToken, "tok");
  assert.equal(env.twilio.fromNumber, "+15555550100");
  assert.equal(env.twilio.subaccountSid, "AC456");
  assert.equal(env.deepgramApiKey, "dg_x");
  assert.equal(env.openaiApiKey, "sk-x");
});

test("voice loadEnv accepts TWILIO_FROM_NUMBER as fallback", () => {
  const env = loadEnv({
    TWILIO_ACCOUNT_SID: "AC123",
    TWILIO_AUTH_TOKEN: "tok",
    TWILIO_FROM_NUMBER: "+15555550100",
  } as unknown as NodeJS.ProcessEnv);

  assert.equal(env.twilio.fromNumber, "+15555550100");
});
