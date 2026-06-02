import { Hono } from 'hono';
import {
  clueLeaksAnswer,
  generatePuzzle,
  toPublicPuzzle,
} from '@cwb/engine';
import {
  DIFFICULTIES,
  resolveBrand,
  BrandSchema,
  SessionConfigSchema,
  isValidJoinCode,
  isValidPrefix,
  normalizePrefix,
  type SessionConfig,
} from '@cwb/shared';
import {
  countOrganizers,
  createSessionIfNoActive,
  deleteOrganizerById,
  purgeSessionResults,
  getBrand,
  getOrganizerByEmail,
  getOrganizerById,
  getOrganizerByPrefix,
  getPuzzleById,
  getSessionByJoinCode,
  historyRounds,
  insertOrganizer,
  insertPuzzle,
  lastWinner,
  listOrganizers,
  listPuzzles,
  mostRecentActiveSessionForOwner,
  mostRecentDisplaySession,
  mostRecentSessionForOwner,
  recentWinners,
  rowToPuzzle,
  sessionActive,
  setOrganizerPrefix,
  startOfTodayUTC,
  todayStats,
  updateOrganizerPassword,
  updateSessionHostTokenHash,
  upsertBrand,
  type SessionRow,
} from './db';
import {
  type AuthVars,
  clearSessionCookie,
  ensureSeed,
  hashPassword,
  JWT_EXP_SEC,
  readSessionCookie,
  requireOrganizer,
  requireSameOrigin,
  setSessionCookie,
  signJwt,
  verifyJwt,
  verifyPassword,
} from './auth';
import { allocPrefixedJoinCode } from './joincode';
import { buildLeaderboard } from './leaderboard';
import { draftWords } from './ai';

/**
 * Worker bindings (mirrors wrangler.toml + design §2).
 * Secrets (OPENROUTER_API_KEY, JWT_SECRET, SEED_ORGANIZER_*) come from .dev.vars
 * locally and `wrangler secret` in prod.
 */
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SESSION: DurableObjectNamespace;
  OPENROUTER_API_KEY: string;
  AI_MODEL: string;
  JWT_SECRET: string;
  SEED_ORGANIZER_EMAIL: string;
  SEED_ORGANIZER_PASSWORD: string;
}

type AppEnv = { Bindings: Env; Variables: AuthVars };

const app = new Hono<AppEnv>();

