// Countdown.tsx — full-dark "STARTING IN" mirror. Faithful port of
// prototype/player.jsx PlayerCountdown. The 3/2/1 digit is derived locally from
// the session clock (remainingMs), not a reducer field.
import type { PublicPlayer } from '@cwb/shared';

export interface CountdownProps {
  me: PublicPlayer;
  remainingMs: number;
}

export function Countdown({ me, remainingMs }: CountdownProps) {
  // Clamp to ≥1 so we never flash 0 before the server advances to `live`.
  const digit = Math.max(1, Math.ceil(remainingMs / 1000));
  const name = me.name.split(' ')[0]?.toUpperCase() ?? '';

  return (
    <div
      className="screen-scroll"
      style={{
        background: 'var(--ink)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--cream)',
      }}
    >
      <div className="label" style={{ color: 'rgba(245,242,234,0.55)' }}>
        STARTING IN
      </div>
      {/* Each beat punches in (count-tick) with a coral ring expanding past the
          digit (count-ring). Both re-key on `digit` so they replay every tick.
          The shared `count-num` look is reused; `.pop` is intentionally not. */}
      <div className="count-stage" style={{ margin: '10px 0' }}>
        <span key={`ring-${digit}`} className="count-ring" aria-hidden="true" />
        <div key={digit} className="count-num count-tick" style={{ fontSize: 200, color: 'var(--coral)' }}>
          {digit}
        </div>
      </div>
      <div className="label" style={{ color: 'rgba(245,242,234,0.55)' }}>
        PENCILS UP, {name}
      </div>
    </div>
  );
}
