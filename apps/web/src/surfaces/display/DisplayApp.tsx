// DisplayApp.tsx — the public booth display: a 16:9 surface that fills the
// viewport and renders the faithful big-screen for each phase. Read-only
// spectator: `useSession(code, 'tv')` opens the socket but the display never
// sends a control/player verb (it never destructures `send`). Routes by
// snapshot.phase; falls back to Idle/Standby when there's no session yet.
// Faithful recreation of prototype/display.jsx DisplaySurface, with the device
// frame dropped — the root fills the viewport directly.
import type { ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useSession } from '../../lib/useSession';
import { Idle } from './Idle';
import { Lobby } from './Lobby';
import { Countdown } from './Countdown';
import { Live } from './Live';
import { Winner } from './Winner';

export function DisplayApp({
  code: codeProp,
  boothPrefix,
}: { code?: string; boothPrefix?: string } = {}) {
  const params = useParams();
  const code = codeProp ?? params.code ?? '';
  const { snapshot, remainingMs } = useSession(code, 'tv');

  // No snapshot yet (connecting), or no active round → Idle/Standby.
  let screen: ReactElement;
  if (!snapshot) {
    screen = <Idle prefix={boothPrefix} />;
  } else {
    switch (snapshot.phase) {
      case 'lobby':
        screen = <Lobby snapshot={snapshot} boothPrefix={boothPrefix} />;
        break;
      case 'countdown':
        screen = <Countdown snapshot={snapshot} remainingMs={remainingMs} />;
        break;
      case 'live':
        screen = <Live snapshot={snapshot} remainingMs={remainingMs} />;
        break;
      case 'winner':
        screen = <Winner snapshot={snapshot} />;
        break;
      case 'idle':
      default:
        screen = <Idle prefix={boothPrefix} />;
        break;
    }
  }

  return (
    // `position:fixed; inset:0` anchors the screen to the viewport so the
    // screens' `position:absolute; inset:0` children (which the prototype relied
    // on a positioned frame for) fill it correctly. overflow:hidden keeps the
    // booth screen clean of scrollbars.
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--cream)' }}>
      {screen}
    </div>
  );
}
