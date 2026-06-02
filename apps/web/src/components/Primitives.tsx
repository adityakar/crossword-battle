// Primitives.tsx — small shared UI atoms. Faithful ports of prototype/ui.jsx
// (Screen, Btn, Chip, KV, Stat, Bar, Spark) and prototype/organizer.jsx
// (Avatar, Stepper, Toggle). Same classes / inline styles / behavior.
//
// NOTE: the device-frame harness (PhoneFrame / DisplayFrame / StatusBar) is
// intentionally NOT ported. `Screen` keeps its scroll + optional sticky footer
// scaffold for a full-viewport mobile layout — no phone chrome.
import type { CSSProperties, ReactNode } from 'react';

// ---------- generic screen scaffold (scroll area + optional sticky footer) ----------
export interface ScreenProps {
  children: ReactNode;
  footer?: ReactNode;
  dark?: boolean;
  pad?: boolean;
  /**
   * Fill the scroll viewport as a flex column so a child marked `margin: auto 0`
   * centers vertically (and falls back to top-aligned + scroll when the content is
   * taller than the viewport — the clip-safe pattern the login/landing use). The
   * screen keeps a top element (e.g. the Wordmark) pinned and centers the body
   * below it. Off by default; only the resting player screens opt in.
   */
  center?: boolean;
}

export function Screen({ children, footer, dark = false, pad = true, center = false }: ScreenProps) {
  return (
    <>
      <div className="screen-scroll" style={{ paddingBottom: footer || center ? 0 : 34 }}>
        <div
          style={
            center
              ? { minHeight: '100%', display: 'flex', flexDirection: 'column', padding: pad ? '4px 0 24px' : 0 }
              : { padding: pad ? '4px 0 24px' : 0 }
          }
        >
          {children}
        </div>
      </div>
      {footer && (
        <div
          style={{
            // flex-shrink:0 pins the footer to the bottom of the app shell; the
            // safe-area inset keeps the action buttons clear of the home bar.
            flexShrink: 0,
            padding: '14px 22px max(30px, calc(16px + env(safe-area-inset-bottom)))',
            borderTop: '1px solid var(--line)',
            background: dark ? 'var(--night-2)' : 'var(--paper)',
          }}
        >
          {footer}
        </div>
      )}
    </>
  );
}

// ---------- buttons ----------
export type BtnKind = 'coral' | 'dark' | 'ghost';

export interface BtnProps {
  kind?: BtnKind;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Append the `btn-sm` modifier (smaller padding/type). */
  sm?: boolean;
}

export function Btn({
  kind = 'coral',
  children,
  onClick,
  disabled,
  className = '',
  style,
  sm = false,
}: BtnProps) {
  const cls = `btn btn-${kind}${sm ? ' btn-sm' : ''} ${className}`.trim();
  return (
    <button className={cls} onClick={onClick} disabled={disabled} style={style}>
      {children}
    </button>
  );
}

// ---------- chips ----------
export type ChipKind = 'line' | 'ink' | 'coral' | 'coral-soft';

export interface ChipProps {
  kind?: ChipKind;
  children: ReactNode;
  pulse?: boolean;
  style?: CSSProperties;
}

export function Chip({ kind = 'line', children, pulse = false, style }: ChipProps) {
  return (
    <span className={`chip chip-${kind}`} style={style}>
      {pulse && <span className="dot dot-pulse" />}
      {children}
    </span>
  );
}

// ---------- key/value ----------
export interface KVProps {
  k: ReactNode;
  v: ReactNode;
  vClass?: string;
  sub?: ReactNode;
}

export function KV({ k, v, vClass = '', sub }: KVProps) {
  return (
    <div className="kv" style={{ padding: '13px 0', borderBottom: '1px solid var(--line)' }}>
      <span className="label">{k}</span>
      <span className={`h3 tnum ${vClass}`} style={{ fontSize: 16 }}>
        {v}
        {sub && (
          <span className="label" style={{ marginLeft: 6 }}>
            {sub}
          </span>
        )}
      </span>
    </div>
  );
}

// ---------- stat ----------
export interface StatProps {
  n: ReactNode;
  label: ReactNode;
  coral?: boolean;
}

export function Stat({ n, label, coral = false }: StatProps) {
  return (
    <div>
      <div className={'h1 tnum' + (coral ? ' coral' : '')} style={{ fontSize: 34, lineHeight: 1 }}>
        {n}
      </div>
      <div className="label" style={{ marginTop: 6 }}>
        {label}
      </div>
    </div>
  );
}

// ---------- progress bar ----------
export interface BarProps {
  value: number;
  coral?: boolean;
}

export function Bar({ value, coral = false }: BarProps) {
  return (
    <div className="bar">
      <div
        className={'bar-fill' + (coral ? ' coral' : '')}
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

// ---------- spark (AI sparkle glyph) ----------
export interface SparkProps {
  size?: number;
  color?: string;
}

export function Spark({ size = 14, color = 'var(--coral)' }: SparkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M7 0L8.4 5.6L14 7L8.4 8.4L7 14L5.6 8.4L0 7L5.6 5.6L7 0Z" fill={color} />
    </svg>
  );
}

// ---------- avatar (initials) ----------
export interface AvatarProps {
  name: string;
  size?: number;
  coral?: boolean;
}

export function Avatar({ name, size = 32, coral = false }: AvatarProps) {
  const initials = name
    ? name
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
    : '?';
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 9,
        flexShrink: 0,
        background: coral ? 'var(--coral)' : 'var(--ink)',
        color: coral ? '#fff' : 'var(--cream)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--mono)',
        fontSize: size * 0.34,
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}
    >
      {initials}
    </div>
  );
}

// ---------- stepper (number control) ----------
export interface StepperProps {
  value: number;
  set: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}

export function Stepper({ value, set, min, max, step = 1, suffix = '' }: StepperProps) {
  const btn: CSSProperties = {
    width: 40,
    height: 40,
    borderRadius: 9,
    border: '1px solid var(--line-2)',
    background: 'var(--paper)',
    fontFamily: 'var(--head)',
    fontSize: 20,
    fontWeight: 600,
    color: 'var(--ink)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button style={btn} onClick={() => set(Math.max(min, value - step))}>
        –
      </button>
      <div className="h2 tnum" style={{ fontSize: 24, minWidth: 64, textAlign: 'center' }}>
        {value}
        <span className="label" style={{ marginLeft: 3 }}>
          {suffix}
        </span>
      </div>
      <button style={btn} onClick={() => set(Math.min(max, value + step))}>
        +
      </button>
    </div>
  );
}

// ---------- toggle (switch) ----------
export interface ToggleProps {
  on: boolean;
  set: (v: boolean) => void;
}

export function Toggle({ on, set }: ToggleProps) {
  return (
    <button
      onClick={() => set(!on)}
      style={{
        width: 52,
        height: 30,
        borderRadius: 100,
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        background: on ? 'var(--coral)' : 'var(--line-3)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: on ? 25 : 3,
          width: 24,
          height: 24,
          borderRadius: 100,
          background: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
        }}
      />
    </button>
  );
}
