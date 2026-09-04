import { ingestAll } from "../ingesters/index.js";
import { getDb } from "../db/init.js";
import { queries } from "../db/queries.js";
import { log } from "../lib/log.js";
import kleur from "kleur";

/** CLI deep search: `crixin search "<query>"`. Prints matches with resume hints. */
export function runSearch(args: { query: string; limit: number; reindex: boolean }): void {
  if (args.reindex) {
    log.info("Re-ingesting before search…");
    ingestAll();
  }
  const db = getDb();
  const hits = queries.searchMessages(db, args.query, args.limit);
  if (hits.length === 0) {
    log.warn(`No matches for "${args.query}".`);
    log.hint("Try: crixin search <query> --reindex");
    return;
  }
  for (const h of hits) {
    const session = queries.getSession(db, h.session_id);
    const project = session?.project ?? "(no project)";
    const ts = h.ts ? new Date(h.ts).toISOString().slice(0, 19).replace("T", " ") : "—";
    console.log("");
    console.log(kleur.bold(project) + kleur.gray("  ·  ") + kleur.gray(ts));
    console.log(kleur.gray(`Resume: cd ${project} && claude --resume ${h.session_id}`));
    console.log(`  …${h.snippet.replace(/\s+/g, " ").trim()}…`);
  }
  console.log("");
  log.success(`${hits.length} match(es).`);
}
