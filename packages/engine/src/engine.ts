// engine.ts — pure TS crossword engine.
// Faithful port of prototype/store.jsx lines 67–231 (buildPuzzle, rngFrom,
// layoutAttempt, generatePuzzle, helpers) into the LOCKED contracts in types.ts.
//
// NOTE: the loose `== null` / `!= null` comparisons are intentional and load-bearing.
// In layoutAttempt, `get(r,c)` returns `string | undefined`; `undefined != null` is
// `false`, which is how the algorithm treats an empty cell. Do NOT tighten to ===/!==.
/* eslint-disable eqeqeq */

import type {
  Cell,
  Dir,
  Grid,
  Puzzle,
  PublicPuzzle,
  PublicWord,
  WordDef,
  GenerateResult,
  GenerateMeta,
} from './types';

// --- seeded RNG: xorshift, exactly as prototype ---------------------------
export function rngFrom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) % 100000 / 100000;
  };
}

// --- buildPuzzle: full puzzle object from a rectangular grid + clue map ----
export function buildPuzzle(def: {
  grid: Grid;
  clues?: Record<string, string>;
  id?: string;
  name?: string;
  sub?: string;
  tag?: string;
  topic?: string | null;
}): Puzzle {
  const grid = def.grid;
  const rows = grid.length;
  const cols = grid[0]!.length;
  const isB = (r: number, c: number): boolean =>
    r < 0 || c < 0 || r >= rows || c >= cols || grid[r]![c] == null;

  const numbers: Record<string, number> = {};
  let n = 1;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (isB(r, c)) continue;
      const sA = isB(r, c - 1) && !isB(r, c + 1);
      const sD = isB(r - 1, c) && !isB(r + 1, c);
      if (sA || sD) numbers[`${r},${c}`] = n++;
    }

  const collect = (dir: Dir): WordDef[] => {
    const A = dir === 'across';
    const out: [number, number][][] = [];
    const outer = A ? rows : cols;
    const inner = A ? cols : rows;
    for (let a = 0; a < outer; a++) {
      let run: [number, number][] = [];
      for (let b = 0; b < inner; b++) {
        const r = A ? a : b;
        const c = A ? b : a;
        if (isB(r, c)) {
          if (run.length >= 2) out.push(run);
          run = [];
        } else {
          run.push([r, c]);
        }
      }
      if (run.length >= 2) out.push(run);
    }
    return out.map((cells) => {
      const [sr, sc] = cells[0]!;
      const answer = cells.map(([r, c]) => grid[r]![c]).join('');
      return {
        dir,
        num: numbers[`${sr},${sc}`]!,
        cells,
        answer,
        clue: (def.clues && def.clues[answer]) || '',
      };
    });
  };

  const across = collect('across');
  const down = collect('down');

  const cellToWord: Record<string, { across?: number; down?: number }> = {};
  across.forEach((w, i) =>
    w.cells.forEach(([r, c]) => {
      (cellToWord[`${r},${c}`] || (cellToWord[`${r},${c}`] = {})).across = i;
    }),
  );
  down.forEach((w, i) =>
    w.cells.forEach(([r, c]) => {
      (cellToWord[`${r},${c}`] || (cellToWord[`${r},${c}`] = {})).down = i;
    }),
  );

  const fill: [number, number][] = [];
  let cellCount = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (!isB(r, c)) {
        fill.push([r, c]);
        cellCount++;
      }

  return {
    id: def.id || 'p' + Math.random().toString(36).slice(2, 7),
    name: def.name || 'Untitled',
    sub: def.sub || `${rows}×${cols} · ${across.length + down.length} words`,
    tag: def.tag || 'Custom',
    grid,
    rows,
    cols,
    numbers,
    across,
    down,
    cellToWord,
    fill,
    cellCount,
    clues: def.clues || {},
    topic: def.topic || null,
  };
}

// --- auto-layout generator: greedy multi-attempt interlock -----------------
interface Placed {
  w: string;
  r: number;
  c: number;
  dir: Dir;
}
interface LayoutResult {
  grid: Grid;
  rows: number;
  cols: number;
  placed: string[];
  unplaced: string[];
}

