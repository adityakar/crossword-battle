// Game.tsx — the playable crossword. Faithful port of prototype/player.jsx
// PlayerGame, adapted to the SERVER-AUTHORITATIVE model (the client has NO
// answers). Local selection/typing comes from useSolve; correctness is decided
// only by the server via lastResult. Top status bar (TIME LEFT / SOLVED % /
// Hint), grid, current clue + nav, across/down toggle, a transient toast, and the
// on-screen LetterPad (+ physical keyboard). The AI hint reveals a solution letter
// directly in the grid (server `hint` → useSolve); a brief toast confirms it + the
// time cost. There is no separate hint card — its text just restated the visible clue.
import { useEffect, useRef, useState } from 'react';
import {
  pWordAt,
  type Dir,
  type PublicPuzzle,
  type PublicWord,
} from '@cwb/engine';
import { fmtTime, type PublicPlayer, type Snapshot } from '@cwb/shared';
import { ClueCard, Crossword, LetterPad, Spark } from '../../components';
import type { LastHint, LastResult, SessionSend } from '../../lib/useSession';
import { hapticSolve, hapticWrong } from '../../lib/haptics';
import { useSolve } from './useSolve';

// Per-player hint cooldown (mirrors the authoritative sessionDO HINT_MIN_INTERVAL_MS).
// The client pre-checks so a too-soon tap gives instant feedback with no whisper
// flash or wasted round-trip; the server still enforces + sends `hintThrottled`.
const HINT_COOLDOWN_MS = 5000;
const HINT_WAIT_MSG = 'Give it a try yourself first. Another hint in a few seconds.';

export interface GameProps {
  snapshot: Snapshot;
  pp: PublicPuzzle;
  remainingMs: number;
  send: SessionSend;
  lastHint: LastHint | null;
  lastResult: LastResult | null;
  /** "You" from the snapshot — for the live adjusted-time (penalty) readout. */
  me: PublicPlayer;
  /** Round ended without a solve (timeout or organizer end). Freezes input and
   *  plays the "pencils down" board-sweep before PlayerApp shows the result. */
  exiting?: boolean;
}

// current word + its position in the across/down list (player.jsx currentClue).
function currentClue(
  pp: PublicPuzzle,
  sel: { r: number; c: number; dir: Dir },
): PublicWord & { list: PublicWord[]; idx: number } {
  const w = pWordAt(pp, sel.r, sel.c, sel.dir) as PublicWord | null;
  if (!w) {
    const f = pp.across[0] ?? pp.down[0];
    return { ...(f as PublicWord), list: pp.across.length ? pp.across : pp.down, idx: 0 };
  }
  const list = w.dir === 'across' ? pp.across : pp.down;
  return { ...w, list, idx: list.indexOf(w) };
}

