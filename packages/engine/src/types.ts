// types.ts — crossword engine data contracts.
// See plan §"Shared contracts (LOCKED)" and design §6.
//
// Two puzzle representations:
//  - `Puzzle`       : full server/organizer object — CONTAINS answers (`grid`, word `answer`).
//  - `PublicPuzzle` : client-safe projection — NO answer letters anywhere (no `grid`, no `answer`).

export type Cell = string | null; // letter or null (black square)
export type Grid = Cell[][];
export type Dir = 'across' | 'down';

export interface WordDef {
  dir: Dir;
  num: number;
  cells: [number, number][];
  answer: string;
  clue: string;
}

export interface Puzzle {
  // SERVER-SIDE / organizer-local — contains answers.
  id: string;
  name: string;
  sub: string;
  tag: string;
  grid: Grid;
  rows: number;
  cols: number;
  numbers: Record<string, number>; // "r,c" -> number
  across: WordDef[];
  down: WordDef[];
  cellToWord: Record<string, { across?: number; down?: number }>;
  fill: [number, number][];
  cellCount: number;
  clues: Record<string, string>;
  topic: string | null;
}

export interface PublicWord {
  dir: Dir;
  num: number;
  cells: [number, number][];
  clue: string;
  len: number;
  id: string; // `${dir}:${num}`
}

export interface PublicPuzzle {
  // CLIENT-SAFE — NO answer letters.
  id: string;
  name: string;
  sub: string;
  rows: number;
  cols: number;
  blocks: [number, number][];
  numbers: Record<string, number>;
  across: PublicWord[];
  down: PublicWord[];
  fill: [number, number][];
  cellCount: number;
  // Contract addition (answer-free index): lets `pWordAt` work on a PublicPuzzle.
  // Maps "r,c" -> the across/down word INDEX into `across`/`down`. No letters.
  cellToWord: Record<string, { across?: number; down?: number }>;
}

export interface GenerateResult {
  puzzle: Puzzle;
  placed: string[];
  dropped: string[];
}

export interface GenerateMeta {
  name?: string;
  sub?: string;
  tag?: string;
  topic?: string | null;
  seed?: number;
  // Optional deterministic id passthrough → buildPuzzle. Seeded presets override
  // the random id so it is stable (matches prototype/store.jsx:267 `pz.id = d.id`).
  id?: string;
}