function layoutAttempt(order: string[]): LayoutResult {
  const cells = new Map<string, string>();
  const placed: Placed[] = [];
  const key = (r: number, c: number): string => r + ',' + c;
  const get = (r: number, c: number): string | undefined => cells.get(key(r, c));

  const canPlace = (w: string, r: number, c: number, dir: Dir): number => {
    const dr = dir === 'down' ? 1 : 0;
    const dc = dir === 'across' ? 1 : 0;
    let cross = 0;
    if (get(r - dr, c - dc) != null) return -1;
    if (get(r + dr * w.length, c + dc * w.length) != null) return -1;
    for (let i = 0; i < w.length; i++) {
      const rr = r + dr * i;
      const cc = c + dc * i;
      const cur = get(rr, cc);
      if (cur != null) {
        if (cur !== w[i]) return -1;
        cross++;
      } else {
        if (dir === 'across') {
          if (get(rr - 1, cc) != null || get(rr + 1, cc) != null) return -1;
        } else {
          if (get(rr, cc - 1) != null || get(rr, cc + 1) != null) return -1;
        }
      }
    }
    return cross;
  };

  const place = (w: string, r: number, c: number, dir: Dir): void => {
    const dr = dir === 'down' ? 1 : 0;
    const dc = dir === 'across' ? 1 : 0;
    for (let i = 0; i < w.length; i++) cells.set(key(r + dr * i, c + dc * i), w[i]!);
    placed.push({ w, r, c, dir });
  };

  place(order[0]!, 0, 0, 'across');
  // running bounding box — used to keep placements compact
  let bMinR = 0;
  let bMaxR = 0;
  let bMinC = 0;
  let bMaxC = order[0]!.length - 1;
  let remaining = order.slice(1);
  let progress = true;
  let passes = 0;
  while (remaining.length && progress && passes < 8) {
    progress = false;
    passes++;
    const still: string[] = [];
    for (const w of remaining) {
      let best:
        | { r: number; c: number; dir: Dir; sc: number; dim: number; area: number; er: number; ec: number }
        | null = null;
      for (let i = 0; i < w.length; i++)
        for (const p of placed)
          for (let j = 0; j < p.w.length; j++) {
            if (p.w[j] !== w[i]) continue;
            const pr = p.dir === 'down' ? p.r + j : p.r;
            const pc = p.dir === 'across' ? p.c + j : p.c;
            const dir: Dir = p.dir === 'across' ? 'down' : 'across';
            const dr = dir === 'down' ? 1 : 0;
            const dc = dir === 'across' ? 1 : 0;
            const r = pr - dr * i;
            const c = pc - dc * i;
            const sc = canPlace(w, r, c, dir);
            if (sc <= 0) continue;
            // bounding box if we placed here → prefer the most compact result
            const er = r + dr * (w.length - 1);
            const ec = c + dc * (w.length - 1);
            const nR = Math.max(bMaxR, er) - Math.min(bMinR, r) + 1;
            const nC = Math.max(bMaxC, ec) - Math.min(bMinC, c) + 1;
            const dim = Math.max(nR, nC);
            const area = nR * nC;
            // rank: more crossings first, then smaller max dimension, then smaller area
            if (
              !best ||
              sc > best.sc ||
              (sc === best.sc && (dim < best.dim || (dim === best.dim && area < best.area)))
            )
              best = { r, c, dir, sc, dim, area, er, ec };
          }
      if (best) {
        place(w, best.r, best.c, best.dir);
        progress = true;
        bMinR = Math.min(bMinR, best.r, best.er);
        bMaxR = Math.max(bMaxR, best.r, best.er);
        bMinC = Math.min(bMinC, best.c, best.ec);
        bMaxC = Math.max(bMaxC, best.c, best.ec);
      } else {
        still.push(w);
      }
    }
    remaining = still;
  }

  let minR = 1e9;
  let minC = 1e9;
  let maxR = -1e9;
  let maxC = -1e9;
  for (const k of cells.keys()) {
    const [r, c] = k.split(',').map(Number) as [number, number];
    minR = Math.min(minR, r);
    minC = Math.min(minC, c);
    maxR = Math.max(maxR, r);
    maxC = Math.max(maxC, c);
  }
  const rows = maxR - minR + 1;
  const cols = maxC - minC + 1;
  const grid: Grid = Array.from({ length: rows }, () => Array<Cell>(cols).fill(null));
  for (const [k, v] of cells) {
    const [r, c] = k.split(',').map(Number) as [number, number];
    grid[r - minR]![c - minC] = v;
  }
  return { grid, rows, cols, placed: placed.map((p) => p.w), unplaced: remaining };
}

