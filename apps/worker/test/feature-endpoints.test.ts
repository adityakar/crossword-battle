// feature-endpoints.test.ts — operational endpoints (pre-deploy):
//   GET    /api/sessions/active        (passive read)
//   GET    /api/organizers             (list, no password hash)
//   DELETE /api/organizers/:id         (self / cross-origin / 404 guards)
//   POST   /api/auth/change-password
//   GET    /api/display/active         (PUBLIC booth attach)
//   GET    /api/history/rounds         (past-rounds projection + limit clamp)
//
// Mirrors routes.test.ts setup (ORIGIN/SEED_*/cookieFrom/login/loginCookie).
// D1 rows are NOT rolled back between tests in this harness, so the display
// test sets status directly via env.DB and the history test truncates first.
import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RankedPlayer } from '@cwb/shared';
import { scoreFor } from '@cwb/shared';

const ORIGIN = 'https://cwb.test';
const SEED_EMAIL = 'seed@example.com';
const SEED_PASSWORD = 'seed-password-123';

// SELF.fetch has no cookie jar. Extract the cookie name=value (drop attributes).
function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('Set-Cookie');
  if (!setCookie) throw new Error('no Set-Cookie header');
  return setCookie.split(';')[0]!; // "cwb_session=<jwt>"
}

async function login(email = SEED_EMAIL, password = SEED_PASSWORD): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

