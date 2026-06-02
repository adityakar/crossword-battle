// Cards.tsx — ClueCard. Faithful port of prototype/ui.jsx (lines 214–238).
// ClueCard uses raw `btn btn-ghost btn-sm` buttons to stay byte-faithful to the
// prototype's inline styling. (The HintCard was removed — the AI hint reveals a
// letter directly in the grid; its card text just restated the visible clue.)
import type { Dir } from '@cwb/engine';

// ---------- clue card ----------
export interface ClueCardProps {
  clue: string;
  dir: Dir;
  num: number;
  onPrev?: () => void;
  onNext?: () => void;
  index: number;
  total: number;
}

export function ClueCard({ clue, dir, num, onPrev, onNext, index, total }: ClueCardProps) {
  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span className="chip chip-ink" style={{ flexShrink: 0 }}>
            {num} {dir === 'across' ? 'ACROSS' : 'DOWN'}
          </span>
          <span className="h3" style={{ fontSize: 16 }}>
            {clue}
          </span>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 12,
        }}
      >
        <span className="label">
          {index}/{total}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={onPrev} style={{ padding: '8px 12px' }}>
            ‹ Prev
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onNext} style={{ padding: '8px 12px' }}>
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
}
