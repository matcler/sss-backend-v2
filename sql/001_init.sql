-- Sessions registry (optional but useful)
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  ruleset TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only event log with per-session version
CREATE TABLE IF NOT EXISTS session_events (
  session_id TEXT NOT NULL,
  version INT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, version)
);

CREATE INDEX IF NOT EXISTS idx_session_events_session_id ON session_events (session_id);

-- Latest snapshot cache
CREATE TABLE IF NOT EXISTS session_snapshots (
  session_id TEXT NOT NULL,
  version INT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, version)
);

CREATE INDEX IF NOT EXISTS idx_session_snapshots_session_id ON session_snapshots (session_id);
