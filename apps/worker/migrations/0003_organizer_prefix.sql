-- 0003_organizer_prefix.sql — per-organizer join-code PREFIX + monotonic session
-- counter (multi-booth concurrent sessions, design §A/§B).
--
-- `prefix` is the 3-letter booth prefix (alphabet ABCDEFGHJKLMNPQRSTUVWXYZ, no
-- I/O) used as the letter half of that organizer's join codes (PUB-001, …).
-- `next_session_seq` is the monotonic, never-reused sequence (claimed atomically
-- on create). Codes are never reused, so they never collide with the DO key
-- (idFromName) or round_results UNIQUE(join_code, round).
ALTER TABLE organizers ADD COLUMN prefix TEXT;
ALTER TABLE organizers ADD COLUMN next_session_seq INTEGER NOT NULL DEFAULT 1;

-- DB-level uniqueness for prefixes. SQLite UNIQUE allows multiple NULLs, so the
-- app-side backfill can assign values after this index exists. This closes the
-- two-organizers-save-concurrently TOCTOU race an app-only check would leave open.
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizers_prefix ON organizers (prefix);

-- The new owner-scoped display/active/one-active queries filter sessions by
-- owner_id (ordered by created_at). Cheap covering index; avoids a table scan.
CREATE INDEX IF NOT EXISTS idx_sessions_owner_created ON sessions (owner_id, created_at);
