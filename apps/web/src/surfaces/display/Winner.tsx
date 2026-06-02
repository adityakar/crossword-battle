// Winner.tsx — the result screen: the champion's name + three stats (finish
// time / adjusted score / penalty), a deterministic AI line, and a TOP 5 rail
// with a "scan again to play" CTA. Faithful port of prototype/display.jsx
// DispWinner.
//
// Adaptation: the winner is `snapshot.winner` (server-authoritative), not the
// prototype's `ranked.find(p => p.score)`. The stats come from
// `scoreFor(snapshot.winner, config)`.
import {
  fmtTime,
  rankPlayers,
  scoreFor,
  type PublicPlayer,
  type Snapshot,
} from '@cwb/shared';
import { Chip, LbRow, Spark } from '../../components';
import { DispChrome } from './DispChrome';
import { useCountUp } from '../../lib/motion';

export interface WinnerProps {
  snapshot: Snapshot;
}

// Local deterministic fallback for the winner commentary. The authoritative line
// now comes from the server (`snapshot.commentary`), decided once at round end and
// upgraded to a live AI line; this only renders if a winner snapshot somehow
// carries none. Ported from the prototype (the wrapping quotes are added in JSX).
function aiWinnerLine(w: PublicPlayer): string {
  const clean = w.hintsUsed === 0 && w.wrongAttempts === 0;
  return `${clean ? 'A clean sheet. No hints, no misses.' : 'Fast hands and a little AI help.'} The floor has a champion.`;
}

export function Winner({ snapshot }: WinnerProps) {
  const { config, round, winner, joinCode, commentary } = snapshot;
  const ranked = rankPlayers(snapshot.players, config);
  const score = winner ? scoreFor(winner, config) : null;
  const points = useCountUp(score?.points ?? 0);

  return (
    <DispChrome
      right={
        <Chip kind="ink" style={{ fontSize: 13, padding: '8px 14px' }}>
          ROUND {round} · FINAL
        </Chip>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', height: '100%' }}>
        <div
          style={{
            position: 'relative',
            overflow: 'hidden',
            padding: '48px 56px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          {winner && score && <div className="victory-glow" aria-hidden="true" />}
          <div style={{ position: 'relative', zIndex: 1 }}>
          {winner && score ? (
            <>
              <div className="label rise" style={{ color: 'var(--coral)', fontSize: 14 }}>
                🏆 ROUND WINNER
              </div>
              <div className="display pop d1" style={{ fontSize: 88, marginTop: 14 }}>
                {winner.name}
              </div>
              <div className="rise d2" style={{ display: 'flex', gap: 48, marginTop: 34 }}>
                <div>
                  <div className="display tnum coral" style={{ fontSize: 56 }}>
                    {fmtTime(score.raw)}
                  </div>
                  <div className="label" style={{ marginTop: 8 }}>
                    FINISH TIME
                  </div>
                </div>
                <div>
                  <div className="display tnum" style={{ fontSize: 56 }}>
                    {points}
                  </div>
                  <div className="label" style={{ marginTop: 8 }}>
                    ADJ. SCORE
                  </div>
                </div>
                <div>
                  <div className="display tnum" style={{ fontSize: 56 }}>
                    +{score.pen}s
                  </div>
                  <div className="label" style={{ marginTop: 8 }}>
                    PENALTY
                  </div>
                </div>
              </div>
              <div
                className="rise d3"
                style={{ marginTop: 34, display: 'flex', gap: 10, alignItems: 'center', maxWidth: 440 }}
              >
                <Spark />
                <span className="body body-ink" style={{ fontSize: 17, fontStyle: 'italic' }}>
                  &ldquo;{commentary ?? aiWinnerLine(winner)}&rdquo;
                </span>
              </div>
            </>
          ) : (
            <div className="display" style={{ fontSize: 64 }}>
              No solve this round
              <span className="coral">.</span>
            </div>
          )}
          </div>
        </div>
        <div
          style={{
            padding: '40px 44px',
            borderLeft: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div className="label" style={{ marginBottom: 8 }}>
            TOP 5
          </div>
          {ranked.slice(0, 5).map((p, i) => (
            <LbRow
              key={p.id}
              rank={i + 1}
              player={p}
              cfg={config}
              lead={i === 0 && p.finishMs != null}
              roundOver
            />
          ))}
          <div style={{ flex: 1 }} />
          <div
            style={{
              background: 'var(--cream)',
              borderTop: '1px solid var(--line)',
              paddingTop: 20,
              marginTop: 20,
            }}
          >
            <div className="label">NEXT ROUND OPENS SHORTLY</div>
            <div className="h3" style={{ fontSize: 18, marginTop: 6 }}>
              Scan again to play · <span className="mono coral">{joinCode}</span>
            </div>
          </div>
        </div>
      </div>
    </DispChrome>
  );
}