app.get('/api/health', (c) => c.json({ ok: true }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
// A session is "active" (resumable / display-attachable) only if created within
// this rolling window — a backstop so a session abandoned in lobby/winner doesn't
// linger forever. 24h comfortably covers an all-day booth across a midnight boundary.
const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000;

// How long a finished round lingers on the booth before it recycles to standby.
// The booth display polls /api/display/active every ~4s; once a 'winner' session
// is older than this it drops out of the display set → the booth shows standby.
const WINNER_LINGER_MS = 60 * 1000;

// sha-256 hex of a string — used to store the host token hash (not the token).
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Best-effort, per-isolate login rate limiter (keyed by email+ip). Counts only
// FAILED attempts in a short sliding window, so a burst of wrong passwords is
// throttled while legitimate logins are never penalized.
// TODO prod: move rate-limit to DO/KV (per-isolate state does not span isolates).
const loginFailures = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_FAILURES = 10;

function loginIsLimited(key: string): boolean {
  const rec = loginFailures.get(key);
  if (!rec || rec.resetAt < Date.now()) return false;
  return rec.count >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(key: string): void {
  const now = Date.now();
  const rec = loginFailures.get(key);
  if (!rec || rec.resetAt < now) {
    loginFailures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  rec.count++;
}

function defaultConfig(puzzleId: string, puzzleName: string): SessionConfig {
  const medium = DIFFICULTIES.find((d) => d.id === 'medium') ?? DIFFICULTIES[0]!;
  return {
    puzzleId,
    puzzleName,
    difficulty: medium.id,
    durationSec: medium.dur,
    hintPenalty: medium.hint,
    wrongPenalty: medium.wrong,
    maxPlayers: 8,
    allowLate: false,
    strictValidation: true,
  };
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------
app.post('/api/auth/login', async (c) => {
  await ensureSeed(c.env);
  let body: { email?: unknown; password?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'bad request' }, 400);
  }
  const email = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const ip = c.req.header('CF-Connecting-IP') ?? 'local';
  const rlKey = `${email}|${ip}`;
  if (loginIsLimited(rlKey)) {
    return c.json({ error: 'too many attempts' }, 429);
  }
  // Generic 401 on any failure (no user enumeration); record the failure for rate-limiting.
  const fail = () => {
    recordLoginFailure(rlKey);
    return c.json({ error: 'invalid credentials' }, 401);
  };
  if (!email || !password) return fail();
  const org = await getOrganizerByEmail(c.env.DB, email);
  if (!org) return fail();
  const ok = await verifyPassword(password, org.password_hash);
  if (!ok) return fail();
  const token = await signJwt({ sub: org.id, email: org.email }, c.env.JWT_SECRET, JWT_EXP_SEC);
  setSessionCookie(c, token);
  return c.json({ ok: true, organizer: { id: org.id, email: org.email } });
});

app.get('/api/auth/me', async (c) => {
  const token = readSessionCookie(c);
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  const payload = await verifyJwt(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'unauthorized' }, 401);
  // Include the organizer's booth prefix (multi-booth) — read fresh from D1 so an
  // edited prefix is reflected without re-login.
  const org = await getOrganizerById(c.env.DB, payload.sub);
  return c.json({ organizer: { id: payload.sub, email: payload.email, prefix: org?.prefix ?? null } });
});

app.post('/api/auth/logout', requireSameOrigin, (c) => {
  clearSessionCookie(c);
  return c.json({ ok: true });
});

// Change the logged-in organizer's password. Requires the current password.
app.post('/api/auth/change-password', requireSameOrigin, requireOrganizer, async (c) => {
  const org = c.get('organizer');
  let body: { currentPassword?: unknown; newPassword?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: 'bad request' }, 400); }
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (newPassword.length < 8) return c.json({ error: 'new password must be at least 8 chars' }, 400);
  const row = await getOrganizerById(c.env.DB, org.id);
  if (!row) return c.json({ error: 'unauthorized' }, 401);
  const ok = await verifyPassword(currentPassword, row.password_hash);
  if (!ok) return c.json({ error: 'current password is incorrect' }, 401);
  const hash = await hashPassword(newPassword);
  await updateOrganizerPassword(c.env.DB, org.id, hash);
  // Pragmatic: we do NOT rotate the JWT/cookie; the existing session stays valid.
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Organizer management (create additional organizers)
// ---------------------------------------------------------------------------
app.post('/api/organizers', requireSameOrigin, requireOrganizer, async (c) => {
  await ensureSeed(c.env);
  let body: { email?: unknown; password?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'bad request' }, 400);
  }
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || password.length < 8) {
    return c.json({ error: 'email and password (>=8 chars) required' }, 400);
  }
  const existing = await getOrganizerByEmail(c.env.DB, email);
  if (existing) return c.json({ error: 'email already in use' }, 409);
  const hash = await hashPassword(password);
  const org = await insertOrganizer(c.env.DB, email, hash);
  return c.json({ ok: true, organizer: { id: org.id, email: org.email } });
});

// List organizers (id/email/created_at/prefix only — never the password hash).
app.get('/api/organizers', requireOrganizer, async (c) => {
  await ensureSeed(c.env);
  const organizers = await listOrganizers(c.env.DB);
  return c.json({ organizers });
});

// Set the logged-in organizer's booth prefix (multi-booth). 400 bad format;
// 409 when the prefix is already taken (DB UNIQUE index is the real arbiter).
app.put('/api/organizers/me/prefix', requireSameOrigin, requireOrganizer, async (c) => {
  const org = c.get('organizer');
  let body: { prefix?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'bad request' }, 400);
  }
  const prefix = normalizePrefix(typeof body.prefix === 'string' ? body.prefix : '');
  if (!isValidPrefix(prefix)) {
    return c.json({ error: 'prefix must be 3 letters (A–Z, excluding I and O)' }, 400);
  }
  try {
    await setOrganizerPrefix(c.env.DB, org.id, prefix);
  } catch (err) {
    // Only the UNIQUE-index violation means "taken"; other D1 errors are 500s.
    const msg = err instanceof Error ? err.message : '';
    if (/unique/i.test(msg)) return c.json({ error: 'prefix in use' }, 409);
    console.error('set prefix failed', err);
    return c.json({ error: 'could not update prefix' }, 500);
  }
  return c.json({ ok: true, prefix });
});

