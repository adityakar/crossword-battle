// db.ts — typed D1 access layer (design §8).
//
// Puzzles store answers in grid_json (server-only). Sessions store the host
// token HASH only. round_results UPSERT is idempotent on (join_code, round).
import { buildPuzzle, generatePuzzle, type Grid, type Puzzle } from '@cwb/engine';
import { fmtTime, type Brand, type RankedPlayer, type Score, type SessionConfig } from '@cwb/shared';
import { PRESET_DEFS } from './presets';

// Re-export so existing importers keep working and tooling (the headless driver)
// has one canonical home for the preset definitions. The data now lives in the
// dependency-free `presets.ts` module.
export { PRESET_DEFS };

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------
export interface OrganizerRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: number;
  // Added in migration 0003 (multi-booth). `prefix` is null only in the brief
  // window between deploy and the lazy ensurePrefixes backfill.
  prefix: string | null;
  next_session_seq: number;
}

export interface PuzzleRow {
  id: string;
  owner_id: string | null;
  name: string;
  tag: string;
  grid_json: string;
  clues_json: string;
  rows: number | null;
  cols: number | null;
  created_at: number;
}

export interface SessionRow {
  join_code: string;
  owner_id: string;
  puzzle_id: string;
  config_json: string;
  round: number;
  status: string;
  host_token_hash: string;
  created_at: number;
  ended_at: number | null;
}

export interface RoundResultRow {
  id: string;
  join_code: string;
  round: number;
  winner_name: string | null;
  winner_score_json: string | null;
  leaderboard_json: string;
  started_at: number | null;
  ended_at: number;
}

export interface BrandRow {
  id: number;
  app_name: string;
  event_line: string;
  venue_label: string;
  accent: string;
  prize_label: string;
  ai_tone: string;
  topic_hint: string;
  updated_at: number;
  updated_by: string | null;
}

