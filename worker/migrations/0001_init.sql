-- Ownit schema. Code, diffs, answers, references and API keys are never stored.

CREATE TABLE repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL COLLATE NOCASE,
  installation_id INTEGER,
  tracked_since TEXT NOT NULL,
  private INTEGER NOT NULL DEFAULT 0,
  UNIQUE (owner, name)
);

CREATE TABLE users (
  github_id INTEGER PRIMARY KEY,
  login TEXT NOT NULL
);

-- Ownit session tokens, stored as SHA-256 hashes.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  github_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE pushes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos (id),
  user_github_id INTEGER,
  base_sha TEXT,
  head_sha TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified', 'skipped', 'pending', 'provider_error')),
  question_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  check_run_id INTEGER
);
CREATE INDEX pushes_by_repo ON pushes (repo_id, created_at);
CREATE INDEX pushes_by_status ON pushes (status, created_at);

-- pushed_at is set when the GitHub webhook confirms the commit landed.
CREATE TABLE commits (
  sha TEXT NOT NULL,
  repo_id INTEGER NOT NULL REFERENCES repos (id),
  push_id INTEGER NOT NULL REFERENCES pushes (id),
  author_login TEXT,
  pushed_at TEXT,
  PRIMARY KEY (repo_id, sha)
);
CREATE INDEX commits_by_push ON commits (push_id);

CREATE TABLE questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  push_id INTEGER NOT NULL REFERENCES pushes (id),
  idx INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('why', 'how', 'next')),
  text TEXT NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  UNIQUE (push_id, idx)
);

-- Fixed-window rate limit counters.
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);

-- Model calls paid for by DEMO_NEBIUS_KEY, per UTC day.
CREATE TABLE demo_usage (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL
);
