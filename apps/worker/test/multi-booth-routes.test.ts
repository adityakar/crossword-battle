// multi-booth-routes.test.ts — one-active-per-organizer create (resume/replace),
// prefixed session codes, and PUT /api/organizers/me/prefix (multi-booth).
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { isValidPrefix, isValidJoinCode } from '@cwb/shared';

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

// Create a fresh organizer (isolates per-org one-active state) and return its
// cookie + id + assigned prefix.
async function makeOrg(): Promise<Org> {
  const admin = await loginCookie(SEED_EMAIL, SEED_PASSWORD);
  const email = `mb-${crypto.randomUUID().slice(0, 8)}@example.com`;
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

async function createSession(cookie: string, replace = false): Promise<Response> {
  const puzzleId = await firstPuzzleId(cookie);
  return SELF.fetch(`${ORIGIN}/api/session/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
    body: JSON.stringify({ puzzleId, ...(replace ? { replace: true } : {}) }),
  });
}

describe('POST /api/session/create — prefixed codes', () => {
  it('mints <PREFIX>-NNN for the organizer; me() exposes the prefix', async () => {
    const org = await makeOrg();
    expect(isValidPrefix(org.prefix)).toBe(true);
    const res = await createSession(org.cookie);
    expect(res.status).toBe(200);
    const { joinCode } = (await res.json()) as { joinCode: string };
    expect(joinCode.startsWith(`${org.prefix}-`)).toBe(true);
    expect(isValidJoinCode(joinCode)).toBe(true);
  });
});

describe('one active session per organizer (resume / replace)', () => {
  it('a just-created (un-opened) session blocks a second create (atomic one-active)', async () => {
    const org = await makeOrg();
    expect((await createSession(org.cookie)).status).toBe(200); // session 1 → 'new' (counts as active)
    const second = await createSession(org.cookie);
    expect(second.status).toBe(409); // 'new' is active → resume/replace, no second live session
    expect(((await second.json()) as { error: string }).error).toBe('active_session');
  });

  it('409 active_session when a started session exists (resume info returned)', async () => {
    const org = await makeOrg();
    const { joinCode } = (await (await createSession(org.cookie)).json()) as { joinCode: string };
    // Drive to a started (active) status directly via D1.
    await env.DB.prepare("UPDATE sessions SET status = 'lobby' WHERE join_code = ?").bind(joinCode).run();
    const res = await createSession(org.cookie);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; session: { joinCode: string; status: string } };
    expect(body.error).toBe('active_session');
    expect(body.session.joinCode).toBe(joinCode);
    expect(body.session.status).toBe('lobby');
  });

  it('replace terminates the old session (→ ended, no longer resumable) and creates a new one', async () => {
    const org = await makeOrg();
    const { joinCode: oldCode } = (await (await createSession(org.cookie)).json()) as { joinCode: string };
    await env.DB.prepare("UPDATE sessions SET status = 'lobby' WHERE join_code = ?").bind(oldCode).run();

    const res = await createSession(org.cookie, true);
    expect(res.status).toBe(200);
    const { joinCode: newCode } = (await res.json()) as { joinCode: string };
    expect(newCode).not.toBe(oldCode);

    const old = await env.DB.prepare('SELECT status FROM sessions WHERE join_code = ?').bind(oldCode).first<{ status: string }>();
    expect(old?.status).toBe('ended');

    // A terminated session is no longer resumable.
    const resume = await SELF.fetch(`${ORIGIN}/api/sessions/${oldCode}/resume`, {
      method: 'POST',
      headers: { Cookie: org.cookie, Origin: ORIGIN },
    });
    expect(resume.status).toBe(404);
  });
});

describe('per-booth stat scoping (cross-owner isolation)', () => {
  function winnerLb(name: string): string {
    return JSON.stringify([
      {
        id: 'p1', name, filledPct: 1, hintsUsed: 0, wrongAttempts: 0, finishMs: 60_000,
        connected: true, score: { raw: 60, pen: 0, adj: 60, points: 1640 }, rank: 1,
      },
    ]);
  }
  async function attachWinner(joinCode: string, name: string): Promise<void> {
    await env.DB
      .prepare(
        `INSERT INTO round_results (id, join_code, round, winner_name, winner_score_json, leaderboard_json, started_at, ended_at)
         VALUES (?, ?, 1, ?, NULL, ?, ?, ?)`,
      )
      .bind(`rr_${crypto.randomUUID().slice(0, 8)}`, joinCode, name, winnerLb(name), Date.now() - 60_000, Date.now())
      .run();
  }

  it('recent winners and display/active are scoped to the booth owner (not cross-bleeding)', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const ca = ((await (await createSession(a.cookie)).json()) as { joinCode: string }).joinCode;
    const cb = ((await (await createSession(b.cookie)).json()) as { joinCode: string }).joinCode;
    await attachWinner(ca, 'AliceA');
    await attachWinner(cb, 'BobB');

    const wa = ((await (await SELF.fetch(`${ORIGIN}/api/history/public?prefix=${a.prefix}`)).json()) as {
      recentWinners: { name: string }[];
    }).recentWinners.map((w) => w.name);
    const wb = ((await (await SELF.fetch(`${ORIGIN}/api/history/public?prefix=${b.prefix}`)).json()) as {
      recentWinners: { name: string }[];
    }).recentWinners.map((w) => w.name);
    expect(wa).toContain('AliceA');
    expect(wa).not.toContain('BobB');
    expect(wb).toContain('BobB');
    expect(wb).not.toContain('AliceA');

    // Two owners both display-active → each booth resolves only its own session.
    await env.DB.prepare("UPDATE sessions SET status = 'lobby' WHERE join_code IN (?, ?)").bind(ca, cb).run();
    const da = (await (await SELF.fetch(`${ORIGIN}/api/display/active?prefix=${a.prefix}`)).json()) as { joinCode: string | null };
    const db = (await (await SELF.fetch(`${ORIGIN}/api/display/active?prefix=${b.prefix}`)).json()) as { joinCode: string | null };
    expect(da.joinCode).toBe(ca);
    expect(db.joinCode).toBe(cb);
  });
});

describe('PUT /api/organizers/me/prefix', () => {
  it('200 for a valid prefix (setting to the org’s own prefix is a no-op success)', async () => {
    const org = await makeOrg();
    const res = await SELF.fetch(`${ORIGIN}/api/organizers/me/prefix`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: org.cookie, Origin: ORIGIN },
      body: JSON.stringify({ prefix: org.prefix }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { prefix: string }).prefix).toBe(org.prefix);
  });

  it('400 for a malformed prefix', async () => {
    const org = await makeOrg();
    for (const bad of ['PI', 'X1Z', 'WXYZ', 'PIO']) {
      const res = await SELF.fetch(`${ORIGIN}/api/organizers/me/prefix`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: org.cookie, Origin: ORIGIN },
        body: JSON.stringify({ prefix: bad }),
      });
      expect(res.status, `prefix=${bad}`).toBe(400);
    }
  });

  it('409 when the prefix is already taken by another organizer', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    const res = await SELF.fetch(`${ORIGIN}/api/organizers/me/prefix`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: b.cookie, Origin: ORIGIN },
      body: JSON.stringify({ prefix: a.prefix }),
    });
    expect(res.status).toBe(409);
  });

  it('403 cross-origin (CSRF defense)', async () => {
    const org = await makeOrg();
    const res = await SELF.fetch(`${ORIGIN}/api/organizers/me/prefix`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: org.cookie, Origin: 'https://evil.example.com' },
      body: JSON.stringify({ prefix: 'ABC' }),
    });
    expect(res.status).toBe(403);
  });
});
