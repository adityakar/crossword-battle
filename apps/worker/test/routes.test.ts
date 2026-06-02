import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

// Mirror of the worker's host-token hashing so the test can prove the stored
// hash is exactly sha256(rawToken) — Task 5 host auth depends on this relation.
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ORIGIN = 'https://cwb.test';
const SEED_EMAIL = 'seed@example.com';
const SEED_PASSWORD = 'seed-password-123';

// SELF.fetch has no cookie jar. Extract the cookie name=value (drop attributes)
// from a Set-Cookie header so it can be replayed as a Cookie request header.
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

async function loginCookie(): Promise<string> {
  const res = await login();
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

describe('POST /api/auth/login', () => {
  it('rejects bad credentials with 401', async () => {
    const res = await login(SEED_EMAIL, 'wrong-password');
    expect(res.status).toBe(401);
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('rejects an unknown email with 401', async () => {
    const res = await login('nobody@example.com', 'whatever');
    expect(res.status).toBe(401);
  });

  it('accepts the seeded organizer and sets an httpOnly cookie', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; organizer: { id: string; email: string } };
    expect(body.ok).toBe(true);
    expect(body.organizer.email).toBe(SEED_EMAIL);
    const setCookie = res.headers.get('Set-Cookie')!;
    expect(setCookie).toContain('cwb_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a cookie', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/auth/me`);
    expect(res.status).toBe(401);
  });

  it('returns 200 with a valid cookie', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { organizer: { email: string } };
    expect(body.organizer.email).toBe(SEED_EMAIL);
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the cookie (same-origin)', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: ORIGIN },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });

  it('rejects a cross-origin logout POST with 403 (CSRF defense)', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/auth/logout`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });
});

describe('requireSameOrigin (CSRF defense)', () => {
  it('blocks a cross-origin POST with 403', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/session/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ puzzleId: 'mini-ai' }),
    });
    expect(res.status).toBe(403);
  });

  it('blocks a POST with no Origin header with 403', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ puzzleId: 'mini-ai' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/puzzles', () => {
  it('requires auth', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/puzzles`);
    expect(res.status).toBe(401);
  });

  it('returns the 2 seeded presets with NO answer letters in the response', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/puzzles`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      puzzles: { id: string; name: string; tag: string; sub: string; rows: number; cols: number; owned: boolean }[];
    };
    const ids = body.puzzles.map((p) => p.id);
    expect(ids).toContain('mini-ai');
    expect(ids).toContain('mini-tech');
    // presets are not owned by this organizer
    for (const p of body.puzzles) {
      if (['mini-ai', 'mini-tech'].includes(p.id)) expect(p.owned).toBe(false);
      expect(typeof p.rows).toBe('number');
      expect(typeof p.cols).toBe('number');
    }
    // Anti-cheat: no answer letters anywhere. Assert known preset answers are
    // absent from the raw JSON, and there is no grid/across/answer key.
    const raw = JSON.stringify(body);
    for (const answer of ['MODEL', 'TOKEN', 'BOOTH', 'PRIZE', 'CACHE', 'DEBUG']) {
      expect(raw).not.toContain(answer);
    }
    expect(raw).not.toContain('grid');
    expect(raw).not.toContain('"across"');
    expect(raw).not.toContain('answer');
  });
});

