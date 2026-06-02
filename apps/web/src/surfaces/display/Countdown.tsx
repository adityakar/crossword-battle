// Countdown.tsx — full-bleed dark "GET READY" with a 420px coral digit, ticked
// locally from the session clock. Faithful port of prototype/display.jsx
// DispCountdown (no DispChrome — this screen is intentionally chrome-less).
//
// The prototype read `state.countdownFrom` for the digit; here we derive 3/2/1
// from the authoritative remaining countdown time (`remainingMs`), clamped to ≥1
// so we never flash 0 before the server advances to `live`. `key={digit}`
// re-fires the `pop` entrance on each tick (host Countdown pattern).
import { fmtTime, type Snapshot } from '@cwb/shared';

export interface CountdownProps {
  snapshot: Snapshot;
  remainingMs: number;
}

export function Countdown({ snapshot, remainingMs }: CountdownProps) {
  const { config } = snapshot;
  const ready = snapshot.players.length;
  const digit = Math.max(1, Math.ceil(remainingMs / 1000));

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--ink)',
        color: 'var(--cream)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div className="label" style={{ color: 'rgba(245,242,234,0.55)', fontSize: 16 }}>
        GET READY · {ready} PLAYERS
      </div>
      <div
        key={digit}
        className="count-num pop"
        style={{ fontSize: 420, color: 'var(--coral)', margin: '-20px 0' }}
      >
        {digit}
      </div>
      <div className="label" style={{ color: 'rgba(245,242,234,0.55)', fontSize: 16 }}>
        {config.puzzleName.toUpperCase()} · {fmtTime(config.durationSec)} CLOCK
      </div>
    </div>
  );
}
