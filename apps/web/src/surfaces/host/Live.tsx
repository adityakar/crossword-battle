// Live.tsx — the live control board: big timer, elapsed bar, finished count,
// current-leader card, and the live leaderboard (or a "hidden" suspense state).
// The leaderboard ranks finishers by score (FLIP-animated as solves land); the
// leader card crowns the top ACTUAL finisher (no "leader" until someone solves).
// Faithful port of prototype/organizer.jsx OrgLive.
//
// Responsive: phone is a single scroll column with the controls in the sticky
// footer (unchanged). Desktop (>=1024px) becomes a control room — timer + leader
// + controls on the left, the live board on the right.
import { useState } from 'react';
import { fmtTime, rankPlayers, type Snapshot } from '@cwb/shared';
import { Avatar, Bar, Btn, Chip, LbRow, Screen } from '../../components';
import type { SessionSend } from '../../lib/useSession';
import { useHostShell } from '../../lib/useHostShell';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { OrgHeader } from './OrgHeader';
import { SolutionViewer } from './SolutionViewer';
import { useCountUp, useFlip } from '../../lib/motion';

export interface LiveProps {
  snapshot: Snapshot;
  remainingMs: number;
  send: SessionSend;
}

export function Live({ snapshot, remainingMs, send }: LiveProps) {
  useHostShell();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const { config, paused, showLeaderboard } = snapshot;
  // The answer key, as a full-screen swap. Live stays mounted (and the snapshot
  // keeps flowing in via props), so closing drops the host back on the live board.
  const [showSolution, setShowSolution] = useState(false);
  const ranked = rankPlayers(snapshot.players, config, { stableUnfinished: true });
  const champ = ranked[0] && ranked[0].finishMs != null ? ranked[0] : null;
  const remainingSec = remainingMs / 1000;
  const danger = remainingSec <= 20;
  const finished = ranked.filter((p) => p.finishMs != null).length;
  const elapsed = config.durationSec > 0 ? 1 - remainingSec / config.durationSec : 0;

  const register = useFlip(ranked.map((p) => p.id).join(','));
  const champPoints = useCountUp(champ?.score?.points ?? 0);

  if (showSolution && snapshot.publicPuzzle) {
    return (
      <SolutionViewer
        puzzleId={snapshot.publicPuzzle.id}
        backLabel="← Back to round"
        onClose={() => setShowSolution(false)}
      />
    );
  }

  const headerRight = (
    <Chip kind={paused ? 'line' : 'coral-soft'} pulse={!paused}>
      {paused ? 'PAUSED' : 'LIVE'}
    </Chip>
  );

  const timerBlock = (
    <>
      <div className="kv" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="label">TIME REMAINING</div>
          <div
            className={'count-num tnum' + (danger ? ' coral' : '')}
            style={{ fontSize: isDesktop ? 88 : 72, marginTop: 4 }}
          >
            {fmtTime(remainingSec)}
          </div>
        </div>
        <div style={{ textAlign: 'right', paddingBottom: 8 }}>
          <div className="h2 tnum" style={{ fontSize: 26 }}>
            {finished}
            <span className="grey" style={{ fontSize: 16 }}>
              /{ranked.length}
            </span>
          </div>
          <div className="label" style={{ marginTop: 4 }}>
            FINISHED
          </div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <Bar value={elapsed} coral={danger} />
      </div>
    </>
  );

  const leaderCard = champ ? (
    <div
      style={{
        background: 'var(--ink)',
        borderRadius: 14,
        padding: '16px 18px',
        color: 'var(--cream)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <Avatar name={champ.name} coral size={42} />
      <div style={{ flex: 1 }}>
        <div className="label" style={{ color: 'rgba(245,242,234,0.55)' }}>
          CURRENT LEADER
        </div>
        <div className="h2" style={{ fontSize: 22, color: 'var(--cream)', marginTop: 2 }}>
          {champ.name}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="h2 tnum coral" style={{ fontSize: 24 }}>
          {champPoints}
        </div>
        <div className="label" style={{ color: 'rgba(245,242,234,0.55)', marginTop: 2 }}>
          POINTS
        </div>
      </div>
    </div>
  ) : (
    <div className="well" style={{ padding: '16px 18px', textAlign: 'center' }}>
      <div className="label">NO SOLVES YET</div>
      <div className="body" style={{ fontSize: 13, marginTop: 6 }}>
        First correct solve takes the lead.
      </div>
    </div>
  );

  const answerKeyBtn = snapshot.publicPuzzle ? (
    <Btn kind="ghost" sm onClick={() => setShowSolution(true)} style={{ width: '100%' }}>
      View answer key →
    </Btn>
  ) : null;

  const controls = (
    <>
      <div className="btn-row">
        <Btn kind="ghost" onClick={() => send.pauseToggle()}>
          {paused ? 'Resume' : 'Pause'}
        </Btn>
        <Btn kind="ghost" onClick={() => send.toggleLeaderboard()}>
          {showLeaderboard ? 'Hide Board' : 'Show Board'}
        </Btn>
      </div>
      <Btn kind="dark" onClick={() => send.endRound()}>
        End Round
      </Btn>
    </>
  );

  const board = showLeaderboard ? (
    <>
      <div className="label" style={{ marginBottom: 6 }}>
        LIVE LEADERBOARD
      </div>
      <div>
        {ranked.map((p, i) => (
          <LbRow
            key={p.id}
            innerRef={register(p.id)}
            rank={i + 1}
            player={p}
            cfg={config}
            lead={i === 0 && p.finishMs != null}
            isYou={false}
          />
        ))}
      </div>
      <div className="label" style={{ marginTop: 14, fontSize: 9, display: 'flex', gap: 14 }}>
        <span>{finished} FINISHED</span>
        <span>{ranked.reduce((a, p) => a + (p.hintsUsed || 0), 0)} HINTS USED</span>
        <span>{ranked.reduce((a, p) => a + (p.wrongAttempts || 0), 0)} WRONG</span>
      </div>
    </>
  ) : (
    <div className="well" style={{ padding: '30px 20px', textAlign: 'center' }}>
      <div className="label">LEADERBOARD HIDDEN</div>
      <div className="body" style={{ fontSize: 13, marginTop: 8 }}>
        Players can't see ranks — build the suspense.
      </div>
    </div>
  );

  // ---------------- desktop control room (>=1024px) ----------------
  if (isDesktop) {
    return (
      <>
        <OrgHeader right={headerRight} />
        <div className="host-page">
          <div className="host-split" style={{ gridTemplateColumns: 'minmax(0, 400px) minmax(0, 1fr)' }}>
            <div className="stack" style={{ '--gap': '18px' } as React.CSSProperties}>
              <div>{timerBlock}</div>
              {leaderCard}
              <div className="host-actions">
                {controls}
                {answerKeyBtn}
              </div>
            </div>
            <div>{board}</div>
          </div>
        </div>
      </>
    );
  }

  // ---------------- phone layout (unchanged) ----------------
  return (
    <Screen
      footer={
        <div className="stack" style={{ '--gap': '10px' } as React.CSSProperties}>
          {controls}
        </div>
      }
    >
      <OrgHeader right={headerRight} />
      <div className="pad" style={{ paddingTop: 18 }}>
        {timerBlock}
      </div>
      <div className="pad" style={{ marginTop: 18 }}>
        {leaderCard}
        {answerKeyBtn && <div style={{ marginTop: 10 }}>{answerKeyBtn}</div>}
      </div>
      <div className="pad" style={{ marginTop: 20 }}>
        {board}
      </div>
    </Screen>
  );
}