async function loginCookie(email = SEED_EMAIL, password = SEED_PASSWORD): Promise<string> {
  const res = await login(email, password);
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

// The seed org's booth prefix (display/active scopes by OWNER, resolved from the
// prefix — independent of the session code's own letters).
async function seedPrefix(): Promise<string> {
  await loginCookie(); // ensureSeed assigns a prefix
  const row = await env.DB.prepare('SELECT prefix FROM organizers WHERE email = ?').bind(SEED_EMAIL).first<{ prefix: string }>();
  if (!row?.prefix) throw new Error('seed prefix not found');
  return row.prefix;
}

// Create a session through the REAL API so owner_id matches the cookie's subject.
// replace:true so repeated creates for the shared seed org in this file don't trip
// the one-active guard (these tests just need a fresh session).
async function createSession(cookie: string): Promise<{ joinCode: string; hostToken: string }> {
  const pz = await SELF.fetch(`${ORIGIN}/api/puzzles`, { headers: { Cookie: cookie } });
  const { puzzles } = (await pz.json()) as { puzzles: { id: string }[] };
  const res = await SELF.fetch(`${ORIGIN}/api/session/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
    body: JSON.stringify({ puzzleId: puzzles[0]!.id, replace: true }),
  });
  return res.json() as Promise<{ joinCode: string; hostToken: string }>;
}

// ===========================================================================
// GET /api/sessions/active
// ===========================================================================
describe('GET /api/sessions/active', () => {
  it('requires auth (401 without a cookie)', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/sessions/active`);
    expect(res.status).toBe(401);
  });

  it('returns { session: null } for an org with no sessions', async () => {
    // A brand-new organizer with no sessions of its own.
    const email = `noses-${Date.now()}@example.com`;
    await SELF.fetch(`${ORIGIN}/api/organizers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: await loginCookie(), Origin: ORIGIN },
      body: JSON.stringify({ email, password: 'fresh-org-password' }),
    });
    const cookie = await loginCookie(email, 'fresh-org-password');
    const res = await SELF.fetch(`${ORIGIN}/api/sessions/active`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: unknown };
    expect(body.session).toBeNull();
  });

  it('returns the most-recent session with a non-empty puzzleName', async () => {
    const cookie = await loginCookie();
    const { joinCode } = await createSession(cookie);
    const res = await SELF.fetch(`${ORIGIN}/api/sessions/active`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      session: { joinCode: string; puzzleName: string; status: string; round: number; createdAt: number } | null;
    };
    expect(body.session).not.toBeNull();
    expect(body.session!.joinCode).toBe(joinCode);
    expect(body.session!.puzzleName.length).toBeGreaterThan(0);
    expect(body.session!.status).toBe('new'); // created sessions start 'new' (one-active marker)
    expect(body.session!.round).toBe(1);
  });

  it('still returns an idle session (resumable — must match what /resume accepts)', async () => {
    // Regression: /active must offer any non-'ended' session, INCLUDING 'idle'
    // (left by Clear Players or an empty-lobby self-recycle — still resumable via
    // POST /resume). Narrowing it to the active set hid recoverable idle sessions
    // from the Home Resume CTA. Set 'idle' directly in D1 (the recycle path is a
    // timer-based DO alarm not worth staging here).
    const cookie = await loginCookie();
    const { joinCode } = await createSession(cookie);
    await env.DB.prepare("UPDATE sessions SET status = 'idle' WHERE join_code = ?").bind(joinCode).run();
    const res = await SELF.fetch(`${ORIGIN}/api/sessions/active`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session: { joinCode: string; status: string } | null };
    expect(body.session).not.toBeNull();
    expect(body.session!.joinCode).toBe(joinCode);
    expect(body.session!.status).toBe('idle');
  });
});

// ===========================================================================
// GET /api/organizers
// ===========================================================================
describe('GET /api/organizers', () => {
  it('requires auth (401 without a cookie)', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/organizers`);
    expect(res.status).toBe(401);
  });

  it('lists organizers including the seed org, with NO password_hash', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/organizers`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      organizers: { id: string; email: string; created_at: number }[];
    };
    expect(Array.isArray(body.organizers)).toBe(true);
    expect(body.organizers.some((o) => o.email === SEED_EMAIL)).toBe(true);
    for (const o of body.organizers) {
      expect(typeof o.id).toBe('string');
      expect(typeof o.email).toBe('string');
      expect(typeof o.created_at).toBe('number');
      expect((o as Record<string, unknown>).password_hash).toBeUndefined();
    }
    // No hash leaks anywhere in the serialized response.
    expect(JSON.stringify(body)).not.toContain('pbkdf2');
  });
});

// ===========================================================================
// DELETE /api/organizers/:id
// ===========================================================================
describe('DELETE /api/organizers/:id', () => {
  it('400 when deleting your own account', async () => {
    const cookie = await loginCookie();
    const me = (await (await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } })).json()) as {
      organizer: { id: string };
    };
    const res = await SELF.fetch(`${ORIGIN}/api/organizers/${me.organizer.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie, Origin: ORIGIN },
    });
    expect(res.status).toBe(400);
  });

  it('403 cross-origin (CSRF defense)', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/organizers/org_whatever`, {
      method: 'DELETE',
      headers: { Cookie: cookie, Origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });

  it('deletes another organizer (200) and it disappears from the list; 404 for unknown id', async () => {
    const cookie = await loginCookie();
    // Create a second organizer to delete.
    const email = `victim-${Date.now()}@example.com`;
    const created = (await (
      await SELF.fetch(`${ORIGIN}/api/organizers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
        body: JSON.stringify({ email, password: 'doomed-organizer-pass' }),
      })
    ).json()) as { organizer: { id: string } };

    const del = await SELF.fetch(`${ORIGIN}/api/organizers/${created.organizer.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie, Origin: ORIGIN },
    });
    expect(del.status).toBe(200);
    expect((await del.json()) as { ok: boolean }).toEqual({ ok: true });

    const list = (await (
      await SELF.fetch(`${ORIGIN}/api/organizers`, { headers: { Cookie: cookie } })
    ).json()) as { organizers: { id: string }[] };
    expect(list.organizers.some((o) => o.id === created.organizer.id)).toBe(false);

    // Deleting it again → 404 (already gone).
    const again = await SELF.fetch(`${ORIGIN}/api/organizers/${created.organizer.id}`, {
      method: 'DELETE',
      headers: { Cookie: cookie, Origin: ORIGIN },
    });
    expect(again.status).toBe(404);
  });
});

// ===========================================================================
// POST /api/auth/change-password
// ===========================================================================
describe('POST /api/auth/change-password', () => {
  it('403 cross-origin (CSRF defense)', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://evil.example.com' },
      body: JSON.stringify({ currentPassword: SEED_PASSWORD, newPassword: 'new-strong-pass' }),
    });
    expect(res.status).toBe(403);
  });

  it('401 when the current password is wrong', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ currentPassword: 'not-the-password', newPassword: 'new-strong-pass' }),
    });
    expect(res.status).toBe(401);
  });

  it('400 when the new password is shorter than 8 chars', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ currentPassword: SEED_PASSWORD, newPassword: 'short' }),
    });
    expect(res.status).toBe(400);
  });

  it('happy path: changes the password, the new one logs in; reverts to keep the seed usable', async () => {
    const cookie = await loginCookie();
    const NEW_PASSWORD = 'rotated-seed-pass-1';
    const res = await SELF.fetch(`${ORIGIN}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ currentPassword: SEED_PASSWORD, newPassword: NEW_PASSWORD }),
    });
    expect(res.status).toBe(200);
    // The new password logs in.
    expect((await login(SEED_EMAIL, NEW_PASSWORD)).status).toBe(200);
    // The old password no longer works.
    expect((await login(SEED_EMAIL, SEED_PASSWORD)).status).toBe(401);

    // Revert to SEED_PASSWORD so other tests sharing this DB still log in.
    const cookie2 = await loginCookie(SEED_EMAIL, NEW_PASSWORD);
    const revert = await SELF.fetch(`${ORIGIN}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie2, Origin: ORIGIN },
      body: JSON.stringify({ currentPassword: NEW_PASSWORD, newPassword: SEED_PASSWORD }),
    });
    expect(revert.status).toBe(200);
    expect((await login(SEED_EMAIL, SEED_PASSWORD)).status).toBe(200);
  });
});

// ===========================================================================
// GET /api/display/active (PUBLIC)
// ===========================================================================
describe('GET /api/display/active (prefix-scoped booth)', () => {
  // A prefixed session code is `<PREFIX>-NNN`, so the org's booth prefix is the
  // first 3 chars of any code it creates.
  it('returns { joinCode: null } with no/invalid/unknown prefix', async () => {
    expect(((await (await SELF.fetch(`${ORIGIN}/api/display/active`)).json()) as { joinCode: string | null }).joinCode).toBeNull();
    expect(((await (await SELF.fetch(`${ORIGIN}/api/display/active?prefix=zz`)).json()) as { joinCode: string | null }).joinCode).toBeNull();
    expect(((await (await SELF.fetch(`${ORIGIN}/api/display/active?prefix=ZZZ`)).json()) as { joinCode: string | null }).joinCode).toBeNull();
  });

  it('returns the joinCode once the booth session reaches a non-idle status (idle excluded)', async () => {
    const cookie = await loginCookie();
    const { joinCode } = await createSession(cookie);
    const prefix = await seedPrefix();

    // Fresh session is 'idle' → not display-worthy.
    const idleRes = await SELF.fetch(`${ORIGIN}/api/display/active?prefix=${prefix}`);
    expect(((await idleRes.json()) as { joinCode: string | null }).joinCode).toBeNull();

    // Drive to 'lobby' directly via D1 (driving to lobby over HTTP is hard).
    await env.DB.prepare("UPDATE sessions SET status = 'lobby' WHERE join_code = ?").bind(joinCode).run();
    const res = await SELF.fetch(`${ORIGIN}/api/display/active?prefix=${prefix}`);
    expect(((await res.json()) as { joinCode: string | null }).joinCode).toBe(joinCode);

    // Reset to idle so this row doesn't bleed into later tests.
    await env.DB.prepare("UPDATE sessions SET status = 'idle' WHERE join_code = ?").bind(joinCode).run();
  });

  it('recycles a winner session: returned while fresh, dropped after the linger window', async () => {
    const cookie = await loginCookie();
    const { joinCode } = await createSession(cookie);
    const prefix = await seedPrefix();
    const now = Date.now();

    // Winner ended just now → still on the booth.
    await env.DB.prepare("UPDATE sessions SET status = 'winner', ended_at = ? WHERE join_code = ?")
      .bind(now, joinCode).run();
    expect(((await (await SELF.fetch(`${ORIGIN}/api/display/active?prefix=${prefix}`)).json()) as { joinCode: string | null }).joinCode).toBe(joinCode);

    // Winner ended 90s ago (> 60s linger) → booth recycles to standby.
    await env.DB.prepare("UPDATE sessions SET ended_at = ? WHERE join_code = ?")
      .bind(now - 90_000, joinCode).run();
    expect(((await (await SELF.fetch(`${ORIGIN}/api/display/active?prefix=${prefix}`)).json()) as { joinCode: string | null }).joinCode).toBeNull();

    await env.DB.prepare("UPDATE sessions SET status = 'idle', ended_at = NULL WHERE join_code = ?").bind(joinCode).run();
  });
});

// ===========================================================================
// GET /api/history/rounds
// ===========================================================================
// Mirror history.test.ts: build a real RankedPlayer leaderboard + insert a
// round_results row directly. Truncate first so projection/limit are deterministic.
const CFG = { hintPenalty: 5, wrongPenalty: 10 };
function entry(name: string, finishMs: number | null, hintsUsed: number, rank: number): RankedPlayer {
  const base = {
    id: `p_${name}`,
    name,
    filledPct: finishMs == null ? 0.5 : 1,
    hintsUsed,
    wrongAttempts: 0,
    finishMs,
    connected: true,
  };
  return { ...base, score: scoreFor(base, CFG), rank };
}

// /api/history/rounds is owner-scoped (round_results JOIN sessions). Link each
// inserted round to a seed-org session so it's attributed to the logged-in org.
let seedIdCache: string | null = null;
async function seedId(): Promise<string> {
  if (seedIdCache) return seedIdCache;
  await loginCookie(); // ensureSeed creates the org
  const row = await env.DB.prepare('SELECT id FROM organizers WHERE email = ?').bind(SEED_EMAIL).first<{ id: string }>();
  if (!row) throw new Error('seed org not found');
  seedIdCache = row.id;
  return seedIdCache;
}

async function insertRound(joinCode: string, endedAt: number, winnerName: string | null): Promise<void> {
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO sessions (join_code, owner_id, puzzle_id, config_json, round, status, host_token_hash, created_at)
       VALUES (?, ?, 'pz_test', '{}', 1, 'winner', 'h', ?)`,
    )
    .bind(joinCode, await seedId(), endedAt)
    .run();
  const lb: RankedPlayer[] = [];
  let rank = 1;
  let winnerScoreJson: string | null = null;
  if (winnerName) {
    const w = entry(winnerName, 72_000, 0, rank++);
    lb.push(w);
    winnerScoreJson = JSON.stringify(w.score);
  }
  lb.push(entry('DNF1', null, 0, rank++)); // one non-finisher so players > winners
  await env.DB.prepare(
    `INSERT INTO round_results (id, join_code, round, winner_name, winner_score_json, leaderboard_json, started_at, ended_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `rr_${crypto.randomUUID().slice(0, 8)}`,
      joinCode,
      winnerName,
      winnerScoreJson,
      JSON.stringify(lb),
      endedAt - 60_000,
      endedAt,
    )
    .run();
}

describe('GET /api/history/rounds', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM round_results').run();
  });

  it('requires auth (401 without a cookie)', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/history/rounds`);
    expect(res.status).toBe(401);
  });

  it('returns { rounds: [] } when there are no rounds', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/history/rounds`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rounds: unknown[] };
    expect(body.rounds).toEqual([]);
  });

  it('projects a round_results row to { joinCode, players, winnerName, winnerTime }', async () => {
    const cookie = await loginCookie();
    await insertRound('HRD-001', Date.now() - 1_000, 'Priya Nair');
    const res = await SELF.fetch(`${ORIGIN}/api/history/rounds`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rounds: { joinCode: string; round: number; winnerName: string | null; winnerTime: string | null; players: number; endedAt: number }[];
    };
    expect(body.rounds).toHaveLength(1);
    const r = body.rounds[0]!;
    expect(r.joinCode).toBe('HRD-001');
    expect(r.round).toBe(1);
    expect(r.winnerName).toBe('Priya Nair');
    expect(r.players).toBe(2); // winner + 1 DNF
    expect(r.winnerTime).toBe('1:12'); // fmtTime(72000/1000)
  });

  it('null winnerTime/winnerName for a winnerless round', async () => {
    const cookie = await loginCookie();
    await insertRound('HRD-002', Date.now() - 1_000, null);
    const body = (await (
      await SELF.fetch(`${ORIGIN}/api/history/rounds`, { headers: { Cookie: cookie } })
    ).json()) as { rounds: { winnerName: string | null; winnerTime: string | null }[] };
    expect(body.rounds).toHaveLength(1);
    expect(body.rounds[0]!.winnerName).toBeNull();
    expect(body.rounds[0]!.winnerTime).toBeNull();
  });

  it('clamps ?limit to a max of 50', async () => {
    const cookie = await loginCookie();
    // Insert 3 rounds; ask for a huge limit. The clamp must not error and the
    // returned set is bounded by 50 (here just the 3 we inserted).
    for (let i = 0; i < 3; i++) {
      await insertRound(`HRD-1${i}`, Date.now() - (3 - i) * 1_000, `W${i}`);
    }
    const res = await SELF.fetch(`${ORIGIN}/api/history/rounds?limit=999`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rounds: unknown[] };
    expect(body.rounds.length).toBeLessThanOrEqual(50);
    expect(body.rounds.length).toBe(3);
  });
});

// ===========================================================================
// GET /api/puzzles/:id/solution — the ONLY route that returns answer letters.
// The auth gate + owner/preset scope is the entire anti-cheat barrier (players
// know the puzzleId from every snapshot), so these guards are load-bearing.
// ===========================================================================
type SolutionBody = {
  puzzle: { id: string; cellCount: number; across: unknown[]; down: unknown[] };
  answers: Record<string, string>;
};

async function createCustomPuzzle(cookie: string): Promise<string> {
  const res = await SELF.fetch(`${ORIGIN}/api/puzzles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
    body: JSON.stringify({
      name: 'Owned Puzzle',
      words: [
        { answer: 'ALPHA', clue: 'First Greek letter' },
        { answer: 'PLANT', clue: 'It grows in soil' },
        { answer: 'TABLE', clue: 'You eat at it' },
        { answer: 'LEMON', clue: 'A sour yellow fruit' },
      ],
    }),
  });
  expect(res.status).toBe(200);
  return (await res.json() as { id: string }).id;
}

