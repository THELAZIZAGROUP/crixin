/**
 * `crixin voice install` — wire the voice MCP server into the same hosts as
 * `crixin install` does for the sessions MCP. We keep these as two separate
 * MCP entries (`crixin` and `crixin-voice`) so a user can install one without
 * the other and so the host UI surfaces them with their distinct tool sets.
 *
 *   crixin voice install              → user-scope: Claude Desktop, Claude Code, Cursor
 *   crixin voice install --project    → write ./.mcp.json in the current repo
 *   crixin voice install --only=desktop
 *   crixin voice install --print      → dry-run
 *   crixin voice install --uninstall  → remove the crixin-voice entry
 *
 * Idempotent: re-running merges. Only the `crixin-voice` entry is touched —
 * the sessions `crixin` entry and any sibling MCP servers are left alone.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { log } from "../lib/log.js";
import { mutateMcpServer as tomlMutate, removeMcpServer as tomlRemove } from "../lib/toml-mcp.js";
import { friendlyFsError } from "../lib/fs-errors.js";
import {
  isLegacyMcpServers,
  migrateLegacyMcpServers,
  legacyRefusalMessage,
} from "../lib/legacy-mcp-servers.js";

interface InstallOpts {
  project?: boolean;
  only?: string;        // "desktop" | "claude-code" | "cursor" | "codex"
  print?: boolean;
  command?: string;     // override the launch command (default: "npx -y crixin voice mcp")
  uninstall?: boolean;
  migrateLegacy?: boolean;  // convert legacy array-shape mcpServers to object form (writes .bak)
}

interface ConfigTarget {
  id: "desktop" | "claude-code" | "cursor" | "codex" | "project";
  label: string;
  path: string;
  format: "json" | "toml";
}

const ENTRY_NAME = "crixin-voice";

function targets(): ConfigTarget[] {
  const home = homedir();
  const out: ConfigTarget[] = [];
  if (platform() === "darwin") {
    out.push({
      id: "desktop",
      label: "Claude Desktop",
      path: join(home, "Library/Application Support/Claude/claude_desktop_config.json"),
      format: "json",
    });
  } else if (platform() === "win32") {
    const appdata = process.env["APPDATA"] ?? join(home, "AppData/Roaming");
    out.push({
      id: "desktop",
      label: "Claude Desktop",
      path: join(appdata, "Claude/claude_desktop_config.json"),
      format: "json",
    });
  } else {
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

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const txt = readFileSync(path, "utf8").trim();
    if (!txt) return {};
    return JSON.parse(txt) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `${path} is not valid JSON — refusing to overwrite. ` +
        `Fix or move it, then re-run \`crixin voice install\`. (${(err as Error).message})`,
    );
  }
}

function writeJson(path: string, data: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.crixin-voice-install.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

function buildEntry(command?: string): { command: string; args: string[] } {
  if (command) {
    const parts = command.split(/\s+/).filter(Boolean);
    return { command: parts[0]!, args: parts.slice(1) };
  }
  return { command: "npx", args: ["-y", "crixin", "voice", "mcp"] };
}

function mergeMcpServer(
  existing: Record<string, unknown>,
  entry: { command: string; args: string[] },
): { config: Record<string, unknown>; changed: boolean; replaced: boolean } {
  const config = { ...existing };
  const servers = (config["mcpServers"] as Record<string, unknown> | undefined) ?? {};
  const before = JSON.stringify(servers[ENTRY_NAME] ?? null);
  servers[ENTRY_NAME] = entry;
  config["mcpServers"] = servers;
  const after = JSON.stringify(servers[ENTRY_NAME]);
  return {
    config,
    changed: before !== after,
    replaced: before !== "null" && before !== after,
  };
}

function removeMcpServer(
  existing: Record<string, unknown>,
): { config: Record<string, unknown>; removed: boolean } {
  const config = { ...existing };
  const servers = (config["mcpServers"] as Record<string, unknown> | undefined) ?? {};
  if (!(ENTRY_NAME in servers)) return { config, removed: false };
  const next = { ...servers };
  delete next[ENTRY_NAME];
  if (Object.keys(next).length === 0) {
    delete config["mcpServers"];
  } else {
    config["mcpServers"] = next;
  }
  return { config, removed: true };
}

function pickTargets(all: ConfigTarget[], opts: InstallOpts): ConfigTarget[] {
  if (opts.project) {
    return [
      {
        id: "project",
        label: `current repo (${process.cwd()})`,
        path: resolve(process.cwd(), ".mcp.json"),
        format: "json",
      },
    ];
  }
  if (opts.only) {
    const filtered = all.filter((t) => t.id === opts.only);
    if (filtered.length === 0) {
      throw new Error(
        `Unknown --only target: ${opts.only}. Use desktop, claude-code, cursor, or codex.`,
      );
    }
    return filtered;
  }
  return all;
}

function readToml(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

function writeToml(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.crixin-voice-install.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

export function runVoiceInstall(opts: InstallOpts): void {
  if (opts.uninstall) {
    runVoiceUninstall(opts);
    return;
  }
  const entry = buildEntry(opts.command);
  const chosen = pickTargets(targets(), opts);

  log.info(`Installing Crixin Voice MCP: ${entry.command} ${entry.args.join(" ")}`);

  let totalChanged = 0;
  let totalSkipped = 0;
  for (const t of chosen) {
    if (t.format === "toml") {
      let existing: string;
      try {
        existing = readToml(t.path);
      } catch (err) {
        log.error(`${t.label} (${t.path}): ${(err as Error).message}`);
        continue;
      }
      const { toml, changed, replaced } = tomlMutate(existing, ENTRY_NAME, entry);
      if (!changed) {
        log.info(`${t.label} — already configured (no change)`);
        totalSkipped++;
        continue;
      }
      if (opts.print) {
        log.info(`${t.label} — would write ${t.path}`);
        log.hint(toml);
        continue;
      }
      try {
        writeToml(t.path, toml);
        log.success(`${t.label} — ${replaced ? "updated" : "added"} (${t.path})`);
        totalChanged++;
      } catch (err) {
        log.error(friendlyFsError(err, t.path, t.label));
      }
      continue;
    }

    let existing: Record<string, unknown>;
    try {
      existing = readJson(t.path);
    } catch (err) {
      log.error(`${t.label} (${t.path}): ${(err as Error).message}`);
      continue;
    }
    if (isLegacyMcpServers(existing)) {
      if (!opts.migrateLegacy) {
        log.error(legacyRefusalMessage(t.path, t.label));
        continue;
      }
      const { converted, count, skipped } = migrateLegacyMcpServers(existing);
      // Write the .bak before any further mutation
      try {
        const bak = `${t.path}.bak`;
        writeFileSync(bak, readFileSync(t.path, "utf8"), "utf8");
        log.info(`${t.label} — wrote backup to ${bak}`);
      } catch (err) {
        log.error(friendlyFsError(err, t.path, t.label));
        continue;
      }
      existing = converted;
      log.success(
        `${t.label} — migrated ${count} legacy mcpServers entr${count === 1 ? "y" : "ies"}` +
          (skipped.length > 0 ? ` (skipped ${skipped.length} malformed)` : ""),
      );
    }
    const { config, changed, replaced } = mergeMcpServer(existing, entry);
    if (!changed) {
      log.info(`${t.label} — already configured (no change)`);
      totalSkipped++;
      continue;
    }
    if (opts.print) {
      log.info(`${t.label} — would write ${t.path}`);
      log.hint(JSON.stringify(config["mcpServers"], null, 2));
      continue;
    }
    try {
      writeJson(t.path, config);
      log.success(`${t.label} — ${replaced ? "updated" : "added"} (${t.path})`);
      totalChanged++;
    } catch (err) {
      log.error(friendlyFsError(err, t.path, t.label));
    }
  }

  if (opts.print) {
    log.info("Dry run only — no files written. Re-run without --print to apply.");
    return;
  }
  if (totalChanged === 0 && totalSkipped > 0) {
    log.info("Nothing to do — all targets already point at Crixin Voice.");
    return;
  }
  log.success(`Wired ${totalChanged} target${totalChanged === 1 ? "" : "s"}.`);
  log.hint("Make sure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER are exported in the env each host launches from.");
  log.hint("Restart your AI host, then test with: crixin voice doctor");
}

function runVoiceUninstall(opts: InstallOpts): void {
  const chosen = pickTargets(targets(), opts);
  log.info("Uninstalling Crixin Voice MCP from selected hosts.");
  let totalRemoved = 0;
  let totalAbsent = 0;
  for (const t of chosen) {
    if (!existsSync(t.path)) {
      log.info(`${t.label} — no config file at ${t.path} (already absent)`);
      totalAbsent++;
      continue;
    }
    if (t.format === "toml") {
      let existing: string;
      try {
        existing = readToml(t.path);
      } catch (err) {
        log.error(`${t.label} (${t.path}): ${(err as Error).message}`);
        continue;
      }
      const { toml, changed } = tomlRemove(existing, ENTRY_NAME);
      if (!changed) {
        log.info(`${t.label} — Crixin Voice entry not found (already absent)`);
        totalAbsent++;
        continue;
      }
      if (opts.print) {
        log.info(`${t.label} — would write ${t.path} (Crixin Voice entry removed)`);
        continue;
      }
      try {
        writeToml(t.path, toml);
        log.success(`${t.label} — removed (${t.path})`);
        totalRemoved++;
      } catch (err) {
        log.error(friendlyFsError(err, t.path, t.label));
      }
      continue;
    }

    let existing: Record<string, unknown>;
    try {
      existing = readJson(t.path);
    } catch (err) {
      log.error(`${t.label} (${t.path}): ${(err as Error).message}`);
      continue;
    }
    const { config, removed } = removeMcpServer(existing);
    if (!removed) {
      log.info(`${t.label} — Crixin Voice entry not found (already absent)`);
      totalAbsent++;
      continue;
    }
    if (opts.print) {
      log.info(`${t.label} — would write ${t.path} (Crixin Voice entry removed)`);
      continue;
    }
    try {
      writeJson(t.path, config);
      log.success(`${t.label} — removed (${t.path})`);
      totalRemoved++;
    } catch (err) {
      log.error(friendlyFsError(err, t.path, t.label));
    }
  }
  if (opts.print) {
    log.info("Dry run only — no files written. Re-run without --print to apply.");
    return;
  }
  if (totalRemoved === 0 && totalAbsent > 0) {
    log.info("Nothing to do — Crixin Voice wasn't registered with any selected host.");
    return;
  }
  log.success(`Removed Crixin Voice from ${totalRemoved} host${totalRemoved === 1 ? "" : "s"}.`);
  log.hint("Restart your AI host for the change to take effect.");
}