export function Game({ snapshot, pp, remainingMs, send, lastHint, lastResult, me, exiting = false }: GameProps) {
  const { config } = snapshot;
  // joinCode + round scope the persisted grid (survives a mid-round refresh).
  // `active` is false while exiting, which freezes auto-submit + persistence.
  const solve = useSolve(pp, send, lastHint, !exiting, snapshot.joinCode, snapshot.round);
  const { entries, sel } = solve;

  // Live "your time" = elapsed since the round started + accrued penalties — the
  // running adjusted time that ranks you (server `finishMs` is serverElapsedMs, so
  // at finish this converges exactly to score.adj). Surfaces the hint cost in the
  // moment: the figure jumps the instant a hint or a wrong answer lands.
  const penaltySec = me.hintsUsed * config.hintPenalty + me.wrongAttempts * config.wrongPenalty;
  const elapsedSec = Math.min(config.durationSec, Math.max(0, config.durationSec - remainingMs / 1000));
  const yourTimeSec = elapsedSec + penaltySec;

  const [toast, setToast] = useState<string | null>(null);
  const [flash, setFlash] = useState<'wrong' | 'right' | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Time of the last GRANTED/sent hint, for the client-side cooldown pre-check.
  const lastHintAtRef = useRef(0);

  // Coral spotlight on the cell an AI hint just revealed. Mirrors useSolve's
  // once-per-hint guard (baseline = the hint present at mount, so a stale hint
  // from a previous round never pulses), and self-clears so the ~4Hz clock ticks
  // never re-trigger it. `n` re-keys the ring on each new hint.
  const [hintPulse, setHintPulse] = useState<{ r: number; c: number; n: number } | null>(null);
  const appliedHintRef = useRef(lastHint);
  const hintSeqRef = useRef(0);
  useEffect(() => {
    if (!lastHint || lastHint === appliedHintRef.current) return;
    appliedHintRef.current = lastHint;
    const n = (hintSeqRef.current += 1);
    setHintPulse({ r: lastHint.r, c: lastHint.c, n });
    const t = setTimeout(() => setHintPulse((p) => (p && p.n === n ? null : p)), 850);
    return () => clearTimeout(t);
  }, [lastHint]);

  const showToast = (msg: string, ms: number) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  };

  const cl = currentClue(pp, sel);
  const danger = remainingMs <= 20000;
  // Final-10s urgency ring: re-keyed on the integer second so it pulses once per
  // second (a heartbeat marking each second leaving), not a continuous strobe.
  const final10 = remainingMs > 0 && remainingMs <= 10000;
  const secondsLeft = Math.ceil(remainingMs / 1000);

  // physical keyboard support (player.jsx keydown handler). Bound ONCE; reads the
  // latest solve via a ref so the listener never rebinds (every render produces a
  // fresh `solve` object). Arrows preventDefault so they move the selection rather
  // than scrolling the page.
  const solveRef = useRef(solve);
  solveRef.current = solve;
  const exitingRef = useRef(exiting);
  exitingRef.current = exiting;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (exitingRef.current) return; // board is sweeping out — ignore input
      const s = solveRef.current;
      if (/^[a-zA-Z]$/.test(e.key)) s.type(e.key.toUpperCase());
      else if (e.key === 'Backspace') s.backspace();
      else if (e.key === 'ArrowRight') { e.preventDefault(); s.move(0, 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); s.move(0, -1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); s.move(1, 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); s.move(-1, 0); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // React to server results (each lastResult is a fresh object ref). Baseline =
  // the result present at MOUNT: useSession only clears lastResult on a connection
  // reset, so a prior round's result is still set when Game remounts for a later
  // round (the player re-joins on the SAME socket). Ref-identity skips that stale
  // object so a new round never opens with a phantom flash/toast/haptic; every
  // genuine result this round is a fresh object and still fires. Mirrors the hint
  // guard above and useSolve's appliedHintRef.
  const appliedResultRef = useRef(lastResult);
  useEffect(() => {
    if (!lastResult || lastResult === appliedResultRef.current) return;
    if (lastResult.finished) {
      setFlash('right');
      hapticSolve(); // the final auto-submitting keystroke is a valid gesture
      const t = setTimeout(() => setFlash(null), 700);
      return () => clearTimeout(t);
    }
    if (lastResult.wrong) {
      setFlash('wrong');
      hapticWrong();
      const t = setTimeout(() => setFlash(null), 500);
      showToast(
        `Not quite: +${lastResult.wrong.penaltySec}s. Check the highlighted word.`,
        2200,
      );
      return () => clearTimeout(t);
    }
    if (lastResult.incomplete) {
      showToast(`${lastResult.incomplete.remainingCells} cells to go. Keep going.`, 1800);
    }
    if (lastResult.hintThrottled) {
      // Server-side backstop (e.g. after a mid-round refresh reset the client clock):
      // the optimistic toast from the refused tap is replaced by the wait toast.
      showToast(HINT_WAIT_MSG, 2400);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastResult]);

  const doHint = () => {
    if (!solve.currentWordId) return;
    // Cooldown pre-check: a too-soon tap shows the wait toast (no whisper, no send).
    // The server enforces the same cooldown authoritatively as a backstop.
    const now = Date.now();
    if (now - lastHintAtRef.current < HINT_COOLDOWN_MS) {
      showToast(HINT_WAIT_MSG, 2400);
      return;
    }
    // Prototype guard (player.jsx 150-152): don't spend a hint on a full word.
    const target = cl.cells.find(([r, c]) => !entries[`${r},${c}`]);
    if (!target) {
      showToast('That word is already full. Try another.', 1800);
      return;
    }
    lastHintAtRef.current = now;
    // The reveal lands as a letter in the grid (server `hint` → useSolve). A brief
    // toast confirms the action + its time cost; there is no persistent card.
    showToast(`A letter filled in. +${config.hintPenalty}s penalty.`, 2400);
    send.useHint(solve.currentWordId);
  };

  // Manual ✓ submit: useSolve.submit guards against resubmitting an unchanged
  // grid; if the grid is incomplete the server replies `incomplete` (toast).
  const doSubmit = () => {
    solve.submit();
  };

  const navClue = (delta: number) => {
    const list = cl.list;
    if (!list.length) return;
    const ni = (cl.idx + delta + list.length) % list.length;
    const target = list[ni]!;
    const [r, c] = target.cells[0]!;
    solve.goTo(r, c, target.dir);
  };

  return (
    <>
      <div
        className={'screen-scroll' + (exiting ? ' board-sweep' : '')}
        style={{ display: 'flex', flexDirection: 'column', paddingBottom: 0 }}
      >
        {/* top status */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 20px 12px',
            borderBottom: '1px solid var(--line)',
          }}
        >
          <div>
            <div className="label" style={{ fontSize: 9 }}>
              TIME LEFT
            </div>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              {final10 && <span key={secondsLeft} className="time-ring" aria-hidden="true" />}
              <div className={'h1 tnum' + (danger ? ' coral' : '')} style={{ fontSize: 30 }}>
                {fmtTime(remainingMs / 1000)}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="label" style={{ fontSize: 9 }}>
              YOUR TIME
            </div>
            <div className="h2 tnum" style={{ fontSize: 20, marginTop: 3 }}>
              {fmtTime(yourTimeSec)}
              {penaltySec > 0 && (
                <span className="label" style={{ marginLeft: 5, color: 'var(--coral-ink)' }}>
                  +{penaltySec}s
                </span>
              )}
            </div>
          </div>
          <button
            onClick={doHint}
            className="btn btn-sm"
            style={{
              width: 'auto',
              background: 'var(--coral-tint)',
              color: 'var(--coral-ink)',
              boxShadow: 'inset 0 0 0 1px var(--coral-line)',
            }}
          >
            <Spark size={13} /> Hint
          </button>
        </div>

        {/* grid */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: '20px 0 18px',
            ...(flash === 'wrong' ? { animation: 'shake .4s' } : {}),
            ...(flash === 'right' ? { animation: 'pulseGrid .6s' } : {}),
          }}
        >
          <Crossword
            puzzle={pp}
            entries={entries}
            sel={sel}
            cellSize={Math.min(56, Math.floor(312 / Math.max(pp.cols, pp.rows)))}
            onSelect={(r, c) => solve.select(r, c)}
            hintCell={hintPulse}
          />
        </div>

        {/* current clue + nav (the per-cell progress dots were removed — the
            "SOLVED %" in the status bar is the single, precise progress readout). */}
        <div className="pad" style={{ paddingBottom: 14 }}>
          <ClueCard
            clue={cl.clue}
            dir={cl.dir}
            num={cl.num}
            index={cl.idx + 1}
            total={cl.list.length}
            onPrev={() => navClue(-1)}
            onNext={() => navClue(1)}
          />
          {/* across/down toggle */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {(['across', 'down'] as Dir[]).map((d) => (
              <button
                key={d}
                onClick={() => solve.setDir(d)}
                style={{
                  flex: 1,
                  padding: '9px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  fontWeight: 500,
                  border: '1px solid ' + (sel.dir === d ? 'var(--ink)' : 'var(--line-2)'),
                  background: sel.dir === d ? 'var(--ink)' : 'transparent',
                  color: sel.dir === d ? 'var(--cream)' : 'var(--grey)',
                }}
              >
                {d.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

      </div>

      {/* Toast dock — pinned directly above the LetterPad (a flex sibling of the
          scroll area + LetterPad) so feedback is never clipped behind the keyboard.
          It carries the wrong / incomplete / cooldown messages and the hint-applied
          + penalty confirmation; all are transient and auto-dismiss. */}
      {toast && (
        <div style={{ flexShrink: 0, padding: '10px 0 4px' }}>
          <div className="pad">
            <div
              className="pop"
              style={{
                background: 'var(--ink)',
                color: 'var(--cream)',
                padding: '12px 16px',
                borderRadius: 10,
                fontSize: 13,
                fontFamily: 'var(--sans)',
                textAlign: 'center',
              }}
            >
              {toast}
            </div>
          </div>
        </div>
      )}

      <LetterPad
        className={exiting ? 'board-sweep' : undefined}
        onKey={(l) => solve.type(l)}
        onBackspace={() => solve.backspace()}
        onSubmit={doSubmit}
      />
    </>
  );
}
