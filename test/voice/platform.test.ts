import { test, after, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { loadEnv } from "../../src/voice/env.js";
import {
  PlatformClient,
  PlatformApiError,
  DEFAULT_PLATFORM_BASE_URL,
} from "../../src/voice/platform/client.js";
import { platformMakeCall } from "../../src/voice/platform/tools.js";
import { CrixinVoiceGeoError } from "../../src/voice/twilio/calls.js";

// ─── fetch mocking ────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
const savedAllowedCc = process.env["CRIXIN_VOICE_ALLOWED_CC"];

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

let recorded: RecordedRequest[] = [];

function mockFetch(status: number, body: string): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    recorded.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(body, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  recorded = [];
  // Geo-gate reads this from process.env; keep tests deterministic.
  delete process.env["CRIXIN_VOICE_ALLOWED_CC"];
});

after(() => {
  globalThis.fetch = realFetch;
  if (savedAllowedCc === undefined) delete process.env["CRIXIN_VOICE_ALLOWED_CC"];
  else process.env["CRIXIN_VOICE_ALLOWED_CC"] = savedAllowedCc;
});

function envelope(data: unknown): string {
  return JSON.stringify({ success: true, data, meta: {} });
}

const CALL_RESOURCE = {
  sid: "CA123",
  status: "queued",
  to: "+201234567890",
  from: "+15555550100",
  direction: "outbound-api",
  uri: "/calls/CA123",
};

// ─── (a) auth header + base URL + CRIXIN_API_BASE override ──────────────────

test("platform client sends Bearer auth + User-Agent against the default base URL", async () => {
  mockFetch(200, envelope({ user_id: "u_1" }));
  const env = loadEnv({ CRIXIN_API_KEY: "crx_live_abc123" } as unknown as NodeJS.ProcessEnv);
  assert.ok(env.platform);
  assert.equal(env.platform.baseUrl, DEFAULT_PLATFORM_BASE_URL);

  const client = new PlatformClient(env.platform);
  await client.get("/me");

  assert.equal(recorded.length, 1);
  const req = recorded[0]!;
  assert.equal(req.url, `${DEFAULT_PLATFORM_BASE_URL}/api/v1/mcp/me`);
  assert.equal(req.headers["Authorization"], "Bearer crx_live_abc123");
  assert.equal(req.headers["User-Agent"], "crixin-cli/0.7.2");
});

