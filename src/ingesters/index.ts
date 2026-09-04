import { ingestClaudeCode, type ClaudeCodeIngestOpts } from "./claude-code.js";
import { ingestCodex } from "./codex.js";
import { ingestCursor } from "./cursor.js";
import type { IngestSummary } from "./types.js";

export interface IngestAllOpts extends ClaudeCodeIngestOpts {}

/**
 * Run every supported ingester and return one summary per source.
 * Ingesters are independent and read from disjoint paths, so a failure in
 * one doesn't block the others.
 */
export function ingestAll(opts: IngestAllOpts = {}): IngestSummary[] {
  const summaries: IngestSummary[] = [];
  const runners: { name: string; run: () => IngestSummary }[] = [
    { name: "claude-code", run: () => ingestClaudeCode(opts) },
    { name: "codex", run: ingestCodex },
    { name: "cursor", run: ingestCursor },
  ];
  for (const r of runners) {
    try {
      summaries.push(r.run());
    } catch {
      summaries.push({
        source: r.name,
        scanned: 0,
        inserted: 0,
        skippedUnchanged: 0,
        failed: 1,
      });
    }
  }
  return summaries;
}

export { ingestClaudeCode, ingestCodex, ingestCursor };
