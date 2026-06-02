// solution.mjs — deterministic solution reconstruction for the E2E suite.
//
// The client (and these tests) never receive the answer letters. But the seeder
// builds each preset's grid deterministically from the SAME words+seed+id via the
// cross-runtime-deterministic engine (Fisher–Yates). So we regenerate the puzzle
// here with identical inputs and read the grid the DO loaded from D1. This mirrors
// apps/worker/scripts/protocol-e2e.mjs exactly.
//
// Import notes (same as protocol-e2e): we import the engine SOURCE by RELATIVE
// path (Node 24 strips TS types). The package specifier `@cwb/engine` re-exports
// `./engine` extensionless, which native ESM can't resolve; the relative source
// import only carries `import type` (fully erased), so it has no runtime deps.
import { generatePuzzle } from '../packages/engine/src/engine.ts';
import { PRESET_DEFS } from '../apps/worker/src/presets.ts';

/**
 * Reconstruct the solution for a preset puzzle.
 * @param {string} puzzleId e.g. 'mini-ai'
 * @returns {{
 *   rows: number, cols: number, cellCount: number,
 *   fill: [number, number][],
 *   solution: Record<string, string>,   // "r,c" -> correct letter
 *   wrongGrid: Record<string, string>,  // complete-but-WRONG full grid
 *   cellsInOrder: { r: number, c: number, letter: string, index: number }[],
 * }}
 */
export function reconstructSolution(puzzleId) {
  const def = PRESET_DEFS.find((d) => d.id === puzzleId);
  if (!def) throw new Error(`preset ${puzzleId} not found`);
  const gen = generatePuzzle(
    def.words.map(([answer, clue]) => ({ answer, clue })),
    { name: def.name, tag: def.tag, topic: def.topic, seed: def.seed, id: def.id },
  );
  if (!gen) throw new Error('generatePuzzle returned null');
  const p = gen.puzzle;

  const solution = {};
  const wrongGrid = {};
  const cellsInOrder = [];
  for (const [r, c] of p.fill) {
    const letter = p.grid[r][c];
    solution[`${r},${c}`] = letter;
    // A complete-but-wrong entry: every fill cell present, every letter differs,
    // so the server returns `wrong` (not `incomplete`).
    wrongGrid[`${r},${c}`] = letter === 'A' ? 'B' : 'A';
    // Row-major child index into the grid (incl. blocks): r*cols + c.
    cellsInOrder.push({ r, c, letter, index: r * p.cols + c });
  }
  if (cellsInOrder.length === 0) throw new Error('empty solution map');

  return {
    rows: p.rows,
    cols: p.cols,
    cellCount: p.cellCount,
    fill: p.fill,
    solution,
    wrongGrid,
    cellsInOrder,
  };
}
