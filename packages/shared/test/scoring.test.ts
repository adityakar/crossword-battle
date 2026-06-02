import { describe, it, expect } from 'vitest';
import { scoreFor, rankPlayers, topScores } from '../src/scoring';
import type { PublicPlayer } from '../src/state';

const cfg = { hintPenalty: 10, wrongPenalty: 5 };

describe('scoreFor', () => {
  it('matches the prototype formula for a known input', () => {
    // raw = 72000/1000 = 72; pen = 1*10 + 0*5 = 10; adj = 82
    // points = max(100, round(2000 - 82*6)) = max(100, round(1508)) = 1508
    const s = scoreFor({ finishMs: 72000, hintsUsed: 1, wrongAttempts: 0 }, cfg);
    expect(s).not.toBeNull();
    expect(s!.raw).toBe(72);
    expect(s!.pen).toBe(10);
    expect(s!.adj).toBe(82);
    expect(s!.points).toBe(1508);
  });

  it('floors points at 100 for very slow / penalised solves', () => {
    // adj huge => 2000 - adj*6 < 100 => clamps to 100
    const s = scoreFor({ finishMs: 600000, hintsUsed: 20, wrongAttempts: 20 }, cfg);
    expect(s!.points).toBe(100);
  });

  it('returns null when finishMs is null', () => {
    expect(scoreFor({ finishMs: null, hintsUsed: 0, wrongAttempts: 0 }, cfg)).toBeNull();
  });
});

function player(over: Partial<PublicPlayer>): PublicPlayer {
  return {
    id: 'x',
    name: 'X',
    filledPct: 0,
    hintsUsed: 0,
    wrongAttempts: 0,
    finishMs: null,
    connected: true,
    ...over,
  };
}

