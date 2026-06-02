import { describe, it, expect } from 'vitest';
import { buildPuzzle, generatePuzzle, toPublicPuzzle } from '@cwb/engine';
import {
  ClientMsg,
  ServerMsg,
  PublicPuzzleSchema,
  parseClientMsg,
  parseServerMsg,
} from '../src/messages';
import type { SessionConfig, PublicPlayer } from '../src/state';

// ---- fixtures ----
const config: SessionConfig = {
  puzzleId: 'p1',
  puzzleName: 'Test',
  difficulty: 'medium',
  durationSec: 120,
  hintPenalty: 10,
  wrongPenalty: 5,
  maxPlayers: 8,
  allowLate: false,
  strictValidation: true,
};

const player: PublicPlayer = {
  id: 'pl1',
  name: 'Ada',
  filledPct: 0.5,
  hintsUsed: 1,
  wrongAttempts: 0,
  finishMs: null,
  connected: true,
};

// A small valid crossword so toPublicPuzzle returns a real PublicPuzzle.
const puzzle = buildPuzzle({
  grid: [
    ['C', 'A', 'T'],
    ['A', null, null],
    ['R', null, null],
  ],
  clues: { 'across:1': 'Feline', 'down:1': 'Auto' },
});
const publicPuzzle = toPublicPuzzle(puzzle);

describe('ClientMsg', () => {
  const valid: unknown[] = [
    { t: 'hello', role: 'player', code: 'ABC-123', playerId: 'p1', name: 'Ada' },
    { t: 'hello', role: 'player', code: 'ABC-123' }, // player needs no hostToken
    { t: 'hello', role: 'host', code: 'ABC-123', hostToken: 'tok' },
    { t: 'hello', role: 'tv', code: 'ABC-123' },
    { t: 'join', name: 'Ada' },
    { t: 'progress', filledPct: 0.42 },
    { t: 'useHint', wordId: 'across:1' },
    { t: 'submit', entries: { '0,0': 'C', '0,1': 'A' } },
    { t: 'openLobby' },
    { t: 'startCountdown' },
    { t: 'pauseToggle' },
    { t: 'toggleLeaderboard' },
    { t: 'endRound' },
    { t: 'nextRound' },
    { t: 'markPrize' },
    { t: 'setConfig', patch: { durationSec: 90, allowLate: true } },
    { t: 'setConfig', patch: {} },
    { t: 'setPuzzle', puzzleId: 'p2' },
    { t: 'reset' },
    { t: 'endSession' },
  ];

  it.each(valid)('accepts a valid message: %o', (msg) => {
    expect(ClientMsg.safeParse(msg).success).toBe(true);
  });

  const invalid: unknown[] = [
    { t: 'hello', role: 'admin', code: 'x' }, // bad role
    { t: 'hello', role: 'player' }, // missing code
    { t: 'hello', role: 'host', code: 'ABC-123' }, // host without hostToken
    { t: 'hello', role: 'host', code: 'ABC-123', hostToken: '' }, // host with empty hostToken
    { t: 'join' }, // missing name
    { t: 'progress', filledPct: 'half' }, // wrong type
    { t: 'progress', filledPct: 1.5 }, // out of [0,1] range
    { t: 'progress', filledPct: -0.1 }, // out of [0,1] range
    { t: 'useHint' }, // missing wordId
    { t: 'useHint', wordId: 'sideways:1' }, // bad direction
    { t: 'useHint', wordId: 'across:' }, // missing number
    { t: 'submit', entries: { '0,0': 5 } }, // non-string entry
    { t: 'submit', entries: { 'bad-key': 'A' } }, // malformed cell key
    { t: 'submit', entries: { '0,0': 'AB' } }, // multi-char letter
    { t: 'submit', entries: { '0,0': 'a' } }, // lowercase letter
    { t: 'setConfig', patch: { durationSec: 'long' } }, // bad patch type
    { t: 'setPuzzle' }, // missing puzzleId
    { t: 'bogus' }, // unknown discriminator
    {}, // no t
  ];

  it.each(invalid)('rejects an invalid message: %o', (msg) => {
    expect(ClientMsg.safeParse(msg).success).toBe(false);
  });

  it('parseClientMsg returns a typed result', () => {
    const r = parseClientMsg({ t: 'join', name: 'Ada' });
    expect(r.success).toBe(true);
    if (r.success && r.data.t === 'join') expect(r.data.name).toBe('Ada');
  });
});