// Remove an organizer. Guards: cannot remove self; cannot remove the last one.
app.delete('/api/organizers/:id', requireSameOrigin, requireOrganizer, async (c) => {
  const org = c.get('organizer');
  const id = c.req.param('id');
  if (id === org.id) return c.json({ error: 'cannot remove your own account' }, 400);
  const count = await countOrganizers(c.env.DB);
  if (count <= 1) return c.json({ error: 'at least one organizer is required' }, 409);
  const deleted = await deleteOrganizerById(c.env.DB, id);
  if (!deleted) return c.json({ error: 'organizer not found' }, 404);
  // Orphan-on-delete (deliberate, pragmatic): we do NOT cascade. A removed
  // organizer's puzzles/sessions are left as-is (their sessions simply become
  // unresumable; the public booth still drops them after the active window).
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Puzzles
// ---------------------------------------------------------------------------
// List = presets + this organizer's puzzles. PUBLIC projection only — no answer
// letters (no grid, no across/down) leave the server in this response.
app.get('/api/puzzles', requireOrganizer, async (c) => {
  await ensureSeed(c.env);
  const org = c.get('organizer');
  const rows = await listPuzzles(c.env.DB, org.id);
  const puzzles = rows.map((row) => {
    const pub = toPublicPuzzle(rowToPuzzle(row));
    return {
      id: row.id,
      name: row.name,
      tag: row.tag,
      sub: pub.sub,
      rows: pub.rows,
      cols: pub.cols,
      owned: row.owner_id === org.id,
    };
  });
  return c.json({ puzzles });
});

// Create a puzzle from organizer-typed words. Rejects clue-leaks, runs the
// generator, stores the FULL puzzle (with answers) owned by the organizer.
app.post('/api/puzzles', requireSameOrigin, requireOrganizer, async (c) => {
  const org = c.get('organizer');
  let body: { name?: unknown; words?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'bad request' }, 400);
  }
  const rawName =
    typeof body.name === 'string' && body.name.trim() ? body.name.trim() : 'Custom Puzzle';
  // Input caps (cheap abuse guard): bounded name, word count, answer/clue length.
  if (rawName.length > 60) return c.json({ error: 'name too long (max 60 chars)' }, 400);
  const name = rawName;
  if (!Array.isArray(body.words) || body.words.length === 0) {
    return c.json({ error: 'words required' }, 400);
  }
  if (body.words.length > 24) {
    return c.json({ error: 'too many words (max 24)' }, 400);
  }
  const words: { answer: string; clue: string }[] = [];
  for (const w of body.words) {
    if (typeof w !== 'object' || w === null) {
      return c.json({ error: 'each word needs answer and clue' }, 400);
    }
    const answer = typeof (w as { answer?: unknown }).answer === 'string' ? (w as { answer: string }).answer : '';
    const clue = typeof (w as { clue?: unknown }).clue === 'string' ? (w as { clue: string }).clue : '';
    if (!answer) return c.json({ error: 'each word needs an answer' }, 400);
    if (answer.length > 9) {
      return c.json({ error: `answer "${answer}" too long (max 9 chars)` }, 400);
    }
    if (clue.length > 120) {
      return c.json({ error: `clue for "${answer}" too long (max 120 chars)` }, 400);
    }
    if (clueLeaksAnswer(answer, clue)) {
      return c.json({ error: `clue for "${answer}" reveals its answer` }, 400);
    }
    words.push({ answer, clue });
  }
  const gen = generatePuzzle(words, { name, tag: 'Custom' });
  if (!gen) return c.json({ error: 'could not build a puzzle from those words' }, 400);
  const p = gen.puzzle;
  const id = await insertPuzzle(c.env.DB, {
    ownerId: org.id,
    name: p.name,
    tag: p.tag,
    grid: p.grid,
    clues: p.clues,
    rows: p.rows,
    cols: p.cols,
  });
  return c.json({ id, dropped: gen.dropped });
});

