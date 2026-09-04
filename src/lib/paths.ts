import { homedir, platform } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";

const HOME = homedir();

/** Default Cursor app-data dir for the current OS (macOS for v0.1; v0.2 covers Linux/Windows). */
function defaultCursorAppData(): string {
  switch (platform()) {
    case "darwin":
      return join(HOME, "Library", "Application Support", "Cursor");
    case "linux":
      return join(HOME, ".config", "Cursor");
    case "win32":
      return join(process.env["APPDATA"] ?? join(HOME, "AppData", "Roaming"), "Cursor");
    default:
      return join(HOME, ".config", "Cursor");
  }
}

export const paths = {
  /** Where Claude Code stores per-project session JSONL files. */
  claudeCodeProjects: process.env.CRIXIN_CLAUDE_PROJECTS ?? join(HOME, ".claude", "projects"),

  /** ~/.codex root. Sessions land under ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl. */
  codexHome: process.env.CRIXIN_CODEX_HOME ?? join(HOME, ".codex"),
  get codexSessions(): string {
    return join(this.codexHome, "sessions");
  },

  /** Cursor app-data root. Contains User/globalStorage and User/workspaceStorage. */
  cursorAppData: process.env.CRIXIN_CURSOR_APPDATA ?? defaultCursorAppData(),

  /** Crixin's own data directory. Created on first run. */
  crixinHome: process.env.CRIXIN_HOME ?? join(HOME, ".crixin"),

  /** Local DuckDB/SQLite database file. */
  get dbFile(): string {
    return join(this.crixinHome, "crixin.db");
  },

  /** Offline-verified license token, written by `crixin license activate`. */
  get licenseFile(): string {
    return join(this.crixinHome, "license.json");
  },
};

/** Ensure CRIXIN_HOME exists. Idempotent. */
export function ensureCrixinHome(): void {
  if (!existsSync(paths.crixinHome)) {
    mkdirSync(paths.crixinHome, { recursive: true });
  }
}
