// Winner.tsx — the result screen: champion name + stats, an AI-commentary card,
// and a TOP 5 leaderboard. Faithful port of prototype/organizer.jsx OrgWinner,
// driven by snapshot.winner + scoreFor + rankPlayers.
//
// Responsive: phone is a single scroll column with the round-end actions in the
// sticky footer (unchanged). Desktop (>=1024px) splits into the champion +
// commentary + actions on the left and the TOP 5 board on the right.
import { fmtTime, rankPlayers, scoreFor, type PublicPlayer, type ScoreCfg, type Snapshot } from '@cwb/shared';
import { Btn, Chip, LbRow, Screen, Spark } from '../../components';
import type { SessionSend } from '../../lib/useSession';
import { useCountUp } from '../../lib/motion';
import { useHostShell } from '../../lib/useHostShell';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { OrgHeader } from './OrgHeader';

export interface WinnerProps {
  snapshot: Snapshot;
  send: SessionSend;
  /** End the whole session from the round-end screen (no need to start another
   *  round first). Terminates server-side, then clears local state → Home. */
  onEndSession: () => void;
}

// Local deterministic fallback for the winner commentary. The authoritative line
// now comes from the server (`snapshot.commentary`), decided once at round end and
// upgraded to a live AI line; this only renders in the (practically unreachable)
// case where a winner snapshot carries no commentary. Ported from the prototype.
function aiWinnerLine(w: PublicPlayer, raw: number): string {
  if (w.hintsUsed === 0 && w.wrongAttempts === 0)
    return `Clean sheet — no hints, no misses, ${fmtTime(raw)} flat. The model is taking notes.`;
  if (w.hintsUsed > 0)
    return `${fmtTime(raw)} with a little help from the assistant. Resourceful is a strategy.`;
  return `${fmtTime(raw)} and steady hands. A worthy floor champion.`;
}

export function Winner({ snapshot, send, onEndSession }: WinnerProps) {
  useHostShell();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const { config, round, winner, commentary } = snapshot;
  const cfg: ScoreCfg = config;
  const ranked = rankPlayers(snapshot.players, config).slice(0, 5);
  const score = winner ? scoreFor(winner, cfg) : null;
  const points = useCountUp(score?.points ?? 0);
  const line =
    winner && score
      ? (commentary ?? aiWinnerLine(winner, score.raw))
      : 'No finishers this round — the puzzle wins.';

  const championBlock =
    winner && score ? (
      <div>
        {/* No 🏆 emoji: it rendered inconsistently across devices and is off the
            design system's no-emoji rule. The coral eyebrow + display name +
            count-up score crown the winner. */}
        <div className="label rise">WINNER · {config.puzzleName.toUpperCase()}</div>
        <div className="display rise d1" style={{ fontSize: isDesktop ? 60 : 48, marginTop: 12 }}>
          {winner.name}
        </div>
        <div className="rise d2" style={{ display: 'flex', gap: 26, marginTop: 20 }}>
          <div>
            <div className="h1 tnum coral" style={{ fontSize: 34 }}>
              {fmtTime(score.raw)}
            </div>
            <div className="label" style={{ marginTop: 5 }}>
              FINISH TIME
            </div>
          </div>
          <div>
            <div className="h1 tnum" style={{ fontSize: 34 }}>
              {points}
            </div>
            <div className="label" style={{ marginTop: 5 }}>
              ADJ. SCORE
            </div>
          </div>
          <div>
            <div className="h1 tnum" style={{ fontSize: 34 }}>
              +{score.pen}
              <span className="label">s</span>
            </div>
            <div className="label" style={{ marginTop: 5 }}>
              PENALTY
            </div>
          </div>
        </div>
        <div
          className="rise d3"
          style={{
            marginTop: 20,
            borderRadius: 14,
            padding: '15px 17px',
            background: 'var(--coral-tint)',
            border: '1px solid var(--coral-line)',
          }}
        >
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <Spark />
            <span className="label label-coral" style={{ fontSize: 10 }}>
              AI COMMENTARY
            </span>
          </div>
          <div className="body body-ink" style={{ fontSize: 15, fontStyle: 'italic' }}>
            &ldquo;{line}&rdquo;
          </div>
        </div>
      </div>
    ) : (
      <div style={{ textAlign: isDesktop ? 'left' : 'center' }}>
        <div className="display" style={{ fontSize: 40 }}>
          No solve.
        </div>
        <div className="body" style={{ marginTop: 12 }}>
          {line}
        </div>
      </div>
    );

  const actions = (
    <>
      {/* The "Mark Prize Given" CTA was removed: prize-given was never persisted
          (ephemeral DO state only, not in round_results), so the toggle couldn't
          surface in history and carried no lasting meaning. */}
      <Btn kind="dark" onClick={() => send.nextRound()}>
        Start Next Round →
      </Btn>
      {/* End the session straight from here — no need to start another round
          first. Mirrors the Lobby's End Session: terminate server-side, and only
          go Home if the verb actually went out (a send dropped on a closed socket
          must not strand a still-live server session). Kept ghost + last so it
          never competes with the continue action above. */}
      <Btn kind="ghost" onClick={() => { if (send.endSession()) onEndSession(); }}>
        End Session
      </Btn>
    </>
  );

  const top5 = (
    <>
      <div className="label" style={{ marginBottom: 6 }}>
        TOP 5
      </div>
      {ranked.map((p, i) => (
        <LbRow
          key={p.id}
          rank={i + 1}
          player={p}
          cfg={config}
          lead={i === 0 && p.finishMs != null}
          isYou={false}
          roundOver
        />
      ))}
    </>
  );

  // ---------------- desktop two-pane (>=1024px) ----------------
  if (isDesktop) {
    return (
      <>
        <OrgHeader right={<Chip kind="ink">ROUND {round} · FINAL</Chip>} />
        <div className="host-page">
          <div className="host-split" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 420px)' }}>
            <div>
              {championBlock}
              <div className="host-actions" style={{ marginTop: 26, maxWidth: 360 }}>
                {actions}
              </div>
            </div>
            <div>{top5}</div>
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
          {actions}
        </div>
      }
    >
      <OrgHeader right={<Chip kind="ink">ROUND {round} · FINAL</Chip>} />
      <div className="pad" style={{ paddingTop: winner && score ? 22 : 40 }}>
        {championBlock}
      </div>
      <div className="pad" style={{ marginTop: 24 }}>
        {top5}
      </div>
    </Screen>
  );
}