// Solved puzzle for the organizer's preview (Setup) and live answer key. This is
// the ONLY route that returns answer letters, so it is organizer-gated and scoped
// to presets (owner_id IS NULL) + the org's own puzzles — the SAME guard as
// session creation. Players already know the puzzleId (it rides every snapshot),
// so this gate is the entire anti-cheat barrier: a non-organizer gets 401, and an
// organizer can never read another organizer's CUSTOM puzzle (preset solutions are
// intentionally shared — accepted trade-off for an event party game). Read-only
// GET, so no requireSameOrigin (that guards state-changing writes, not reads).
app.get('/api/puzzles/:id/solution', requireOrganizer, async (c) => {
  await ensureSeed(c.env);
  const org = c.get('organizer');
  const row = await getPuzzleById(c.env.DB, c.req.param('id'));
  if (!row) return c.json({ error: 'puzzle not found' }, 404);
  if (row.owner_id !== null && row.owner_id !== org.id) {
    return c.json({ error: 'puzzle not found' }, 404);
  }
  const full = rowToPuzzle(row);
  const puzzle = toPublicPuzzle(full);
  // Answer letters as a "r,c" -> letter map, exactly what <Crossword reveal>
  // consumes (the builder's MiniPreview does the same from a client-side grid).
  const answers: Record<string, string> = {};
  for (const [r, col] of full.fill) {
    const ch = full.grid[r]?.[col];
    if (ch) answers[`${r},${col}`] = ch;
  }
  return c.json({ puzzle, answers });
});

// ---------------------------------------------------------------------------
// AI word/clue drafting (OpenRouter) — organizer-only, same-origin. Drafts
// editable words for the builder; on any AI failure returns a curated fallback
// so the builder always works. The route never stores anything.
// ---------------------------------------------------------------------------
app.post('/api/ai/draft-words', requireSameOrigin, requireOrganizer, async (c) => {
  let body: { topic?: unknown; count?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'bad request' }, 400);
  }
  // Clamp the topic to a sane length (trim, then cap at 200 chars).
  const topic = typeof body.topic === 'string' ? body.topic.trim().slice(0, 200) : '';
  if (!topic) return c.json({ error: 'topic required' }, 400);
  const rawCount = typeof body.count === 'number' ? Math.floor(body.count) : 6;
  const count = Math.max(4, Math.min(10, rawCount));
  const tone = resolveBrand(await getBrand(c.env.DB)).aiTone;
  const { entries, source } = await draftWords(c.env, topic, count, tone);
  return c.json({ entries, source });
});

