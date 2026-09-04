/**
 * Schema DDL — applied by `init.ts` on first connection.
 *
 * SCHEMA_VERSION is bumped whenever the meaning of an existing column changes
 * (not just when columns are added). When a binary loads a DB whose stored
 * schema_version is lower, init.ts wipes the cached `sessions` rows so the
 * next ingest re-computes against the new logic.
 *
 * v2 (2026-05-04): cost_usd_cents is now Anthropic-cache-aware when the
 * source JSONL carries a `usage` block. Old tokenizer-estimate values must
 * be discarded so the user doesn't see stale numbers from v1.
 *
 * v3 (2026-05-05): adds tags + alerts + share_tokens tables for v0.0.4
 * features (#8 tags, #9 alerts, #14 share). Sessions table gets a
 * `parent_session_id` column for sub-agent attribution (#3).
 *
 * v4 (2026-05-09): the v0.1.0 pivot. Adds voice_calls + voice_recordings
 * tables — Twilio call records, recordings, and joined transcript text.
 * The session-analyzer surface (sessions/messages/tool_uses) is left in
 * place for users still on legacy data, but the wrapped/archetype/ducked
 * engines now read from voice_calls when present.
 *
 * v5 (2026-05-14): Crixin Sync v1. Adds sync_devices, sync_outbox, sync_inbox
 * tables for opt-in, metadata-only cross-machine sync (Pro). Additive only —
 * no existing rows touched; nothing here reads or writes message bodies or
 * transcripts. See .claude/backlog/2026-05-14-crixin-sync-v1.md for scope.
 */
export const SCHEMA_VERSION = "5";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,           -- session UUID from source
  source        TEXT NOT NULL,              -- 'claude-code' | 'codex' | 'cursor' | 'sdk'
  project       TEXT,                       -- repo path / project name
  started_at    INTEGER,                    -- unix ms
  ended_at      INTEGER,                    -- unix ms
  message_count INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd_cents INTEGER NOT NULL DEFAULT 0, -- cents to keep integer math
  source_path   TEXT NOT NULL,              -- absolute path of origin file
  source_mtime  INTEGER NOT NULL,           -- file mtime (ms) at last ingest
  source_size   INTEGER NOT NULL,           -- file size (bytes) at last ingest
  parent_session_id TEXT,                   -- v3: non-NULL for sub-agent runs
  pinned        INTEGER NOT NULL DEFAULT 0  -- v3: 0/1 — surfaced at top of list
);

CREATE INDEX IF NOT EXISTS idx_sessions_source     ON sessions(source);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_project    ON sessions(project);

CREATE TABLE IF NOT EXISTS messages (
  session_id TEXT NOT NULL,
  idx        INTEGER NOT NULL,
  role       TEXT NOT NULL,    -- 'user' | 'assistant' | 'system' | 'tool_result'
  content    TEXT,             -- best-effort flattened text
  ts         INTEGER,          -- unix ms
  model      TEXT,
  tokens     INTEGER,
  PRIMARY KEY (session_id, idx),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, idx);

