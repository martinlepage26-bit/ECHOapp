-- ECHO drafts schema (D1)
-- No transcripts, no dictation. Drafts are the only user data.

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_drafts_created_at ON drafts (created_at DESC);
