// motion.ts — small, dependency-free motion primitives shared across surfaces.
// All three respect prefers-reduced-motion. No animation library (consistent
// with the CSS-first motion in styles/global.css).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

/** Tracks the user's reduced-motion preference, live. */
export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduce(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduce;
}

/**
 * Animate a number toward `target` (ease-out cubic). Counts from 0 on first
 * appearance and from the last shown value on change. Reduced-motion → instant.
 * Guarded on the target value, so it never restarts the rAF on an unrelated
 * re-render.
 */
export function useCountUp(target: number, durationMs = 900): number {
  const reduce = usePrefersReducedMotion();
  const [value, setValue] = useState(0);
  // valueRef mirrors the displayed value WITHOUT being an effect dependency, so a
  // new target animates from wherever the count currently is (mid-animation
  // included) rather than from a stale closure value.
  const valueRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (reduce) {
      valueRef.current = target;
      setValue(target);
      return;
    }
    const from = valueRef.current;
    if (from === target) return; // no-op when the value hasn't changed
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(from + (target - from) * eased);
      valueRef.current = v;
      setValue(v);
      rafRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [target, durationMs, reduce]);

  return reduce ? target : value;
}

/**
 * FLIP reorder animation for a keyed list (e.g. a leaderboard). Returns a
 * `register(key)` ref-callback to attach to each row's root element.
 *
 * `orderKey` is the ordered keys joined into a string; the layout effect runs
 * ONLY when it changes (not on every re-render / clock tick), so a live board
 * that re-renders 4×/s doesn't measure every frame — only on an actual reorder.
 * Any in-flight transform is cancelled before measuring, so two reorders within
 * one animation window read the settled layout rect rather than a mid-animation
 * one (which would compound deltas into jank).
 */
export function useFlip(orderKey: string): (key: string) => (el: HTMLElement | null) => void {
  const reduce = usePrefersReducedMotion();
  const els = useRef(new Map<string, HTMLElement>());
  const rects = useRef(new Map<string, DOMRect>());
  const anims = useRef(new Map<string, Animation>());
  const cbCache = useRef(new Map<string, (el: HTMLElement | null) => void>());

  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>();
    els.current.forEach((el, key) => {
      // Cancel any running transform so getBoundingClientRect reads the settled
      // layout position, not a mid-animation one.
      const running = anims.current.get(key);
      if (running) {
        running.cancel();
        anims.current.delete(key);
      }
      const nrect = el.getBoundingClientRect();
      next.set(key, nrect);
      if (reduce) return;
      const orect = rects.current.get(key);
      if (orect) {
        const dy = orect.top - nrect.top;
        if (Math.abs(dy) > 1) {
          const anim = el.animate(
            [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
            { duration: 420, easing: EASE },
          );
          anims.current.set(key, anim);
          anim.onfinish = () => anims.current.delete(key);
        }
      }
    });
    rects.current = next;
  }, [orderKey, reduce]);

  return useCallback((key: string) => {
    let cb = cbCache.current.get(key);
    if (!cb) {
      cb = (el: HTMLElement | null) => {
        if (el) els.current.set(key, el);
        else els.current.delete(key);
      };
      cbCache.current.set(key, cb);
    }
    return cb;
  }, []);
}
