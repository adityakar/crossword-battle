// history.test.ts — Task 8 "History surfacing". Inserts round_results rows
// directly into env.DB (winner / no-winner / older-but-still-today) and asserts
// the organizer GET /api/history aggregates + the public GET /api/history/public
// list. D1 rows are NOT rolled back between tests in this harness, so each test
// starts from a truncated round_results table (beforeEach below).
import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RankedPlayer } from '@cwb/shared';
import { scoreFor } from '@cwb/shared';

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

// History is now scoped PER-BOOTH (per organizer): /api/history joins
// round_results → sessions on join_code and filters by owner_id, and
// /api/history/public resolves ?prefix=PUB → owner. So a round only counts for
// the seed org if its join_code belongs to a session owned by the seed org.
// Look the seed org up once (login first so ensureSeed has created it).
let seedCache: { id: string; prefix: string } | null = null;
async function seed(): Promise<{ id: string; prefix: string }> {
  if (seedCache) return seedCache;
  await loginCookie(); // triggers ensureSeed (org + prefix)
  const row = await env.DB
    .prepare('SELECT id, prefix FROM organizers WHERE email = ?')
    .bind(SEED_EMAIL)
    .first<{ id: string; prefix: string }>();
  if (!row?.prefix) throw new Error('seed organizer / prefix not found');
  seedCache = { id: row.id, prefix: row.prefix };
  return seedCache;
}

// Ensure a session row owned by the seed org exists for `joinCode`, so the
// owner-scoped history join attributes the round to the seed org.
async function ensureSeedSession(joinCode: string): Promise<void> {
  const { id } = await seed();
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO sessions (join_code, owner_id, puzzle_id, config_json, round, status, host_token_hash, created_at)
       VALUES (?, ?, 'pz_test', '{}', 1, 'winner', 'h', ?)`,
    )
    .bind(joinCode, id, Date.now())
    .run();
}

// D1 rows persist across tests in this harness — start each test from a clean
// round_results table so counts/ordering are deterministic.
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM round_results').run();
});

const CFG = { hintPenalty: 5, wrongPenalty: 10 };

// Build a RankedPlayer leaderboard entry that carries finishMs/hints so the
// server's winnerEntry()/hintsNote() derivations have real data to read.
function entry(
  name: string,
  finishMs: number | null,
  hintsUsed: number,
  wrongAttempts: number,
  rank: number,
): RankedPlayer {
  const base = {
    id: `p_${name}`,
    name,
    filledPct: finishMs == null ? 0.5 : 1,
    hintsUsed,
    wrongAttempts,
    finishMs,
    connected: true,
  };
  return { ...base, score: scoreFor(base, CFG), rank };
}

let rrCounter = 0;
async function insertRound(opts: {
  endedAt: number;
  winner: { name: string; finishMs: number; hintsUsed: number; wrongAttempts: number } | null;
  others?: number; // extra non-finisher players in the leaderboard
}): Promise<void> {
  rrCounter++;
  const joinCode = `HST-${String(rrCounter).padStart(3, '0')}`;
  await ensureSeedSession(joinCode); // link this round to the seed org (owner-scoped history)
  const lb: RankedPlayer[] = [];
  let rank = 1;
  let winnerScoreJson: string | null = null;
  if (opts.winner) {
    const w = entry(opts.winner.name, opts.winner.finishMs, opts.winner.hintsUsed, opts.winner.wrongAttempts, rank++);
    lb.push(w);
    winnerScoreJson = JSON.stringify(w.score);
  }
  for (let i = 0; i < (opts.others ?? 0); i++) {
    lb.push(entry(`DNF${i}`, null, 0, 0, rank++));
  }
  await env.DB.prepare(
    `INSERT INTO round_results (id, join_code, round, winner_name, winner_score_json, leaderboard_json, started_at, ended_at)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
  )
    .bind(
      `rr_${rrCounter}_${crypto.randomUUID().slice(0, 8)}`,
      joinCode,
      opts.winner ? opts.winner.name : null,
      winnerScoreJson,
      JSON.stringify(lb),
      opts.endedAt - 60_000,
      opts.endedAt,
    )
    .run();
}

