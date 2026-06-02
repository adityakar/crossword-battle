// api.ts — typed fetch wrappers for the worker's /api/* routes.
//
// Every call uses `credentials:'include'` so the JWT session cookie rides along.
// Mutating calls (login/logout/createPuzzle/createSession) are same-origin POSTs;
// the browser sets the `Origin` header automatically, which satisfies the
// worker's `requireSameOrigin` CSRF check. We never set Origin by hand here.
import type { PublicPuzzle } from '@cwb/engine';
import type { Brand, SessionConfig } from '@cwb/shared';

/** Thrown on any non-2xx API response. Carries the HTTP status + server message. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Shared request helper: JSON in/out, cookies included, typed errors on non-2xx.
async function request<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const opts: RequestInit = {
    method: init?.method ?? 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  };
  if (init?.body !== undefined) {
    opts.headers = { ...opts.headers, 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(init.body);
  }
  const res = await fetch(path, opts);
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    // Session expired on an authenticated endpoint → bounce to the login screen.
    // Exclude /api/auth/* so a bad-credentials login or an unauthenticated me()
    // check doesn't trigger a redirect loop (those callers handle their own 401).
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      window.location.href = '/login';
    }
    const msg =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export interface Organizer {
  id: string;
  email: string;
  // Booth join-code prefix (multi-booth). Present on /api/auth/me; absent on the
  // login response (which only echoes id/email).
  prefix?: string | null;
}

export function login(email: string, password: string): Promise<{ ok: true; organizer: Organizer }> {
  return request('/api/auth/login', { method: 'POST', body: { email, password } });
}

export function me(): Promise<{ organizer: Organizer }> {
  return request('/api/auth/me');
}

/** Set the logged-in organizer's booth prefix. Throws ApiError(409) if taken,
 *  ApiError(400) on bad format. */
export function putPrefix(prefix: string): Promise<{ ok: true; prefix: string }> {
  return request('/api/organizers/me/prefix', { method: 'PUT', body: { prefix } });
}

