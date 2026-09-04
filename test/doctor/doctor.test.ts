/**
 * Tests for `crixin doctor` — the comprehensive support-engineer command.
 * Each section's check function is tested in isolation. Plus a smoke test
 * for the full runDoctor() that verifies exit codes and section ordering.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkRuntime,
  checkMcpInstall,
  checkStorage,
  checkTwilio,
  checkDeepgram,
  checkLicense,
  runDoctor,
  type DoctorCheck,
} from "../../src/cli/doctor.ts";
import { paths } from "../../src/lib/paths.ts";
import { runVoiceInstall } from "../../src/voice/install.ts";
import { runCoderInstall } from "../../src/coder/install.ts";

let originalHome: string | undefined;
let originalCrixinHome: string;
let originalEnv: Record<string, string | undefined>;
let tmpHome: string;

const TWILIO_VARS = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "TWILIO_FROM_NUMBER", "TWILIO_SUBACCOUNT_SID", "TWILIO_SUBACCOUNT_TOKEN", "DEEPGRAM_API_KEY"];

before(() => {
  originalHome = process.env["HOME"];
  originalCrixinHome = paths.crixinHome;
  originalEnv = {};
  for (const v of TWILIO_VARS) originalEnv[v] = process.env[v];
});

after(() => {
  if (originalHome !== undefined) process.env["HOME"] = originalHome;
  paths.crixinHome = originalCrixinHome;
  for (const v of TWILIO_VARS) {
    if (originalEnv[v] === undefined) delete process.env[v];
    else process.env[v] = originalEnv[v];
  }
});

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "crixin-doctor-test-"));
  process.env["HOME"] = tmpHome;
  // Sandbox the DB path so tests don't see/touch the user's real DB
  paths.crixinHome = join(tmpHome, ".crixin");
  // Clear all credential vars so each test starts blank
  for (const v of TWILIO_VARS) delete process.env[v];
});

function cleanup() {
  rmSync(tmpHome, { recursive: true, force: true });
}

function silenceStdout(): () => string {
  const captured: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout.write as unknown as (msg: string) => boolean) = (msg: string) => {
    captured.push(typeof msg === "string" ? msg : msg.toString());
    return true;
  };
  return () => {
    (process.stdout.write as unknown as typeof orig) = orig;
    return captured.join("");
  };
}

// ─── checkRuntime ─────────────────────────────────────────────────────────────

describe("doctor · checkRuntime", () => {
  it("reports the running Node version and platform", () => {
    const checks = checkRuntime();
    assert.equal(checks.length, 2);
    const nodeCheck = checks.find((c) => c.name === "Node.js")!;
    const platCheck = checks.find((c) => c.name === "Platform")!;
    assert.ok(nodeCheck);
    assert.ok(platCheck);
    // Test runner runs on Node >= 22 (since the project requires it)
    assert.equal(nodeCheck.status, "ok");
    assert.ok(nodeCheck.detail.includes(`v${process.versions.node}`));
    assert.equal(platCheck.status, "info");
  });
});

// ─── checkMcpInstall ──────────────────────────────────────────────────────────

describe("doctor · checkMcpInstall · no installs", () => {
  it("warns 'no host config' for every host on a clean machine", () => {
    const checks = checkMcpInstall();
    assert.equal(checks.length, 4);
    for (const c of checks) {
      assert.equal(c.status, "warn", `${c.name} should warn when no config`);
      assert.ok(c.detail.includes("no host config"));
      assert.ok(c.fix?.includes("crixin install"));
    }
    cleanup();
  });
});

describe("doctor · checkMcpInstall · fully installed", () => {
  it("reports ok for every host after install + install", () => {
    runVoiceInstall({});
    runCoderInstall({});
    const checks = checkMcpInstall();
    for (const c of checks) {
      assert.equal(c.status, "ok", `${c.name} should be ok`);
      assert.ok(c.detail.includes("crixin-voice + crixin-coder"));
    }
    cleanup();
  });
});

describe("doctor · checkMcpInstall · partial install", () => {
  it("reports fail with 'missing: crixin-coder' when only voice is installed", () => {
    runVoiceInstall({});
    const checks = checkMcpInstall();
    for (const c of checks) {
      assert.equal(c.status, "fail");
      assert.ok(c.detail.includes("missing: crixin-coder"));
      assert.ok(c.fix?.includes("crixin install"));
    }
    cleanup();
  });
});

describe("doctor · checkMcpInstall · legacy schema", () => {
  it("flags legacy mcpServers array with the migrate command in the fix", () => {
    writeFileSync(join(tmpHome, ".claude.json"), JSON.stringify({
      mcpServers: [{ name: "x", command: "y" }],
    }));
    const checks = checkMcpInstall();
    const claude = checks.find((c) => c.name === "Claude Code")!;
    assert.equal(claude.status, "fail");
    assert.ok(claude.detail.includes("legacy"));
    assert.ok(claude.fix?.includes("crixin install --migrate-legacy"));
    cleanup();
  });
});

describe("doctor · checkMcpInstall · malformed config", () => {
  it("flags unreadable config with a 'cat the file' hint", () => {
    mkdirSync(join(tmpHome, ".cursor"), { recursive: true });
    writeFileSync(join(tmpHome, ".cursor/mcp.json"), "{ not valid json");
    const checks = checkMcpInstall();
    const cursor = checks.find((c) => c.name === "Cursor")!;
    assert.equal(cursor.status, "fail");
    assert.ok(cursor.detail.includes("unreadable"));
    assert.ok(cursor.fix?.includes("cat"));
    cleanup();
  });
});

// ─── checkStorage ─────────────────────────────────────────────────────────────

describe("doctor · checkStorage · no DB", () => {
  it("reports info (not fail) when DB doesn't exist yet", () => {
    const checks = checkStorage(false);
    assert.equal(checks.length, 1);
    assert.equal(checks[0]!.status, "info");
    assert.ok(checks[0]!.detail.includes("not yet created"));
    assert.ok(checks[0]!.fix?.includes("crixin coder ingest"));
    cleanup();
  });
});

// ─── checkTwilio (offline) ────────────────────────────────────────────────────

describe("doctor · checkTwilio · no env, no network", () => {
  it("warns with a list of missing variables and the fix", async () => {
    const checks = await checkTwilio({ network: false, verbose: false });
    assert.equal(checks.length, 1);
    const c = checks[0]!;
    assert.equal(c.status, "warn");
    assert.ok(c.detail.includes("TWILIO_ACCOUNT_SID"));
    assert.ok(c.detail.includes("TWILIO_AUTH_TOKEN"));
    assert.ok(c.detail.includes("TWILIO_PHONE_NUMBER"));
    assert.ok(c.fix?.includes("export TWILIO_ACCOUNT_SID"));
    cleanup();
  });
});

describe("doctor · checkTwilio · malformed SID", () => {
  it("fails with a clear character-count error", async () => {
    process.env["TWILIO_ACCOUNT_SID"] = "AC-too-short";       // not 34 chars
    process.env["TWILIO_AUTH_TOKEN"]  = "x".repeat(32);
    process.env["TWILIO_PHONE_NUMBER"] = "+15555550100";
    const checks = await checkTwilio({ network: false, verbose: false });
    const fail = checks.find((c) => c.status === "fail");
    assert.ok(fail, "should have a failing check");
    assert.ok(fail!.detail.includes("malformed"));
    assert.ok(fail!.detail.includes("chars"));
    cleanup();
  });
});

describe("doctor · checkTwilio · malformed token length", () => {
  it("fails when token is not 32 chars", async () => {
    process.env["TWILIO_ACCOUNT_SID"] = "AC" + "1".repeat(32);
    process.env["TWILIO_AUTH_TOKEN"]  = "tooshort";
    process.env["TWILIO_PHONE_NUMBER"] = "+15555550100";
    const checks = await checkTwilio({ network: false, verbose: false });
    const fail = checks.find((c) => c.status === "fail");
    assert.ok(fail);
    assert.ok(fail!.detail.includes("TWILIO_AUTH_TOKEN malformed"));
    cleanup();
  });
});

describe("doctor · checkTwilio · valid env, network skipped", () => {
  it("reports ok for credentials and skips the live probe", async () => {
    process.env["TWILIO_ACCOUNT_SID"] = "AC" + "1".repeat(32);
    process.env["TWILIO_AUTH_TOKEN"]  = "x".repeat(32);
    process.env["TWILIO_PHONE_NUMBER"] = "+15555550100";
    const checks = await checkTwilio({ network: false, verbose: false });
    const credCheck = checks.find((c) => c.name === "Credentials")!;
    const acctCheck = checks.find((c) => c.name === "Account")!;
    assert.equal(credCheck.status, "ok");
    assert.ok(credCheck.detail.includes("SID AC1111"));
    assert.equal(acctCheck.status, "info");
    assert.ok(acctCheck.detail.includes("--no-network"));
    cleanup();
  });
});

// ─── checkDeepgram (offline) ──────────────────────────────────────────────────

describe("doctor · checkDeepgram · no key", () => {
  it("reports info (not fail) with explanation of what breaks without it", async () => {
    delete process.env["DEEPGRAM_API_KEY"];  // defensive: parent shell may have one set
    const checks = await checkDeepgram({ network: false, verbose: false });
    assert.equal(checks.length, 1);
    assert.equal(checks[0]!.status, "info");
    assert.ok(checks[0]!.detail.includes("DEEPGRAM_API_KEY not set"));
    assert.ok(checks[0]!.fix?.includes("transcription"));
    cleanup();
  });
});

describe("doctor · checkDeepgram · key set, network skipped", () => {
  it("reports ok and skips the probe", async () => {
    process.env["DEEPGRAM_API_KEY"] = "abc123";
    const checks = await checkDeepgram({ network: false, verbose: false });
    const keyCheck = checks.find((c) => c.name === "API key")!;
    const reach = checks.find((c) => c.name === "Reachable")!;
    assert.equal(keyCheck.status, "ok");
    assert.ok(keyCheck.detail.includes("abc123") || keyCheck.detail.includes("…"));
    assert.equal(reach.status, "info");
    cleanup();
  });
});

// ─── checkLicense ─────────────────────────────────────────────────────────────

describe("doctor · checkLicense", () => {
  it("returns a single license-tier row", () => {
    const checks = checkLicense();
    assert.equal(checks.length, 1);
    assert.equal(checks[0]!.section, "license");
    assert.ok(["Free", "Pro"].includes(checks[0]!.detail));
  });
});

// ─── runDoctor end-to-end ─────────────────────────────────────────────────────

describe("doctor · runDoctor end-to-end", () => {
  it("returns exit code 0 on a fresh machine (warnings only, no failures)", async () => {
    // Per the contract: warnings don't fail. A fresh machine with no install
    // and no creds has all warnings → exit 0 with "Overall: USABLE".
    delete process.env["DEEPGRAM_API_KEY"];  // defensive
    const stop = silenceStdout();
    const code = await runDoctor({ network: false });
    const out = stop();
    assert.equal(code, 0, `expected 0 (warnings don't fail), got ${code}.\n${out}`);
    assert.ok(out.includes("Overall: USABLE") || out.includes("Overall: HEALTHY"),
      `expected USABLE or HEALTHY, got:\n${out}`);
    // All sections rendered
    assert.ok(out.includes("Runtime"));
    assert.ok(out.includes("MCP host registrations"));
    assert.ok(out.includes("Twilio"));
    assert.ok(out.includes("Deepgram"));
    assert.ok(out.includes("License"));
    cleanup();
  });

  it("returns exit code 1 when there are actual failures (malformed creds)", async () => {
    process.env["TWILIO_ACCOUNT_SID"] = "AC-bad";       // malformed → fail
    process.env["TWILIO_AUTH_TOKEN"]  = "x".repeat(32);
    process.env["TWILIO_PHONE_NUMBER"] = "+15555550100";
    const stop = silenceStdout();
    const code = await runDoctor({ network: false });
    const out = stop();
    assert.equal(code, 1, `expected 1, got ${code}.\n${out}`);
    assert.ok(out.includes("Overall: NEEDS ATTENTION"));
    cleanup();
  });

  it("prints fix lines indented under failing checks", async () => {
    process.env["TWILIO_ACCOUNT_SID"] = "AC-bad";
    process.env["TWILIO_AUTH_TOKEN"]  = "x".repeat(32);
    process.env["TWILIO_PHONE_NUMBER"] = "+15555550100";
    const stop = silenceStdout();
    await runDoctor({ network: false });
    const out = stop();
    assert.ok(out.includes("Re-copy TWILIO_ACCOUNT_SID"));
    cleanup();
  });

  it("returns exit code 0 when fully set up offline (network skipped)", async () => {
    runVoiceInstall({});
    runCoderInstall({});
    process.env["TWILIO_ACCOUNT_SID"] = "AC" + "1".repeat(32);
    process.env["TWILIO_AUTH_TOKEN"]  = "x".repeat(32);
    process.env["TWILIO_PHONE_NUMBER"] = "+15555550100";
    process.env["DEEPGRAM_API_KEY"]   = "abc123";
    const stop = silenceStdout();
    const code = await runDoctor({ network: false });
    const out = stop();
    assert.equal(code, 0, `expected 0, got ${code}. Output:\n${out}`);
    assert.ok(out.includes("Overall: HEALTHY") || out.includes("Overall: USABLE"));
    cleanup();
  });

  it("output sections appear in fixed order", async () => {
    const stop = silenceStdout();
    await runDoctor({ network: false });
    const out = stop();
    const order = [
      out.indexOf("Runtime"),
      out.indexOf("MCP host registrations"),
      out.indexOf("Storage"),
      out.indexOf("Twilio"),
      out.indexOf("Deepgram"),
      out.indexOf("License"),
    ];
    for (let i = 0; i < order.length - 1; i++) {
      assert.ok(order[i] < order[i + 1], `section ${i} should appear before section ${i + 1}`);
    }
    cleanup();
  });
});
