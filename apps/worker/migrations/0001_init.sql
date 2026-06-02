-- 0001_init.sql — Crossword Battle schema (design §5, §8).
-- Solution answers live in `puzzles.grid_json` / `clues_json` (server-only; never
-- broadcast to clients). Host tokens and passwords are stored hashed.

-- Organizer accounts (login-gated host surface). Password is a versioned
-- PBKDF2 record: pbkdf2$sha256$<iters>$<b64 salt>$<b64 hash> (see auth.ts).
CREATE TABLE IF NOT EXISTS organizers (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

-- Puzzle library. owner_id NULL == a seeded preset (visible to every organizer).
-- grid_json holds answer letters (server-only). clues_json maps ANSWER -> clue.
CREATE TABLE IF NOT EXISTS puzzles (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT,
  name       TEXT NOT NULL,
  tag        TEXT NOT NULL,
  grid_json  TEXT NOT NULL,
  clues_json TEXT NOT NULL,
  rows       INTEGER,
  cols       INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_puzzles_owner ON puzzles (owner_id);

-- One row per live/historical session. join_code is the DO key (idFromName).
-- host_token_hash is the sha-256 hex of the once-issued host token.
CREATE TABLE IF NOT EXISTS sessions (
  join_code       TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  puzzle_id       TEXT NOT NULL,
  config_json     TEXT NOT NULL,
  round           INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'idle',
  host_token_hash TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  ended_at        INTEGER
);

-- Round history → Home "TODAY" stats + display "recent winners". The DO writes
-- one row per round; UNIQUE(join_code, round) makes the write idempotent (UPSERT).
CREATE TABLE IF NOT EXISTS round_results (
  id                TEXT PRIMARY KEY,
  join_code         TEXT NOT NULL,
  round             INTEGER NOT NULL,
  winner_name       TEXT,
  winner_score_json TEXT,
  leaderboard_json  TEXT NOT NULL,
  started_at        INTEGER,
  ended_at          INTEGER NOT NULL,
  UNIQUE (join_code, round)
);

CREATE INDEX IF NOT EXISTS idx_round_results_join ON round_results (join_code);
CREATE INDEX IF NOT EXISTS idx_round_results_ended ON round_results (ended_at);