function uid(prefix: string): string {
  return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Organizers
// ---------------------------------------------------------------------------
export async function getOrganizerByEmail(
  db: D1Database,
  email: string,
): Promise<OrganizerRow | null> {
  return db.prepare('SELECT * FROM organizers WHERE email = ?').bind(email).first<OrganizerRow>();
}

export async function getOrganizerById(db: D1Database, id: string): Promise<OrganizerRow | null> {
  return db.prepare('SELECT * FROM organizers WHERE id = ?').bind(id).first<OrganizerRow>();
}

// ---- Organizer management ----
export interface OrganizerListItem { id: string; email: string; created_at: number; prefix: string | null; }

export async function listOrganizers(db: D1Database): Promise<OrganizerListItem[]> {
  const { results } = await db
    .prepare('SELECT id, email, created_at, prefix FROM organizers ORDER BY created_at ASC')
    .all<OrganizerListItem>();
  return results ?? [];
}

// ---- Booth prefix (multi-booth, migration 0003) ----
// Unambiguous alphabet, no I/O — matches the join-code letter alphabet.
const PREFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function randomPrefix(): string {
  const buf = crypto.getRandomValues(new Uint8Array(3));
  return [...buf].map((b) => PREFIX_ALPHABET[b % PREFIX_ALPHABET.length]).join('');
}

export async function getOrganizerByPrefix(db: D1Database, prefix: string): Promise<OrganizerRow | null> {
  return db.prepare('SELECT * FROM organizers WHERE prefix = ?').bind(prefix).first<OrganizerRow>();
}

// Set an organizer's prefix. Throws on the UNIQUE-index violation (the caller
// maps that to a 409). Caller is responsible for format validation.
export async function setOrganizerPrefix(db: D1Database, id: string, prefix: string): Promise<void> {
  await db.prepare('UPDATE organizers SET prefix = ? WHERE id = ?').bind(prefix, id).run();
}

// Atomically claim this organizer's next session number. D1/SQLite serializes
// the UPDATE…RETURNING, so two concurrent same-org creates can never read the
// same value (no read-then-write race). Returns the CLAIMED value (pre-increment).
export async function claimNextSeq(db: D1Database, ownerId: string): Promise<number> {
  const row = await db
    .prepare('UPDATE organizers SET next_session_seq = next_session_seq + 1 WHERE id = ? RETURNING next_session_seq')
    .bind(ownerId)
    .first<{ next_session_seq: number }>();
  if (!row) throw new Error('organizer not found for seq claim');
  return row.next_session_seq - 1;
}

// Highest existing numeric suffix (NNN) among `<prefix>-NNN` codes already in the
// sessions table, or 0 if none. Used to jump an organizer's sequence counter past
// codes a PREVIOUS owner of a reclaimed prefix (or a legacy random code sharing
// the letters) already occupies — so sequential allocation doesn't dead-end on the
// low suffixes. Codes are always 7 chars (`LLL-NNN`), so the suffix is substr(5,3).
export async function maxSuffixForPrefix(db: D1Database, prefix: string): Promise<number> {
  const row = await db
    .prepare("SELECT MAX(CAST(substr(join_code, 5, 3) AS INTEGER)) AS maxN FROM sessions WHERE join_code LIKE ?")
    .bind(`${prefix}-%`)
    .first<{ maxN: number | null }>();
  return row?.maxN ?? 0;
}

// Bump an organizer's sequence counter UP to at least `value` (never decreases it).
export async function bumpSeqTo(db: D1Database, ownerId: string, value: number): Promise<void> {
  await db
    .prepare('UPDATE organizers SET next_session_seq = ? WHERE id = ? AND next_session_seq < ?')
    .bind(value, ownerId, value)
    .run();
}

// Assign a fresh unique prefix to `id`, retrying on the UNIQUE-index collision.
// Returns the assigned prefix, or null if it couldn't find a free one (absurdly
// unlikely: 24^3 ≈ 13.8k prefixes).
async function assignUniquePrefix(db: D1Database, id: string): Promise<string | null> {
  for (let i = 0; i < 30; i++) {
    const p = randomPrefix();
    try {
      // Conditional on the prefix still being unset: if a concurrent PUT (or a
      // racing ensurePrefixes pass) already assigned one, this affects 0 rows and
      // we keep that value instead of clobbering it.
      const res = await db
        .prepare("UPDATE organizers SET prefix = ? WHERE id = ? AND (prefix IS NULL OR prefix = '')")
        .bind(p, id)
        .run();
      if ((res.meta?.changes ?? 0) > 0) return p;
      // 0 rows changed → the row already has a prefix (or is gone). Return what's there.
      const row = await db.prepare('SELECT prefix FROM organizers WHERE id = ?').bind(id).first<{ prefix: string | null }>();
      return row?.prefix ?? null;
    } catch {
      // UNIQUE collision on this random prefix — try another.
    }
  }
  return null;
}

// Idempotent backfill: give every prefix-less organizer a unique prefix. Runs
// lazily from ensureSeed; safe to call repeatedly (only touches NULL/empty rows).
export async function ensurePrefixes(db: D1Database): Promise<void> {
  const { results } = await db
    .prepare("SELECT id FROM organizers WHERE prefix IS NULL OR prefix = ''")
    .all<{ id: string }>();
  for (const r of results ?? []) {
    await assignUniquePrefix(db, r.id);
  }
}

export async function countOrganizers(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM organizers').first<{ n: number }>();
  return row?.n ?? 0;
}

// Returns true if a row was deleted.
export async function deleteOrganizerById(db: D1Database, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM organizers WHERE id = ?').bind(id).run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function updateOrganizerPassword(
  db: D1Database, id: string, passwordHash: string,
): Promise<void> {
  await db.prepare('UPDATE organizers SET password_hash = ? WHERE id = ?')
    .bind(passwordHash, id).run();
}

export async function insertOrganizer(
  db: D1Database,
  email: string,
  passwordHash: string,
): Promise<OrganizerRow> {
  const id = uid('org_');
  const createdAt = Date.now();
  await db
    .prepare('INSERT INTO organizers (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, email, passwordHash, createdAt)
    .run();
  // Assign a unique booth prefix (multi-booth, 0003). Done as a follow-up UPDATE
  // so the retry-on-UNIQUE-collision loop is reusable; next_session_seq defaults to 1.
  const prefix = await assignUniquePrefix(db, id);
  return { id, email, password_hash: passwordHash, created_at: createdAt, prefix, next_session_seq: 1 };
}

// ---------------------------------------------------------------------------
// Puzzles
// ---------------------------------------------------------------------------
// Reconstruct a full server-side Puzzle (with answers) from a stored row.
export function rowToPuzzle(row: PuzzleRow): Puzzle {
  const grid = JSON.parse(row.grid_json) as Grid;
  const clues = JSON.parse(row.clues_json) as Record<string, string>;
  return buildPuzzle({ grid, clues, id: row.id, name: row.name, tag: row.tag });
}

export async function getPuzzleById(db: D1Database, id: string): Promise<PuzzleRow | null> {
  return db.prepare('SELECT * FROM puzzles WHERE id = ?').bind(id).first<PuzzleRow>();
}

// Presets (owner_id IS NULL) + the given owner's puzzles.
export async function listPuzzles(db: D1Database, ownerId: string): Promise<PuzzleRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM puzzles WHERE owner_id IS NULL OR owner_id = ? ORDER BY created_at ASC')
    .bind(ownerId)
    .all<PuzzleRow>();
  return results ?? [];
}

// Insert a built puzzle. `id` lets callers pin preset ids; otherwise generated.
export async function insertPuzzle(
  db: D1Database,
  p: {
    ownerId: string | null;
    name: string;
    tag: string;
    grid: Grid;
    clues: Record<string, string>;
    rows: number;
    cols: number;
    id?: string;
  },
): Promise<string> {
  const id = p.id ?? uid('pz_');
  await db
    .prepare(
      'INSERT INTO puzzles (id, owner_id, name, tag, grid_json, clues_json, rows, cols, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      p.ownerId,
      p.name,
      p.tag,
      JSON.stringify(p.grid),
      JSON.stringify(p.clues),
      p.rows,
      p.cols,
      Date.now(),
    )
    .run();
  return id;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
// Atomic create-if-no-active (multi-booth one-active guard). Inserts the session
// with status 'new' ONLY if the owner has no active session within the window —
// the WHERE NOT EXISTS makes the check-and-insert a single serialized statement,
// so two concurrent creates can't both succeed (closes the check-then-insert
// TOCTOU). Returns true if inserted, false if an active session already holds the
// slot.
//
// 'new' marks a created-but-not-yet-opened session: it COUNTS as active for the
// one-active guard (a second create is blocked → resume/replace) but is EXCLUDED
// from the booth display until the host opens the lobby (status → 'lobby').
export async function createSessionIfNoActive(
  db: D1Database,
  s: {
    joinCode: string;
    ownerId: string;
    puzzleId: string;
    config: SessionConfig;
    hostTokenHash: string;
    windowSince: number;
  },
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO sessions (join_code, owner_id, puzzle_id, config_json, round, status, host_token_hash, created_at)
       SELECT ?, ?, ?, ?, 1, 'new', ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM sessions WHERE owner_id = ? AND created_at >= ?
           AND status IN ('new','lobby','countdown','live','winner')
       )`,
    )
    .bind(
      s.joinCode,
      s.ownerId,
      s.puzzleId,
      JSON.stringify(s.config),
      s.hostTokenHash,
      Date.now(),
      s.ownerId,
      s.windowSince,
    )
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function getSessionByJoinCode(
  db: D1Database,
  joinCode: string,
): Promise<SessionRow | null> {
  return db
    .prepare('SELECT * FROM sessions WHERE join_code = ?')
    .bind(joinCode)
    .first<SessionRow>();
}

// ---- Session resume / display ----
// Two readers answer two DIFFERENT questions; don't conflate them:
//
//   mostRecentSessionForOwner       — "what can I RESUME?" (Home Resume CTA).
//     Any non-'ended' session, INCLUDING 'idle'. This must mirror exactly what
//     POST /resume accepts (it rejects only 'ended'): an 'idle' session left by
//     Clear Players or an empty-lobby self-recycle is still resumable, so the
//     CTA must offer it. Narrowing this to the active set hid recoverable idle
//     sessions from an organizer who closed the host tab after a recycle.
//
//   mostRecentActiveSessionForOwner — "is a session BLOCKING a new create?"
//     (the one-active guard / conflict prompt). 'idle' is excluded because it
//     does NOT block a new session; it matches createSessionIfNoActive's set.
//
// Owner's most-recent resumable session within the window (any status != 'ended').
export async function mostRecentSessionForOwner(
  db: D1Database, ownerId: string, since: number,
): Promise<SessionRow | null> {
  return db
    .prepare(
      "SELECT * FROM sessions WHERE owner_id = ? AND created_at >= ? AND status != 'ended' ORDER BY created_at DESC LIMIT 1",
    )
    .bind(ownerId, since)
    .first<SessionRow>();
}

// The owner's current ACTIVE session (one-active enforcement). "Active" = a
// just-created ('new') or started (lobby/countdown/live/winner) session within
// the window. 'idle' is excluded — it legitimately means Clear Players / End
// Session (reset → idle); 'ended' is the terminal marker. Must match the
// createSessionIfNoActive NOT-EXISTS status set. Null when none.
export async function mostRecentActiveSessionForOwner(
  db: D1Database, ownerId: string, since: number,
): Promise<SessionRow | null> {
  return db
    .prepare(
      `SELECT * FROM sessions
       WHERE owner_id = ? AND created_at >= ?
         AND status IN ('new','lobby','countdown','live','winner')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(ownerId, since)
    .first<SessionRow>();
}

// Atomically transition a session to 'lobby' ONLY if its owner has no OTHER active
// session within the window. Authoritative one-active guard for SessionDO.openLobby():
// a stale/resurrected host reconnecting to an idle session must NOT reopen it into a
// SECOND display-worthy lobby (the orphan the booth bounces to). The conditional
// UPDATE is a single serialized statement, so two same-owner DOs opening concurrently
// can't both win — D1 serializes them and the loser's NOT EXISTS sees the winner's
// 'lobby' (closes the check-then-write TOCTOU, mirroring createSessionIfNoActive).
// Returns true iff THIS session became 'lobby'. Same active set as the create guard.
export async function setLobbyIfSoleActive(
  db: D1Database, joinCode: string, ownerId: string, since: number,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE sessions SET status = 'lobby'
       WHERE join_code = ?
         AND NOT EXISTS (
           SELECT 1 FROM sessions
           WHERE owner_id = ? AND created_at >= ? AND join_code != ?
             AND status IN ('new','lobby','countdown','live','winner')
         )`,
    )
    .bind(joinCode, ownerId, since, joinCode)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

export async function updateSessionHostTokenHash(
  db: D1Database, joinCode: string, hostTokenHash: string,
): Promise<void> {
  await db.prepare('UPDATE sessions SET host_token_hash = ? WHERE join_code = ?')
    .bind(hostTokenHash, joinCode).run();
}

// Most-recent session worth DISPLAYING on a given organizer's public booth.
// Owner-scoped (per-booth) AND winner-staleness-aware: a 'winner' session only
// counts while fresh (ended_at >= winnerFreshSince), so the booth auto-recycles
// to standby ~60s after a round ends (TvStandby's poll then gets null). Excludes
// idle/ended. Returns the join_code or null.
export async function mostRecentDisplaySession(
  db: D1Database, ownerId: string, since: number, winnerFreshSince: number,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT join_code FROM sessions
       WHERE owner_id = ? AND created_at >= ?
         AND ( status IN ('lobby','countdown','live')
               OR (status = 'winner' AND ended_at >= ?) )
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(ownerId, since, winnerFreshSince)
    .first<{ join_code: string }>();
  return row?.join_code ?? null;
}

export async function setSessionStatus(
  db: D1Database,
  joinCode: string,
  status: string,
  endedAt?: number,
): Promise<void> {
  if (endedAt != null) {
    await db
      .prepare('UPDATE sessions SET status = ?, ended_at = ? WHERE join_code = ?')
      .bind(status, endedAt, joinCode)
      .run();
  } else {
    await db
      .prepare('UPDATE sessions SET status = ? WHERE join_code = ?')
      .bind(status, joinCode)
      .run();
  }
}

// ---------------------------------------------------------------------------
// Round results (idempotent UPSERT on (join_code, round))
// ---------------------------------------------------------------------------
export async function upsertRoundResult(
  db: D1Database,
  r: {
    joinCode: string;
    round: number;
    winnerName: string | null;
    winnerScoreJson: string | null;
    leaderboardJson: string;
    startedAt: number | null;
    endedAt: number;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO round_results (id, join_code, round, winner_name, winner_score_json, leaderboard_json, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (join_code, round) DO UPDATE SET
         winner_name = excluded.winner_name,
         winner_score_json = excluded.winner_score_json,
         leaderboard_json = excluded.leaderboard_json,
         started_at = excluded.started_at,
         ended_at = excluded.ended_at`,
    )
    .bind(
      uid('rr_'),
      r.joinCode,
      r.round,
      r.winnerName,
      r.winnerScoreJson,
      r.leaderboardJson,
      r.startedAt,
      r.endedAt,
    )
    .run();
}

