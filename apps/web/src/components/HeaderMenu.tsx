// HeaderMenu.tsx — the organizer's header overflow menu (account-level actions
// that don't belong in the body: Manage organizers, Event branding, Log out).
// A kebab trigger opens a small popover. The menu is position:fixed (anchored to
// the trigger's rect on open) so it ESCAPES the `.screen-scroll` overflow clip —
// an absolutely-positioned dropdown inside that scroll container would be cut off.
import { useEffect, useRef, useState } from 'react';

export interface HeaderMenuItem {
  label: string;
  onClick: () => void;
  external?: boolean; // appends a ↗ glyph (opens a new tab/window)
  danger?: boolean; // tints the label (e.g. Log out)
}

function Kebab() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx={8} cy={3} r={1.5} fill="currentColor" />
      <circle cx={8} cy={8} r={1.5} fill="currentColor" />
      <circle cx={8} cy={13} r={1.5} fill="currentColor" />
    </svg>
  );
}

export function HeaderMenu({ items, label = 'More options' }: { items: HeaderMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });

  // While open: Esc closes; the fixed popover is anchored once, so a scroll or
  // resize (which would detach it from the trigger) closes it rather than leave
  // it floating. The fixed backdrop catches outside clicks.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const close = () => setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    // Move focus into the menu so keyboard users land on the first item.
    menuRef.current?.querySelector('button')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  function toggle() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    setOpen((o) => !o);
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn btn-ghost btn-sm"
        style={{ width: 'auto', padding: '8px 10px', color: 'var(--ink)' }}
      >
        <Kebab />
      </button>
      {open && (
        <>
          {/* full-screen backdrop: outside-click to close (transparent) */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 50 }}
          />
          <div
            ref={menuRef}
            role="menu"
            className="pop"
            style={{
              position: 'fixed',
              top: pos.top,
              right: pos.right,
              zIndex: 51,
              minWidth: 188,
              background: 'var(--paper)',
              border: '1px solid var(--line-2)',
              borderRadius: 12,
              padding: 6,
              // Functional float for a popover (kept under the 16px ghost-card
              // threshold); the hairline border does the primary definition.
              boxShadow: '0 6px 14px rgba(31,27,25,0.10)',
            }}
          >
            {items.map((it, i) => (
              <button
                key={i}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 14,
                  width: '100%',
                  textAlign: 'left',
                  padding: '11px 12px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'var(--head)',
                  fontWeight: 600,
                  fontSize: 14,
                  color: it.danger ? 'var(--coral-ink)' : 'var(--ink)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--paper-edge)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {it.label}
                {it.external && <span style={{ color: 'var(--grey-soft)' }}>↗</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