CREATE TABLE IF NOT EXISTS tool_uses (
  session_id  TEXT NOT NULL,
  msg_idx     INTEGER NOT NULL,
  tool_name   TEXT NOT NULL,
  ok          INTEGER NOT NULL DEFAULT 1, -- boolean (0/1)
  duration_ms INTEGER,
  FOREIGN KEY (session_id, msg_idx) REFERENCES messages(session_id, idx) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tool_uses_session ON tool_uses(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_uses_name    ON tool_uses(tool_name);

CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_pinned ON sessions(pinned) WHERE pinned = 1;

-- v3: user-defined tags
CREATE TABLE IF NOT EXISTS tags (
  name       TEXT PRIMARY KEY,
  color      TEXT,                          -- hex like #f5b452, optional
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_tags (
  session_id TEXT NOT NULL,
  tag        TEXT NOT NULL,
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (session_id, tag),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (tag) REFERENCES tags(name) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_tags_tag ON session_tags(tag);

-- v3: cost / activity alerts (Pro)
CREATE TABLE IF NOT EXISTS alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,                -- 'cost_daily' | 'cost_weekly' | 'cost_monthly'
  threshold_cents INTEGER NOT NULL,
  project     TEXT,                         -- nullable = global
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_fired_at INTEGER,                    -- unix ms; cleared each new period
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_enabled ON alerts(enabled) WHERE enabled = 1;

-- v3: share tokens for read-only Wrapped exports (Pro)
CREATE TABLE IF NOT EXISTS share_tokens (
  token       TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,                -- 'wrapped' | 'session'
  payload_id  TEXT,                         -- session_id when scope='session'
  year        INTEGER,                      -- year when scope='wrapped'
  remote_url  TEXT,                         -- e.g. https://crixin.com/share/<token>
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER,                      -- unix ms; NULL = no expiry
  revoked     INTEGER NOT NULL DEFAULT 0
);

-- Schema version for future migrations.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- v4: voice product. Twilio call records, ingested by crixin voice ingest.
-- One row per Call SID. transcript_text is best-effort joined text from
-- attached recordings (Deepgram-transcribed when DEEPGRAM_API_KEY is present).
CREATE TABLE IF NOT EXISTS voice_calls (
  sid                   TEXT PRIMARY KEY,        -- Twilio Call SID (CAxxxxxxxx…)
  account_sid           TEXT,
  direction             TEXT,                    -- 'outbound-api' | 'inbound' | …
  from_number           TEXT,
  to_number             TEXT,
  status                TEXT,                    -- queued/ringing/in-progress/completed/busy/failed/no-answer/canceled
  started_at            INTEGER,                 -- unix ms
  ended_at              INTEGER,                 -- unix ms
  duration_seconds      INTEGER NOT NULL DEFAULT 0,
  price_cents           INTEGER NOT NULL DEFAULT 0,  -- |price| × 100; positive
  price_unit            TEXT,                    -- usually 'USD'
  recording_count       INTEGER NOT NULL DEFAULT 0,
  transcript_text       TEXT,                    -- joined Deepgram transcripts
  transcript_language   TEXT,                    -- e.g. 'en', 'ar', 'es'
  transcript_confidence REAL,                    -- 0..1; avg over recordings
  campaign              TEXT,                    -- user-supplied free-text tag (legacy column name; treat as 'tag')
  outcome               TEXT,                    -- user-tag: 'booked' | 'no-answer' | 'callback' | 'declined' …
  fetched_at            INTEGER NOT NULL,        -- when we last synced this row
  pinned                INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_voice_calls_started_at ON voice_calls(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_voice_calls_status     ON voice_calls(status);
CREATE INDEX IF NOT EXISTS idx_voice_calls_to         ON voice_calls(to_number);
CREATE INDEX IF NOT EXISTS idx_voice_calls_campaign   ON voice_calls(campaign);

-- v4: per-recording details. A single call can have multiple recordings (e.g.
-- whole-call recording + recipient-reply recording). We mirror them so
-- transcribe_call can re-process individual segments without re-fetching
-- everything from Twilio.
CREATE TABLE IF NOT EXISTS voice_recordings (
  sid          TEXT PRIMARY KEY,                 -- Twilio Recording SID (RExxx…)
  call_sid     TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  status       TEXT,
  media_url    TEXT,                             -- direct .mp3 (auth-protected)
  transcript_text TEXT,
  transcript_language TEXT,
  transcript_confidence REAL,
  fetched_at   INTEGER NOT NULL,
  FOREIGN KEY (call_sid) REFERENCES voice_calls(sid) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_voice_recordings_call ON voice_recordings(call_sid);

-- v5: Crixin Sync v1. Three additive tables. Nothing here references message
-- bodies, transcripts, or credentials. Pro-gated; opt-in.

-- Local mirror of devices registered to this account. is_this_device flags
-- the row that represents the current machine so the sync status and
-- sync devices commands work offline.
CREATE TABLE IF NOT EXISTS sync_devices (
  device_id      TEXT PRIMARY KEY,           -- random 32-hex, minted on first run
  device_name    TEXT,                       -- user-visible label (hostname by default)
  hostname       TEXT,
  os             TEXT,                       -- 'darwin' | 'linux' | 'win32'
  created_at     INTEGER NOT NULL,           -- unix ms
  last_seen_at   INTEGER,                    -- unix ms
  is_this_device INTEGER NOT NULL DEFAULT 0  -- 0/1
);

-- Outbound queue. One row per local record we've decided to share. payload_json
-- is the exact typed record we sent to the server; storing it makes debugging
-- easy and lets us retry without re-extracting. pushed_at is nullable — null
-- means pending. We don't garbage-collect; sync history is small and useful.
CREATE TABLE IF NOT EXISTS sync_outbox (
  record_id       TEXT PRIMARY KEY,          -- sha256(uid + source + session_id)
  source          TEXT NOT NULL,             -- 'claude-code' | 'codex' | 'cursor' | 'voice'
  local_id        TEXT NOT NULL,             -- original sessions.id or voice_calls.sid
  content_hash    TEXT NOT NULL,             -- sha256 over allowlisted metadata fields
  payload_json    TEXT NOT NULL,             -- typed metadata record as sent
  queued_at       INTEGER NOT NULL,          -- unix ms
  pushed_at       INTEGER,                   -- unix ms; null = not yet pushed
  push_error      TEXT                       -- last-error message, null on success
);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_pushed   ON sync_outbox(pushed_at);
CREATE INDEX IF NOT EXISTS idx_sync_outbox_queued   ON sync_outbox(queued_at);

-- Inbound queue. One row per record we pulled from another device. We never
-- merge these back into the sessions/voice_calls tables in v1 — they're
-- surfaced read-only via a future "Other devices" dashboard tab.
CREATE TABLE IF NOT EXISTS sync_inbox (
  record_id        TEXT PRIMARY KEY,
  source           TEXT NOT NULL,
  source_device_id TEXT,                     -- which device produced this record
  payload_json     TEXT NOT NULL,            -- typed metadata record
  updated_at       INTEGER NOT NULL,         -- server-side updated_at (unix ms)
  pulled_at        INTEGER NOT NULL          -- unix ms; when we received it
);
CREATE INDEX IF NOT EXISTS idx_sync_inbox_updated ON sync_inbox(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_inbox_source  ON sync_inbox(source);

INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '5');
`;