// --- generatePuzzle: [{answer,clue}] -> { puzzle, placed, dropped } --------
export function generatePuzzle(
  entries: { answer: string; clue: string }[],
  meta: GenerateMeta = {},
): GenerateResult | null {
  const clean = entries
    .map((e) => ({
      answer: (e.answer || '').toUpperCase().replace(/[^A-Z]/g, ''),
      clue: (e.clue || '').trim(),
    }))
    .filter((e) => e.answer.length >= 2);
  // dedupe answers
  const seen = new Set<string>();
  const uniq: { answer: string; clue: string }[] = [];
  for (const e of clean) {
    if (!seen.has(e.answer)) {
      seen.add(e.answer);
      uniq.push(e);
    }
  }
  if (uniq.length === 0) return null;
  const words = uniq.map((e) => e.answer);
  const rng = rngFrom(meta.seed || 12345);
  // Seeded Fisher–Yates: consumes rng() in a fixed order, so generation is
  // deterministic ACROSS JS runtimes (Node, workerd). A `sort(() => rng()-0.5)`
  // shuffle is NOT — its comparator-call sequence depends on the engine's sort
  // internals, so identical seeds produced different grids in workerd vs Node.
  const shuffle = (arr: string[]): void => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
  };
  let best: (LayoutResult & { sc: number }) | null = null;
  for (let t = 0; t < 90; t++) {
    let order = words.slice();
    if (t === 0) order.sort((a, b) => b.length - a.length);
    else {
      shuffle(order);
      if (t % 2 === 0) order.sort((a, b) => b.length - a.length);
    }
    const res = layoutAttempt(order);
    const dim = Math.max(res.rows, res.cols);
    if (dim > 11) continue; // hard cap: keep it phone-friendly
    const sc =
      res.placed.length * 1000 - dim * 10 - res.rows * res.cols - Math.abs(res.rows - res.cols) * 3;
    if (!best || sc > best.sc) best = { ...res, sc };
    if (res.placed.length === words.length && dim <= 8 && Math.abs(res.rows - res.cols) <= 2) break;
  }
  if (!best) return null;
  const clues: Record<string, string> = {};
  uniq.forEach((e) => {
    clues[e.answer] = e.clue;
  });
  const puzzle = buildPuzzle({
    grid: best.grid,
    clues,
    id: meta.id, // deterministic id passthrough; undefined → buildPuzzle random id
    name: meta.name || 'Custom Puzzle',
    sub: meta.sub,
    tag: meta.tag || 'Custom',
    topic: meta.topic,
  });
  const placedSet = new Set(best.placed);
  return { puzzle, placed: best.placed, dropped: words.filter((w) => !placedSet.has(w)) };
}

// --- clue-leak guard (anti-cheat) -----------------------------------------
// Returns true if the clue text reveals its own answer (case-insensitive raw
// substring). Creation paths can call this to reject leaking entries before a
// puzzle ever reaches a client. Answers shorter than 2 chars are not checked.
export function clueLeaksAnswer(answer: string, clue: string): boolean {
  if (answer.length < 2) return false;
  return clue.toUpperCase().includes(answer.toUpperCase());
}

