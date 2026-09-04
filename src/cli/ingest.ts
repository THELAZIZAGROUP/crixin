/**
 * `crixin ingest` — kept as a top-level alias for `crixin voice ingest`. The
 * legacy session-analyzer ingesters (claude-code / codex / cursor JSONL parsers)
 * were retired in v0.1.0; voice is the only data source now.
 */
import { runVoiceIngest } from "../voice/ingest.js";

export interface IngestOpts {
  sinceDays?: number;
  limit?: number;
  skipTranscribe?: boolean;
  reTranscribe?: boolean;
}

export async function runIngest(opts: IngestOpts = {}): Promise<void> {
  await runVoiceIngest(opts);
}
