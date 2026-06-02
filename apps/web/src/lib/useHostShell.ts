import { useEffect } from 'react';

// useHostShell — host surfaces that have a desktop layout opt INTO a wider
// editorial shell. On a desktop viewport the phone-column frame (440px) would
// strand the organizer's controls in a strip, so a surface designed to use the
// space calls this to widen #root (see the `.host-shell` rules in global.css).
// Players (/j), the booth (/tv), login and landing never opt in, so they keep
// their existing layouts untouched.
//
// Two widths:
//   'wide' (default, ~1080px) — dashboards, control rooms, two-pane surfaces.
//   'read' (~640px)           — forms and lists, where a bounded reading column
//                               is the right desktop treatment (no two-pane).
//
// Per-surface, NOT app-wide: only call it from a surface that actually has a
// desktop layout. Navigating to a host surface that hasn't been widened yet
// drops the class on unmount, so it falls back to the 440px phone column.
//
// `.host-shell` is ref-counted so it survives a transition where two opted-in
// surfaces briefly overlap. The 'read' modifier is plain add/remove: host
// surfaces never mount concurrently (HostApp shows one view; routes are
// separate), and a wide surface never touches it.
let mounted = 0;

export function useHostShell(variant: 'wide' | 'read' = 'wide'): void {
  useEffect(() => {
    const root = document.getElementById('root');
    mounted += 1;
    root?.classList.add('host-shell');
    if (variant === 'read') root?.classList.add('host-shell-read');
    return () => {
      if (variant === 'read') root?.classList.remove('host-shell-read');
      mounted -= 1;
      if (mounted <= 0) {
        mounted = 0;
        root?.classList.remove('host-shell');
      }
    };
  }, [variant]);
}
