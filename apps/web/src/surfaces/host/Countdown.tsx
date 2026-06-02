// Countdown.tsx — full-bleed dark "GET READY" with a massive coral digit ticked
// locally from the session clock (remainingMs). Faithful port of
// prototype/organizer.jsx OrgCountdown.
import { fmtTime, type Snapshot } from '@cwb/shared';

export interface CountdownProps {
  snapshot: Snapshot;
  remainingMs: number;
}

export function Countdown({ snapshot, remainingMs }: CountdownProps) {
  const { config } = snapshot;
  const ready = snapshot.players.length;
  // Derive the 3/2/1 digit locally from the remaining countdown time. Clamp to
  // at least 1 so we never flash 0 before the server advances to `live`.
  const digit = Math.max(1, Math.ceil(remainingMs / 1000));

  return (
    <div
      className="screen-scroll"
      style={{ background: 'var(--ink)', display: 'flex', flexDirection: 'column' }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '0 24px',
          color: 'var(--cream)',
        }}
      >
        <div className="label" style={{ color: 'rgba(245,242,234,0.55)', marginBottom: 8 }}>
          GET READY
        </div>
        <div key={digit} className="count-num pop" style={{ fontSize: 260, color: 'var(--coral)' }}>
          {digit}
        </div>
        <div className="label" style={{ color: 'rgba(245,242,234,0.55)', marginTop: 8 }}>
          {config.puzzleName.toUpperCase()} · {fmtTime(config.durationSec)} CLOCK
        </div>
      </div>
      <div
        style={{
          padding: '0 24px 60px',
          display: 'flex',
          justifyContent: 'space-between',
          color: 'var(--cream)',
        }}
      >
        <div>
          <div className="h2 tnum" style={{ fontSize: 30, color: 'var(--cream)' }}>
            {ready}
          </div>
          <div className="label" style={{ color: 'rgba(245,242,234,0.55)', marginTop: 4 }}>
            PLAYERS READY
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="h2" style={{ fontSize: 30, color: 'var(--cream)' }}>
            {snapshot.publicPuzzle ? `${snapshot.publicPuzzle.rows}×${snapshot.publicPuzzle.cols}` : '—'}
          </div>
          <div className="label" style={{ color: 'rgba(245,242,234,0.55)', marginTop: 4 }}>
            WORD SQUARE
          </div>
        </div>
      </div>
    </div>
  );
}