export function logout(): Promise<{ ok: true }> {
  return request('/api/auth/logout', { method: 'POST', body: {} });
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true }> {
  return request('/api/auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });
}

// ---------------------------------------------------------------------------
// Brand (white-label event identity)
// ---------------------------------------------------------------------------
/** Public: the active brand (or DEFAULT_BRAND when unset). */
export function getBrandConfig(): Promise<{ event: Brand }> {
  return request('/api/config');
}

/** Organizer-only: persist the brand (same-origin PUT). */
export function updateBrand(brand: Brand): Promise<{ event: Brand }> {
  return request('/api/config', { method: 'PUT', body: brand });
}

// ---------------------------------------------------------------------------
// Organizers (management: list / create / delete)
// ---------------------------------------------------------------------------
export interface OrganizerListItem {
  id: string;
  email: string;
  created_at: number;
  prefix: string | null;
}

export function listOrganizers(): Promise<{ organizers: OrganizerListItem[] }> {
  return request('/api/organizers');
}

export function createOrganizer(
  email: string,
  password: string,
): Promise<{ ok: true; organizer: Organizer }> {
  return request('/api/organizers', { method: 'POST', body: { email, password } });
}

export function deleteOrganizer(id: string): Promise<{ ok: true }> {
  return request(`/api/organizers/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Puzzles
// ---------------------------------------------------------------------------
export interface PuzzleSummary {
  id: string;
  name: string;
  tag: string;
  sub: string;
  rows: number;
  cols: number;
  owned: boolean;
}

export function listPuzzles(): Promise<{ puzzles: PuzzleSummary[] }> {
  return request('/api/puzzles');
}

// The solved puzzle: the public structure (clues, numbers, blocks) PLUS an
// answer map ("r,c" -> letter). Organizer-only; presets + the org's own puzzles.
export interface PuzzleSolution {
  puzzle: PublicPuzzle;
  answers: Record<string, string>;
}

export function getPuzzleSolution(id: string): Promise<PuzzleSolution> {
  return request(`/api/puzzles/${encodeURIComponent(id)}/solution`);
}

export interface WordInput {
  answer: string;
  clue: string;
}

export function createPuzzle(
  name: string,
  words: WordInput[],
): Promise<{ id: string; dropped: string[] }> {
  return request('/api/puzzles', { method: 'POST', body: { name, words } });
}

// ---------------------------------------------------------------------------
// AI drafting
// ---------------------------------------------------------------------------
export interface DraftResult {
  entries: WordInput[];
  source: 'ai' | 'fallback';
}

/** Draft editable word/clue entries for a topic. Server falls back to a curated
 *  starter set on any AI failure, so this resolves to a non-empty list. */
export function aiDraftWords(topic: string, count: number): Promise<DraftResult> {
  return request('/api/ai/draft-words', { method: 'POST', body: { topic, count } });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
// A successful create, OR a one-active-session conflict carrying the active
// session so the UI can prompt to resume or replace.
export type CreateSessionResult =
  | { ok: true; joinCode: string; hostToken: string }
  | { ok: false; active: ActiveSession };

/** Create a session. On a one-active conflict returns `{ ok:false, active }`
 *  (HTTP 409); pass `replace:true` to supersede the active session. Other
 *  non-2xx still throw ApiError (incl. the shared 401→/login bounce). */
export async function createSession(
  puzzleId: string,
  config?: Partial<SessionConfig>,
  replace?: boolean,
): Promise<CreateSessionResult> {
  const res = await fetch('/api/session/create', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ puzzleId, ...(config ? { config } : {}), ...(replace ? { replace: true } : {}) }),
  });
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (res.status === 409 && data && typeof data === 'object' && 'session' in data) {
    return { ok: false, active: (data as { session: ActiveSession }).session };
  }
  if (!res.ok) {
    if (res.status === 401) window.location.href = '/login';
    const msg =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `request failed (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  const ok = data as { joinCode: string; hostToken: string };
  return { ok: true, joinCode: ok.joinCode, hostToken: ok.hostToken };
}

export interface ActiveSession {
  joinCode: string;
  puzzleName: string;
  status: string;
  round: number;
  createdAt: number;
}

/** Passive: the organizer's most-recent resumable session (or null). No mutation. */
export function sessionsActive(): Promise<{ session: ActiveSession | null }> {
  return request('/api/sessions/active');
}

export interface ResumeResult {
  joinCode: string;
  hostToken: string;
  status: string;
  round: number;
  config: Partial<SessionConfig> | null;
}

/** Deliberate re-mint: rotates the host token so this client can reconnect. */
export function resumeSession(code: string): Promise<ResumeResult> {
  return request(`/api/sessions/${encodeURIComponent(code)}/resume`, { method: 'POST', body: {} });
}

// ---------------------------------------------------------------------------
// Display (public booth)
// ---------------------------------------------------------------------------
/** The active session to display on a given booth (`prefix`), or null. Without a
 *  prefix the server returns null (booth shows standby). */
export function displayActive(prefix?: string): Promise<{ joinCode: string | null }> {
  const q = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
  return request(`/api/display/active${q}`);
}

/**
 * Public preflight: does a session exist for this code? Used to show a clean
 * "game not found" instead of an endless WS reconnect (a failed /ws upgrade is
 * a 400/404 the browser hides from JS).
 */
export function sessionExists(code: string): Promise<{ exists: boolean }> {
  return request(`/api/join/${encodeURIComponent(code)}`);
}

// ---------------------------------------------------------------------------
// History (round_results → Home stats + display recent winners)
// ---------------------------------------------------------------------------
export interface HistoryStats {
  rounds: number;
  players: number;
  winners: number;
}

export interface HistoryLastWinner {
  name: string;
  time: string; // m:ss
  hints: number;
}

/** Organizer Home: today's TODAY counts + the last round's winner (or null). */
export function history(): Promise<{ today: HistoryStats; lastWinner: HistoryLastWinner | null }> {
  return request('/api/history');
}

export interface RecentWinner {
  name: string;
  time: string; // m:ss
  note: string; // 'clean' | 'N hint(s)'
}

/** Public display: a booth's most-recent winners (`prefix`). Without a valid
 *  prefix the server returns an empty list. */
export function historyPublic(prefix?: string): Promise<{ recentWinners: RecentWinner[] }> {
  const q = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
  return request(`/api/history/public${q}`);
}

export interface HistoryRound {
  joinCode: string;
  round: number;
  winnerName: string | null;
  winnerTime: string | null; // m:ss or null
  players: number;
  endedAt: number;
  status: string; // owning session's status
  active: boolean; // server-computed: still in progress / a winner the booth lingers on → Delete hidden
}

/** Past rounds (most recent first), optionally capped to `limit`. */
export function historyRounds(limit?: number): Promise<{ rounds: HistoryRound[] }> {
  const q = limit != null ? `?limit=${limit}` : '';
  return request(`/api/history/rounds${q}`);
}

/** Delete a PAST game (owner-scoped): its session + all rounds. 404 wrong-owner/missing,
 *  409 if the game is currently active. Removes it from the leaderboard + history. */
export function deleteSession(code: string): Promise<{ ok: true }> {
  return request(`/api/sessions/${encodeURIComponent(code)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Leaderboard (all-time, per-puzzle, owner-scoped)
// ---------------------------------------------------------------------------
export interface LbPuzzle {
  id: string;
  name: string;
}
export interface LbEntry {
  rank: number;
  name: string;
  points: number;
  time: string; // m:ss
  note: string; // 'clean' | 'N hint(s)'
}

/** Public booth board: the latest puzzle's all-time top-10 for `prefix`. Without a
 *  valid prefix (or no history) the server returns `{ puzzle: null, entries: [] }`. */
export function leaderboardPublic(prefix?: string): Promise<{ puzzle: LbPuzzle | null; entries: LbEntry[] }> {
  const q = prefix ? `?prefix=${encodeURIComponent(prefix)}` : '';
  return request(`/api/leaderboard/public${q}`);
}

/** Host board: any of the org's puzzles-with-results (default latest) + the selector list. */
export function leaderboard(
  puzzleId?: string,
): Promise<{ puzzle: LbPuzzle | null; entries: LbEntry[]; puzzles: LbPuzzle[] }> {
  const q = puzzleId ? `?puzzleId=${encodeURIComponent(puzzleId)}` : '';
  return request(`/api/leaderboard${q}`);
}
