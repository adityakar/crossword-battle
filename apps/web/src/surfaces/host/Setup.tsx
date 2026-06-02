// Setup.tsx — session configuration (puzzle + difficulty + clock/penalties).
// Faithful port of prototype/organizer.jsx OrgSetup, but driven by the real
// puzzle list (api.listPuzzles) and local React state. On "Open Lobby" it hands
// the chosen puzzle + config up to HostApp, which creates the session.
//
// Responsive: phone is a single scroll column with Open Lobby in the sticky
// footer (unchanged). Desktop (>=1024px) reflows into a two-pane — the puzzle
// picker + difficulty on the left, a settings rail with Open Lobby dissolved
// into it on the right.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DIFFICULTIES } from '@cwb/shared';
import { Btn, Chip, Screen, Spark, Stepper, Toggle } from '../../components';
import type * as api from '../../lib/api';
import { useHostShell } from '../../lib/useHostShell';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { OrgHeader } from './OrgHeader';
import { SolutionViewer } from './SolutionViewer';

export interface SetupConfig {
  puzzleId: string;
  puzzleName: string;
  difficulty: string;
  durationSec: number;
  hintPenalty: number;
  wrongPenalty: number;
  maxPlayers: number;
  allowLate: boolean;
}

export interface SetupProps {
  puzzles: api.PuzzleSummary[];
  round: number;
  busy?: boolean;
  error?: string | null;
  /** Pre-select this puzzle (e.g. one just created in the Builder). */
  initialPuzzleId?: string;
  onOpenLobby: (cfg: SetupConfig) => void;
  /** Return to the dashboard (Home) without opening a session. */
  onBack?: () => void;
}

const DEFAULT_DIFFICULTY = 'medium';

