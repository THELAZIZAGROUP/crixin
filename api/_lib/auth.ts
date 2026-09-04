/**
 * Session cookie helpers + small auth utilities.
 *
 * The magic-link side of auth lives elsewhere — Firebase Identity Toolkit
 * mints + verifies the email link (see api/_lib/firebase-identity.ts).
 * Once the frontend exchanges that for a Firebase ID token, /api/auth/session
 * verifies the ID token and uses these helpers to mint our HttpOnly session
 * cookie.
 *
 * Why our own cookie instead of just keeping the Firebase ID token client-side:
 *   - Firebase ID tokens expire in 1 hour; we'd refresh constantly.
 *   - Firebase ID tokens live in localStorage by default (XSS-readable).
 *   - HttpOnly + SameSite=Lax + HMAC signature = CSRF-resistant + XSS-resistant.
 *
 * Required env:
 *   AUTH_SESSION_SECRET — HMAC key for session cookies (>= 32 bytes)
 */

import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;        // 14 days
const COOKIE_NAME = "crixin_session";

// =============================================================================
//  Session cookie (HS256, JWT-shape)
// =============================================================================

export interface SessionPayload {
  /** Stable user id — sha256(email) so it doesn't change if we ever lower-case downstream. */
  uid: string;
  /** Email at time of session mint (Firestore is the source of truth for current email). */
  email: string;
  /** Issued-at (unix seconds). */
  iat: number;
  /** Expires-at (unix seconds). */
  exp: number;
}

export function mintSessionCookie(args: { uid: string; email: string }): string {
  const secret = sessionSecret();
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    uid: args.uid,
    email: args.email,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "CRIXIN_SESS" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifySessionCookie(token: string | undefined): SessionPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];

  // Constant-time signature compare
  const expected = createHmac("sha256", sessionSecret())
    .update(`${header}.${body}`)
    .digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

function sessionSecret(): string {
  const s = process.env["AUTH_SESSION_SECRET"];
  if (!s || s.length < 32) {
    throw new Error("AUTH_SESSION_SECRET missing or too short (>= 32 chars)");
  }
  return s;
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

// =============================================================================
//  Cookie I/O helpers (no `cookie` npm dep)
// =============================================================================

export function setSessionCookie(res: VercelResponse, value: string): void {
  const isProd = process.env["VERCEL_ENV"] === "production" || process.env["NODE_ENV"] === "production";
  const parts = [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (isProd) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res: VercelResponse): void {
  const isProd = process.env["VERCEL_ENV"] === "production" || process.env["NODE_ENV"] === "production";
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isProd) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function readSessionFromRequest(req: VercelRequest): SessionPayload | null {
  const raw = req.headers["cookie"];
  if (typeof raw !== "string") return null;
  const cookies = parseCookieHeader(raw);
  return verifySessionCookie(cookies[COOKIE_NAME]);
}

function parseCookieHeader(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const k = part.slice(0, eq);
    const v = part.slice(eq + 1);
    out[k] = v;
  }
  return out;
}

// =============================================================================
//  Stable user id derivation
// =============================================================================

/**
 * Deterministic user id from email. SHA-256 hash → first 24 hex chars.
 * Lower-cased so case-mismatched re-signups land in the same doc.
 */
export function deriveUserId(email: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
}

/** RFC-5322 lite — good enough at the API boundary. */
export function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;
}
