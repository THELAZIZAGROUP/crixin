/**
 * `crixin tag` — F8
 * Free: 5 tags max
 * Pro:  unlimited tags + saved searches
 *
 * Subcommands:
 *   crixin tag <session-id> <tag>          — attach tag
 *   crixin tag rm <session-id> <tag>       — detach
 *   crixin tag list                         — list all tags
 *   crixin tag of <session-id>              — list tags on a session
 *   crixin pin <session-id>                 — pin (alias for adding the "_pinned" pseudo-tag)
 *   crixin unpin <session-id>               — unpin
 */
import { getDb } from "../db/init.js";
import { tags as tagOps } from "../db/queries.js";
import { isPro, PRO_BADGE, PRO_UPGRADE_HINT } from "../license/features.js";
import { log } from "../lib/log.js";
import kleur from "kleur";

const FREE_TAG_LIMIT = 5;

export function runTag(args: { positionals: string[] }): void {
  const db = getDb();
  const [sub, ...rest] = args.positionals;

  if (sub === "list" || sub === undefined) {
    const list = tagOps.list(db);
    if (list.length === 0) {
      console.log(kleur.gray("No tags yet — `crixin tag <session-id> <name>` to create one."));
      return;
    }
    console.log("");
    console.log(kleur.bold("Tags"));
    for (const t of list) {
      const c = t.color ? ((s: string) => s) : (s: string) => s;
      console.log(`  ${c(t.name.padEnd(20))} ${kleur.gray(`${t.count} session${t.count === 1 ? "" : "s"}`)}`);
    }
    console.log("");
    return;
  }

  if (sub === "rm") {
    const [sessionId, name] = rest;
    if (!sessionId || !name) { log.error("Usage: crixin tag rm <session-id> <name>"); process.exitCode = 1; return; }
    tagOps.detach(db, sessionId, name);
    log.success(`Removed tag "${name}" from ${sessionId.slice(0, 12)}…`);
    return;
  }

  if (sub === "of") {
    const [sessionId] = rest;
    if (!sessionId) { log.error("Usage: crixin tag of <session-id>"); process.exitCode = 1; return; }
    const t = tagOps.forSession(db, sessionId);
    console.log(t.length ? "  " + t.join(", ") : kleur.gray("  (no tags)"));
    return;
  }

  // Default: `crixin tag <session-id> <name>` to attach
  const sessionId = sub;
  const name = rest[0];
  if (!sessionId || !name) {
    log.error("Usage: crixin tag <session-id> <name>");
    process.exitCode = 1;
    return;
  }

  if (!isPro()) {
    const existing = tagOps.list(db);
    if (existing.length >= FREE_TAG_LIMIT && !existing.find((t) => t.name === name)) {
      log.error(`Free tier capped at ${FREE_TAG_LIMIT} tags. ${PRO_BADGE} ${PRO_UPGRADE_HINT}`);
      process.exitCode = 1;
      return;
    }
  }

  tagOps.attach(db, sessionId, name);
  log.success(`Tagged ${sessionId.slice(0, 12)}… as "${name}"`);
}

export function runPin(sessionId: string, pinned: boolean): void {
  const db = getDb();
  tagOps.pin(db, sessionId, pinned);
  log.success(`${pinned ? "Pinned" : "Unpinned"} ${sessionId.slice(0, 12)}…`);
}