describe('POST /api/puzzles', () => {
  it('rejects a clue that leaks its answer with 400', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/puzzles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({
        name: 'Leaky',
        words: [
          { answer: 'CAT', clue: 'A small CAT-like pet' },
          { answer: 'DOG', clue: 'A loyal companion' },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a non-array words payload with 400', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/puzzles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ name: 'NotArray', words: 'oops' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects more than 24 words with 400', async () => {
    const cookie = await loginCookie();
    const words = Array.from({ length: 25 }, (_v, i) => ({ answer: `WORD${i}`, clue: `Clue ${i}` }));
    const res = await SELF.fetch(`${ORIGIN}/api/puzzles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ name: 'TooMany', words }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an answer longer than 9 chars with 400', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/puzzles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ words: [{ answer: 'TENLETTERS', clue: 'A long one' }] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a clue longer than 120 chars with 400', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/puzzles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ words: [{ answer: 'CAT', clue: 'x'.repeat(121) }] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a puzzle name longer than 60 chars with 400', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/puzzles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ name: 'N'.repeat(61), words: [{ answer: 'CAT', clue: 'A pet' }] }),
    });
    expect(res.status).toBe(400);
  });

  it('builds and stores a puzzle from clean words', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/puzzles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({
        name: 'My Puzzle',
        words: [
          { answer: 'ALPHA', clue: 'First Greek letter' },
          { answer: 'PLANT', clue: 'It grows in soil' },
          { answer: 'TABLE', clue: 'You eat at it' },
          { answer: 'LEMON', clue: 'A sour yellow fruit' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; dropped: string[] };
    expect(typeof body.id).toBe('string');
    expect(Array.isArray(body.dropped)).toBe(true);
    // it should now appear in the owned list
    const list = await SELF.fetch(`${ORIGIN}/api/puzzles`, { headers: { Cookie: cookie } });
    const listBody = (await list.json()) as { puzzles: { id: string; owned: boolean }[] };
    const mine = listBody.puzzles.find((p) => p.id === body.id);
    expect(mine?.owned).toBe(true);
  });
});

describe('POST /api/session/create', () => {
  it('requires auth', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ puzzleId: 'mini-ai' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns a valid join code + host token, and stores only the token HASH', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ puzzleId: 'mini-ai', replace: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { joinCode: string; hostToken: string };
    // LLL-NNN with letters excluding I and O
    expect(body.joinCode).toMatch(/^[A-HJ-NP-Z]{3}-\d{3}$/);
    expect(body.hostToken).toMatch(/^[0-9a-f]{64}$/); // 32 bytes hex
    // The sessions row must store the HASH, never the raw token.
    const row = await env.DB.prepare(
      'SELECT host_token_hash, puzzle_id, config_json, status FROM sessions WHERE join_code = ?',
    )
      .bind(body.joinCode)
      .first<{ host_token_hash: string; puzzle_id: string; config_json: string; status: string }>();
    expect(row).not.toBeNull();
    expect(row!.host_token_hash).not.toBe(body.hostToken);
    expect(row!.host_token_hash).toMatch(/^[0-9a-f]{64}$/);
    // The stored value must be exactly sha256(rawToken) — load-bearing for Task 5.
    expect(row!.host_token_hash).toBe(await sha256Hex(body.hostToken));
    expect(row!.puzzle_id).toBe('mini-ai');
    expect(row!.status).toBe('new'); // created sessions start 'new' (one-active marker)
    // default config = medium difficulty, strictValidation true
    const config = JSON.parse(row!.config_json) as {
      difficulty: string;
      durationSec: number;
      strictValidation: boolean;
    };
    expect(config.difficulty).toBe('medium');
    expect(config.durationSec).toBe(240); // medium preset default (raised from 120)
    expect(config.strictValidation).toBe(true);
  });

  it('404s for an unknown puzzle', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ puzzleId: 'does-not-exist' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects an out-of-range config (negative durationSec) with 400', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ puzzleId: 'mini-ai', config: { durationSec: -5 } }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an over-max durationSec with 400 (never reaches D1)', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ puzzleId: 'mini-ai', config: { durationSec: 100000 } }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an out-of-range maxPlayers with 400', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ puzzleId: 'mini-ai', config: { maxPlayers: 1000 } }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/organizers', () => {
  it('creates a new organizer who can then log in', async () => {
    const cookie = await loginCookie();
    const email = `new-${Date.now()}@example.com`;
    const res = await SELF.fetch(`${ORIGIN}/api/organizers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ email, password: 'another-strong-pass' }),
    });
    expect(res.status).toBe(200);
    const loginRes = await login(email, 'another-strong-pass');
    expect(loginRes.status).toBe(200);
  });

  it('requires same-origin', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/organizers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ email: 'x@y.com', password: 'longenoughpass' }),
    });
    expect(res.status).toBe(403);
  });
});

// Sanity: the seed guard is per-isolate; presets/seed organizer exist regardless
// of which route triggered ensureSeed first.
beforeEach(() => {
  void env; // touch to keep the import meaningful across files
});

describe('GET /api/join/:code (public preflight)', () => {
  it('returns exists:false for a malformed code', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/join/not-a-code`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exists: false });
  });

  it('returns exists:false for a well-formed but unknown code', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/join/ZZZ-999`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exists: false });
  });

  it('returns exists:true for a created session, with no auth required', async () => {
    const cookie = await loginCookie();
    const cs = await SELF.fetch(`${ORIGIN}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ puzzleId: 'mini-ai', replace: true }),
    });
    expect(cs.status).toBe(200);
    const { joinCode } = (await cs.json()) as { joinCode: string };
    // No cookie on the preflight — it is intentionally public.
    const res = await SELF.fetch(`${ORIGIN}/api/join/${joinCode}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ exists: true });
  });
});
