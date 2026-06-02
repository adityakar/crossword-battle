// leaderboard.test.ts — all-time per-puzzle leaderboard endpoints (public + host),
// session delete (owner-scope, active-guard, DO-quiesce + cascade), and the
// sessionHasResults helper that drives the setPuzzle lock. Rows are seeded
// directly via env.DB to control puzzle_id + leaderboard_json precisely.
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { sessionHasResults } from '../src/db';

const ORIGIN = 'https://cwb.test';
const SEED_EMAIL = 'seed@example.com';
const SEED_PASSWORD = 'seed-password-123';

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('Set-Cookie');
  if (!setCookie) throw new Error('no Set-Cookie header');
  return setCookie.split(';')[0]!;
}
async function loginCookie(email: string, password: string): Promise<string> {
  const res = await SELF.fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

interface Org { cookie: string; id: string; prefix: string; }

async function makeOrg(): Promise<Org> {
  const admin = await loginCookie(SEED_EMAIL, SEED_PASSWORD);
  const email = `lb-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = 'fresh-org-password';
  const created = await SELF.fetch(`${ORIGIN}/api/organizers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: admin, Origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  });
  expect(created.status).toBe(200);
  const cookie = await loginCookie(email, password);
  const me = (await (await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } })).json()) as {
    organizer: { id: string; prefix: string | null };
  };
  expect(me.organizer.prefix).not.toBeNull();
  return { cookie, id: me.organizer.id, prefix: me.organizer.prefix! };
}

async function firstPuzzleId(cookie: string): Promise<string> {
  const pz = (await (await SELF.fetch(`${ORIGIN}/api/puzzles`, { headers: { Cookie: cookie } })).json()) as {
    puzzles: { id: string }[];
  };
  return pz.puzzles[0]!.id;
}

// A leaderboard_json entry shaped like RankedPlayer (the helpers read name + score).
function entry(name: string, finishMs: number | null, hintsUsed = 0, wrongAttempts = 0) {
  const raw = finishMs == null ? 0 : finishMs / 1000;
  const pen = hintsUsed * 10 + wrongAttempts * 5;
  const adj = raw + pen;
  const score = finishMs == null ? null : { raw, pen, adj, points: Math.max(100, Math.round(2000 - adj * 6)) };
  return { id: name, name, filledPct: 1, hintsUsed, wrongAttempts, finishMs, connected: false, score, rank: 1 };
}

async function seedSession(
  ownerId: string,
  code: string,
  puzzleId: string,
  status = 'idle',
  endedAt: number | null = null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sessions (join_code, owner_id, puzzle_id, config_json, round, status, host_token_hash, created_at, ended_at)
     VALUES (?, ?, ?, '{}', 1, ?, 'x', ?, ?)`,
  ).bind(code, ownerId, puzzleId, status, Date.now(), endedAt).run();
}
async function seedRound(
  code: string,
  round: number,
  entries: ReturnType<typeof entry>[],
  endedAt = Date.now(),
): Promise<void> {
  const winner = entries.find((e) => e.finishMs != null) ?? null;
  await env.DB.prepare(
    `INSERT INTO round_results (id, join_code, round, winner_name, winner_score_json, leaderboard_json, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), code, round, winner?.name ?? null,
    winner ? JSON.stringify(winner.score) : null, JSON.stringify(entries), endedAt - 60000, endedAt,
  ).run();
}

