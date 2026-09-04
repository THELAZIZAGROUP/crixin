/**
 * Firebase Identity Toolkit REST helpers — generate magic-link sign-in URLs
 * with our service account, then verify the resulting Firebase ID token
 * against Google's JWKS.
 *
 * We deliberately avoid `firebase-admin` (5+ MB install, ~600ms cold-start
 * heavier than these REST calls). Same primitives, less weight.
 *
 * Required env:
 *   FIREBASE_PROJECT_ID         — e.g. crixin-ab7d6
 *   FIREBASE_CLIENT_EMAIL       — service account email
 *   FIREBASE_PRIVATE_KEY        — PEM with literal "\n" or real newlines
 *   FIREBASE_WEB_API_KEY        — public Web API key (visible in Firebase Console → Project settings)
 *   PUBLIC_SITE_URL             — used to build continueUrl
 */

import { createSign, createPrivateKey, createPublicKey, verify as cryptoVerify } from "node:crypto";

const IDENTITY_BASE = "https://identitytoolkit.googleapis.com/v1";

let cachedToken: { token: string; expiresAt: number } | null = null;
let cachedJwks: { keys: Map<string, string>; expiresAt: number } | null = null;

// =============================================================================
//  Service-account access token (cloud-platform scope)
// =============================================================================

function loadConfig() {
  const projectId = process.env["FIREBASE_PROJECT_ID"];
  const clientEmail = process.env["FIREBASE_CLIENT_EMAIL"];
  let privateKey = process.env["FIREBASE_PRIVATE_KEY"];
  const apiKey = process.env["FIREBASE_WEB_API_KEY"];
  if (!projectId || !clientEmail || !privateKey || !apiKey) {
    throw new Error(
      "Firebase identity not configured (FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY/WEB_API_KEY)",
    );
  }
  if (privateKey.includes("\\n")) privateKey = privateKey.replace(/\\n/g, "\n");
  return { projectId, clientEmail, privateKey, apiKey };
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < cachedToken.expiresAt - 60_000) return cachedToken.token;

  const { clientEmail, privateKey } = loadConfig();
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: clientEmail,
      // cloud-platform covers Identity Toolkit + Firestore + everything else
      // we need; avoids juggling per-API scopes.
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat,
      exp,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const key = createPrivateKey(privateKey);
  const sig = createSign("RSA-SHA256").update(signingInput).sign(key);
  const jwt = `${signingInput}.${b64urlBuf(sig)}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });
  if (!r.ok) {
    throw new Error(`token exchange failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: j.access_token, expiresAt: now + j.expires_in * 1000 };
  return j.access_token;
}

// =============================================================================
//  Mint a sign-in magic link (server-only — service account auth)
// =============================================================================

export interface SignInLinkOptions {
  email: string;
  /** Where Firebase's action handler redirects after validating the click. */
  continueUrl: string;
  /** Default true. When set, the redirect URL goes straight to continueUrl after Firebase verifies. */
  canHandleCodeInApp?: boolean;
}

export interface SignInLinkResult {
  /** The full magic link to email the user. Goes through Firebase's action
   *  handler first (validates oobCode), then redirects to continueUrl with
   *  ?email=&oobCode=&apiKey=&mode=signIn&lang=en. */
  oobLink: string;
}

/**
 * Generate a sign-in-with-email-link URL using Firebase Identity Toolkit.
 * `returnOobLink: true` requires elevated privileges (service account auth);
 * Firebase will NOT send its own email — we email the URL via Resend.
 */
export async function generateSignInWithEmailLink(
  opts: SignInLinkOptions,
): Promise<SignInLinkResult> {
  const { apiKey } = loadConfig();
  const accessToken = await getAccessToken();
  const r = await fetch(`${IDENTITY_BASE}/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requestType: "EMAIL_SIGNIN",
      email: opts.email,
      continueUrl: opts.continueUrl,
      canHandleCodeInApp: opts.canHandleCodeInApp ?? true,
      returnOobLink: true,
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`sendOobCode failed (${r.status}): ${text.slice(0, 240)}`);
  }
  const j = (await r.json()) as { oobLink?: string };
  if (!j.oobLink) {
    throw new Error("sendOobCode returned no oobLink");
  }
  return { oobLink: j.oobLink };
}

// =============================================================================
//  Verify a Firebase ID token (RS256 + JWKS, cached 6 hours)
// =============================================================================

export interface FirebaseIdTokenClaims {
  iss: string;
  aud: string;
  auth_time: number;
  user_id: string;        // Firebase UID
  sub: string;            // same as user_id
  iat: number;
  exp: number;
  email?: string;
  email_verified?: boolean;
  firebase: {
    identities: Record<string, unknown>;
    sign_in_provider: string;
  };
}

const JWKS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

async function getJwks(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cachedJwks && now < cachedJwks.expiresAt) return cachedJwks.keys;
  const r = await fetch(JWKS_URL);
  if (!r.ok) throw new Error(`jwks fetch failed: ${r.status}`);
  const j = (await r.json()) as Record<string, string>;
  // Cache-Control honors Google's max-age, default 6h
  const cacheControl = r.headers.get("cache-control") ?? "";
  const m = cacheControl.match(/max-age=(\d+)/);
  const ttlMs = m ? parseInt(m[1]!, 10) * 1000 : 6 * 3600 * 1000;
  const keys = new Map(Object.entries(j));
  cachedJwks = { keys, expiresAt: now + ttlMs };
  return keys;
}

/**
 * Verify a Firebase ID token. Returns the parsed claims on success, throws
 * on any failure (bad signature, expired, wrong project, etc.).
 *
 * Reference: https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
 */
export async function verifyFirebaseIdToken(token: string): Promise<FirebaseIdTokenClaims> {
  const { projectId } = loadConfig();
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed id token");
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")) as {
    alg?: string;
    kid?: string;
  };
  if (header.alg !== "RS256") throw new Error("unexpected alg");
  if (!header.kid) throw new Error("missing kid");

  const jwks = await getJwks();
  const certPem = jwks.get(header.kid);
  if (!certPem) throw new Error("unknown signing key (kid)");

  const pubKey = createPublicKey(certPem);
  const ok = cryptoVerify(
    "RSA-SHA256",
    Buffer.from(`${headerB64}.${payloadB64}`, "utf8"),
    pubKey,
    Buffer.from(sigB64, "base64url"),
  );
  if (!ok) throw new Error("signature invalid");

  const claims = JSON.parse(
    Buffer.from(payloadB64, "base64url").toString("utf8"),
  ) as FirebaseIdTokenClaims;

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now) throw new Error("token expired");
  if (claims.iat > now + 60) throw new Error("token from the future");
  if (claims.aud !== projectId) {
    throw new Error(`wrong audience: ${claims.aud} (expected ${projectId})`);
  }
  if (claims.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error(`wrong issuer: ${claims.iss}`);
  }
  if (!claims.sub || claims.sub !== claims.user_id) {
    throw new Error("missing/inconsistent sub");
  }
  if (!claims.email) {
    throw new Error("token has no email claim");
  }
  return claims;
}

// =============================================================================
//  Helpers
// =============================================================================

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}
function b64urlBuf(b: Buffer): string {
  return b.toString("base64url");
}