// --- toPublicPuzzle: strip every answer letter ----------------------------
export function toPublicPuzzle(p: Puzzle): PublicPuzzle {
  const toPublic = (w: WordDef): PublicWord => ({
    dir: w.dir,
    num: w.num,
    cells: w.cells,
    clue: w.clue,
    len: w.cells.length,
    id: `${w.dir}:${w.num}`,
  });
  const blocks: [number, number][] = [];
  for (let r = 0; r < p.rows; r++)
    for (let c = 0; c < p.cols; c++) if (p.grid[r]![c] == null) blocks.push([r, c]);
  return {
    id: p.id,
    name: p.name,
    sub: p.sub,
    rows: p.rows,
    cols: p.cols,
    blocks,
    numbers: p.numbers,
    across: p.across.map(toPublic),
    down: p.down.map(toPublic),
    fill: p.fill,
    cellCount: p.cellCount,
    cellToWord: p.cellToWord, // pure indices, no letters
  };
}

// --- solution-aware (server-only) -----------------------------------------
export function solutionAt(p: Puzzle, r: number, c: number): string | null {
  if (r < 0 || c < 0 || r >= p.rows || c >= p.cols) return null;
  const v = p.grid[r]![c];
  return v == null ? null : v;
}

export function validateSolution(p: Puzzle, entries: Record<string, string>): boolean {
  for (const [r, c] of p.fill) {
    if (entries[`${r},${c}`] !== p.grid[r]![c]) return false;
  }
  return p.cellCount > 0;
}

// --- progress (answer-free, client-safe) ----------------------------------
export function progressFilled(pp: PublicPuzzle, entries: Record<string, string>): number {
  if (!pp.cellCount) return 0;
  let filled = 0;
  for (const [r, c] of pp.fill) {
    const v = entries[`${r},${c}`];
    if (v != null && v !== '') filled++;
  }
  return filled / pp.cellCount;
}

// --- puzzle-aware helpers (operate on Puzzle OR PublicPuzzle) --------------
// Type guard: only a full Puzzle carries the answer `grid`.
function hasGrid(p: Puzzle | PublicPuzzle): p is Puzzle {
  return 'grid' in p;
}

export function pIsBlock(p: Puzzle | PublicPuzzle, r: number, c: number): boolean {
  if (r < 0 || c < 0 || r >= p.rows || c >= p.cols) return true;
  if (hasGrid(p)) return p.grid[r]![c] == null;
  // PublicPuzzle: a cell is a block iff it is NOT in the fill set. Use `blocks`
  // list membership (equivalently absence from `fill`). Derive from `fill` for O(1)
  // via a per-call lookup is overkill; scan `blocks` (small grids, ≤11×11).
  for (const [br, bc] of p.blocks) if (br === r && bc === c) return true;
  return false;
}

export function pWordAt(
  p: Puzzle | PublicPuzzle,
  r: number,
  c: number,
  dir: Dir,
): WordDef | PublicWord | null {
  const ref = p.cellToWord[`${r},${c}`];
  if (!ref) return null;
  const idx = dir === 'across' ? ref.across : ref.down;
  if (idx == null) return null;
  return (dir === 'across' ? p.across : p.down)[idx] ?? null;
}

export function pDirFor(p: Puzzle | PublicPuzzle, r: number, c: number, want: Dir): Dir {
  const ref = p.cellToWord[`${r},${c}`] || {};
  if (want === 'across' && ref.across != null) return 'across';
  if (want === 'down' && ref.down != null) return 'down';
  if (ref.across != null) return 'across';
  if (ref.down != null) return 'down';
  return 'across';
}

export function pStep(
  p: Puzzle | PublicPuzzle,
  r: number,
  c: number,
  dir: Dir,
  delta: 1 | -1,
): { r: number; c: number } {
  const w = pWordAt(p, r, c, dir);
  if (!w) return { r, c };
  const i = w.cells.findIndex(([rr, cc]) => rr === r && cc === c);
  const j = i + delta;
  if (j < 0 || j >= w.cells.length) return { r, c };
  const cell = w.cells[j]!;
  return { r: cell[0], c: cell[1] };
}

export function firstSel(p: Puzzle | PublicPuzzle): { r: number; c: number; dir: Dir } {
  const w = (p.across[0] || p.down[0])!;
  const [r, c] = w.cells[0]!;
  return { r, c, dir: w.dir };
}
