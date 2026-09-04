/**
 * `crixin coder install` — wire Crixin into the MCP configs of every AI coding tool
 * we know about, so a single command turns "I'm in a random project" into
 * "Claude Desktop / Claude Code / Cursor can all see my Crixin sessions."
 *
 *   crixin install                 → user-scope (default): Claude Desktop,
 *                                     Claude Code (~/.claude.json), Cursor
 *   crixin install --project       → write ./.mcp.json in the current repo
 *   crixin install --only=desktop  → only one target
 *   crixin coder install --print         → dry-run: print intended changes
 *
 * Idempotent: re-running merges. Existing mcpServers entries for `crixin` are
 * overwritten in place; sibling entries are left alone.
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
  print?: boolean;      // dry-run
  command?: string;     // override the launch command (default: "npx -y crixin coder mcp")
  uninstall?: boolean;  // remove the crixin entry instead of adding it
  migrateLegacy?: boolean;  // convert legacy array-shape mcpServers to object form (writes .bak)
}

interface ConfigTarget {
  id: "desktop" | "claude-code" | "cursor" | "codex" | "project";
  label: string;
  path: string;
  format: "json" | "toml";
}

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
    // Linux: Claude Desktop is not officially shipped; some community builds
    // use ~/.config/Claude. Best-effort.
    out.push({
      id: "desktop",
      label: "Claude Desktop",
      path: join(home, ".config/Claude/claude_desktop_config.json"),
      format: "json",
    });
  }
  out.push({
    id: "claude-code",
    label: "Claude Code",
    path: join(home, ".claude.json"),
    format: "json",
  });
  out.push({
    id: "cursor",
    label: "Cursor",
    path: join(home, ".cursor/mcp.json"),
    format: "json",
  });
  out.push({
    id: "codex",
    label: "Codex CLI",
    path: join(home, ".codex/config.toml"),
    format: "toml",
  });
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
        `Fix or move it, then re-run \`crixin install\`. (${(err as Error).message})`,
    );
  }
}

function writeJson(path: string, data: Record<string, unknown>): void {
  // Atomic write: stage to a sibling .tmp, rename on success. Protects
  // ~/.claude.json (user state) from a half-written corrupt file if we crash
  // or get killed mid-write.
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.crixin-coder-install.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

function buildEntry(command?: string): { command: string; args: string[] } {
  if (command) {
    const parts = command.split(/\s+/).filter(Boolean);
    return { command: parts[0]!, args: parts.slice(1) };
  }
  return { command: "npx", args: ["-y", "crixin", "coder", "mcp"] };
}

function mergeMcpServer(
  existing: Record<string, unknown>,
  entry: { command: string; args: string[] },
): { config: Record<string, unknown>; changed: boolean; replaced: boolean } {
  const config = { ...existing };
  const servers = (config["mcpServers"] as Record<string, unknown> | undefined) ?? {};
  const before = JSON.stringify(servers["crixin-coder"] ?? null);
  servers["crixin-coder"] = entry;
  config["mcpServers"] = servers;
  const after = JSON.stringify(servers["crixin-coder"]);
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
  if (!("crixin-coder" in servers)) {
    return { config, removed: false };
  }
  const next = { ...servers };
  delete next["crixin-coder"];
  // If mcpServers is now empty, drop the key entirely so we don't litter
  // the user's config with a hollow object.
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
  const tmp = `${path}.crixin-coder-install.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

export function runCoderInstall(opts: InstallOpts): void {
  if (opts.uninstall) {
    runCoderUninstall(opts);
    return;
  }
  const entry = buildEntry(opts.command);
  const all = targets();
  const chosen = pickTargets(all, opts);

  log.info(`Installing Crixin Coder MCP server: ${entry.command} ${entry.args.join(" ")}`);

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
      const { toml, changed, replaced } = tomlMutate(existing, "crixin-coder", entry);
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
    log.info("Nothing to do — all targets already point at Crixin Coder.");
    return;
  }

  log.success(`Wired ${totalChanged} target${totalChanged === 1 ? "" : "s"}.`);
  log.hint("Restart Claude Desktop / Claude Code / Cursor (or relaunch Codex CLI) to pick up the change.");
  log.hint("Test with: crixin doctor");
}

function runCoderUninstall(opts: InstallOpts): void {
  const all = targets();
  const chosen = pickTargets(all, opts);

  log.info("Uninstalling Crixin Coder MCP server from selected hosts.");

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
      const { toml, changed } = tomlRemove(existing, "crixin-coder");
      if (!changed) {
        log.info(`${t.label} — Crixin Coder entry not found (already absent)`);
        totalAbsent++;
        continue;
      }
      if (opts.print) {
        log.info(`${t.label} — would write ${t.path} (Crixin entry removed)`);
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
      log.info(`${t.label} — Crixin Coder entry not found (already absent)`);
      totalAbsent++;
      continue;
    }
    if (opts.print) {
      log.info(`${t.label} — would write ${t.path} (Crixin entry removed)`);
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
    log.info("Nothing to do — Crixin Coder wasn't registered with any selected host.");
    return;
  }
  log.success(`Removed Crixin Coder from ${totalRemoved} host${totalRemoved === 1 ? "" : "s"}.`);
  log.hint("Restart Claude Desktop / Claude Code / Cursor for the change to take effect.");
  log.hint("To reinstall: crixin coder install");
}
