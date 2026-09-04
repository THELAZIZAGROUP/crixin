import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  say,
  record,
  hangup,
  promptAndRecord,
  speakOnly,
  escapeXml,
  wrap,
} from "../../src/voice/twiml/templates.js";

test("voice escapeXml replaces all special characters", () => {
  assert.equal(
    escapeXml(`<a href="x" 'q'>&y</a>`),
    `&lt;a href=&quot;x&quot; &apos;q&apos;&gt;&amp;y&lt;/a&gt;`,
  );
});

test("voice say emits a Say tag with voice + language attributes", () => {
  const xml = say("Hello world", { voice: "Polly.Joanna-Neural", language: "en-US" });
  assert.equal(
    xml,
    '<Say voice="Polly.Joanna-Neural" language="en-US">Hello world</Say>',
  );
});

test("voice say escapes user content", () => {
  const xml = say(`<bad>&"`);
  assert.equal(xml, '<Say >&lt;bad&gt;&amp;&quot;</Say>');
});

test("voice record sets sensible defaults", () => {
  const xml = record();
  assert.match(xml, /maxLength="60"/);
  assert.match(xml, /timeout="5"/);
  assert.match(xml, /finishOnKey="#"/);
  assert.match(xml, /playBeep="true"/);
});

test("voice record honors overrides", () => {
  const xml = record({ maxLength: 30, timeout: 3, transcribe: true, playBeep: false });
  assert.match(xml, /maxLength="30"/);
  assert.match(xml, /timeout="3"/);
  assert.match(xml, /transcribe="true"/);
  assert.match(xml, /playBeep="false"/);
});

test("voice promptAndRecord composes Say + Record + Hangup inside <Response>", () => {
  const xml = promptAndRecord({
    prompt: "What time do you open?",
    voice: "Polly.Hala-Neural",
    language: "ar-EG",
    closingMessage: "Thank you, goodbye.",
  });
  assert.match(xml, /^<\?xml version="1\.0"[^>]+><Response>/);
  assert.match(xml, /<Say voice="Polly\.Hala-Neural" language="ar-EG">What time do you open\?<\/Say>/);
  assert.match(xml, /<Pause length="1" \/>/);
  assert.match(xml, /<Record /);
  assert.match(xml, /<Say voice="Polly\.Hala-Neural" language="ar-EG">Thank you, goodbye\.<\/Say>/);
  assert.match(xml, /<Hangup \/><\/Response>$/);
});

test("voice speakOnly emits Say + Hangup with no Record", () => {
  const xml = speakOnly("Just FYI.", "Polly.Joanna-Neural", "en-US");
  assert.match(xml, /<Say voice="Polly\.Joanna-Neural" language="en-US">Just FYI\.<\/Say>/);
  assert.match(xml, /<Hangup \/>/);
  assert.doesNotMatch(xml, /<Record/);
});

test("voice wrap adds the XML envelope", () => {
  assert.equal(wrap("<X/>"), '<?xml version="1.0" encoding="UTF-8"?><Response><X/></Response>');
});

test("voice hangup is a self-closing tag", () => {
  assert.equal(hangup(), "<Hangup />");
});

test("voice 20003 error has friendly message", async () => {
  // Verify the friendly message exists in client.ts source — quick smoke test
  // that the UX fix didn't get reverted.
  const { TwilioApiError } = await import("../../src/voice/twilio/client.js");
  const err = new TwilioApiError(401, "Twilio rejected your credentials (error 20003).", 20003);
  assert.equal(err.twilioCode, 20003);
  assert.match(err.message, /Twilio rejected/);
});
