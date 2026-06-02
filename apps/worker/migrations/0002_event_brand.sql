-- 0002_event_brand.sql — editable white-label brand (singleton row) + retire the
-- expo puzzle preset that was seeded by older deployments.

CREATE TABLE IF NOT EXISTS event_brand (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  app_name    TEXT NOT NULL,
  event_line  TEXT NOT NULL,
  venue_label TEXT NOT NULL,
  accent      TEXT NOT NULL,
  prize_label TEXT NOT NULL,
  ai_tone     TEXT NOT NULL,
  topic_hint  TEXT NOT NULL,
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT
);

-- Retire the seeded expo preset. The cold DO load (loadFromD1) re-fetches the
-- puzzle row by id, so deleting a preset still referenced by a session would break
-- that session. The NOT EXISTS guard makes this self-protecting: it only removes
-- the row when no session references it (the Deploy task additionally waits for the
-- active window to clear, so in practice the row IS removed).
DELETE FROM puzzles
WHERE id = 'mini-expo'
  AND owner_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM sessions WHERE puzzle_id = 'mini-expo');