describe('GET /api/puzzles/:id/solution', () => {
  it('requires auth (401 without a cookie)', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/puzzles/mini-ai/solution`);
    expect(res.status).toBe(401);
  });

  it('returns a preset solution: answers cover every fillable cell, all A–Z', async () => {
    const cookie = await loginCookie(); // ensureSeed seeds the presets
    const res = await SELF.fetch(`${ORIGIN}/api/puzzles/mini-ai/solution`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SolutionBody;
    expect(body.puzzle.id).toBe('mini-ai');
    // One answer letter per fillable cell, nothing more, nothing less.
    expect(Object.keys(body.answers).length).toBe(body.puzzle.cellCount);
    for (const letter of Object.values(body.answers)) {
      expect(letter).toMatch(/^[A-Z]$/);
    }
    // Every across/down word reads a full answer string off the map.
    for (const w of [...body.puzzle.across, ...body.puzzle.down] as { cells: [number, number][] }[]) {
      const answer = w.cells.map(([r, c]) => body.answers[`${r},${c}`] ?? '').join('');
      expect(answer.length).toBe(w.cells.length);
    }
  });

  it('404s for an unknown puzzle id', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/puzzles/pz_does_not_exist/solution`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
  });

  it("404s when another organizer requests someone's CUSTOM puzzle", async () => {
    // Org A owns a custom puzzle.
    const ownerCookie = await loginCookie();
    const id = await createCustomPuzzle(ownerCookie);
    // Owner can read it (positive control).
    const own = await SELF.fetch(`${ORIGIN}/api/puzzles/${id}/solution`, { headers: { Cookie: ownerCookie } });
    expect(own.status).toBe(200);
    // Org B (fresh organizer) cannot — owner-scoped custom puzzles 404 cross-org.
    const email = `other-${Date.now()}@example.com`;
    await SELF.fetch(`${ORIGIN}/api/organizers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: await loginCookie(), Origin: ORIGIN },
      body: JSON.stringify({ email, password: 'other-org-password' }),
    });
    const otherCookie = await loginCookie(email, 'other-org-password');
    const res = await SELF.fetch(`${ORIGIN}/api/puzzles/${id}/solution`, { headers: { Cookie: otherCookie } });
    expect(res.status).toBe(404);
  });
});