// ---------------------------------------------------------------------------
// Session creation (no DurableObject calls in this task)
// ---------------------------------------------------------------------------
app.post('/api/session/create', requireSameOrigin, requireOrganizer, async (c) => {
  await ensureSeed(c.env);
  const org = c.get('organizer');
  let body: { puzzleId?: unknown; config?: unknown; replace?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'bad request' }, 400);
  }
  const puzzleId = typeof body.puzzleId === 'string' ? body.puzzleId : '';
  if (!puzzleId) return c.json({ error: 'puzzleId required' }, 400);
  const puzzleRow = await getPuzzleById(c.env.DB, puzzleId);
  if (!puzzleRow) return c.json({ error: 'puzzle not found' }, 404);
  // Only presets (owner_id IS NULL) or the organizer's own puzzles are usable.
  if (puzzleRow.owner_id !== null && puzzleRow.owner_id !== org.id) {
    return c.json({ error: 'puzzle not found' }, 404);
  }

  const config = defaultConfig(puzzleId, puzzleRow.name);
  // Snapshot the active brand's AI tone so the round's tone is fixed and the DO
  // never reads D1 mid-round (the DO input gate is open across the OpenRouter await).
  config.aiTone = resolveBrand(await getBrand(c.env.DB)).aiTone;
  // Merge an optional config patch (defaults stay authoritative for missing keys).
  if (body.config && typeof body.config === 'object') {
    const patch = body.config as Partial<SessionConfig>;
    if (typeof patch.difficulty === 'string') {
      const d = DIFFICULTIES.find((x) => x.id === patch.difficulty);
      if (d) {
        config.difficulty = d.id;
        config.durationSec = d.dur;
        config.hintPenalty = d.hint;
        config.wrongPenalty = d.wrong;
      }
    }
    if (typeof patch.durationSec === 'number') config.durationSec = patch.durationSec;
    if (typeof patch.hintPenalty === 'number') config.hintPenalty = patch.hintPenalty;
    if (typeof patch.wrongPenalty === 'number') config.wrongPenalty = patch.wrongPenalty;
    if (typeof patch.maxPlayers === 'number') config.maxPlayers = patch.maxPlayers;
    if (typeof patch.allowLate === 'boolean') config.allowLate = patch.allowLate;
    if (typeof patch.strictValidation === 'boolean') config.strictValidation = patch.strictValidation;
  }

  // Validate the merged config against the bounded schema so an out-of-range or
  // non-finite value (e.g. a negative/huge duration) can never reach the DO/D1.
  const parsed = SessionConfigSchema.safeParse(config);
  if (!parsed.success) {
    return c.json({ error: 'invalid session config' }, 400);
  }

  // One active session per organizer (multi-booth). If the org already has an
  // active session (new/lobby/countdown/live/winner) in the window, prompt to
  // resume or replace — unless this request opts to replace. The authoritative
  // guard is the atomic createSessionIfNoActive below; this pre-check just gives
  // a clean 409 (with the active session) for the common sequential case without
  // burning a sequence number.
  const windowSince = Date.now() - ACTIVE_WINDOW_MS;
  const replace = body.replace === true;
  const projectActive = (row: SessionRow) => {
    let nm = '';
    try {
      const acfg = JSON.parse(row.config_json) as { puzzleName?: unknown };
      if (typeof acfg.puzzleName === 'string') nm = acfg.puzzleName;
    } catch { /* malformed config → empty name */ }
    return { joinCode: row.join_code, puzzleName: nm, status: row.status, round: row.round, createdAt: row.created_at };
  };
  const active = await mostRecentActiveSessionForOwner(c.env.DB, org.id, windowSince);
  if (active && !replace) {
    return c.json({ error: 'active_session', session: projectActive(active) }, 409);
  }
  if (active && replace) {
    // Authoritatively stop the superseded session's DO (sets it 'ended', kills its
    // alarm, drops its booth/players) — D1-only marking would let it resurrect.
    // If termination fails we must NOT create a second session (that would leave
    // two live sessions for one organizer); surface a retryable error instead.
    try {
      const stub = c.env.SESSION.get(c.env.SESSION.idFromName(active.join_code));
      const tres = await stub.fetch(
        new Request('https://do/terminate', {
          // Internal credential the DO verifies (constant-time). Not client-reachable.
          headers: { 'x-terminate': c.env.JWT_SECRET, 'x-join-code': active.join_code },
        }),
      );
      if (!tres.ok) throw new Error(`terminate returned ${tres.status}`);
    } catch (err) {
      console.error('replace: failed to terminate superseded session', err);
      return c.json({ error: 'could not end the current session — please try again' }, 503);
    }
  }

  const joinCode = await allocPrefixedJoinCode(c.env.DB, org.id);
  // Host token: returned ONCE to the client; only its sha-256 hash is stored.
  const hostToken = randomHex(32);
  const hostTokenHash = await sha256Hex(hostToken);
  // Atomic insert: only succeeds if the owner still has no active session. A
  // concurrent create that won the race makes this return false → surface its
  // session for resume/replace (rather than creating a second live session).
  const inserted = await createSessionIfNoActive(c.env.DB, {
    joinCode,
    ownerId: org.id,
    puzzleId,
    config,
    hostTokenHash,
    windowSince,
  });
  if (!inserted) {
    const raced = await mostRecentActiveSessionForOwner(c.env.DB, org.id, windowSince);
    return c.json(
      raced ? { error: 'active_session', session: projectActive(raced) } : { error: 'active_session' },
      409,
    );
  }
  return c.json({ joinCode, hostToken });
});

