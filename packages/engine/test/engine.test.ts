import { describe, it, expect } from 'vitest';
import {
  buildPuzzle,
  generatePuzzle,
  clueLeaksAnswer,
  rngFrom,
  toPublicPuzzle,
  validateSolution,
  solutionAt,
  progressFilled,
  pIsBlock,
  pWordAt,
  pDirFor,
  pStep,
  firstSel,
} from '../src/index';
import type { Grid, Puzzle } from '../src/index';

const B = null;

// ---------------------------------------------------------------------------
// Hand-verified 5x5 fixture.
//
//   C A T . .
//   O . O . .
//   D A T A .
//   E . E . .
//   . . M . .
//
// Across: CAT (1), DATA (3).  Down: CODE (1), TOTEM (2).
// Numbering rule: a cell is numbered iff it starts an across run
// (left edge/block AND right open) OR a down run (top edge/block AND below open),
// assigned in row-major order. Hand-verified → {0,0:1, 0,2:2, 2,0:3}.
// ---------------------------------------------------------------------------
const FIXTURE_GRID: Grid = [
  ['C', 'A', 'T', B, B],
  ['O', B, 'O', B, B],
  ['D', 'A', 'T', 'A', B],
  ['E', B, 'E', B, B],
  [B, B, 'M', B, B],
];

function buildFixture(): Puzzle {
  return buildPuzzle({
    grid: FIXTURE_GRID,
    clues: {
      CAT: 'Feline pet',
      DATA: 'Raw fuel for models',
      CODE: 'What devs write',
      TOTEM: 'Symbolic pole',
    },
    name: 'Fixture',
  });
}

describe('rngFrom', () => {
  it('is a deterministic xorshift producing values in [0,1)', () => {
    const a = rngFrom(7);
    const b = rngFrom(7);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = rngFrom(7);
    const b = rngFrom(8);
    expect([a(), a(), a()]).not.toEqual([b(), b(), b()]);
  });

  it('matches the prototype xorshift formula exactly (pins seed stability)', () => {
    // Hardcoded so a silent change to the xorshift math is caught — preset seeds
    // (mini-ai:7, mini-tech:23) depend on this exact sequence.
    const r = rngFrom(7);
    expect([r(), r(), r()]).toEqual([0.92583, 0.89255, 0.05507]);
  });
});

describe('buildPuzzle numbering', () => {
  it('matches the hand-verified fixture numbering', () => {
    const p = buildFixture();
    expect(p.numbers).toEqual({ '0,0': 1, '0,2': 2, '2,0': 3 });
  });

  it('derives the correct across/down words and answers', () => {
    const p = buildFixture();
    const across = p.across.map((w) => w.answer).sort();
    const down = p.down.map((w) => w.answer).sort();
    expect(across).toEqual(['CAT', 'DATA']);
    expect(down).toEqual(['CODE', 'TOTEM']);
    // numbers attach to the starting cell of each word
    const cat = p.across.find((w) => w.answer === 'CAT')!;
    const data = p.across.find((w) => w.answer === 'DATA')!;
    const code = p.down.find((w) => w.answer === 'CODE')!;
    const totem = p.down.find((w) => w.answer === 'TOTEM')!;
    expect(cat.num).toBe(1);
    expect(data.num).toBe(3);
    expect(code.num).toBe(1);
    expect(totem.num).toBe(2);
    // clues attach by answer
    expect(cat.clue).toBe('Feline pet');
    expect(totem.clue).toBe('Symbolic pole');
  });

  it('computes fill, cellCount, rows, cols', () => {
    const p = buildFixture();
    expect(p.rows).toBe(5);
    expect(p.cols).toBe(5);
    // count of non-null cells
    let count = 0;
    for (const row of FIXTURE_GRID) for (const cell of row) if (cell != null) count++;
    expect(p.cellCount).toBe(count);
    expect(p.fill.length).toBe(count);
  });

  it('builds cellToWord index pointing into across/down arrays', () => {
    const p = buildFixture();
    // (2,2) 'T' is the crossing of DATA (across) and TOTEM (down)
    const ref = p.cellToWord['2,2'];
    expect(ref).toBeTruthy();
    expect(p.across[ref!.across!]!.answer).toBe('DATA');
    expect(p.down[ref!.down!]!.answer).toBe('TOTEM');
  });
});