describe('rankPlayers', () => {
  it('orders finishers by adj ascending', () => {
    const fast = player({ id: 'fast', name: 'Fast', finishMs: 60000 }); // adj 60
    const slow = player({ id: 'slow', name: 'Slow', finishMs: 90000 }); // adj 90
    const r = rankPlayers([slow, fast], cfg);
    expect(r.map((p) => p.id)).toEqual(['fast', 'slow']);
    expect(r[0]!.rank).toBe(1);
    expect(r[1]!.rank).toBe(2);
  });

  it('penalties affect finisher ordering via adj', () => {
    // a finishes earlier in ms but has heavy penalties -> higher adj -> ranks lower
    const a = player({ id: 'a', finishMs: 60000, hintsUsed: 5 }); // adj 60 + 50 = 110
    const b = player({ id: 'b', finishMs: 80000 }); // adj 80
    const r = rankPlayers([a, b], cfg);
    expect(r.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('ranks non-finishers by filledPct descending, all below finishers', () => {
    const finisher = player({ id: 'fin', finishMs: 100000 });
    const high = player({ id: 'high', filledPct: 0.8 });
    const low = player({ id: 'low', filledPct: 0.2 });
    const r = rankPlayers([low, high, finisher], cfg);
    expect(r.map((p) => p.id)).toEqual(['fin', 'high', 'low']);
    expect(r.map((p) => p.rank)).toEqual([1, 2, 3]);
  });

  it('assigns a score to finishers and null to non-finishers', () => {
    const finisher = player({ id: 'fin', finishMs: 60000 });
    const dnf = player({ id: 'dnf', filledPct: 0.5 });
    const r = rankPlayers([finisher, dnf], cfg);
    expect(r[0]!.score).not.toBeNull();
    expect(r[1]!.score).toBeNull();
  });

  describe('deterministic tie-breaks', () => {
    it('breaks an equal-adj finisher tie by lower raw, then hints, wrong, id', () => {
      // All four have adj === 100, achieved different ways:
      //  - raw100: raw 100, 0 hints, 0 wrong  (lowest raw → rank 1)
      //  - rawA:   raw 90 + 1 hint(10)         (raw 90, 1 hint)
      //  - rawB:   raw 90 + 1 hint(10)         (raw 90, 1 hint) — ties rawA on raw+hints+wrong → id breaks
      //  - rawC:   raw 80 + 2 hints(20)        (raw 80 → ranks ahead of the raw-90 pair)
      const cfg2 = { hintPenalty: 10, wrongPenalty: 5 };
      const raw100 = player({ id: 'm_raw100', finishMs: 100000 }); // adj 100, raw 100
      const rawA = player({ id: 'b_rawA', finishMs: 90000, hintsUsed: 1 }); // adj 100, raw 90
      const rawB = player({ id: 'a_rawB', finishMs: 90000, hintsUsed: 1 }); // adj 100, raw 90 (id < rawA)
      const rawC = player({ id: 'z_rawC', finishMs: 80000, hintsUsed: 2 }); // adj 100, raw 80
      // All confirm adj == 100.
      for (const p of [raw100, rawA, rawB, rawC]) {
        expect(scoreFor(p, cfg2)!.adj).toBe(100);
      }
      const r = rankPlayers([raw100, rawA, rawB, rawC], cfg2);
      // raw 80 first, then the raw-90 pair (id lexicographic), then raw 100.
      expect(r.map((p) => p.id)).toEqual(['z_rawC', 'a_rawB', 'b_rawA', 'm_raw100']);
    });

    it('is stable regardless of input order (identical inputs → identical order)', () => {
      const a = player({ id: 'a', finishMs: 90000, hintsUsed: 1 });
      const b = player({ id: 'b', finishMs: 90000, hintsUsed: 1 });
      const c = player({ id: 'c', finishMs: 90000, hintsUsed: 1 });
      const order1 = rankPlayers([a, b, c], cfg).map((p) => p.id);
      const order2 = rankPlayers([c, b, a], cfg).map((p) => p.id);
      const order3 = rankPlayers([b, a, c], cfg).map((p) => p.id);
      expect(order1).toEqual(['a', 'b', 'c']);
      expect(order2).toEqual(['a', 'b', 'c']);
      expect(order3).toEqual(['a', 'b', 'c']);
    });

    it('breaks equal-filledPct non-finisher ties by id lexicographic', () => {
      const x = player({ id: 'x', filledPct: 0.5 });
      const y = player({ id: 'y', filledPct: 0.5 });
      const z = player({ id: 'z', filledPct: 0.5 });
      expect(rankPlayers([z, y, x], cfg).map((p) => p.id)).toEqual(['x', 'y', 'z']);
    });
  });

  describe('stableUnfinished option (live boards)', () => {
    it('preserves the input (join) order for non-finishers, ignoring filledPct, when set', () => {
      const finisher = player({ id: 'fin', finishMs: 100000 });
      const high = player({ id: 'zzz', filledPct: 0.9 });
      const low = player({ id: 'aaa', filledPct: 0.1 });
      // Input (join) order: high, finisher, low. The finisher floats up; the two
      // non-finishers keep their INPUT order (high before low) — NOT id order
      // (which would put 'aaa' first) and NOT filledPct order.
      const r = rankPlayers([high, finisher, low], cfg, { stableUnfinished: true });
      expect(r.map((p) => p.id)).toEqual(['fin', 'zzz', 'aaa']);
    });

    it('a late joiner appends at the bottom (does not cut in by random id)', () => {
      // 'p_zzz' joined first; 'p_aaa' joined later (its random id sorts lower).
      const first = player({ id: 'p_zzz', filledPct: 0.5 });
      const late = player({ id: 'p_aaa', filledPct: 0.5 });
      const r = rankPlayers([first, late], cfg, { stableUnfinished: true });
      // Join order is preserved → the late joiner stays at the bottom, NOT
      // reshuffled to ['p_aaa', 'p_zzz'] by id.
      expect(r.map((p) => p.id)).toEqual(['p_zzz', 'p_aaa']);
    });

    it('default (no opts) still orders non-finishers by filledPct descending', () => {
      const highPct = player({ id: 'zzz', filledPct: 0.9 });
      const lowPct = player({ id: 'aaa', filledPct: 0.1 });
      expect(rankPlayers([lowPct, highPct], cfg).map((p) => p.id)).toEqual(['zzz', 'aaa']);
    });
  });
});

describe('topScores', () => {
  // A finished RankedPlayer (carries a real score) with the given finish/penalties.
  const fin = (id: string, finishMs: number, hintsUsed = 0, wrongAttempts = 0) =>
    rankPlayers([player({ id, name: id, finishMs, hintsUsed, wrongAttempts })], cfg)[0]!;

  it('ranks by points desc and reassigns 1-based rank', () => {
    const fast = fin('fast', 60000); // adj 60 → points 1640
    const slow = fin('slow', 120000); // adj 120 → points 1280
    const r = topScores([slow, fast], 10);
    expect(r.map((e) => e.name)).toEqual(['fast', 'slow']);
    expect(r.map((e) => e.rank)).toEqual([1, 2]);
    expect(r[0]!.points).toBeGreaterThan(r[1]!.points);
  });

  it('excludes non-finishers (score == null)', () => {
    const finr = fin('f', 60000);
    const dnf = rankPlayers([player({ id: 'd', name: 'd', filledPct: 0.9 })], cfg)[0]!;
    const r = topScores([finr, dnf], 10);
    expect(r.map((e) => e.name)).toEqual(['f']);
  });

  it('flattens entries across multiple rounds', () => {
    const round1 = [fin('a', 60000), fin('b', 90000)];
    const round2 = [fin('c', 70000)];
    const r = topScores([...round1, ...round2], 10);
    expect(r.map((e) => e.name)).toEqual(['a', 'c', 'b']); // 60s, 70s, 90s
  });

  it('caps at the limit', () => {
    const many = Array.from({ length: 15 }, (_, i) => fin(`p${i}`, 60000 + i * 1000));
    expect(topScores(many, 10)).toHaveLength(10);
  });

  it('tie-breaks equal points by adj asc (F4)', () => {
    // Two solves slow enough to floor to 100 points but with different adj — lower adj ranks first.
    const lowAdj = fin('low', 320000); // adj 320 → points 100
    const hiAdj = fin('high', 340000); // adj 340 → points 100
    expect(lowAdj.score!.points).toBe(100);
    expect(hiAdj.score!.points).toBe(100);
    const r = topScores([hiAdj, lowAdj], 10);
    expect(r.map((e) => e.name)).toEqual(['low', 'high']);
  });

  it('returns [] for empty input', () => {
    expect(topScores([], 10)).toEqual([]);
  });

  it('skips null/garbage entries without throwing', () => {
    const good = fin('ok', 60000);
    const garbage = [null, undefined, { name: 'no-score' }, { name: 'bad', score: 5 }, good];
    const r = topScores(garbage as unknown as Parameters<typeof topScores>[0], 10);
    expect(r.map((e) => e.name)).toEqual(['ok']);
  });
});