// Optional ownerId scopes to one organizer's rounds via the sessions join
// (round_results carries no owner_id; we resolve it through the session row).
// Omitting ownerId preserves the original GLOBAL behavior (and the no-join path
// still counts orphan rows whose session was removed).
export async function recentRoundResults(
  db: D1Database,
  limit = 10,
  ownerId?: string,
): Promise<RoundResultRow[]> {
  const stmt = ownerId
    ? db
        .prepare(
          `SELECT rr.* FROM round_results rr
           JOIN sessions s ON s.join_code = rr.join_code
           WHERE s.owner_id = ? ORDER BY rr.ended_at DESC LIMIT ?`,
        )
        .bind(ownerId, limit)
    : db.prepare('SELECT * FROM round_results ORDER BY ended_at DESC LIMIT ?').bind(limit);
  const { results } = await stmt.all<RoundResultRow>();
  return results ?? [];
}

export interface TodayStats {
  rounds: number;
  players: number;
  winners: number;
}

// UTC midnight (ms) for the day containing `now`. The unix epoch is itself UTC
// midnight, so flooring to whole days lands exactly on a midnight boundary —
// no Date object (and no module-scope Date.now()) needed.
const DAY_MS = 86_400_000;
export function startOfTodayUTC(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

// "TODAY" stats from round_results since `since` (UTC midnight, see above).
// Scope is GLOBAL (round_results has no owner_id; this is the single-event
// model — requireOrganizer gates ACCESS, not scope). `players` is the sum of
// each round's leaderboard length, i.e. player-ROUNDS, not unique players.
export async function todayStats(db: D1Database, since: number, ownerId?: string): Promise<TodayStats> {
  const stmt = ownerId
    ? db
        .prepare(
          `SELECT rr.winner_name, rr.leaderboard_json FROM round_results rr
           JOIN sessions s ON s.join_code = rr.join_code
           WHERE rr.ended_at >= ? AND s.owner_id = ?`,
        )
        .bind(since, ownerId)
    : db
        .prepare('SELECT winner_name, leaderboard_json FROM round_results WHERE ended_at >= ?')
        .bind(since);
  const { results } = await stmt.all<{ winner_name: string | null; leaderboard_json: string }>();
  const rows = results ?? [];
  let players = 0;
  let winners = 0;
  for (const row of rows) {
    if (row.winner_name) winners++;
    try {
      const lb = JSON.parse(row.leaderboard_json) as unknown[];
      if (Array.isArray(lb)) players += lb.length;
    } catch {
      // ignore malformed history rows in the count
    }
  }
  return { rounds: rows.length, players, winners };
}

// Pull the winner's leaderboard entry from a parsed leaderboard_json. By
// construction (sessionDO.writeResults) the winner is the first finisher in the
// ranked list, so we match on finishMs != null rather than the name — this
// sidesteps duplicate-name ambiguity. Returns null on any malformed/absent row.
function winnerEntry(leaderboardJson: string): RankedPlayer | null {
  try {
    const lb = JSON.parse(leaderboardJson) as RankedPlayer[];
    if (!Array.isArray(lb)) return null;
    return lb.find((p) => p?.finishMs != null) ?? null;
  } catch {
    return null;
  }
}

// note text for a winner: 'clean' if no hints, else 'N hint(s)'. Derived from
// hintsUsed (NOT score.pen) so a winner whose penalty came from wrong answers
// — not hints — never renders the misleading "0 hint(s)".
export function hintsNote(hintsUsed: number): string {
  return hintsUsed === 0 ? 'clean' : `${hintsUsed} hint(s)`;
}

export interface LastWinner {
  name: string;
  time: string; // fmtTime(score.raw) — m:ss
  hints: number;
}

// Most recent round with a winner → formatted name/time/hints for Home's
// "Last winner — …" well. null when no round has ever had a finisher.
export async function lastWinner(db: D1Database, ownerId?: string): Promise<LastWinner | null> {
  const stmt = ownerId
    ? db
        .prepare(
          `SELECT rr.winner_name, rr.winner_score_json, rr.leaderboard_json FROM round_results rr
           JOIN sessions s ON s.join_code = rr.join_code
           WHERE rr.winner_name IS NOT NULL AND s.owner_id = ?
           ORDER BY rr.ended_at DESC LIMIT 1`,
        )
        .bind(ownerId)
    : db.prepare(
        'SELECT winner_name, winner_score_json, leaderboard_json FROM round_results WHERE winner_name IS NOT NULL ORDER BY ended_at DESC LIMIT 1',
      );
  const row = await stmt.first<{ winner_name: string; winner_score_json: string | null; leaderboard_json: string }>();
  if (!row) return null;
  const entry = winnerEntry(row.leaderboard_json);
  // Prefer the stored winner Score for the time; fall back to the entry's score.
  let raw = 0;
  if (row.winner_score_json) {
    try {
      raw = (JSON.parse(row.winner_score_json) as Score).raw;
    } catch {
      raw = entry?.score?.raw ?? 0;
    }
  } else {
    raw = entry?.score?.raw ?? 0;
  }
  return {
    name: row.winner_name,
    time: fmtTime(raw),
    hints: entry?.hintsUsed ?? 0,
  };
}

export interface RecentWinner {
  name: string;
  time: string; // fmtTime(score.raw) — m:ss
  note: string; // 'clean' | 'N hint(s)'
}

// Recent rounds that HAD a winner → display "RECENT WINNERS" list (most-recent
// first). Filters at the SQL level so we never fetch winnerless rounds.
export async function recentWinners(db: D1Database, limit = 5, ownerId?: string): Promise<RecentWinner[]> {
  const stmt = ownerId
    ? db
        .prepare(
          `SELECT rr.winner_name, rr.winner_score_json, rr.leaderboard_json FROM round_results rr
           JOIN sessions s ON s.join_code = rr.join_code
           WHERE rr.winner_name IS NOT NULL AND s.owner_id = ?
           ORDER BY rr.ended_at DESC LIMIT ?`,
        )
        .bind(ownerId, limit)
    : db
        .prepare(
          'SELECT winner_name, winner_score_json, leaderboard_json FROM round_results WHERE winner_name IS NOT NULL ORDER BY ended_at DESC LIMIT ?',
        )
        .bind(limit);
  const { results } = await stmt.all<{ winner_name: string; winner_score_json: string | null; leaderboard_json: string }>();
  const rows = results ?? [];
  return rows.map((row) => {
    const entry = winnerEntry(row.leaderboard_json);
    let raw = entry?.score?.raw ?? 0;
    if (row.winner_score_json) {
      try {
        raw = (JSON.parse(row.winner_score_json) as Score).raw;
      } catch {
        /* keep entry-derived raw */
      }
    }
    return {
      name: row.winner_name,
      time: fmtTime(raw),
      note: hintsNote(entry?.hintsUsed ?? 0),
    };
  });
}

// ---- History (past rounds) ----
export interface HistoryRound {
  joinCode: string;
  round: number;
  winnerName: string | null;
  winnerTime: string | null; // fmtTime(winner score.raw) or null when no winner
  players: number;           // leaderboard length
  endedAt: number;
  status: string;            // owning session's status
  createdAt: number;         // owning session's created_at (for the active-window check)
}

export async function historyRounds(db: D1Database, limit = 25, ownerId?: string): Promise<HistoryRound[]> {
  // JOIN sessions for the owning session's status (lets the host UI hide Delete on an active game).
  // Owner-scoped via s.owner_id when given; the global path LEFT JOINs so an orphan round (session
  // row gone) still lists, with a defaulted status.
  const stmt = ownerId
    ? db
        .prepare(
          `SELECT rr.*, s.status AS s_status, s.created_at AS s_created FROM round_results rr
             JOIN sessions s ON s.join_code = rr.join_code
            WHERE s.owner_id = ? ORDER BY rr.ended_at DESC LIMIT ?`,
        )
        .bind(ownerId, limit)
    : db
        .prepare(
          `SELECT rr.*, s.status AS s_status, s.created_at AS s_created FROM round_results rr
             LEFT JOIN sessions s ON s.join_code = rr.join_code
            ORDER BY rr.ended_at DESC LIMIT ?`,
        )
        .bind(limit);
  const { results } = await stmt.all<RoundResultRow & { s_status: string | null; s_created: number | null }>();
  return (results ?? []).map((row) => {
    let players = 0;
    try {
      const lb = JSON.parse(row.leaderboard_json) as unknown[];
      if (Array.isArray(lb)) players = lb.length;
    } catch { /* malformed row → 0 players */ }
    let winnerTime: string | null = null;
    if (row.winner_name) {
      // Prefer the stored winner score; fall back to the winner's leaderboard entry.
      const entry = winnerEntry(row.leaderboard_json);
      let raw = entry?.score?.raw ?? 0;
      if (row.winner_score_json) {
        try { raw = (JSON.parse(row.winner_score_json) as Score).raw; } catch { /* keep entry raw */ }
      }
      winnerTime = fmtTime(raw);
    }
    return {
      joinCode: row.join_code,
      round: row.round,
      winnerName: row.winner_name,
      winnerTime,
      players,
      endedAt: row.ended_at,
      status: row.s_status ?? 'ended',
      createdAt: row.s_created ?? 0,
    };
  });
}

// Whether a session should still be treated as ACTIVE — i.e. protected from delete
// and shown as "live" in history. Mirrors the rest of the backend's staleness rules
// so an abandoned game can be scrubbed once it ages out: an in-progress session is
// active only within the create active-window; a 'winner' session only while the
// booth still lingers on it (after that the booth has recycled to standby). 'idle'
// and 'ended' are never active.
export function sessionActive(
  status: string,
  createdAt: number,
  endedAt: number | null,
  now: number,
  activeWindowMs: number,
  winnerLingerMs: number,
): boolean {
  switch (status) {
    case 'new':
    case 'lobby':
    case 'countdown':
    case 'live':
      return createdAt >= now - activeWindowMs;
    case 'winner':
      return (endedAt ?? createdAt) >= now - winnerLingerMs;
    default:
      return false; // idle / ended → deletable
  }
}

// ---- Leaderboard (all-time, per-puzzle, owner-scoped) ----

// Distinct puzzles the owner has results for, names joined UNDER the owner scope (so a caller can
// only ever learn names of puzzles they actually played — closes the name-leak), most-recent first.
// Element [0] is the booth's latest puzzle (the TV board's target).
export async function puzzlesWithResults(
  db: D1Database,
  ownerId: string,
): Promise<{ id: string; name: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT s.puzzle_id AS id, p.name AS name, MAX(rr.ended_at) AS last
         FROM round_results rr
         JOIN sessions s ON s.join_code = rr.join_code
         JOIN puzzles  p ON p.id = s.puzzle_id
        WHERE s.owner_id = ?
        GROUP BY s.puzzle_id, p.name
        ORDER BY last DESC`,
    )
    .bind(ownerId)
    .all<{ id: string; name: string; last: number }>();
  return (results ?? []).map((r) => ({ id: r.id, name: r.name }));
}

// Every leaderboard for one owner+puzzle, parsed and flattened. Malformed rows are skipped
// (matching the existing defensive parsing). Returns the concatenated RankedPlayer entries.
export async function leaderboardEntriesForPuzzle(
  db: D1Database,
  ownerId: string,
  puzzleId: string,
): Promise<RankedPlayer[]> {
  const { results } = await db
    .prepare(
      `SELECT rr.leaderboard_json AS lb FROM round_results rr
         JOIN sessions s ON s.join_code = rr.join_code
        WHERE s.owner_id = ? AND s.puzzle_id = ?`,
    )
    .bind(ownerId, puzzleId)
    .all<{ lb: string }>();
  const out: RankedPlayer[] = [];
  for (const row of results ?? []) {
    try {
      const lb = JSON.parse(row.lb) as RankedPlayer[];
      if (Array.isArray(lb)) out.push(...lb);
    } catch {
      /* skip malformed history row */
    }
  }
  return out;
}

// True iff the session has any persisted round results. Drives the DO setPuzzle lock so a session's
// puzzle is immutable once it has results (keeps sessions.puzzle_id an exact attribution key).
export async function sessionHasResults(db: D1Database, code: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS x FROM round_results WHERE join_code = ? LIMIT 1')
    .bind(code)
    .first<{ x: number }>();
  return row != null;
}

// Scrub a deleted past game: remove its round results (so it leaves the leaderboard
// + history, which both JOIN round_results) but KEEP the session row as an inert
// 'ended' tombstone. The tombstone reserves the join code so the prefix allocator
// never reuses it on a sequence wrap — reuse would alias the old code's Durable
// Object (stale `terminated` storage) and break the new game. The row is invisible
// to every read path (all exclude 'ended'). The caller verifies ownership +
// non-active + quiesces the DO (which already set status 'ended') first.
export async function purgeSessionResults(db: D1Database, code: string): Promise<void> {
  await db.prepare('DELETE FROM round_results WHERE join_code = ?').bind(code).run();
}

// ---------------------------------------------------------------------------
// Event brand (singleton row id=1). getBrand is DEFENSIVE: a missing event_brand
// table (the window between a deploy and the remote migration) resolves to null
// rather than throwing, so GET /api/config still serves DEFAULT_BRAND upstream.
// ---------------------------------------------------------------------------
export async function getBrand(db: D1Database): Promise<Brand | null> {
  try {
    const row = await db.prepare('SELECT * FROM event_brand WHERE id = 1').first<BrandRow>();
    if (!row) return null;
    return {
      appName: row.app_name,
      eventLine: row.event_line,
      venueLabel: row.venue_label,
      accent: row.accent,
      prizeLabel: row.prize_label,
      aiTone: row.ai_tone,
      topicHint: row.topic_hint,
    };
  } catch {
    return null;
  }
}

export async function upsertBrand(db: D1Database, b: Brand, updatedBy: string | null): Promise<void> {
  await db
    .prepare(
      `INSERT INTO event_brand
         (id, app_name, event_line, venue_label, accent, prize_label, ai_tone, topic_hint, updated_at, updated_by)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         app_name = excluded.app_name,
         event_line = excluded.event_line,
         venue_label = excluded.venue_label,
         accent = excluded.accent,
         prize_label = excluded.prize_label,
         ai_tone = excluded.ai_tone,
         topic_hint = excluded.topic_hint,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    )
    .bind(
      b.appName,
      b.eventLine,
      b.venueLabel,
      b.accent,
      b.prizeLabel,
      b.aiTone,
      b.topicHint,
      Date.now(),
      updatedBy,
    )
    .run();
}