describe('generatePuzzle — interlocking', () => {
  const ENTRIES = [
    { answer: 'MODEL', clue: 'What you train' },
    { answer: 'AGENT', clue: 'Autonomous AI' },
    { answer: 'DATA', clue: 'Raw fuel' },
    { answer: 'TOKEN', clue: 'Chunk of text' },
    { answer: 'LOGIC', clue: 'Sound reasoning' },
    { answer: 'LAYER', clue: 'Tier of a net' },
  ];

  it('returns a Puzzle whose grid round-trips to a valid interlocked word set', () => {
    const res = generatePuzzle(ENTRIES, { seed: 7 });
    expect(res).not.toBeNull();
    const { puzzle, placed, dropped } = res!;

    // Re-derive words from the produced grid via buildPuzzle.
    const rebuilt = buildPuzzle({ grid: puzzle.grid });
    const derivedWords = [
      ...rebuilt.across.map((w) => w.answer),
      ...rebuilt.down.map((w) => w.answer),
    ].sort();

    // Every word in the grid must be one of the intended answers (no junk runs
    // = no illegal adjacency producing unexpected words), and must be a *placed*
    // word, not a dropped one.
    const intended = new Set(ENTRIES.map((e) => e.answer));
    for (const w of derivedWords) {
      expect(intended.has(w)).toBe(true);
      expect(dropped).not.toContain(w);
    }
    // The set of grid words equals the placed set.
    expect(derivedWords).toEqual([...placed].sort());
    // Sanity: at least the longest-first interlock placed several words.
    expect(placed.length).toBeGreaterThanOrEqual(4);
  });

  it('reports words that cannot interlock in dropped, not placed', () => {
    // ZZZZZ shares no letters with the others → cannot interlock.
    const res = generatePuzzle(
      [
        { answer: 'MODEL', clue: 'a' },
        { answer: 'AGENT', clue: 'b' },
        { answer: 'TOKEN', clue: 'c' },
        { answer: 'ZZZZZ', clue: 'unrelated' },
      ],
      { seed: 3 },
    );
    expect(res).not.toBeNull();
    const { placed, dropped, puzzle } = res!;
    expect(dropped).toContain('ZZZZZ');
    expect(placed).not.toContain('ZZZZZ');
    // ZZZZZ must not appear in the grid at all.
    const rebuilt = buildPuzzle({ grid: puzzle.grid });
    const words = [...rebuilt.across, ...rebuilt.down].map((w) => w.answer);
    expect(words).not.toContain('ZZZZZ');
  });

  it('keeps maxDim <= 11', () => {
    const res = generatePuzzle(ENTRIES, { seed: 7 });
    expect(res).not.toBeNull();
    expect(Math.max(res!.puzzle.rows, res!.puzzle.cols)).toBeLessThanOrEqual(11);
  });

  it('rejects a layout that cannot fit under maxDim 11 (single 12-letter word)', () => {
    const res = generatePuzzle([{ answer: 'ABCDEFGHIJKL', clue: 'twelve letters' }], { seed: 1 });
    expect(res).toBeNull();
  });

  it('returns null when there are no valid entries', () => {
    expect(generatePuzzle([], {})).toBeNull();
    expect(generatePuzzle([{ answer: 'A', clue: 'too short' }], {})).toBeNull();
  });

  it('dedupes repeated answers', () => {
    const res = generatePuzzle(
      [
        { answer: 'DATA', clue: 'first' },
        { answer: 'data', clue: 'dup (case-folded)' },
        { answer: 'CODE', clue: 'second' },
      ],
      { seed: 9 },
    );
    expect(res).not.toBeNull();
    const all = [...res!.placed, ...res!.dropped];
    expect(all.filter((w) => w === 'DATA').length).toBe(1);
  });
});

