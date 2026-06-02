// LetterPad.tsx — on-screen QWERTY pad. Faithful port of prototype/ui.jsx
// (lines 263–289). Same key styles, layout, DEL/✓ keys, dark variant.
import type { CSSProperties } from 'react';

export interface LetterPadProps {
  onKey: (letter: string) => void;
  onBackspace: () => void;
  onSubmit: () => void;
  dark?: boolean;
  /** Extra class on the pad root (e.g. the round-end board-sweep animation). */
  className?: string;
}

export function LetterPad({ onKey, onBackspace, onSubmit, dark = false, className }: LetterPadProps) {
  const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
  const keyStyle: CSSProperties = {
    height: 46,
    borderRadius: 8,
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--head)',
    fontWeight: 600,
    fontSize: 18,
    background: dark ? 'rgba(245,242,234,0.1)' : 'var(--paper)',
    color: dark ? 'var(--cream)' : 'var(--ink)',
    border: '1px solid ' + (dark ? 'rgba(245,242,234,0.12)' : 'var(--line)'),
    cursor: 'pointer',
    userSelect: 'none',
  };
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        // flex-shrink:0 keeps the keyboard at full height (it's a flex child of the
        // app shell); the safe-area inset lifts the bottom row above the home bar.
        flexShrink: 0,
        padding: '12px 8px calc(8px + env(safe-area-inset-bottom))',
        background: dark ? 'var(--night-2)' : 'var(--paper-edge)',
        borderTop: '1px solid var(--line)',
      }}
    >
      {rows.map((row, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: 6,
            padding: i === 1 ? '0 16px' : i === 2 ? '0 0' : '0',
          }}
        >
          {i === 2 && (
            <div
              className="lp-key"
              onClick={onBackspace}
              style={{ ...keyStyle, flex: 1.5, fontSize: 13, fontFamily: 'var(--mono)' }}
            >
              DEL
            </div>
          )}
          {row.split('').map((l) => (
            <div key={l} className="lp-key" onClick={() => onKey(l)} style={keyStyle}>
              {l}
            </div>
          ))}
          {i === 2 && (
            <div
              className="lp-key"
              onClick={onSubmit}
              style={{
                ...keyStyle,
                flex: 1.5,
                background: 'var(--coral)',
                color: '#fff',
                border: 'none',
                fontSize: 13,
                fontFamily: 'var(--mono)',
              }}
            >
              ✓
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