describe('ServerMsg', () => {
  const snapshot = {
    t: 'snapshot',
    phase: 'live',
    round: 1,
    joinCode: 'ABC-123',
    config,
    publicPuzzle,
    players: [player],
    startedAt: 1000,
    serverTime: 2000,
    countdownEndsAt: null,
    roundEndsAt: 122000,
    paused: false,
    showLeaderboard: true,
    prizeGiven: false,
    winner: null,
    commentary: null,
  };

  const valid: unknown[] = [
    snapshot,
    { ...snapshot, publicPuzzle: null, winner: player },
    { ...snapshot, paused: true },
    { t: 'identity', playerId: 'p1', rejoinSecret: 's1' },
    { t: 'hint', r: 0, c: 1, letter: 'A' },
    { t: 'wrong', wrongAttempts: 2, penaltySec: 5 },
    { t: 'incomplete', remainingCells: 3 },
    {
      t: 'finished',
      finishMs: 60000,
      score: { raw: 60, pen: 0, adj: 60, points: 1640 },
    },
    { t: 'error', code: 'NOPE', message: 'denied' },
  ];

  it.each(valid)('accepts a valid message', (msg) => {
    const res = ServerMsg.safeParse(msg);
    if (!res.success) console.error(res.error.issues);
    expect(res.success).toBe(true);
  });

  it('round-trips a snapshot built from a real toPublicPuzzle output', () => {
    const res = ServerMsg.safeParse(snapshot);
    expect(res.success).toBe(true);
    if (res.success && res.data.t === 'snapshot') {
      // publicPuzzle passes through unchanged, including engine-only cellToWord
      expect(res.data.publicPuzzle).toEqual(publicPuzzle);
      expect((res.data.publicPuzzle as { cellToWord: unknown }).cellToWord).toBeDefined();
    }
  });

  const invalid: unknown[] = [
    { ...snapshot, phase: 'paused' }, // not a valid Phase
    (() => { const { paused: _p, ...rest } = snapshot; return rest; })(), // snapshot missing paused
    { t: 'identity', playerId: 'p1' }, // identity missing rejoinSecret
    { t: 'identity' }, // missing playerId
    { t: 'hint', r: 0, c: 1 }, // missing letter
    { t: 'hint', r: 0, c: 1, letter: 'AB' }, // multi-char letter
    { t: 'hint', r: 0, c: 1, letter: 'a' }, // lowercase letter
    { t: 'wrong', wrongAttempts: 'two', penaltySec: 5 }, // wrong type
    { t: 'finished', finishMs: 1 }, // missing score
    { t: 'error', code: 'NOPE' }, // missing message
    { t: 'snapshot' }, // missing everything
  ];

  it.each(invalid)('rejects an invalid message', (msg) => {
    expect(ServerMsg.safeParse(msg).success).toBe(false);
  });

  it('parseServerMsg returns a typed result', () => {
    const r = parseServerMsg({ t: 'identity', playerId: 'p9', rejoinSecret: 's9' });
    expect(r.success).toBe(true);
    if (r.success && r.data.t === 'identity') {
      expect(r.data.playerId).toBe('p9');
      expect(r.data.rejoinSecret).toBe('s9');
    }
  });
});

// ---------------------------------------------------------------------------
// Fix 1 — hello accepts an optional rejoinSecret (private reattach credential).
// ---------------------------------------------------------------------------
describe('hello rejoinSecret (optional reattach credential)', () => {
  it('accepts a player hello carrying a rejoinSecret', () => {
    expect(
      ClientMsg.safeParse({
        t: 'hello',
        role: 'player',
        code: 'ABC-123',
        playerId: 'p1',
        rejoinSecret: 'sek',
      }).success,
    ).toBe(true);
  });

  it('still accepts a player hello with no rejoinSecret', () => {
    expect(
      ClientMsg.safeParse({ t: 'hello', role: 'player', code: 'ABC-123', playerId: 'p1' }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fix 4 — host hello requires a non-empty hostToken (enforced on the union).
// ---------------------------------------------------------------------------
describe('hello hostToken rule', () => {
  it('rejects a host hello with no hostToken', () => {
    expect(ClientMsg.safeParse({ t: 'hello', role: 'host', code: 'ABC-123' }).success).toBe(false);
  });

  it('rejects a host hello with an empty hostToken', () => {
    expect(
      ClientMsg.safeParse({ t: 'hello', role: 'host', code: 'ABC-123', hostToken: '' }).success,
    ).toBe(false);
  });

  it('accepts a host hello with a non-empty hostToken', () => {
    expect(
      ClientMsg.safeParse({ t: 'hello', role: 'host', code: 'ABC-123', hostToken: 'tok' }).success,
    ).toBe(true);
  });

  it('accepts a player hello with no hostToken', () => {
    expect(ClientMsg.safeParse({ t: 'hello', role: 'player', code: 'ABC-123' }).success).toBe(true);
  });

  it('accepts a tv hello with no hostToken', () => {
    expect(ClientMsg.safeParse({ t: 'hello', role: 'tv', code: 'ABC-123' }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fix 2 — strict PublicPuzzle schema: parses a real engine projection, and
// REJECTS any object that smuggles in answer-bearing keys (`grid`, `answer`).
// ---------------------------------------------------------------------------
describe('PublicPuzzleSchema (strict, anti-cheat)', () => {
  it('parses a real toPublicPuzzle(generatePuzzle(...)) output', () => {
    const res = generatePuzzle(
      [
        { answer: 'MODEL', clue: 'train it' },
        { answer: 'AGENT', clue: 'acts on its own' },
        { answer: 'DATA', clue: 'raw fuel' },
        { answer: 'TOKEN', clue: 'one chunk' },
        { answer: 'LOGIC', clue: 'reasoning' },
        { answer: 'LAYER', clue: 'one tier' },
      ],
      { seed: 7 },
    )!;
    const pp = toPublicPuzzle(res.puzzle);
    const parsed = PublicPuzzleSchema.safeParse(pp);
    if (!parsed.success) console.error(parsed.error.issues);
    expect(parsed.success).toBe(true);
  });

  it('parses the hand-built fixture projection', () => {
    expect(PublicPuzzleSchema.safeParse(publicPuzzle).success).toBe(true);
  });

  it('REJECTS an object that additionally carries a top-level `grid` key', () => {
    const withGrid = { ...publicPuzzle, grid: [['C', 'A', 'T']] };
    expect(PublicPuzzleSchema.safeParse(withGrid).success).toBe(false);
  });

  it('REJECTS an object whose word carries an `answer` key', () => {
    const leaked = {
      ...publicPuzzle,
      across: publicPuzzle.across.map((w) => ({ ...w, answer: 'CAT' })),
    };
    expect(PublicPuzzleSchema.safeParse(leaked).success).toBe(false);
  });

  it('REJECTS any other unknown top-level key', () => {
    const extra = { ...publicPuzzle, secret: 42 };
    expect(PublicPuzzleSchema.safeParse(extra).success).toBe(false);
  });
});
