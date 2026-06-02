// DispChrome.tsx — the booth-screen chrome: a top bar (Mark + EVENT appName +
// eventLine · venueLabel, with a per-screen `right` slot) over a flex body that
// fills the surface. Faithful port of prototype/display.jsx DispChrome, adapted
// to read the white-label EVENT from context instead of a hardcoded `EVENT`.
//
// The prototype used `position:absolute; inset:0` because it lived inside a
// positioned `.display-screen` frame. Here DispChrome is a plain column that
// fills its (fixed, full-viewport) parent — the body uses `flex:1` + `position:
// relative` so absolutely-positioned children (e.g. the dark split panels) still
// anchor correctly.
import type { ReactNode } from 'react';
import { Mark } from '../../components';
import { useEvent, lockup } from '../../lib/event';

export interface DispChromeProps {
  children: ReactNode;
  right?: ReactNode;
}

export function DispChrome({ children, right }: DispChromeProps) {
  const event = useEvent();
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--cream)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '26px 40px',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Mark size={30} />
          <div>
            <div className="h3" style={{ fontSize: 20 }}>
              {event.appName}
            </div>
            {lockup(event.eventLine, event.venueLabel.toUpperCase()) && (
              <div className="label" style={{ fontSize: 11, marginTop: 3 }}>
                {lockup(event.eventLine, event.venueLabel.toUpperCase())}
              </div>
            )}
          </div>
        </div>
        {right}
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>{children}</div>
    </div>
  );
}
