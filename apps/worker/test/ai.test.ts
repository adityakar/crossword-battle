import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { clueLeaksAnswer, generatePuzzle } from '@cwb/engine';
import {
  FALLBACK_ENTRIES,
  fallbackWinnerLine,
  parseCommentary,
  parseDraftResponse,
  winnerCommentary,
} from '../src/ai';
import type { Env } from '../src/index';

const ORIGIN = 'https://cwb.test';
const SEED_EMAIL = 'seed@example.com';
const SEED_PASSWORD = 'seed-password-123';

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('Set-Cookie');
  if (!setCookie) throw new Error('no Set-Cookie header');
  return setCookie.split(';')[0]!;
}

async function loginCookie(): Promise<string> {
  const res = await SELF.fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return cookieFrom(res);
}

// ---------------------------------------------------------------------------
// parseDraftResponse — the defensive parser, in isolation (no live endpoint).
// ---------------------------------------------------------------------------
describe('parseDraftResponse', () => {
  it('parses a clean raw JSON array', () => {
    const raw = '[{"answer":"MODEL","clue":"What you train on data"},{"answer":"AGENT","clue":"Autonomous AI doer"}]';
    const out = parseDraftResponse(raw, 6);
    expect(out).toEqual([
      { answer: 'MODEL', clue: 'What you train on data' },
      { answer: 'AGENT', clue: 'Autonomous AI doer' },
    ]);
  });

  it('extracts JSON wrapped in code fences', () => {
    const raw = '```json\n[{"answer":"DATA","clue":"Raw fuel"},{"answer":"NODE","clue":"A network point"}]\n```';
    const out = parseDraftResponse(raw, 6);
    expect(out).toHaveLength(2);
    expect(out![0]!.answer).toBe('DATA');
  });

  it('extracts JSON wrapped in surrounding prose', () => {
    const raw =
      'Sure! Here are your entries:\n[{"answer":"LOGIC","clue":"Sound reasoning"},{"answer":"LAYER","clue":"One tier"}]\nHope that helps.';
    const out = parseDraftResponse(raw, 6);
    expect(out).toHaveLength(2);
    expect(out!.map((e) => e.answer)).toEqual(['LOGIC', 'LAYER']);
  });

  it('strips punctuation/spaces and uppercases answers', () => {
    const raw = '[{"answer":"a-rr.ay","clue":"Ordered list"},{"answer":"to ken","clue":"A chunk"}]';
    const out = parseDraftResponse(raw, 6);
    expect(out).toEqual([
      { answer: 'ARRAY', clue: 'Ordered list' },
      { answer: 'TOKEN', clue: 'A chunk' },
    ]);
  });

  it('drops entries whose clue leaks its own answer', () => {
    const raw =
      '[{"answer":"CACHE","clue":"A fast CACHE of data"},{"answer":"QUERY","clue":"A database request"},{"answer":"LAYER","clue":"One tier"}]';
    const out = parseDraftResponse(raw, 6);
    expect(out).toEqual([
      { answer: 'QUERY', clue: 'A database request' },
      { answer: 'LAYER', clue: 'One tier' },
    ]);
  });

  it('drops answers outside 3-7 letters', () => {
    const raw =
      '[{"answer":"AI","clue":"Too short"},{"answer":"SUPERCALIFRAG","clue":"Too long"},{"answer":"MODEL","clue":"Trained thing"},{"answer":"AGENT","clue":"A doer"}]';
    const out = parseDraftResponse(raw, 6);
    expect(out).toEqual([
      { answer: 'MODEL', clue: 'Trained thing' },
      { answer: 'AGENT', clue: 'A doer' },
    ]);
  });

  it('dedupes repeated answers', () => {
    const raw =
      '[{"answer":"MODEL","clue":"First clue"},{"answer":"MODEL","clue":"Second clue"},{"answer":"AGENT","clue":"A doer"}]';
    const out = parseDraftResponse(raw, 6);
    expect(out).toEqual([
      { answer: 'MODEL', clue: 'First clue' },
      { answer: 'AGENT', clue: 'A doer' },
    ]);
  });

  it('caps the number of entries at count', () => {
    const raw =
      '[{"answer":"MODEL","clue":"a"},{"answer":"AGENT","clue":"b"},{"answer":"TOKEN","clue":"c"},{"answer":"LAYER","clue":"d"}]';
    const out = parseDraftResponse(raw, 2);
    expect(out).toHaveLength(2);
  });

  it('returns null when fewer than 2 valid entries survive (route can fall back)', () => {
    expect(parseDraftResponse('[{"answer":"MODEL","clue":"only one"}]', 6)).toBeNull();
    // After dropping the leaking CACHE clue only AGENT survives (1 < 2) → null.
    expect(
      parseDraftResponse('[{"answer":"CACHE","clue":"a CACHE leak"},{"answer":"AGENT","clue":"doer"}]', 6),
    ).toBeNull();
  });

  it('returns null on non-JSON / no array', () => {
    expect(parseDraftResponse('no json here at all', 6)).toBeNull();
    expect(parseDraftResponse('[not, valid, json', 6)).toBeNull();
    expect(parseDraftResponse('', 6)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FALLBACK_ENTRIES — the offline guarantee: they must build a grid and be
// clue-leak clean (so a user clicking "Use This Puzzle" offline succeeds).
// ---------------------------------------------------------------------------
describe('FALLBACK_ENTRIES', () => {
  it('interlock into a buildable grid at min (4) and a larger (6) count', () => {
    const four = generatePuzzle(FALLBACK_ENTRIES.slice(0, 4), {});
    const six = generatePuzzle(FALLBACK_ENTRIES.slice(0, 6), {});
    expect(four).not.toBeNull();
    expect(four!.placed.length).toBeGreaterThanOrEqual(2);
    expect(six).not.toBeNull();
    expect(six!.placed.length).toBeGreaterThanOrEqual(2);
  });

  it('have no clue that leaks its own answer (survives the /api/puzzles guard)', () => {
    for (const e of FALLBACK_ENTRIES) {
      expect(clueLeaksAnswer(e.answer, e.clue)).toBe(false);
      expect(e.answer).toMatch(/^[A-Z]{3,7}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Route — POST /api/ai/draft-words. The test pool has no OPENROUTER_API_KEY, so
// `draftWords` short-circuits to the curated fallback. Either way the contract
// holds: 200 + a non-empty entries array of valid word/clue pairs.
// ---------------------------------------------------------------------------
describe('POST /api/ai/draft-words', () => {
  it('requires auth', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/ai/draft-words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify({ topic: 'machine learning', count: 6 }),
    });
    expect(res.status).toBe(401);
  });

  it('requires same-origin', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/ai/draft-words`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        Origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ topic: 'machine learning', count: 6 }),
    });
    expect(res.status).toBe(403);
  });

  it('400s when topic is missing', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/ai/draft-words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ count: 6 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 with a non-empty entries array (live AI or fallback)', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/ai/draft-words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ topic: 'machine learning', count: 6 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: { answer: string; clue: string }[];
      source: 'ai' | 'fallback';
    };
    expect(['ai', 'fallback']).toContain(body.source);
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length).toBeGreaterThanOrEqual(2);
    for (const e of body.entries) {
      expect(e.answer).toMatch(/^[A-Z]{3,7}$/);
      expect(e.clue.length).toBeGreaterThan(0);
      // anti-cheat: a drafted clue never contains its own answer
      expect(e.clue.toUpperCase().includes(e.answer)).toBe(false);
    }
  });

  it('clamps count into 4-10', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/ai/draft-words`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ topic: 'machine learning', count: 99 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries.length).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Winner commentary — the deterministic fallback, the defensive parser, and the
// no-key path (which keeps the fallback). The live AI path is exercised manually.
// ---------------------------------------------------------------------------
describe('fallbackWinnerLine', () => {
  const base = { name: 'Ada', puzzleName: 'Mini AI' };
  it('clean solve (no hints, no misses) includes the time', () => {
    const line = fallbackWinnerLine({ ...base, time: '1:23', hintsUsed: 0, wrongAttempts: 0 });
    expect(line).toContain('1:23');
    expect(line.length).toBeGreaterThan(0);
  });
  it('with hints is the assistant branch (includes the time)', () => {
    const line = fallbackWinnerLine({ ...base, time: '2:00', hintsUsed: 2, wrongAttempts: 0 });
    expect(line).toContain('2:00');
  });
  it('with wrongs but no hints is the steady-hands branch', () => {
    const line = fallbackWinnerLine({ ...base, time: '0:45', hintsUsed: 0, wrongAttempts: 3 });
    expect(line).toContain('0:45');
  });
  it('never wraps the line in quotes (the surfaces add their own)', () => {
    const line = fallbackWinnerLine({ ...base, time: '1:00', hintsUsed: 0, wrongAttempts: 0 });
    expect(line.startsWith('"')).toBe(false);
    expect(line.endsWith('"')).toBe(false);
  });
});

describe('parseCommentary', () => {
  it('returns a clean one-liner unchanged', () => {
    expect(parseCommentary('Ada blazed through that grid.')).toBe('Ada blazed through that grid.');
  });
  it('strips wrapping straight quotes', () => {
    expect(parseCommentary('"Ada blazed through."')).toBe('Ada blazed through.');
  });
  it('strips wrapping smart quotes', () => {
    expect(parseCommentary('“Ada wins it.”')).toBe('Ada wins it.');
  });
  it('strips code fences and takes the first non-empty line', () => {
    expect(parseCommentary('```\nAda wins it.\n```')).toBe('Ada wins it.');
  });
  it('caps very long output at 240 chars', () => {
    const out = parseCommentary('x'.repeat(500));
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(240);
  });
  it('returns null on empty / blank input', () => {
    expect(parseCommentary('')).toBeNull();
    expect(parseCommentary('   \n  ')).toBeNull();
  });
});

describe('winnerCommentary', () => {
  it('returns null (keep the fallback) when no API key is configured', async () => {
    // No fetch is made: with an empty key the function short-circuits to null so
    // the caller keeps the deterministic fallback (this is the test-pool path).
    const env = { OPENROUTER_API_KEY: '', AI_MODEL: 'test' } as unknown as Env;
    const out = await winnerCommentary(
      env,
      { name: 'Ada', time: '1:00', hintsUsed: 0, wrongAttempts: 0, puzzleName: 'Mini' },
      'dry, confident',
    );
    expect(out).toBeNull();
  });
});
