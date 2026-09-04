import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, sign } from "node:crypto";

const TMP_HOME = mkdtempSync(join(tmpdir(), "crixin-lic-"));
process.env["CRIXIN_HOME"] = TMP_HOME;
delete process.env["CRIXIN_PRO"];

const { isPro, gate, resetLicenseCache, verifyLicenseToken } = await import(
  "../src/license/features.ts"
);
const { paths } = await import("../src/lib/paths.ts");
const { LICENSE_PUBLIC_KEY_RAW_B64 } = await import("../src/license/keys.ts");

describe("license gate", () => {
  beforeEach(() => {
    resetLicenseCache();
    delete process.env["CRIXIN_PRO"];
    try { writeFileSync(paths.licenseFile, JSON.stringify({})); } catch {}
  });
  after(() => rmSync(TMP_HOME, { recursive: true, force: true }));

  it("free by default (no license file, no env override)", () => {
    assert.equal(isPro(), false);
    assert.equal(gate("free", "pro"), "free");
  });

  it("CRIXIN_PRO=1 unlocks pro", () => {
    process.env["CRIXIN_PRO"] = "1";
    resetLicenseCache();
    assert.equal(isPro(), true);
    assert.equal(gate("free", "pro"), "pro");
  });

  it("malformed JWT is rejected", () => {
    writeFileSync(paths.licenseFile, JSON.stringify({ token: "not.a.jwt" }));
    resetLicenseCache();
    assert.equal(isPro(), false);
    assert.equal(verifyLicenseToken("garbage"), false);
  });

  it("JWT with valid shape but wrong signature is rejected", () => {
    // Sign with a throwaway key, NOT the production key. Verify must reject.
    const { privateKey } = generateKeyPairSync("ed25519");
    const header = { alg: "EdDSA", typ: "JWT" };
    const payload = {
      sub: "x", tier: "pro",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const b64u = (s: string) =>
      Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const h = b64u(JSON.stringify(header));
    const p = b64u(JSON.stringify(payload));
    const sig = sign(null, Buffer.from(`${h}.${p}`, "utf8"), privateKey);
    const s = sig.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const token = `${h}.${p}.${s}`;

    writeFileSync(paths.licenseFile, JSON.stringify({ token }));
    resetLicenseCache();
    assert.equal(isPro(), false, "fake-signed JWT must not unlock pro");
    assert.equal(verifyLicenseToken(token), false);
  });

  it("public key constant is the right length (Ed25519 = 32 raw bytes)", () => {
    assert.ok(LICENSE_PUBLIC_KEY_RAW_B64.length > 0);
    const raw = Buffer.from(LICENSE_PUBLIC_KEY_RAW_B64, "base64");
    assert.equal(raw.length, 32);
  });
});
