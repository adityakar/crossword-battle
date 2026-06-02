// Crossword.tsx — generic crossword grid. Faithful port of prototype/ui.jsx
// (lines 182–212), adapted to render from a PublicPuzzle (NO answers).
//
// Block detection + active-word highlighting use the engine's `pIsBlock` /
// `pWordAt`, which both operate on a PublicPuzzle. There is no `grid` on a
// PublicPuzzle, so `reveal` simply means "non-interactive display of the given
// `entries`" (the builder preview, which has answers, uses a separate path).
import { pIsBlock, pWordAt, type Dir, type PublicPuzzle } from '@cwb/engine';

export interface CrosswordSelection {
  r: number;
  c: number;
  dir: Dir;
}

export interface CrosswordProps {
  puzzle: PublicPuzzle | null;
  entries?: Record<string, string>;
  sel?: CrosswordSelection | null;
  onSelect?: (r: number, c: number) => void;
  cellSize?: number;
  /** Non-interactive display of the given `entries` (organizer preview). */
  reveal?: boolean;
  interactive?: boolean;
  /** Dim the whole grid (e.g. a paused/overlaid state). */
  dim?: boolean;
  /** The cell an AI hint just revealed — gets a one-shot coral spotlight ring.
   *  `n` is a monotonic sequence so re-keying replays the ring on each new hint. */
  hintCell?: { r: number; c: number; n: number } | null;
}

export function Crossword({
  puzzle,
  entries = {},
  sel,
  onSelect,
  cellSize = 56,
  reveal = false,
  interactive = true,
  dim = false,
  hintCell = null,
}: CrosswordProps) {
  if (!puzzle) return null;
  // `reveal` is a read-only display mode → never interactive.
  const canInteract = interactive && !reveal;
  const activeWord = sel ? pWordAt(puzzle, sel.r, sel.c, sel.dir) : null;
  const inWordSet = new Set(activeWord ? activeWord.cells.map(([r, c]) => `${r},${c}`) : []);
  const rows = [];
  for (let r = 0; r < puzzle.rows; r++) {
    for (let c = 0; c < puzzle.cols; c++) {
      const key = `${r},${c}`;
      if (pIsBlock(puzzle, r, c)) {
        rows.push(
          <div key={key} className="cell block" style={{ width: cellSize, height: cellSize }} />,
        );
        continue;
      }
      const num = puzzle.numbers[key];
      const inWord = inWordSet.has(key);
      const active = !!sel && sel.r === r && sel.c === c;
      // PublicPuzzle has no answers — letters come from `entries` only.
      const letter = entries[key] || '';
      rows.push(
        <div
          key={key}
          className={'cell' + (inWord ? ' inword' : '') + (active ? ' active' : '')}
          style={{
            width: cellSize,
            height: cellSize,
            fontSize: cellSize * 0.5,
            opacity: dim ? 0.55 : 1,
            cursor: canInteract ? 'pointer' : 'default',
          }}
          onClick={canInteract ? () => onSelect && onSelect(r, c) : undefined}
        >
          {num && (
            <span className="cell-num" style={{ fontSize: Math.max(8, cellSize * 0.16) }}>
              {num}
            </span>
          )}
          {/* One-shot coral spotlight on the cell an AI hint just revealed. Keyed
              by the hint sequence so a new hint on the same cell replays it. */}
          {hintCell && hintCell.r === r && hintCell.c === c && (
            <span key={`hint-${hintCell.n}`} className="cell-hint-ring" aria-hidden="true" />
          )}
          {/* Letter "stamp": only in live play (not the read-only preview), wrapped
              in a span keyed by the letter so set/retype remounts and re-animates,
              while clock-tick re-renders (same letter) do not. */}
          {reveal ? (
            letter
          ) : (
            letter && (
              <span key={letter} className="cell-ch">
                {letter}
              </span>
            )
          )}
        </div>,
      );
    }
  }
  return (
    <div className="xw" style={{ gridTemplateColumns: `repeat(${puzzle.cols}, ${cellSize}px)` }}>
      {rows}
    </div>
  );
}