test("CRIXIN_API_BASE overrides the base URL and trailing slashes are stripped", async () => {
  mockFetch(200, envelope(CALL_RESOURCE));
  const env = loadEnv({
    CRIXIN_API_KEY: "crx_live_abc123",
    CRIXIN_API_BASE: "https://staging.example.test/",
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(env.platform?.baseUrl, "https://staging.example.test");

  const client = new PlatformClient(env.platform!);
  await client.get("/calls/CA123");

  assert.equal(recorded[0]!.url, "https://staging.example.test/api/v1/mcp/calls/CA123");
});

test("POSTs carry Content-Type: application/json", async () => {
  mockFetch(200, envelope(CALL_RESOURCE));
  const client = new PlatformClient({
    baseUrl: "https://api.example.test",
    apiKey: "crx_live_x",
  });
  await client.post("/sms", { to: "+201234567890", body: "hi" });

  const req = recorded[0]!;
  assert.equal(req.method, "POST");
  assert.equal(req.headers["Content-Type"], "application/json");
  assert.equal(req.url, "https://api.example.test/api/v1/mcp/sms");
});

// ─── (b) envelope unwrap on success ──────────────────────────────────────────

test("success envelope is unwrapped to data", async () => {
  mockFetch(200, envelope(CALL_RESOURCE));
  const client = new PlatformClient({
    baseUrl: "https://api.example.test",
    apiKey: "crx_live_x",
  });
  const result = await client.get<typeof CALL_RESOURCE>("/calls/CA123");
  assert.deepEqual(result, CALL_RESOURCE);
});

// ─── (c) PlatformApiError on error envelope and non-JSON body ────────────────

test("error envelope throws PlatformApiError with status, code, message", async () => {
  mockFetch(
    402,
    JSON.stringify({
      success: false,
      error: { code: "OUT_OF_MINUTES", message: "Plan minutes exhausted." },
    }),
  );
  const client = new PlatformClient({
    baseUrl: "https://api.example.test",
    apiKey: "crx_live_x",
  });
  await assert.rejects(
    () => client.get("/calls"),
    (caught: unknown) => {
      assert.ok(caught instanceof PlatformApiError);
      assert.equal(caught.status, 402);
      assert.equal(caught.code, "OUT_OF_MINUTES");
      assert.equal(caught.message, "Plan minutes exhausted.");
      return true;
    },
  );
});

test("non-JSON error body throws PlatformApiError with code HTTP_ERROR and raw text", async () => {
  mockFetch(503, "Service Unavailable");
  const client = new PlatformClient({
    baseUrl: "https://api.example.test",
    apiKey: "crx_live_x",
  });
  await assert.rejects(
    () => client.get("/me"),
    (caught: unknown) => {
      assert.ok(caught instanceof PlatformApiError);
      assert.equal(caught.status, 503);
      assert.equal(caught.code, "HTTP_ERROR");
      assert.equal(caught.message, "Service Unavailable");
      return true;
    },
  );
});

// ─── (d) loadEnv platform mode with no TWILIO vars ───────────────────────────

test("loadEnv does not require TWILIO_* when CRIXIN_API_KEY is set", () => {
  const env = loadEnv({ CRIXIN_API_KEY: "crx_live_abc123" } as unknown as NodeJS.ProcessEnv);
  assert.ok(env.platform);
  assert.equal(env.platform.apiKey, "crx_live_abc123");
  assert.equal(env.twilio.accountSid, "");
  assert.equal(env.twilio.authToken, "");
  assert.equal(env.twilio.fromNumber, "");
});

test("loadEnv still includes + validates TWILIO_* when present in platform mode", () => {
  const env = loadEnv({
    CRIXIN_API_KEY: "crx_live_abc123",
    TWILIO_ACCOUNT_SID: "AC123",
    TWILIO_AUTH_TOKEN: "tok",
    TWILIO_PHONE_NUMBER: "+15555550100",
  } as unknown as NodeJS.ProcessEnv);
  assert.equal(env.twilio.accountSid, "AC123");
  assert.equal(env.twilio.fromNumber, "+15555550100");

  // Malformed from-number is rejected even in platform mode.
  assert.throws(
    () =>
      loadEnv({
        CRIXIN_API_KEY: "crx_live_abc123",
        TWILIO_PHONE_NUMBER: "5555550100",
      } as unknown as NodeJS.ProcessEnv),
    /E\.164/,
  );
});

// ─── (e) platformMakeCall runs the local geo-gate first ──────────────────────

test("platformMakeCall blocks a US number without consent and never hits the network", async () => {
  mockFetch(200, envelope(CALL_RESOURCE));
  const client = new PlatformClient({
    baseUrl: "https://api.example.test",
    apiKey: "crx_live_x",
  });
  await assert.rejects(
    () => platformMakeCall(client, { to: "+15555550123", prompt: "hello" }),
    (caught: unknown) => {
      assert.ok(caught instanceof CrixinVoiceGeoError);
      assert.equal(caught.status, "consent");
      return true;
    },
  );
  assert.equal(recorded.length, 0, "geo-gate must reject before any fetch happens");
});

test("platformMakeCall with consented:true POSTs and includes consented in the body", async () => {
  mockFetch(200, envelope(CALL_RESOURCE));
  const client = new PlatformClient({
    baseUrl: "https://api.example.test",
    apiKey: "crx_live_x",
  });
  const result = await platformMakeCall(client, {
    to: "+15555550123",
    prompt: "hello",
    consented: true,
  });
  assert.equal(result.sid, "CA123");
  assert.equal(recorded.length, 1);
  const body = JSON.parse(recorded[0]!.body!) as Record<string, unknown>;
  assert.equal(body["consented"], true);
  assert.equal(body["to"], "+15555550123");
  assert.equal(recorded[0]!.url, "https://api.example.test/api/v1/mcp/calls");
});

// ─── (f) snake_case mapping on the wire ──────────────────────────────────────

test("platformMakeCall maps camelCase options to snake_case and omits undefined", async () => {
  mockFetch(200, envelope(CALL_RESOURCE));
  const client = new PlatformClient({
    baseUrl: "https://api.example.test",
    apiKey: "crx_live_x",
  });
  await platformMakeCall(client, {
    to: "+201234567890", // Egypt — allowed without consent
    prompt: "hello",
    closingMessage: "goodbye",
    maxRecordingSeconds: 120,
    machineDetection: "DetectMessageEnd",
    record: true,
  });

  const body = JSON.parse(recorded[0]!.body!) as Record<string, unknown>;
  assert.equal(body["max_recording_seconds"], 120);
  assert.equal(body["closing_message"], "goodbye");
  assert.equal(body["machine_detection"], "DetectMessageEnd");
  assert.equal(body["record"], true);
  assert.ok(!("maxRecordingSeconds" in body));
  assert.ok(!("closingMessage" in body));
  assert.ok(!("twiml" in body), "undefined fields must be omitted from the wire body");
  assert.ok(!("url" in body));
  assert.ok(!("consented" in body));
});