// ---------------------------------------------------------------------------
// Session resume / display (operational). /active is a passive read (no mutation,
// no token); /resume deliberately re-mints the host token so an organizer who
// lost the original (closed the tab) can re-attach to a still-running session.
// ---------------------------------------------------------------------------
app.get('/api/sessions/active', requireOrganizer, async (c) => {
  const org = c.get('organizer');
  const since = Date.now() - ACTIVE_WINDOW_MS;
  // The Home "Resume" CTA must offer exactly what POST /resume accepts — any
  // non-'ended' session. This is DELIBERATELY broader than the create guard's
  // active set: an 'idle' session (Clear Players, or an empty-lobby self-recycle)
  // is still resumable, so it belongs here. (The persistent-404 the CTA used to
  // show is handled client-side: a 404 drops the stale session + a transient
  // error; the bar collapses when there's nothing to resume.)
  const row = await mostRecentSessionForOwner(c.env.DB, org.id, since);
  if (!row) return c.json({ session: null });
  let puzzleName = '';
  try {
    const cfg = JSON.parse(row.config_json) as { puzzleName?: unknown };
    if (typeof cfg.puzzleName === 'string') puzzleName = cfg.puzzleName;
  } catch { /* malformed config → empty name */ }
  return c.json({
    session: {
      joinCode: row.join_code,
      puzzleName,
      status: row.status,
      round: row.round,
      createdAt: row.created_at,
    },
  });
});

app.post('/api/sessions/:code/resume', requireSameOrigin, requireOrganizer, async (c) => {
  const org = c.get('organizer');
  const code = c.req.param('code');
  if (!isValidJoinCode(code)) return c.json({ error: 'invalid join code' }, 400);
  const row = await getSessionByJoinCode(c.env.DB, code);
  // 404 (not 403) on wrong owner: don't reveal that a session exists.
  if (!row || row.owner_id !== org.id) return c.json({ error: 'session not found' }, 404);
  // A terminated/replaced session is not resumable (its DO has been quiesced).
  if (row.status === 'ended') return c.json({ error: 'session not found' }, 404);
  // Re-mint: a fresh token whose hash replaces the stored one. The SessionDO
  // re-reads D1 on the next host hello mismatch and accepts the new token.
  const hostToken = randomHex(32);
  const hostTokenHash = await sha256Hex(hostToken);
  await updateSessionHostTokenHash(c.env.DB, code, hostTokenHash);
  let config: unknown = null;
  try { config = JSON.parse(row.config_json); } catch { /* leave null */ }
  return c.json({ joinCode: code, hostToken, status: row.status, round: row.round, config });
});