describe('generatePuzzle — determinism', () => {
  const ENTRIES = [
    { answer: 'MODEL', clue: 'a' },
    { answer: 'AGENT', clue: 'b' },
    { answer: 'DATA', clue: 'c' },
    { answer: 'TOKEN', clue: 'd' },
    { answer: 'LOGIC', clue: 'e' },
    { answer: 'LAYER', clue: 'f' },
  ];

  it('same seed → deep-equal grids', () => {
    const a = generatePuzzle(ENTRIES, { seed: 7 })!;
    const b = generatePuzzle(ENTRIES, { seed: 7 })!;
    expect(a.puzzle.grid).toEqual(b.puzzle.grid);
    expect(a.puzzle.rows).toBe(b.puzzle.rows);
    expect(a.puzzle.cols).toBe(b.puzzle.cols);
    expect(a.puzzle.numbers).toEqual(b.puzzle.numbers);
    expect(a.placed).toEqual(b.placed);
    expect(a.dropped).toEqual(b.dropped);
  });

  // The three canonical preset seed-sets (prototype PRESET_DEFS) — these exact
  // inputs are seeded to D1 in Task 4, so the engine must lay them out stably
  // under the phone-friendly dimension cap. Regression coverage of real data.
  it('lays out all three canonical presets stably under maxDim 11', () => {
    const presets = [
      { seed: 7, minPlaced: 5, words: ['MODEL', 'AGENT', 'DATA', 'TOKEN', 'LOGIC', 'LAYER'] },
      { seed: 23, minPlaced: 5, words: ['CACHE', 'ARRAY', 'QUERY', 'DEBUG', 'LOOP', 'BYTE'] },
      { seed: 41, minPlaced: 6, words: ['BOOTH', 'BADGE', 'DEMO', 'PRIZE', 'SCAN', 'EXPO'] },
    ];
    for (const { seed, words, minPlaced } of presets) {
      const res = generatePuzzle(
        words.map((w) => ({ answer: w, clue: `clue for ${w}` })),
        { seed },
      );
      expect(res, `preset seed ${seed} must generate`).not.toBeNull();
      const { puzzle, placed, dropped } = res!;
      expect(Math.max(puzzle.rows, puzzle.cols)).toBeLessThanOrEqual(11);
      expect(placed.length).toBeGreaterThanOrEqual(minPlaced);
      // grid round-trips to exactly the placed set (no junk runs / illegal adjacency)
      const rebuilt = buildPuzzle({ grid: puzzle.grid });
      const gridWords = [...rebuilt.across, ...rebuilt.down].map((w) => w.answer);
      const intended = new Set(words);
      for (const w of gridWords) {
        expect(intended.has(w)).toBe(true);
        expect(dropped).not.toContain(w);
      }
    }
  });

  it('passes meta.id through as a deterministic puzzle id', () => {
    const res = generatePuzzle(ENTRIES, { seed: 7, id: 'fixed' })!;
    expect(res.puzzle.id).toBe('fixed');
    // absent id → random (non-empty) id, and the grid is unaffected by id
    const noId = generatePuzzle(ENTRIES, { seed: 7 })!;
    expect(noId.puzzle.id).not.toBe('fixed');
    expect(noId.puzzle.id.length).toBeGreaterThan(0);
    expect(res.puzzle.grid).toEqual(noId.puzzle.grid);
  });

  it('different seeds may differ but each is internally stable', () => {
    const s7a = generatePuzzle(ENTRIES, { seed: 7 })!;
    const s7b = generatePuzzle(ENTRIES, { seed: 7 })!;
    const s99 = generatePuzzle(ENTRIES, { seed: 99 })!;
    expect(s7a.puzzle.grid).toEqual(s7b.puzzle.grid);
    // not asserting s7 !== s99 strictly (could coincide), just that s99 is stable
    const s99b = generatePuzzle(ENTRIES, { seed: 99 })!;
    expect(s99.puzzle.grid).toEqual(s99b.puzzle.grid);
  });
});

describe('validateSolution / solutionAt', () => {
  it('is true for the exact solution and false if a cell is wrong or empty', () => {
    const p = buildFixture();
    const correct: Record<string, string> = {};
    for (const [r, c] of p.fill) correct[`${r},${c}`] = solutionAt(p, r, c)!;
    expect(validateSolution(p, correct)).toBe(true);

    // one cell wrong
    const wrong = { ...correct };
    const [wr, wc] = p.fill[0]!;
    wrong[`${wr},${wc}`] = correct[`${wr},${wc}`] === 'X' ? 'Y' : 'X';
    expect(validateSolution(p, wrong)).toBe(false);

    // one cell empty (missing)
    const empty = { ...correct };
    delete empty[`${wr},${wc}`];
    expect(validateSolution(p, empty)).toBe(false);

    // wholly empty
    expect(validateSolution(p, {})).toBe(false);
  });

  it('solutionAt returns the grid letter and null for blocks', () => {
    const p = buildFixture();
    expect(solutionAt(p, 0, 0)).toBe('C');
    expect(solutionAt(p, 2, 2)).toBe('T');
    expect(solutionAt(p, 0, 3)).toBeNull(); // block
    expect(solutionAt(p, -1, 0)).toBeNull(); // out of bounds
  });
});

