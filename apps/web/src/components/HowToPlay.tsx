// HowToPlay.tsx — auto-rotating "how to play" tips for the lobby wait. First-timer
// friendly; penalty values come from the live session config so they stay accurate
// (and white-label correct). Auto-advances every few seconds (re-armed on a manual
// tap); tapping the card advances. The tip body re-mounts on change (`key`) to
// replay the transform-only `.rise` entrance, which is disabled under
// prefers-reduced-motion, so it simply swaps instantly there.
import { useEffect, useState, type ReactNode } from 'react';

const ROTATE_MS = 5200;

function buildTips(hintPenalty: number, wrongPenalty: number): { title: string; body: ReactNode }[] {
  return [
    {
      title: 'Tap a square',
      body: (
        <>
          Tapping a square shows its clue. Tap the same square again to flip between the Across and
          Down word where they cross.
        </>
      ),
    },
    {
      title: 'Just type',
      body: (
        <>
          Tap the letter keys below the grid to fill it in. It checks itself the moment every square
          is full.
        </>
      ),
    },
    {
      title: 'Stuck on a word?',
      body: (
        <>
          Tap <b>Hint</b> to fill in one correct letter. It adds <b>+{hintPenalty}s</b> to your time,
          and you can use one every few seconds.
        </>
      ),
    },
    {
      title: 'Mind the misses',
      body: (
        <>
          Submitting a full grid that's wrong costs <b>+{wrongPenalty}s</b>, so give it a glance
          before the last square goes in.
        </>
      ),
    },
    {
      title: 'How you win',
      body: (
        <>
          Fastest finish takes it. Your time is how long you took plus any penalties, so keep it
          low.
        </>
      ),
    },
    {
      title: 'Get around',
      body: (
        <>
          Jump between clues with <b>Prev</b> and <b>Next</b>, or flip direction with the{' '}
          <b>Across / Down</b> toggle.
        </>
      ),
    },
  ];
}

export interface HowToPlayProps {
  hintPenalty: number;
  wrongPenalty: number;
}

export function HowToPlay({ hintPenalty, wrongPenalty }: HowToPlayProps) {
  const tips = buildTips(hintPenalty, wrongPenalty);
  const [i, setI] = useState(0);

  // setTimeout keyed on `i` re-arms after every change, so a manual tap also
  // resets the dwell timer (no double-advance right after a tap).
  useEffect(() => {
    const id = setTimeout(() => setI((n) => (n + 1) % tips.length), ROTATE_MS);
    return () => clearTimeout(id);
  }, [i, tips.length]);

  const tip = tips[i]!;
  return (
    <button
      type="button"
      onClick={() => setI((n) => (n + 1) % tips.length)}
      aria-label="Next tip"
      className="card"
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '16px 18px 14px',
        cursor: 'pointer',
        background: 'var(--paper)',
        font: 'inherit',
        color: 'inherit',
      }}
    >
      <div className="label" style={{ marginBottom: 11 }}>
        HOW TO PLAY
      </div>
      {/* re-mount on change → replays `.rise` (reduced-motion: instant swap) */}
      <div key={i} className="rise" style={{ minHeight: 72 }}>
        <div className="h3" style={{ fontSize: 16, marginBottom: 5 }}>
          {tip.title}
        </div>
        <div className="body body-ink" style={{ fontSize: 14, lineHeight: 1.5 }}>
          {tip.body}
        </div>
      </div>
      {/* progress dots — active is a wider ink pill, set instantly (no transition) */}
      <div style={{ display: 'flex', gap: 5, marginTop: 13 }} aria-hidden>
        {tips.map((_, j) => (
          <span
            key={j}
            style={{
              width: j === i ? 18 : 6,
              height: 6,
              borderRadius: 100,
              background: j === i ? 'var(--ink)' : 'var(--line-2)',
            }}
          />
        ))}
      </div>
    </button>
  );
}
