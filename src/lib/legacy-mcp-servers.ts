/**
 * Legacy schema handling for `mcpServers`.
 *
 * Old / non-standard MCP client configs sometimes encode `mcpServers` as an
 * ARRAY of entries (each with a `name` field) instead of the modern OBJECT
 * keyed by name. Common shapes seen in the wild:
 *
 *   { "mcpServers": [
 *       { "name": "filesystem", "command": "npx", "args": [...] },
 *       { "id":   "github",     "command": "...", "args": [...] }
 *     ] }
 *
 * Modern format:
 *
 *   { "mcpServers": {
 *       "filesystem": { "command": "npx", "args": [...] },
 *       "github":     { "command": "...", "args": [...] }
 *     } }
 *
 * Crixin must NOT silently coerce array → object. Silent schema rewrites are
 * a trust-killing class of bug. Instead:
 *   1. Detect the legacy shape via `isLegacyMcpServers()`
 *   2. Refuse to mutate unless the user explicitly opted in via
 *      `--migrate-legacy`
 *   3. When migrating, always write a `.bak` first so the user can recover
 */

interface LegacyEntry {
  name?: string;
  id?: string;
  command?: string;
  args?: string[];
  [k: string]: unknown;
}

/**
 * Returns true if the config has a legacy array-shaped mcpServers field.
 * Returns false for the modern object form, for absent mcpServers, and for
 * any other shape (which is "weird but not legacy" — caller decides).
 */
export function isLegacyMcpServers(cfg: Record<string, unknown>): boolean {
  return Array.isArray(cfg["mcpServers"]);
}

export interface MigrationResult {
  /** The converted config, with mcpServers as an object. */
  converted: Record<string, unknown>;
  /** Number of legacy entries successfully migrated. */
  count: number;
  /** Entries we couldn't migrate (missing both `name` and `id`). */
  skipped: LegacyEntry[];
}

/**
 * Convert a legacy array-shaped mcpServers config into the modern object form.
 *
 * Rules:
 *   - Each entry's key is taken from its `name` field, then `id` as a fallback.
 *   - Entries with neither `name` nor `id` are skipped (returned in `skipped`).
 *   - The `name` / `id` field is stripped from the value to avoid duplication.
 *   - Duplicate keys: last-write-wins (preserves array order).
 *   - All other top-level config keys are preserved unchanged.
 *
 * This is a pure function — caller is responsible for backup + write.
 */
export function migrateLegacyMcpServers(cfg: Record<string, unknown>): MigrationResult {
  if (!isLegacyMcpServers(cfg)) {
    return { converted: cfg, count: 0, skipped: [] };
  }
  const legacy = cfg["mcpServers"] as LegacyEntry[];
  const out: Record<string, unknown> = {};
  const skipped: LegacyEntry[] = [];
  let count = 0;
  for (const entry of legacy) {
    if (!entry || typeof entry !== "object") {
      skipped.push(entry);
      continue;
    }
    const key = entry.name ?? entry.id;
    if (typeof key !== "string" || !key) {
      skipped.push(entry);
      continue;
    }
    const { name: _n, id: _i, ...rest } = entry;
    out[key] = rest;
    count++;
  }
  return {
    converted: { ...cfg, mcpServers: out },
    count,
    skipped,
  };
}

/**
 * Build the user-facing refusal message when we detect legacy schema but the
 * user hasn't opted into migration. Names the path and tells them exactly
 * what to do.
 */
export function legacyRefusalMessage(path: string, label: string): string {
  return [
    `${label} (${path}) uses the legacy array-shaped mcpServers format.`,
    ``,
    `Crixin refuses to silently rewrite this — the conversion is lossy and we`,
    `won't touch your config without explicit consent.`,
    ``,
    `Two options:`,
    ``,
    `  1. (recommended) Let Crixin migrate it for you. A .bak file will be`,
    `     written next to the original before any changes:`,
    ``,
    `         crixin install --migrate-legacy`,
    ``,
    `  2. Migrate by hand. Convert from:`,
    `         "mcpServers": [ { "name": "x", ... }, ... ]`,
    `     to:`,
    `         "mcpServers": { "x": { ... }, ... }`,
    `     and re-run \`crixin install\`.`,
    ``,
    `Skipping this host for now.`,
  ].join("\n");
}
