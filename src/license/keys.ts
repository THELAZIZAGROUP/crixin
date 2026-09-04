/**
 * Public key shipped with the binary. We verify license JWTs against this.
 *
 * Threat model: anyone can read this; that's fine, you can only verify
 * signatures, not produce them. The corresponding private key lives on
 * Vercel as STRIPE_LICENSE_PRIV_KEY (never committed).
 *
 * Generated 2026-05-05. To rotate: update both this constant AND the Vercel
 * env var, ship a new npm version, and the old keys keep working until users
 * upgrade (their existing license JWTs were signed with the old key).
 */
export const LICENSE_PUBLIC_KEY_RAW_B64 =
  "Rmiw63MhCktslVhmZ3extdpD/o3lixwewK6sJCT5s80=";