describe('progressFilled', () => {
  it('returns filled/cellCount in [0,1] using no answer knowledge', () => {
    const p = buildFixture();
    const pp = toPublicPuzzle(p);
    expect(progressFilled(pp, {})).toBe(0);

    // fill half the cells with arbitrary (even wrong) letters → still counts as filled
    const half = Math.floor(pp.cellCount / 2);
    const entries: Record<string, string> = {};
    for (let i = 0; i < half; i++) {
      const [r, c] = pp.fill[i]!;
      entries[`${r},${c}`] = 'Z'; // deliberately wrong; progress only cares about presence
    }
    expect(progressFilled(pp, entries)).toBeCloseTo(half / pp.cellCount, 10);

    // all cells filled → 1
    const full: Record<string, string> = {};
    for (const [r, c] of pp.fill) full[`${r},${c}`] = 'Z';
    expect(progressFilled(pp, full)).toBe(1);

    // empty-string entries do NOT count as filled
    const blanks: Record<string, string> = {};
    for (const [r, c] of pp.fill) blanks[`${r},${c}`] = '';
    expect(progressFilled(pp, blanks)).toBe(0);
  });
});

describe('toPublicPuzzle — anti-cheat (no answer letters)', () => {
  it('strips grid and answers; public projection has no answer letters anywhere', () => {
    const p = buildFixture();
    const pp = toPublicPuzzle(p);

    // structural projection present
    expect(pp.rows).toBe(p.rows);
    expect(pp.cols).toBe(p.cols);
    expect(pp.numbers).toEqual(p.numbers);
    expect(pp.cellCount).toBe(p.cellCount);
    expect(pp.fill.length).toBe(p.fill.length);
    expect(pp.blocks.length).toBe(p.rows * p.cols - p.cellCount);

    // no `grid`, no `answer` fields anywhere
    expect((pp as unknown as { grid?: unknown }).grid).toBeUndefined();
    for (const w of [...pp.across, ...pp.down]) {
      expect((w as unknown as { answer?: unknown }).answer).toBeUndefined();
      expect(w.id).toBe(`${w.dir}:${w.num}`);
      expect(w.len).toBe(w.cells.length);
    }

    // serialized public puzzle must contain NONE of the answer words —
    // CASE-INSENSITIVE: uppercase the whole JSON so a clue that happened to
    // spell an answer in lowercase would still be caught.
    const json = JSON.stringify(pp).toUpperCase();
    for (const w of [...p.across, ...p.down]) {
      expect(json).not.toContain(w.answer.toUpperCase());
    }
  });

  it('a generated puzzle public projection leaks no answers in its JSON (case-insensitive)', () => {
    const entries = [
      { answer: 'MODEL', clue: 'train it' },
      { answer: 'AGENT', clue: 'acts on its own' },
      { answer: 'DATA', clue: 'raw fuel' },
      { answer: 'TOKEN', clue: 'chunk read at a time' },
      { answer: 'LOGIC', clue: 'reasoning' },
      { answer: 'LAYER', clue: 'one tier' },
    ];
    const res = generatePuzzle(entries, { seed: 7 })!;
    const json = JSON.stringify(toPublicPuzzle(res.puzzle)).toUpperCase();
    for (const w of res.placed) {
      expect(json).not.toContain(w.toUpperCase());
    }
  });

  // Adversarial: the public projection never carries answers, but a *clue* could
  // still leak its own answer if a creation path accepted it. `clueLeaksAnswer`
  // is the guard that lets creation reject such entries. This fixture verifies it
  // would catch a leaking clue (the public projection itself stays clean above).
  it('clueLeaksAnswer would catch a clue that contains its own answer', () => {
    const leaky = { answer: 'AGENT', clue: 'The AGENT field is below' };
    const clean = { answer: 'MODEL', clue: 'What you train on data' };
    expect(clueLeaksAnswer(leaky.answer, leaky.clue)).toBe(true);
    expect(clueLeaksAnswer(clean.answer, clean.clue)).toBe(false);
  });
});

