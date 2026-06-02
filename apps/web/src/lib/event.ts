// event.ts — white-label brand context.
//
// Fetches the active Brand from the worker (`GET /api/config`) once on mount and
// applies it to the document (sets `--coral` accent + page title). While loading
// it uses DEFAULT_BRAND so nothing flashes empty — `useEvent()` therefore never
// returns null and components render in isolation. `useSetEvent()` lets the
// branding page re-apply a saved brand live. Wrap the router in `<EventProvider>`
// (see main.tsx).
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_BRAND, type Brand } from '@cwb/shared';

const DEFAULT_EVENT: Brand = DEFAULT_BRAND;

const EventCtx = createContext<Brand>(DEFAULT_EVENT);
// Separate setter context so existing useEvent() consumers are unaffected.
const SetEventCtx = createContext<(b: Brand) => void>(() => {});

// Parse "#RRGGBB" (or "RRGGBB") → [r,g,b]; null if not a 6-digit hex.
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// The coral accent baked into global.css, whose token family (--coral-ink/tint/
// line) is hand-tuned for THIS hue. When an event uses this exact accent we leave
// the CSS palette untouched (an approximated --coral-ink would only drift it); we
// derive the family only for a genuinely different re-skin accent.
const DEFAULT_ACCENT = '#FE414D';

// Apply event-derived globals to the document: coral accent token family + title.
function applyEvent(event: Brand): void {
  document.documentElement.style.setProperty('--coral', event.accent);
  // Derive the rest of the coral token family from the accent so a re-skin with a
  // different accent stays internally consistent (tint/line are alpha variants;
  // ink is a darker shade for text contrast on light backgrounds). Skip when the
  // accent is the CSS default (keep its hand-tuned palette), or isn't a 6-hex color.
  const rgb =
    event.accent.trim().toUpperCase() === DEFAULT_ACCENT ? null : hexToRgb(event.accent);
  const root = document.documentElement.style;
  if (rgb) {
    const [r, g, b] = rgb;
    root.setProperty('--coral-tint', `rgba(${r}, ${g}, ${b}, 0.10)`);
    root.setProperty('--coral-line', `rgba(${r}, ${g}, ${b}, 0.45)`);
    const dark = (x: number) => Math.round(x * 0.72); // ~28% darker for text contrast
    root.setProperty('--coral-ink', `rgb(${dark(r)}, ${dark(g)}, ${dark(b)})`);
  } else {
    // Default (or non-hex) accent → drop any previously-derived inline tokens so
    // they fall back to global.css's hand-tuned palette. Without this, switching a
    // custom accent BACK to the default (live, via the branding page) would leave
    // stale --coral-tint/line/ink until reload.
    root.removeProperty('--coral-tint');
    root.removeProperty('--coral-line');
    root.removeProperty('--coral-ink');
  }
  document.title = event.appName;
}

export function EventProvider({ children }: { children: ReactNode }) {
  const [event, setEvent] = useState<Brand>(DEFAULT_EVENT);

  useEffect(() => {
    let alive = true;
    // Apply the default immediately so the accent/title are correct pre-fetch.
    applyEvent(event);
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`config ${r.status}`))))
      .then((data: { event?: Brand }) => {
        if (!alive || !data?.event) return;
        setEvent(data.event);
        applyEvent(data.event);
      })
      .catch(() => {
        /* keep default on failure */
      });
    return () => {
      alive = false;
    };
    // Run once on mount; `event` is only read for the immediate default apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateBrandState = (b: Brand) => {
    setEvent(b);
    applyEvent(b);
  };
  return createElement(
    SetEventCtx.Provider,
    { value: updateBrandState },
    createElement(EventCtx.Provider, { value: event }, children),
  );
}

export function useEvent(): Brand {
  return useContext(EventCtx);
}

export function useSetEvent(): (b: Brand) => void {
  return useContext(SetEventCtx);
}

// Join non-empty lockup parts with " · " so empty venueLabel/eventLine never
// produce a dangling separator. e.g. lockup('', 'LIVE GAME SHOW') === 'LIVE GAME SHOW'.
export function lockup(...parts: (string | undefined | null)[]): string {
  return parts.filter((p): p is string => !!p && p.length > 0).join(' · ');
}