describe('GET /api/history (organizer)', () => {
  it('requires auth', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/history`);
    expect(res.status).toBe(401);
  });

  it('returns zeroed today + null lastWinner when no rounds exist', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/history`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      today: { rounds: number; players: number; winners: number };
      lastWinner: unknown;
    };
    expect(body.today).toEqual({ rounds: 0, players: 0, winners: 0 });
    expect(body.lastWinner).toBeNull();
  });

  it('aggregates today counts and surfaces the most recent winner', async () => {
    const cookie = await loginCookie();
    const now = Date.now();
    // Round A: a clean winner (no hints), 2 other DNF players → 3 in leaderboard.
    await insertRound({
      endedAt: now - 5_000,
      winner: { name: 'Priya Nair', finishMs: 72_000, hintsUsed: 0, wrongAttempts: 0 },
      others: 2,
    });
    // Round B (most recent): a winner with 1 hint, 1 other DNF → 2 in leaderboard.
    await insertRound({
      endedAt: now - 1_000,
      winner: { name: 'Sven Holt', finishMs: 88_000, hintsUsed: 1, wrongAttempts: 0 },
      others: 1,
    });
    // Round C: no winner (no finisher), 2 DNF → 2 in leaderboard, winners not counted.
    await insertRound({ endedAt: now - 3_000, winner: null, others: 2 });

    const res = await SELF.fetch(`${ORIGIN}/api/history`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      today: { rounds: number; players: number; winners: number };
      lastWinner: { name: string; time: string; hints: number } | null;
    };
    // 3 rounds; players = 3 + 2 + 2 = 7 player-rounds; winners = 2 (rounds A & B).
    expect(body.today.rounds).toBe(3);
    expect(body.today.players).toBe(7);
    expect(body.today.winners).toBe(2);
    // Most-recent winner is Round B (ended_at = now-1s).
    expect(body.lastWinner).not.toBeNull();
    expect(body.lastWinner!.name).toBe('Sven Holt');
    expect(body.lastWinner!.hints).toBe(1);
    expect(body.lastWinner!.time).toBe('1:28'); // fmtTime(88000/1000) = 1:28
  });

  it('excludes rounds older than UTC midnight from today counts', async () => {
    const cookie = await loginCookie();
    const now = Date.now();
    const startOfTodayUTC = Math.floor(now / 86_400_000) * 86_400_000;
    // One round inside today, one a full day before midnight.
    await insertRound({
      endedAt: now,
      winner: { name: 'Today Tom', finishMs: 60_000, hintsUsed: 0, wrongAttempts: 0 },
      others: 1,
    });
    await insertRound({
      endedAt: startOfTodayUTC - 3_600_000,
      winner: { name: 'Yesterday Yan', finishMs: 60_000, hintsUsed: 0, wrongAttempts: 0 },
      others: 1,
    });

    const res = await SELF.fetch(`${ORIGIN}/api/history`, { headers: { Cookie: cookie } });
    const body = (await res.json()) as { today: { rounds: number } };
    // Only the in-today round counts.
    expect(body.today.rounds).toBe(1);
  });
});

describe('GET /api/history/public (display)', () => {
  it('is public (no auth) and returns an empty list when no winners exist', async () => {
    const { prefix } = await seed();
    const res = await SELF.fetch(`${ORIGIN}/api/history/public?prefix=${prefix}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recentWinners: unknown[] };
    expect(body.recentWinners).toEqual([]);
  });

  it('returns an empty list for a missing or unknown prefix', async () => {
    const noPrefix = await SELF.fetch(`${ORIGIN}/api/history/public`);
    expect(((await noPrefix.json()) as { recentWinners: unknown[] }).recentWinners).toEqual([]);
    const unknown = await SELF.fetch(`${ORIGIN}/api/history/public?prefix=ZZZ`);
    expect(((await unknown.json()) as { recentWinners: unknown[] }).recentWinners).toEqual([]);
  });

  it('returns recent winners (most-recent first) with formatted note chips', async () => {
    const now = Date.now();
    await insertRound({
      endedAt: now - 10_000,
      winner: { name: 'Maya Okafor', finishMs: 94_000, hintsUsed: 2, wrongAttempts: 0 },
      others: 1,
    });
    await insertRound({
      endedAt: now - 2_000,
      winner: { name: 'Sven Holt', finishMs: 88_000, hintsUsed: 0, wrongAttempts: 1 },
      others: 0,
    });
    // A winnerless round must NOT appear in the list.
    await insertRound({ endedAt: now - 1_000, winner: null, others: 2 });

    const { prefix } = await seed();
    const res = await SELF.fetch(`${ORIGIN}/api/history/public?prefix=${prefix}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      recentWinners: { name: string; time: string; note: string }[];
    };
    expect(body.recentWinners).toHaveLength(2);
    // Most-recent first: Sven (now-2s) then Maya (now-10s).
    expect(body.recentWinners[0]!.name).toBe('Sven Holt');
    expect(body.recentWinners[0]!.time).toBe('1:28'); // 88000/1000 → 1:28
    // hintsUsed 0 → 'clean' even though a wrong-answer penalty exists.
    expect(body.recentWinners[0]!.note).toBe('clean');
    expect(body.recentWinners[1]!.name).toBe('Maya Okafor');
    expect(body.recentWinners[1]!.note).toBe('2 hint(s)');
  });
});