describe('clueLeaksAnswer — anti-cheat clue guard', () => {
  it('returns false when the clue does not contain the answer', () => {
    expect(clueLeaksAnswer('MODEL', 'What you train on data')).toBe(false);
  });

  it('returns true when the clue contains the answer', () => {
    expect(clueLeaksAnswer('AGENT', 'An agent acts')).toBe(true);
  });

  it('is case-insensitive on both sides', () => {
    expect(clueLeaksAnswer('CACHE', 'a cache stores')).toBe(true);
  });

  it('does not flag answers shorter than 2 chars', () => {
    expect(clueLeaksAnswer('A', 'A is the first letter')).toBe(false);
  });
});

describe('helpers on Puzzle and PublicPuzzle', () => {
  it('pIsBlock agrees on both representations', () => {
    const p = buildFixture();
    const pp = toPublicPuzzle(p);
    const cases: [number, number][] = [
      [0, 0], // fill
      [0, 3], // block
      [2, 2], // fill
      [4, 0], // block
      [-1, 0], // OOB
      [0, 5], // OOB
    ];
    for (const [r, c] of cases) {
      expect(pIsBlock(pp, r, c)).toBe(pIsBlock(p, r, c));
    }
    expect(pIsBlock(p, 0, 0)).toBe(false);
    expect(pIsBlock(p, 0, 3)).toBe(true);
    expect(pIsBlock(p, -1, 0)).toBe(true);
  });

  it('pWordAt resolves words on both representations', () => {
    const p = buildFixture();
    const pp = toPublicPuzzle(p);

    const aP = pWordAt(p, 0, 0, 'across');
    const aPP = pWordAt(pp, 0, 0, 'across');
    expect(aP).toBeTruthy();
    expect(aPP).toBeTruthy();
    expect(aP!.cells).toEqual(aPP!.cells);
    expect(aP!.num).toBe(aPP!.num);

    const dP = pWordAt(p, 2, 2, 'down');
    const dPP = pWordAt(pp, 2, 2, 'down');
    expect(dP!.cells).toEqual(dPP!.cells);

    // a block cell has no word
    expect(pWordAt(p, 0, 3, 'across')).toBeNull();
    expect(pWordAt(pp, 0, 3, 'across')).toBeNull();
  });

  it('pDirFor matches on both representations', () => {
    const p = buildFixture();
    const pp = toPublicPuzzle(p);
    // (0,0): both across (CAT) and down (CODE) start here
    expect(pDirFor(p, 0, 0, 'down')).toBe('down');
    expect(pDirFor(pp, 0, 0, 'down')).toBe('down');
    expect(pDirFor(p, 0, 0, 'across')).toBe('across');
    expect(pDirFor(pp, 0, 0, 'across')).toBe('across');
    // (0,1) 'A' only across (CAT) → wanting down falls back to across
    expect(pDirFor(p, 0, 1, 'down')).toBe('across');
    expect(pDirFor(pp, 0, 1, 'down')).toBe('across');
    // (1,0) 'O' only down (CODE) → wanting across falls back to down
    expect(pDirFor(p, 1, 0, 'across')).toBe('down');
    expect(pDirFor(pp, 1, 0, 'across')).toBe('down');
  });

  it('pStep moves within a word and clamps at the ends on both representations', () => {
    const p = buildFixture();
    const pp = toPublicPuzzle(p);
    // CAT across starts at (0,0); step +1 → (0,1)
    expect(pStep(p, 0, 0, 'across', 1)).toEqual({ r: 0, c: 1 });
    expect(pStep(pp, 0, 0, 'across', 1)).toEqual({ r: 0, c: 1 });
    // at start, step -1 clamps
    expect(pStep(p, 0, 0, 'across', -1)).toEqual({ r: 0, c: 0 });
    // at end of CAT (0,2), step +1 clamps
    expect(pStep(p, 0, 2, 'across', 1)).toEqual({ r: 0, c: 2 });
    expect(pStep(pp, 0, 2, 'across', 1)).toEqual({ r: 0, c: 2 });
    // CODE down: (0,0)->(1,0)
    expect(pStep(p, 0, 0, 'down', 1)).toEqual({ r: 1, c: 0 });
    expect(pStep(pp, 0, 0, 'down', 1)).toEqual({ r: 1, c: 0 });
  });

  it('firstSel returns the first selectable cell + direction on both representations', () => {
    const p = buildFixture();
    const pp = toPublicPuzzle(p);
    const selP = firstSel(p);
    const selPP = firstSel(pp);
    expect(selP).toEqual(selPP);
    expect(selP.r).toBe(0);
    expect(selP.c).toBe(0);
    expect(['across', 'down']).toContain(selP.dir);
  });
});
