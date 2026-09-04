/**
 * Feature-gating primitives.
 *
 * Free vs Pro is a runtime check. The license token is a real Ed25519 JWT
 * issued by the Stripe webhook on `checkout.session.completed` — verified
 * offline against the public key embedded in `keys.ts`.
 *
 * Pro features SHOULD always degrade gracefully via `gate(free, pro)` so a
 * user without a license never sees an error — they see the Free version.
 */

import { existsSync, readFileSync } from "node:fs";
import { paths } from "../lib/paths.js";
import { verifyLicenseJwt, type LicenseClaims } from "./jwt.js";

interface LicenseFile {
  /** The Ed25519-signed JWT issued at Stripe checkout. */
  token: string;
}

let cached: { value: boolean; claims: LicenseClaims | null; checkedAt: number } | null = null;
const CACHE_MS = 30_000;

/** True if the user holds a valid Pro/Lifetime license. Cached for ~30s. */
export function isPro(): boolean {
  return getCurrentLicense().valid;
}

/** Underlying check + claims, exposed for `crixin license status`. */
export function getCurrentLicense(): { valid: boolean; claims: LicenseClaims | null } {
  const now = Date.now();
  if (cached && now - cached.checkedAt < CACHE_MS) {
    return { valid: cached.value, claims: cached.claims };
  }

  let valid = false;
  let claims: LicenseClaims | null = null;
  try {
    if (existsSync(paths.licenseFile)) {
      const raw = readFileSync(paths.licenseFile, "utf8");
      const j = JSON.parse(raw) as LicenseFile;
      if (typeof j.token === "string") {
        claims = verifyLicenseJwt(j.token);
        valid = claims !== null;
      }
    }
  } catch {
    valid = false;
    claims = null;
  }
  // Env override for development / testing only — useful for `CRIXIN_PRO=1 npm test`.
  if (!valid && process.env["CRIXIN_PRO"] === "1") valid = true;

  cached = { value: valid, claims, checkedAt: now };
  return { valid, claims };
}

/** Drop-in helper: returns `pro` when the user is Pro, `free` otherwise. */
export function gate<T>(free: T, pro: T): T {
  return isPro() ? pro : free;
}

/** Verify a token before persisting it (used by `crixin license activate`). */
export function verifyLicenseToken(token: string): boolean {
  return verifyLicenseJwt(token) !== null;
}

/** Reset the cache (called by tests + by `license activate/deactivate`). */
export function resetLicenseCache(): void {
  cached = null;
}

/** Friendly badge string for "this is a Pro feature" surfaces. */
export const PRO_BADGE = "✨ Pro";

/** Display-time string for the "upgrade to Pro" call-to-action footers. */
export const PRO_UPGRADE_HINT =
  "Pro · $5/mo with 3-day trial — https://crixin.com/install";
