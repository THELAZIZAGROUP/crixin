/**
 * Shared host-target detection for `crixin install` / `crixin install --check`
 * / `crixin doctor`. The host paths and shapes are identical across voice
 * and coder install code, plus the new `--check` command — extracted here
 * so all three callers stay in sync.
 *
 * Scope is intentionally narrow: just where the four supported AI host
 * configs live, and what format each uses. Nothing about MCP entry shapes
 * or write logic lives here.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export type HostId = "desktop" | "claude-code" | "cursor" | "codex";

export interface HostTarget {
  id: HostId;
  label: string;
  path: string;
  format: "json" | "toml";
}

export interface PathEnv {
  /** User home directory. Required. */
  home: string;
  /** node:os platform() value: "darwin" | "win32" | other (Linux fallback). */
  platform: NodeJS.Platform;
  /** Windows %APPDATA% directory; ignored on non-Windows. Defaults to {home}/AppData/Roaming. */
  appdata?: string;
}

/**
 * Pure path-computation function. Given a PathEnv, returns the four host
 * targets. Extracted so cross-platform paths can be tested without mocking
 * node:os.
 *
 * Supported platforms:
 *   - "darwin" — uses ~/Library/Application Support/Claude/...
 *   - "win32"  — uses %APPDATA%/Claude/... (falls back to home/AppData/Roaming)
 *   - anything else — Linux convention ~/.config/Claude/... (Claude Desktop
 *     isn't officially shipped on Linux but some community builds use this)
 *
 * Claude Code / Cursor / Codex paths are identical across all platforms.
 */
export function computeHostTargets(env: PathEnv): HostTarget[] {
  const { home } = env;
  const out: HostTarget[] = [];
  if (env.platform === "darwin") {
    out.push({
      id: "desktop",
      label: "Claude Desktop",
      path: join(home, "Library/Application Support/Claude/claude_desktop_config.json"),
      format: "json",
    });
  } else if (env.platform === "win32") {
    const appdata = env.appdata ?? join(home, "AppData/Roaming");
    out.push({
      id: "desktop",
      label: "Claude Desktop",
      path: join(appdata, "Claude/claude_desktop_config.json"),
      format: "json",
    });
  } else {
    // Linux: Claude Desktop is not officially shipped; some community builds
    // use ~/.config/Claude. Best-effort.
    out.push({
      id: "desktop",
      label: "Claude Desktop",
      path: join(home, ".config/Claude/claude_desktop_config.json"),
      format: "json",
    });
  }
  out.push({ id: "claude-code", label: "Claude Code", path: join(home, ".claude.json"),       format: "json" });
  out.push({ id: "cursor",      label: "Cursor",      path: join(home, ".cursor/mcp.json"),   format: "json" });
  out.push({ id: "codex",       label: "Codex CLI",   path: join(home, ".codex/config.toml"), format: "toml" });
  return out;
}

export function getHostTargets(): HostTarget[] {
  return computeHostTargets({
    home: homedir(),
    platform: platform(),
    appdata: process.env["APPDATA"],
  });
}

/**
 * Check whether a single MCP entry name is registered in the given host's
 * config. Returns:
 *   - "present"        — entry is registered (regardless of exact command/args)
 *   - "missing"        — config exists and is readable, but entry is absent
 *   - "no-config"      — config file doesn't exist at all (host probably not installed)
 *   - "unreadable"     — file exists but couldn't be parsed (malformed JSON/TOML)
 *   - "legacy-schema"  — JSON file has mcpServers as an array (legacy shape)
 *
 * Read-only: never mutates anything.
 */
export type EntryStatus =
  | "present"
  | "missing"
  | "no-config"
  | "unreadable"
  | "legacy-schema";

export function checkEntryPresent(target: HostTarget, entryName: string): EntryStatus {
  if (!existsSync(target.path)) return "no-config";
  let raw: string;
  try {
    raw = readFileSync(target.path, "utf8");
  } catch {
    return "unreadable";
  }
  if (target.format === "json") {
    if (!raw.trim()) return "missing";
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return "unreadable";
    }
    const servers = parsed["mcpServers"];
    if (Array.isArray(servers)) return "legacy-schema";
    if (!servers || typeof servers !== "object") return "missing";
    return entryName in (servers as Record<string, unknown>) ? "present" : "missing";
  }
  // TOML
  return raw.includes(`[mcp_servers.${entryName}]`) ? "present" : "missing";
}
