-- ECHO edge storage: drafts + transcripts, mirrors the Mongo collections
-- the Python API used before the Cloudflare Workers deploy.

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drafts_created_at ON drafts (created_at DESC);

CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  duration REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transcripts_created_at ON transcripts (created_at DESC);