describe('GET /api/leaderboard/public', () => {
  it('returns the latest puzzle top-10 for the booth, points-ranked', async () => {
    const org = await makeOrg();
    const pid = await firstPuzzleId(org.cookie);
    await seedSession(org.id, `${org.prefix}-001`, pid);
    await seedRound(`${org.prefix}-001`, 1, [entry('Ann', 60000), entry('Bob', 120000)]);
    const res = await SELF.fetch(`${ORIGIN}/api/leaderboard/public?prefix=${org.prefix}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { puzzle: { id: string } | null; entries: { name: string; rank: number }[] };
    expect(body.puzzle?.id).toBe(pid);
    expect(body.entries.map((e) => e.name)).toEqual(['Ann', 'Bob']);
    expect(body.entries[0]!.rank).toBe(1);
  });

  it('unknown/empty prefix → empty', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/leaderboard/public?prefix=ZZZ`);
    expect(await res.json()).toEqual({ puzzle: null, entries: [] });
  });

  it("does not include another owner's scores", async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const pid = await firstPuzzleId(a.cookie);
    await seedSession(a.id, `${a.prefix}-001`, pid);
    await seedRound(`${a.prefix}-001`, 1, [entry('A-only', 60000)]);
    await seedSession(b.id, `${b.prefix}-001`, pid);
    await seedRound(`${b.prefix}-001`, 1, [entry('B-only', 50000)]);
    const res = await SELF.fetch(`${ORIGIN}/api/leaderboard/public?prefix=${a.prefix}`);
    const body = await res.json() as { entries: { name: string }[] };
    expect(body.entries.map((e) => e.name)).toEqual(['A-only']);
  });
});