// Delete a PAST game (owner-scoped): scrubs its round results off the leaderboard
// + history, keeping the session row as an inert 'ended' tombstone (which reserves
// the join code so the allocator never reuses it — see purgeSessionResults).
// Refuses a session that is still ACTIVE — genuinely in progress, or a
// 'winner' the booth is still lingering on (409). A stale/abandoned game (an
// in-progress one aged out of the active window, or a winner past the linger) IS
// deletable, so trial rounds left on the winner screen can still be scrubbed. For a
// non-`ended` (resumable) session the DO is quiesced via the authenticated terminate
// RPC BEFORE the D1 cascade — otherwise a still-live/resumable DO could write orphan
// results after the row is gone. Terminate failure → 503 (no D1 change).
app.delete('/api/sessions/:code', requireSameOrigin, requireOrganizer, async (c) => {
  const org = c.get('organizer');
  const code = c.req.param('code');
  if (!isValidJoinCode(code)) return c.json({ error: 'invalid join code' }, 400);
  const row = await getSessionByJoinCode(c.env.DB, code);
  // 404 (not 403) on missing OR wrong owner: don't disclose another org's codes.
  if (!row || row.owner_id !== org.id) return c.json({ error: 'session not found' }, 404);
  if (sessionActive(row.status, row.created_at, row.ended_at, Date.now(), ACTIVE_WINDOW_MS, WINNER_LINGER_MS))
    return c.json({ error: 'session_active' }, 409);
  if (row.status !== 'ended') {
    try {
      const stub = c.env.SESSION.get(c.env.SESSION.idFromName(code));
      const tres = await stub.fetch(
        new Request('https://do/terminate', {
          headers: { 'x-terminate': c.env.JWT_SECRET, 'x-join-code': code },
        }),
      );
      if (!tres.ok) throw new Error(`terminate returned ${tres.status}`);
    } catch (err) {
      console.error('delete: failed to quiesce session before cascade', err);
      return c.json({ error: 'could not delete session — please try again' }, 503);
    }
  }
  await purgeSessionResults(c.env.DB, code);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// WebSocket: /ws/:code → SessionDO (design §3, §4). Must be registered BEFORE
// the ASSETS fallback so it is never swallowed by the SPA.
// ---------------------------------------------------------------------------
app.get('/ws/:code', (c) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return c.text('expected websocket upgrade', 426);
  }
  const code = c.req.param('code');
  // Reject malformed codes before any DO lookup (cheap guard, avoids idFromName
  // churn on junk paths). Format (LLL-NNN) is validated via the shared rule.
  if (!isValidJoinCode(code)) {
    return c.text('invalid join code', 400);
  }
  const id = c.env.SESSION.idFromName(code);
  const stub = c.env.SESSION.get(id);
  // Forward the join code to the DO so it can lazily load from D1. The DO never
  // re-parses the URL; it reads `x-join-code`.
  const fwd = new Request(c.req.raw);
  // Strip any client-supplied internal control header: a client must NOT be able
  // to trigger the DO's terminate RPC through the public WS proxy (it forwards the
  // raw request). The DO ALSO requires the secret credential, so this is belt+suspenders.
  fwd.headers.delete('x-terminate');
  fwd.headers.set('x-join-code', code);
  return stub.fetch(fwd);
});

// Public preflight: does a session exist for this code? Lets the landing/player
// surface a clean "game not found" instead of an endless WS reconnect loop (a
// failed /ws upgrade returns 400/404, which the browser hides from JS). Reveals
// only existence — anyone with the code can already join, so this leaks nothing.
app.get('/api/join/:code', async (c) => {
  const code = c.req.param('code');
  if (!isValidJoinCode(code)) return c.json({ exists: false });
  const session = await getSessionByJoinCode(c.env.DB, code);
  return c.json({ exists: !!session });
});

// ---------------------------------------------------------------------------
// History surfacing (design §8). round_results → organizer Home "TODAY" stats +
// last-winner well, and the public display "RECENT WINNERS" list.
//
//  - GET /api/history (requireOrganizer) → { today, lastWinner } for the Home
//    surface, scoped PER-BOOTH to the logged-in organizer (round_results carries
//    no owner_id, so we resolve it through the sessions join). `today` is the UTC
//    day; `today.players` is player-ROUNDS (sum of leaderboard lengths).
//  - GET /api/history/public (PUBLIC, no auth — the booth display has no login)
//    → { recentWinners }, scoped per-booth via ?prefix=PUB (prefix → owner). An
//    unknown/missing prefix returns an empty list.
// Both registered BEFORE the ASSETS fallback so the SPA does not swallow them.
// ---------------------------------------------------------------------------
app.get('/api/history', requireOrganizer, async (c) => {
  const org = c.get('organizer');
  const since = startOfTodayUTC(Date.now());
  // Per-booth: TODAY stats + last winner scoped to the logged-in organizer.
  const [today, last] = await Promise.all([
    todayStats(c.env.DB, since, org.id),
    lastWinner(c.env.DB, org.id),
  ]);
  return c.json({ today, lastWinner: last });
});

app.get('/api/history/public', async (c) => {
  // Per-booth recent winners (?prefix=PUB). Unknown/missing prefix → empty list.
  const prefix = normalizePrefix(c.req.query('prefix') ?? '');
  if (!isValidPrefix(prefix)) return c.json({ recentWinners: [] });
  const org = await getOrganizerByPrefix(c.env.DB, prefix);
  if (!org) return c.json({ recentWinners: [] });
  const winners = await recentWinners(c.env.DB, 5, org.id);
  return c.json({ recentWinners: winners });
});

