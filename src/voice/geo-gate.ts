/**
 * Country-level gate for outbound AI voice calls.
 *
 * This is a *product-side* compliance layer, not a substitute for legal
 * review of any specific call. The defaults err on the side of "blocked
 * unless we can name a reason it's permissible." Caller can override with
 * `--consented` (CLI) or `consented: true` (MCP) to attest that the recipient
 * has given prior express written consent for the call.
 *
 * Reference:
 *   US:    TCPA + FCC 2024 ruling — artificial voice = AI voice. Prior express
 *          written consent for telemarketing to wireless. B2B landline broader.
 *   UK:    PECR + TPS list compliance.
 *   EU:    ePrivacy Directive — consent required for automated marketing.
 *   MENA:  Generally lighter, varies by country.
 *
 * Three categories:
 *   - allowed:    outbound AI calls are broadly permissible under local law,
 *                 with user-side responsibility for any sector-specific rules.
 *   - consent:    permissible only if the caller can attest to prior consent.
 *                 Requires the explicit override flag.
 *   - blocked:    outbound AI calls are categorically restricted and we
 *                 won't dial regardless of override. (Reserved; empty by default.)
 *
 * Caller can extend / override the allowlist via the CRIXIN_VOICE_ALLOWED_CC
 * env var (comma-separated E.164 country codes, e.g. "20,971,966,44"). Useful
 * for jurisdictions where the operator has registered for outbound campaigns.
 */

export type CountryStatus = "allowed" | "consent" | "blocked";

interface CountryRule {
  /** E.164 country code (no leading +). */
  cc: string;
  /** Country name for error messages. */
  name: string;
  status: CountryStatus;
  /** One-line rationale shown in error messages and `crixin voice doctor`. */
  note: string;
}

/**
 * Default rules. Ordered by E.164 country code length (longest first) so
 * lookup matches the most-specific prefix first (e.g. +1-242 Bahamas before
 * +1 US/Canada).
 */
const COUNTRY_RULES: CountryRule[] = [
  // MENA / Africa — broadly permissive, light AI-voice regulation
  { cc: "20",  name: "Egypt",          status: "allowed", note: "No TCPA-equivalent; general telecoms law applies" },
  { cc: "971", name: "UAE",            status: "allowed", note: "TRA registration recommended for sustained outbound campaigns" },
  { cc: "966", name: "Saudi Arabia",   status: "allowed", note: "CITC registration required for commercial outbound" },
  { cc: "962", name: "Jordan",         status: "allowed", note: "TRC outbound rules apply" },
  { cc: "965", name: "Kuwait",         status: "allowed", note: "CITRA rules apply" },
  { cc: "974", name: "Qatar",          status: "allowed", note: "CRA rules apply" },
  { cc: "973", name: "Bahrain",        status: "allowed", note: "TRA rules apply" },
  { cc: "968", name: "Oman",           status: "allowed", note: "TRA rules apply" },
  { cc: "961", name: "Lebanon",        status: "allowed", note: "Limited specific regulation" },
  { cc: "234", name: "Nigeria",        status: "allowed", note: "NCC outbound rules" },
  { cc: "27",  name: "South Africa",   status: "allowed", note: "POPIA consent rules; B2B broader" },

  // Restricted — strict consent regimes; require explicit override
  { cc: "1",   name: "US / Canada",    status: "consent", note: "TCPA / CRTC: prior express written consent for AI voice to wireless; B2B landline broader. Pass --consented to override." },
  { cc: "44",  name: "United Kingdom", status: "consent", note: "PECR + TPS list compliance required. Pass --consented to override." },
  { cc: "353", name: "Ireland",        status: "consent", note: "ePrivacy Regulations. Pass --consented to override." },
  { cc: "33",  name: "France",         status: "consent", note: "Bloctel registry; ePrivacy. Pass --consented to override." },
  { cc: "34",  name: "Spain",          status: "consent", note: "LSSI + ePrivacy. Pass --consented to override." },
  { cc: "39",  name: "Italy",          status: "consent", note: "RPO list + ePrivacy. Pass --consented to override." },
  { cc: "31",  name: "Netherlands",    status: "consent", note: "Bel-me-niet register + ePrivacy. Pass --consented to override." },
  { cc: "61",  name: "Australia",      status: "consent", note: "Do Not Call Register. Pass --consented to override." },
  { cc: "64",  name: "New Zealand",    status: "consent", note: "Telecommunications Act / NDNCR. Pass --consented to override." },

  // Blocked — categorically restricted; override does not unlock
  { cc: "49",  name: "Germany",        status: "blocked", note: "UWG §7 + GDPR — aggressively enforced; AI voice cold calling treated as unsolicited commercial communication." },
];