// ---------------------------------------------------------------------------
// Seeding (idempotent)
// ---------------------------------------------------------------------------
// Preset definitions live in the dependency-free `presets.ts` module (imported
// above). Built server-side via the engine so the stored grid/clues are
// deterministic per seed.
export async function seedPresets(db: D1Database): Promise<void> {
  for (const def of PRESET_DEFS) {
    const existing = await getPuzzleById(db, def.id);
    if (existing) continue;
    const gen = generatePuzzle(
      def.words.map(([answer, clue]) => ({ answer, clue })),
      { name: def.name, tag: def.tag, topic: def.topic, seed: def.seed, id: def.id },
    );
    if (!gen) continue; // defensive — seeds are known-good
    const p = gen.puzzle;
    await db
      .prepare(
        'INSERT OR IGNORE INTO puzzles (id, owner_id, name, tag, grid_json, clues_json, rows, cols, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(
        def.id,
        p.name,
        p.tag,
        JSON.stringify(p.grid),
        JSON.stringify(p.clues),
        p.rows,
        p.cols,
        Date.now(),
      )
      .run();
  }
}

export async function seedOrganizer(
  db: D1Database,
  email: string,
  passwordHash: string,
): Promise<void> {
  // Idempotent: no-op if an organizer with this email already exists.
  const id = uid('org_');
  const res = await db
    .prepare(
      'INSERT OR IGNORE INTO organizers (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(id, email, passwordHash, Date.now())
    .run();
  // Only the row we just inserted needs a prefix; on IGNORE (already existed)
  // the existing row keeps its prefix and ensurePrefixes covers any legacy gap.
  if ((res.meta?.changes ?? 0) > 0) await assignUniquePrefix(db, id);
}