// Past rounds list (organizer-gated). GLOBAL scope (round_results has no
// owner_id; single-event model). `limit` is clamped to [1,50] (default 25).
app.get('/api/history/rounds', requireOrganizer, async (c) => {
  const org = c.get('organizer');
  const raw = c.req.query('limit');
  const n = raw != null ? Number(raw) : 25;
  const limit = Number.isFinite(n) ? Math.max(1, Math.min(50, Math.floor(n))) : 25;
  // Per-booth: only this organizer's past rounds. `active` marks a session the host
  // can't delete yet (genuinely live, or a winner still on the booth) using the same
  // staleness rules as the delete guard, so a stale/abandoned game becomes scrubbable.
  const rows = await historyRounds(c.env.DB, limit, org.id);
  const now = Date.now();
  const rounds = rows.map((r) => ({
    ...r,
    active: sessionActive(r.status, r.createdAt, r.endedAt, now, ACTIVE_WINDOW_MS, WINNER_LINGER_MS),
  }));
  return c.json({ rounds });
});

// ---------------------------------------------------------------------------
// Leaderboard (all-time, per-puzzle, owner-scoped). The board is keyed to ONE
// puzzle (points only compare within a puzzle) — the booth's most-recently-played
// one for the public TV, or any of the org's puzzles-with-results for the host.
//  - GET /api/leaderboard/public?prefix=PUB → { puzzle, entries } (latest puzzle).
//  - GET /api/leaderboard?puzzleId= (requireOrganizer) → { puzzle, entries, puzzles }.
// Puzzle identity comes ONLY from the owner-scoped set, so a client-supplied
// puzzleId can never surface another organizer's puzzle name.
// ---------------------------------------------------------------------------
app.get('/api/leaderboard/public', async (c) => {
  const prefix = normalizePrefix(c.req.query('prefix') ?? '');
  if (!isValidPrefix(prefix)) return c.json({ puzzle: null, entries: [] });
  const org = await getOrganizerByPrefix(c.env.DB, prefix);
  if (!org) return c.json({ puzzle: null, entries: [] });
  const { puzzle, entries } = await buildLeaderboard(c.env.DB, org.id);
  return c.json({ puzzle, entries });
});

app.get('/api/leaderboard', requireOrganizer, async (c) => {
  const org = c.get('organizer');
  const puzzleId = c.req.query('puzzleId') || undefined;
  const lb = await buildLeaderboard(c.env.DB, org.id, puzzleId);
  return c.json(lb);
});

// PUBLIC (booth has no login): the join code of the most-recent display-worthy
// session FOR A GIVEN BOOTH (?prefix=PUB) — scoped to that organizer + within
// the active window, with 'winner' sessions dropping out after WINNER_LINGER_MS
// so the booth recycles to standby. Unknown/missing prefix → { joinCode: null }.
app.get('/api/display/active', async (c) => {
  const prefix = normalizePrefix(c.req.query('prefix') ?? '');
  if (!isValidPrefix(prefix)) return c.json({ joinCode: null });
  const org = await getOrganizerByPrefix(c.env.DB, prefix);
  if (!org) return c.json({ joinCode: null });
  const now = Date.now();
  const joinCode = await mostRecentDisplaySession(
    c.env.DB,
    org.id,
    now - ACTIVE_WINDOW_MS,
    now - WINNER_LINGER_MS,
  );
  return c.json({ joinCode });
});

// ---------------------------------------------------------------------------
// Brand config. GET is public (the booth/players read it); PUT is organizer-only.
// Must be registered BEFORE the ASSETS fallback so the SPA does not swallow it.
// ---------------------------------------------------------------------------
app.get('/api/config', async (c) => c.json({ event: resolveBrand(await getBrand(c.env.DB)) }));

app.put('/api/config', requireSameOrigin, requireOrganizer, async (c) => {
  const org = c.get('organizer');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'bad request' }, 400);
  }
  const parsed = BrandSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid brand' }, 400);
  await upsertBrand(c.env.DB, parsed.data, org.id);
  return c.json({ event: parsed.data });
});

// Everything else falls through to the SPA (Static Assets binding).
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

// Authoritative session Durable Object (design §3) lives in its own module.
export { SessionDO } from './sessionDO';

export default app;