export function Setup({
  puzzles,
  round,
  busy = false,
  error,
  initialPuzzleId,
  onOpenLobby,
  onBack,
}: SetupProps) {
  const navigate = useNavigate();
  useHostShell();
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // Owned ("YOURS") puzzles first, mirroring the prototype's [...custom, ...presets].
  const ordered = useMemo(
    () => [...puzzles].sort((a, b) => Number(b.owned) - Number(a.owned)),
    [puzzles],
  );

  const initialDiff = DIFFICULTIES.find((d) => d.id === DEFAULT_DIFFICULTY) ?? DIFFICULTIES[0]!;

  const [puzzleId, setPuzzleId] = useState(() => initialPuzzleId ?? ordered[0]?.id ?? '');
  const [difficulty, setDifficulty] = useState(initialDiff.id);
  const [durationSec, setDurationSec] = useState(initialDiff.dur);
  const [hintPenalty, setHintPenalty] = useState(initialDiff.hint);
  const [wrongPenalty, setWrongPenalty] = useState(initialDiff.wrong);
  const [maxPlayers, setMaxPlayers] = useState(8);
  const [allowLate, setAllowLate] = useState(false);
  // Preview the selected puzzle's solution as a full-screen swap. Setup stays
  // mounted behind it (its config survives), so closing returns here unchanged.
  const [previewId, setPreviewId] = useState<string | null>(null);

  // Keep a valid selection if the list arrives after first render.
  const effectivePuzzleId = puzzleId || ordered[0]?.id || '';

  function selectDifficulty(id: string) {
    const d = DIFFICULTIES.find((x) => x.id === id);
    if (!d) return;
    setDifficulty(id);
    setDurationSec(d.dur);
    setHintPenalty(d.hint);
    setWrongPenalty(d.wrong);
  }

  function open() {
    const p = ordered.find((x) => x.id === effectivePuzzleId);
    if (!p) return;
    onOpenLobby({
      puzzleId: p.id,
      puzzleName: p.name,
      difficulty,
      durationSec,
      hintPenalty,
      wrongPenalty,
      maxPlayers,
      allowLate,
    });
  }

  const diffSub = DIFFICULTIES.find((d) => d.id === difficulty)?.sub ?? '';

  if (previewId) {
    return (
      <SolutionViewer
        puzzleId={previewId}
        backLabel="← Back to setup"
        onClose={() => setPreviewId(null)}
      />
    );
  }

  const headerRight = (
    <>
      <Chip kind="line">ROUND {round}</Chip>
      {onBack && (
        <Btn kind="ghost" sm onClick={onBack} style={{ width: 'auto' }}>
          ← Back
        </Btn>
      )}
    </>
  );

  // ---- content blocks, shared by both layouts ----
  const puzzleBlock = (
    <>
      <div className="kv" style={{ marginBottom: 11 }}>
        <span className="label">PUZZLE</span>
        <button
          onClick={() => navigate('/host/builder')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            letterSpacing: '0.08em',
            color: 'var(--coral)',
            fontWeight: 500,
          }}
        >
          <Spark size={11} /> CREATE NEW
        </button>
      </div>
      <div className="stack" style={{ '--gap': '8px' } as React.CSSProperties}>
        {ordered.map((p) => {
          const on = effectivePuzzleId === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setPuzzleId(p.id)}
              style={{
                textAlign: 'left',
                width: '100%',
                cursor: 'pointer',
                padding: '14px 16px',
                borderRadius: 12,
                background: on ? 'var(--paper)' : 'transparent',
                border: '1.5px solid ' + (on ? 'var(--coral)' : 'var(--line)'),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="h3" style={{ fontSize: 16 }}>
                  {p.name}
                </div>
                <div className="label" style={{ marginTop: 5 }}>
                  {p.sub}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                {p.owned ? (
                  <span className="chip chip-line">YOURS</span>
                ) : p.tag === 'AI-generated' ? (
                  <span className="chip chip-coral-soft">
                    <Spark size={10} />
                    AI
                  </span>
                ) : null}
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 100,
                    border: '2px solid ' + (on ? 'var(--coral)' : 'var(--line-3)'),
                    background: on ? 'var(--coral)' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {on && (
                    <span style={{ width: 6, height: 6, borderRadius: 100, background: '#fff' }} />
                  )}
                </span>
              </div>
            </button>
          );
        })}
        {ordered.length === 0 && (
          <div className="body" style={{ fontSize: 13, padding: '8px 2px' }}>
            No puzzles available.
          </div>
        )}
      </div>
      {effectivePuzzleId && (
        <Btn
          kind="ghost"
          sm
          onClick={() => setPreviewId(effectivePuzzleId)}
          style={{ width: '100%', marginTop: 10 }}
        >
          View solved grid →
        </Btn>
      )}
    </>
  );

  const difficultyBlock = (
    <>
      <div className="label" style={{ marginBottom: 11 }}>
        DIFFICULTY
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {DIFFICULTIES.map((d) => {
          const on = difficulty === d.id;
          return (
            <button
              key={d.id}
              onClick={() => selectDifficulty(d.id)}
              style={{
                cursor: 'pointer',
                padding: '10px 14px',
                borderRadius: 100,
                border: '1.5px solid ' + (on ? 'var(--coral)' : 'var(--line-2)'),
                background: on ? 'var(--coral)' : 'transparent',
                color: on ? '#fff' : 'var(--ink)',
                fontFamily: 'var(--head)',
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {d.name}
            </button>
          );
        })}
      </div>
      <div className="body" style={{ fontSize: 13, marginTop: 12 }}>
        {diffSub}
      </div>
    </>
  );

  const settingsCard = (
    <div className="card" style={{ padding: '4px 18px' }}>
      <div className="kv" style={{ padding: '18px 0', borderBottom: '1px solid var(--line)' }}>
        <div>
          <div className="h3" style={{ fontSize: 15 }}>
            Duration
          </div>
          <div className="label" style={{ marginTop: 4 }}>
            ROUND CLOCK
          </div>
        </div>
        <Stepper value={durationSec} set={setDurationSec} min={30} max={600} step={15} suffix="s" />
      </div>
      <div className="kv" style={{ padding: '18px 0', borderBottom: '1px solid var(--line)' }}>
        <div>
          <div className="h3" style={{ fontSize: 15 }}>
            Hint penalty
          </div>
          <div className="label" style={{ marginTop: 4 }}>
            PER AI HINT
          </div>
        </div>
        <Stepper value={hintPenalty} set={setHintPenalty} min={0} max={30} step={1} suffix="s" />
      </div>
      <div className="kv" style={{ padding: '18px 0', borderBottom: '1px solid var(--line)' }}>
        <div>
          <div className="h3" style={{ fontSize: 15 }}>
            Wrong-answer penalty
          </div>
          <div className="label" style={{ marginTop: 4 }}>
            PER MISTAKE
          </div>
        </div>
        <Stepper value={wrongPenalty} set={setWrongPenalty} min={0} max={30} step={1} suffix="s" />
      </div>
      <div className="kv" style={{ padding: '18px 0', borderBottom: '1px solid var(--line)' }}>
        <div>
          <div className="h3" style={{ fontSize: 15 }}>
            Max players
          </div>
          <div className="label" style={{ marginTop: 4 }}>
            LOBBY CAP
          </div>
        </div>
        <Stepper value={maxPlayers} set={setMaxPlayers} min={1} max={64} step={1} />
      </div>
      <div className="kv" style={{ padding: '18px 0' }}>
        <div>
          <div className="h3" style={{ fontSize: 15 }}>
            Allow late joiners
          </div>
          <div className="label" style={{ marginTop: 4 }}>
            JOIN AFTER START
          </div>
        </div>
        <Toggle on={allowLate} set={setAllowLate} />
      </div>
    </div>
  );

  const openBtn = (
    <Btn kind="coral" disabled={busy || !effectivePuzzleId} onClick={open}>
      {busy ? 'Opening…' : 'Open Lobby →'}
    </Btn>
  );

  const errorLine = error ? (
    <div className="body" style={{ fontSize: 13, color: 'var(--coral)' }}>
      {error}
    </div>
  ) : null;

  // ---------------- desktop two-pane (>=1024px) ----------------
  if (isDesktop) {
    return (
      <>
        <OrgHeader right={headerRight} />
        <div className="host-page">
          <div className="label">SESSION SETUP</div>
          <div className="h1" style={{ fontSize: 36, marginTop: 8, marginBottom: 28 }}>
            Configure round
          </div>
          <div className="host-split" style={{ gridTemplateColumns: 'minmax(0, 1fr) 360px' }}>
            <div className="stack" style={{ '--gap': '30px' } as React.CSSProperties}>
              <div>{puzzleBlock}</div>
              <div>{difficultyBlock}</div>
            </div>
            <div>
              {settingsCard}
              <div className="host-actions" style={{ marginTop: 16 }}>
                {openBtn}
                {errorLine}
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ---------------- phone layout (unchanged) ----------------
  return (
    <Screen footer={openBtn}>
      <OrgHeader right={headerRight} />
      <div className="pad" style={{ paddingTop: 22 }}>
        <div className="label">SESSION SETUP</div>
        <div className="h1" style={{ fontSize: 32, marginTop: 8 }}>
          Configure round
        </div>
      </div>
      <div className="pad" style={{ marginTop: 24 }}>
        {puzzleBlock}
      </div>
      <div className="pad" style={{ marginTop: 26 }}>
        {difficultyBlock}
      </div>
      <div className="pad" style={{ marginTop: 26 }}>
        {settingsCard}
      </div>
      {error && (
        <div className="pad" style={{ marginTop: 16 }}>
          {errorLine}
        </div>
      )}
    </Screen>
  );
}
