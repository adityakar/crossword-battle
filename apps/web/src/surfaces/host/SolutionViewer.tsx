// SolutionViewer.tsx — the organizer's answer key. Fetches the solved puzzle
// (GET /api/puzzles/:id/solution, organizer-gated) and renders it two ways: the
// filled grid via the shared <Crossword reveal> path (same as the builder's
// MiniPreview), and an ACROSS/DOWN clue→answer list read off the answer map.
//
// Reused as a full-screen swap from BOTH Setup (preview the puzzle you're about
// to run) and Live (the answer key mid-round). The parent stays mounted behind
// it — its state and the live snapshot keep flowing — and `onClose` returns. It
// is a framed host surface, so it must NOT opt into full-bleed.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicWord } from '@cwb/engine';
import { Btn, Chip, Crossword, Screen } from '../../components';
import * as api from '../../lib/api';
import { useHostShell } from '../../lib/useHostShell';
import { OrgHeader } from './OrgHeader';

export interface SolutionViewerProps {
  puzzleId: string;
  onClose: () => void;
  /** Footer dismiss label, tuned per caller (e.g. "Back to setup"). */
  backLabel?: string;
}

export function SolutionViewer({ puzzleId, onClose, backLabel = 'Done' }: SolutionViewerProps) {
  // The answer key reads cleanly as a single bounded column, so on desktop it
  // takes the read width even when opened over a wide host surface (Setup/Live);
  // closing reverts to that surface's own width.
  useHostShell('read');
  const [data, setData] = useState<api.PuzzleSolution | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // A generation token guards every fetch — mount, puzzleId change, AND the retry
  // button. Only the latest load's response is applied, and the effect cleanup
  // bumps the token so no in-flight request (retry included) calls setState after
  // unmount, and a slow response for an old puzzleId can't overwrite a newer one.
  const genRef = useRef(0);
  const load = useCallback(() => {
    const gen = ++genRef.current;
    setStatus('loading');
    api
      .getPuzzleSolution(puzzleId)
      .then((res) => {
        if (genRef.current !== gen) return;
        setData(res);
        setStatus('ready');
      })
      .catch(() => {
        if (genRef.current === gen) setStatus('error');
      });
  }, [puzzleId]);

  useEffect(() => {
    load();
    return () => {
      genRef.current += 1;
    };
  }, [load]);

  const footer = (
    <Btn kind="dark" onClick={onClose}>
      {backLabel}
    </Btn>
  );

  if (status !== 'ready' || !data) {
    return (
      <Screen footer={footer}>
        <OrgHeader right={<Chip kind="coral-soft">ANSWER KEY</Chip>} />
        <div className="pad" style={{ paddingTop: 60, textAlign: 'center' }}>
          {status === 'error' ? (
            <>
              <div className="label">COULDN&apos;T LOAD</div>
              <p className="body" style={{ fontSize: 14, marginTop: 10 }}>
                The solution didn&apos;t come through.
              </p>
              <div style={{ marginTop: 18, display: 'flex', justifyContent: 'center' }}>
                <Btn kind="ghost" sm onClick={load} style={{ width: 'auto' }}>
                  Try again
                </Btn>
              </div>
            </>
          ) : (
            <div className="label">LOADING SOLUTION…</div>
          )}
        </div>
      </Screen>
    );
  }

  const { puzzle, answers } = data;
  // Read each word's answer straight off the cell→letter map.
  const answerOf = (w: PublicWord) => w.cells.map(([r, c]) => answers[`${r},${c}`] ?? '').join('');
  const maxDim = Math.max(puzzle.rows, puzzle.cols);
  const cell = Math.max(30, Math.min(48, Math.floor(340 / maxDim)));

  return (
    <Screen footer={footer}>
      <OrgHeader right={<Chip kind="coral-soft">ANSWER KEY</Chip>} />

      <div className="pad rise" style={{ paddingTop: 20 }}>
        <div className="label">SOLVED GRID</div>
        <div className="h1" style={{ fontSize: 27, marginTop: 8 }}>
          {puzzle.name}
        </div>
        <div className="label" style={{ marginTop: 7 }}>
          {puzzle.rows}×{puzzle.cols} · {puzzle.across.length + puzzle.down.length} WORDS ·{' '}
          {puzzle.cellCount} CELLS
        </div>
      </div>

      <div className="pad" style={{ marginTop: 14 }}>
        <div className="card pop" style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
          <Crossword puzzle={puzzle} entries={answers} reveal interactive={false} cellSize={cell} />
        </div>
      </div>

      <div className="pad" style={{ marginTop: 24 }}>
        <ClueColumn heading="ACROSS" words={puzzle.across} answerOf={answerOf} />
        <div style={{ marginTop: 22 }}>
          <ClueColumn heading="DOWN" words={puzzle.down} answerOf={answerOf} />
        </div>
      </div>
    </Screen>
  );
}

// One labelled list of clue → answer rows. Number + clue read left, the answer
// (the point of the screen) sits right in mono. Ink throughout — coral stays the
// single chip so the key reads as a quiet reference, not a wall of accent.
function ClueColumn({
  heading,
  words,
  answerOf,
}: {
  heading: string;
  words: PublicWord[];
  answerOf: (w: PublicWord) => string;
}) {
  if (words.length === 0) return null;
  return (
    <div>
      <div className="label" style={{ marginBottom: 4 }}>
        {heading}
      </div>
      {words.map((w) => (
        <div
          key={w.id}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 14,
            padding: '11px 0',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
            <span
              className="mono"
              style={{ color: 'var(--grey-soft)', flexShrink: 0, width: 18, textAlign: 'right' }}
            >
              {w.num}
            </span>
            <span className="body body-ink" style={{ fontSize: 14 }}>
              {w.clue || <span style={{ color: 'var(--grey-soft)' }}>(no clue)</span>}
            </span>
          </div>
          <span
            className="mono"
            style={{ fontWeight: 600, fontSize: 14, letterSpacing: '0.06em', flexShrink: 0 }}
          >
            {answerOf(w)}
          </span>
        </div>
      ))}
    </div>
  );
}
