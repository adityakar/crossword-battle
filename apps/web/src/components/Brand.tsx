// Brand.tsx — Mark (grid glyph) + Wordmark (lockup). Faithful port of
// prototype/ui.jsx lines 5–34. `Mark` is props-only; `Wordmark` reads the
// active EVENT (appName / eventLine) from context, with optional override props.
import { useEvent } from '../lib/event';

export interface MarkProps {
  size?: number;
  on?: 'ink' | 'cream';
}

// tiny crossword-grid glyph: 3×3, two cells inked, one coral
export function Mark({ size = 22, on = 'ink' }: MarkProps) {
  const g = size / 3;
  const base = on === 'cream' ? '#F5F2EA' : '#1F1B19';
  const fills: Record<string, string> = {
    '0,0': base,
    '1,1': base,
    '2,2': base,
    '2,0': 'var(--coral)',
    '0,2': base,
  };
  const cells = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const f = fills[`${r},${c}`];
      cells.push(
        <rect
          key={`${r}${c}`}
          x={c * g}
          y={r * g}
          width={g - 1.5}
          height={g - 1.5}
          rx={1}
          fill={f || 'transparent'}
          stroke={f ? undefined : on === 'cream' ? 'rgba(245,242,234,0.35)' : 'rgba(31,27,25,0.22)'}
          strokeWidth={f ? 0 : 1}
        />,
      );
    }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      {cells}
    </svg>
  );
}

export interface WordmarkProps {
  on?: 'ink' | 'cream';
  sub?: boolean;
  /** Override the EVENT app name (defaults to the active event). */
  appName?: string;
  /** Override the EVENT sub-lockup line. */
  eventLine?: string;
}

export function Wordmark({ on = 'ink', sub = true, appName, eventLine }: WordmarkProps) {
  const event = useEvent();
  const name = appName ?? event.appName;
  const line = eventLine ?? event.eventLine;
  const ink = on === 'cream' ? 'var(--cream)' : 'var(--ink)';
  const grey = on === 'cream' ? 'rgba(245,242,234,0.6)' : 'var(--grey-soft)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Mark size={22} on={on} />
      <div style={{ lineHeight: 1 }}>
        <div className="h3" style={{ fontSize: 15, color: ink, letterSpacing: '-0.01em' }}>
          {name}
        </div>
        {sub && line && (
          <div className="label" style={{ fontSize: 9, color: grey, marginTop: 3 }}>
            {line}
          </div>
        )}
      </div>
    </div>
  );
}
