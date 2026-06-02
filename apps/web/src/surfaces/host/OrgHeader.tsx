// OrgHeader.tsx — the organizer screens' top bar (Wordmark + a right-aligned
// chip/control). Faithful port of prototype/organizer.jsx OrgHeader.
//
// `onLogout` is optional: when provided (e.g. on the Home landing) a compact
// ghost "Log out" button renders next to the `right` slot so the organizer can
// clear their session. Screens that don't pass it (Lobby/Winner) are unchanged.
import type { ReactNode } from 'react';
import { Btn, Wordmark } from '../../components';

export interface OrgHeaderProps {
  right?: ReactNode;
  onLogout?: () => void;
}

export function OrgHeader({ right, onLogout }: OrgHeaderProps) {
  return (
    <div
      className="org-header"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 22px 14px',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <Wordmark />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {right}
        {onLogout && (
          <Btn kind="ghost" sm onClick={onLogout} style={{ width: 'auto' }}>
            Log out
          </Btn>
        )}
      </div>
    </div>
  );
}