export interface GateOptions {
  /** When true, treat `consent`-status destinations as allowed. */
  consented?: boolean;
}

export interface GateDecision {
  ok: boolean;
  country: string;
  status: CountryStatus;
  reason: string;
}

/**
 * Decide whether the caller is allowed to dial this E.164 number under
 * the configured policy. Returns { ok: true } only when the destination's
 * country is in the allowed set (or consent set with `consented: true`).
 */
export function checkDestination(toE164: string, opts: GateOptions = {}): GateDecision {
  const num = toE164.trim();
  if (!num.startsWith("+")) {
    return {
      ok: false,
      country: "unknown",
      status: "blocked",
      reason: `Destination must be E.164 (start with '+'). Got: ${num}`,
    };
  }
  const digits = num.replace(/[^\d]/g, "");

  // Allow operator to override via env (additive — appends to allowed set).
  const envOverride = (process.env["CRIXIN_VOICE_ALLOWED_CC"] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Longest-prefix match against the rules.
  const sorted = [...COUNTRY_RULES].sort((a, b) => b.cc.length - a.cc.length);
  const match = sorted.find((r) => digits.startsWith(r.cc));

  if (envOverride.length > 0 && match && envOverride.includes(match.cc)) {
    return {
      ok: true,
      country: match.name,
      status: "allowed",
      reason: `${match.name} (+${match.cc}) — overridden via CRIXIN_VOICE_ALLOWED_CC`,
    };
  }

  if (!match) {
    return {
      ok: false,
      country: "unknown",
      status: "blocked",
      reason: `No outbound rule defined for country code in ${num}. Add it to CRIXIN_VOICE_ALLOWED_CC (comma-separated) after verifying local law.`,
    };
  }

  if (match.status === "blocked") {
    return {
      ok: false,
      country: match.name,
      status: "blocked",
      reason: `${match.name} (+${match.cc}) blocked: ${match.note}`,
    };
  }

  if (match.status === "consent") {
    if (opts.consented) {
      return {
        ok: true,
        country: match.name,
        status: "consent",
        reason: `${match.name} (+${match.cc}) allowed via --consented override. ${match.note}`,
      };
    }
    return {
      ok: false,
      country: match.name,
      status: "consent",
      reason: `${match.name} (+${match.cc}) requires consent. ${match.note}`,
    };
  }

  return {
    ok: true,
    country: match.name,
    status: "allowed",
    reason: `${match.name} (+${match.cc}) — ${match.note}`,
  };
}

/** Compact summary of the rules for `crixin voice doctor`. */
export function summarizeRules(): {
  allowed: Array<{ cc: string; name: string }>;
  consent: Array<{ cc: string; name: string }>;
  blocked: Array<{ cc: string; name: string }>;
} {
  return {
    allowed: COUNTRY_RULES.filter((r) => r.status === "allowed").map((r) => ({ cc: r.cc, name: r.name })),
    consent: COUNTRY_RULES.filter((r) => r.status === "consent").map((r) => ({ cc: r.cc, name: r.name })),
    blocked: COUNTRY_RULES.filter((r) => r.status === "blocked").map((r) => ({ cc: r.cc, name: r.name })),
  };
}