describe('GET /api/leaderboard (host)', () => {
  it('401 without auth', async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/leaderboard`)).status).toBe(401);
  });

  it('defaults to the latest puzzle and lists puzzles-with-results', async () => {
    const org = await makeOrg();
    const pid = await firstPuzzleId(org.cookie);
    await seedSession(org.id, `${org.prefix}-001`, pid);
    await seedRound(`${org.prefix}-001`, 1, [entry('Cara', 60000)]);
    const res = await SELF.fetch(`${ORIGIN}/api/leaderboard`, { headers: { Cookie: org.cookie } });
    const body = await res.json() as { puzzle: { id: string } | null; puzzles: { id: string }[]; entries: unknown[] };
    expect(body.puzzle?.id).toBe(pid);
    expect(body.puzzles.map((p) => p.id)).toContain(pid);
    expect(body.entries).toHaveLength(1);
  });

  it('a foreign/unowned puzzleId falls back to latest and never leaks its name (F3)', async () => {
    const org = await makeOrg();
    const pid = await firstPuzzleId(org.cookie);
    await seedSession(org.id, `${org.prefix}-001`, pid);
    await seedRound(`${org.prefix}-001`, 1, [entry('Dan', 60000)]);
    const res = await SELF.fetch(`${ORIGIN}/api/leaderboard?puzzleId=does-not-belong`, { headers: { Cookie: org.cookie } });
    const body = await res.json() as { puzzle: { id: string } | null };
    expect(body.puzzle?.id).toBe(pid); // fell back to the owner's latest, not the foreign id
  });

  it('no results at all → empty', async () => {
    const org = await makeOrg();
    const res = await SELF.fetch(`${ORIGIN}/api/leaderboard`, { headers: { Cookie: org.cookie } });
    expect(await res.json()).toEqual({ puzzle: null, entries: [], puzzles: [] });
  });
});

describe('DELETE /api/sessions/:code', () => {
  it('cross-owner → 404 and leaves the row intact', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const pid = await firstPuzzleId(a.cookie);
    await seedSession(a.id, `${a.prefix}-001`, pid);
    await seedRound(`${a.prefix}-001`, 1, [entry('A', 60000)]);
    const res = await SELF.fetch(`${ORIGIN}/api/sessions/${a.prefix}-001`, {
      method: 'DELETE', headers: { Cookie: b.cookie, Origin: ORIGIN },
    });
    expect(res.status).toBe(404);
    const still = await SELF.fetch(`${ORIGIN}/api/leaderboard/public?prefix=${a.prefix}`);
    expect(((await still.json()) as { entries: unknown[] }).entries).toHaveLength(1);
  });

  it('missing session → 404', async () => {
    const org = await makeOrg();
    const res = await SELF.fetch(`${ORIGIN}/api/sessions/${org.prefix}-777`, {
      method: 'DELETE', headers: { Cookie: org.cookie, Origin: ORIGIN },
    });
    expect(res.status).toBe(404);
  });

  it('active session → 409', async () => {
    const org = await makeOrg();
    const pid = await firstPuzzleId(org.cookie);
    await seedSession(org.id, `${org.prefix}-009`, pid, 'live');
    const res = await SELF.fetch(`${ORIGIN}/api/sessions/${org.prefix}-009`, {
      method: 'DELETE', headers: { Cookie: org.cookie, Origin: ORIGIN },
    });
    expect(res.status).toBe(409);
  });

  it('a winner still lingering on the booth → 409', async () => {
    const org = await makeOrg();
    const pid = await firstPuzzleId(org.cookie);
    await seedSession(org.id, `${org.prefix}-010`, pid, 'winner', Date.now()); // just ended
    const res = await SELF.fetch(`${ORIGIN}/api/sessions/${org.prefix}-010`, {
      method: 'DELETE', headers: { Cookie: org.cookie, Origin: ORIGIN },
    });
    expect(res.status).toBe(409);
  });

  it('a STALE winner (booth recycled) is deletable — scrubbable trial round (codex P2)', async () => {
    const org = await makeOrg();
    const pid = await firstPuzzleId(org.cookie);
    // Abandoned on the winner screen, ended well past the booth linger window.
    await seedSession(org.id, `${org.prefix}-011`, pid, 'winner', Date.now() - 10 * 60 * 1000);
    await seedRound(`${org.prefix}-011`, 1, [entry('Trial', 60000)], Date.now() - 10 * 60 * 1000);
    const del = await SELF.fetch(`${ORIGIN}/api/sessions/${org.prefix}-011`, {
      method: 'DELETE', headers: { Cookie: org.cookie, Origin: ORIGIN },
    });
    expect(del.status).toBe(200);
    const board = await SELF.fetch(`${ORIGIN}/api/leaderboard/public?prefix=${org.prefix}`);
    expect((await board.json() as { entries: unknown[] }).entries).toHaveLength(0);
  });

  it('deletes a past (idle) game — quiesces the DO, scrubs rounds, keeps an ended tombstone', async () => {
    const org = await makeOrg();
    const pid = await firstPuzzleId(org.cookie);
    await seedSession(org.id, `${org.prefix}-002`, pid, 'idle');
    await seedRound(`${org.prefix}-002`, 1, [entry('Gone', 60000)]);
    const del = await SELF.fetch(`${ORIGIN}/api/sessions/${org.prefix}-002`, {
      method: 'DELETE', headers: { Cookie: org.cookie, Origin: ORIGIN },
    });
    expect(del.status).toBe(200);
    // Rounds are gone from the board...
    const board = await SELF.fetch(`${ORIGIN}/api/leaderboard/public?prefix=${org.prefix}`);
    const body = await board.json() as { puzzle: unknown; entries: unknown[] };
    expect(body.entries).toHaveLength(0);
    expect(body.puzzle).toBeNull();
    // ...but the session row survives as an inert 'ended' tombstone that reserves the
    // join code (so the allocator never reuses it on a sequence wrap), with no rounds.
    const sess = await env.DB.prepare('SELECT status FROM sessions WHERE join_code = ?')
      .bind(`${org.prefix}-002`).first<{ status: string }>();
    expect(sess?.status).toBe('ended');
    const rr = await env.DB.prepare('SELECT COUNT(*) AS n FROM round_results WHERE join_code = ?')
      .bind(`${org.prefix}-002`).first<{ n: number }>();
    expect(rr?.n).toBe(0);
  });
});

describe('sessionHasResults (drives the setPuzzle lock)', () => {
  it('flips to true once a round result is written', async () => {
    const org = await makeOrg();
    const pid = await firstPuzzleId(org.cookie);
    await seedSession(org.id, `${org.prefix}-003`, pid);
    expect(await sessionHasResults(env.DB, `${org.prefix}-003`)).toBe(false);
    await seedRound(`${org.prefix}-003`, 1, [entry('X', 60000)]);
    expect(await sessionHasResults(env.DB, `${org.prefix}-003`)).toBe(true);
  });
});
