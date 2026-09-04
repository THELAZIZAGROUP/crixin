/** A single message we extracted from a source file, normalized for our DB. */
export interface NormalizedMessage {
  role: "user" | "assistant" | "system" | "tool_result";
  content: string;
  ts: number | null;
  model?: string | null;
  tokens?: number | null;
  toolName?: string | null;
}

export interface IngestSummary {
  source: string;
  scanned: number;
  inserted: number;
  skippedUnchanged: number;
  failed: number;
}
