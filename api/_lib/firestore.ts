/**
 * Tiny Firestore REST client. We intentionally do NOT depend on
 * firebase-admin in serverless functions — its cold start is ~600ms heavier
 * than this hand-rolled REST + JWT path, and we only need a few endpoints.
 *
 * Required env vars:
 *   FIREBASE_PROJECT_ID    — e.g. crixin-ab7d6
 *   FIREBASE_CLIENT_EMAIL  — service account email
 *   FIREBASE_PRIVATE_KEY   — PEM with literal "\n" or real newlines
 */

import { createSign, createPrivateKey } from "node:crypto";

let cachedToken: { token: string; expiresAt: number } | null = null;

function loadConfig() {
  const projectId = process.env["FIREBASE_PROJECT_ID"];
  const clientEmail = process.env["FIREBASE_CLIENT_EMAIL"];
  let privateKey = process.env["FIREBASE_PRIVATE_KEY"];
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firestore not configured (FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY)");
  }
  // Vercel stores env vars with literal "\n" — convert to real newlines.
  if (privateKey.includes("\\n")) privateKey = privateKey.replace(/\\n/g, "\n");
  return { projectId, clientEmail, privateKey };
}

/** Mint an OAuth2 access token from the service account, cached for 50min. */
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
      scope: "https://www.googleapis.com/auth/datastore",
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
  if (!r.ok) throw new Error(`token exchange failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: j.access_token, expiresAt: now + j.expires_in * 1000 };
  return j.access_token;
}

/**
 * Write (or merge) a Firestore document. `path` is "collection/doc" form.
 * Values are coerced to Firestore typed-value JSON.
 */
export async function writeDoc(
  path: string,
  data: Record<string, unknown>,
  opts: { merge?: boolean } = {},
): Promise<void> {
  const { projectId } = loadConfig();
  const token = await getAccessToken();
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`,
  );
  if (opts.merge) {
    for (const k of Object.keys(data)) url.searchParams.append("updateMask.fieldPaths", k);
  }
  const r = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!r.ok) {
    throw new Error(`firestore write ${path} failed: ${r.status} ${(await r.text()).slice(0, 240)}`);
  }
}

/**
 * Read a Firestore document. Returns the field map (with Firestore typed
 * values translated to JS) or null if not found. Path is "collection/doc".
 */
export async function readDoc(path: string): Promise<Record<string, unknown> | null> {
  const { projectId } = loadConfig();
  const token = await getAccessToken();
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`firestore read ${path} failed: ${r.status}`);
  const j = (await r.json()) as { fields?: Record<string, FsValue> };
  if (!j.fields) return null;
  return fromFirestoreFields(j.fields);
}

interface FsValue {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  nullValue?: null;
  arrayValue?: { values?: FsValue[] };
  mapValue?: { fields?: Record<string, FsValue> };
}

function fromFirestoreFields(fields: Record<string, FsValue>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fromFirestoreValue(v);
  return out;
}
function fromFirestoreValue(v: FsValue): unknown {
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue ? new Date(v.timestampValue) : null;
  if ("arrayValue" in v) return (v.arrayValue?.values ?? []).map(fromFirestoreValue);
  if ("mapValue" in v) return v.mapValue?.fields ? fromFirestoreFields(v.mapValue.fields) : {};
  return null;
}

/**
 * List documents under a collection path. Returns the parsed field maps plus
 * each document's name (`<collection>/<id>`). Pagination via pageToken when the
 * caller supplies one. v1 of sync uses this for `/api/sync/pull`.
 *
 * `orderBy` is a field name; prefix with `-` for DESC (e.g. `-updated_at`).
 * Firestore's REST `listDocuments` doesn't filter, so the caller is responsible
 * for any post-fetch filtering. Acceptable for sync v1 where records-per-user
 * is small (hundreds to low thousands).
 */
export async function listDocs(args: {
  collectionPath: string;
  pageSize?: number;
  pageToken?: string;
  orderBy?: string;
}): Promise<{ docs: Array<{ id: string; fields: Record<string, unknown> }>; nextPageToken: string | null }> {
  const { projectId } = loadConfig();
  const token = await getAccessToken();
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${args.collectionPath}`,
  );
  url.searchParams.set("pageSize", String(args.pageSize ?? 100));
  if (args.pageToken) url.searchParams.set("pageToken", args.pageToken);
  if (args.orderBy) url.searchParams.set("orderBy", args.orderBy);

  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 404) return { docs: [], nextPageToken: null };
  if (!r.ok) throw new Error(`firestore list ${args.collectionPath} failed: ${r.status} ${(await r.text()).slice(0, 240)}`);

  const j = (await r.json()) as {
    documents?: Array<{ name: string; fields?: Record<string, FsValue> }>;
    nextPageToken?: string;
  };
  const docs = (j.documents ?? []).map((d) => ({
    id: d.name.split("/").pop()!,
    fields: d.fields ? fromFirestoreFields(d.fields) : {},
  }));
  return { docs, nextPageToken: j.nextPageToken ?? null };
}

/** Delete a Firestore document. Idempotent — 404 is success. */
export async function deleteDoc(path: string): Promise<void> {
  const { projectId } = loadConfig();
  const token = await getAccessToken();
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
  if (!r.ok && r.status !== 404) {
    throw new Error(`firestore delete ${path} failed: ${r.status}`);
  }
}

/** Append a doc to a collection with an auto-generated id. */
export async function appendDoc(
  collection: string,
  data: Record<string, unknown>,
): Promise<{ id: string }> {
  const { projectId } = loadConfig();
  const token = await getAccessToken();
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: toFirestoreFields(data) }),
    },
  );
  if (!r.ok) {
    throw new Error(`firestore append ${collection} failed: ${r.status} ${(await r.text()).slice(0, 240)}`);
  }
  const j = (await r.json()) as { name: string };
  return { id: j.name.split("/").pop()! };
}

function toFirestoreFields(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) out[k] = toFirestoreValue(v);
  return out;
}
function toFirestoreValue(v: unknown): unknown {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === "object") return { mapValue: { fields: toFirestoreFields(v as Record<string, unknown>) } };
  return { stringValue: String(v) };
}

function b64url(s: string): string { return b64urlBuf(Buffer.from(s, "utf8")); }
function b64urlBuf(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
