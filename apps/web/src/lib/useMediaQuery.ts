import { useEffect, useState } from 'react';

// useMediaQuery — subscribe to a CSS media query, re-rendering when it flips.
// Used where a desktop layout is structurally different from the phone one (e.g.
// the host dashboard dissolves the sticky action bar into a two-column grid), so
// a CSS-only reflow can't express it. The initializer reads matchMedia
// synchronously, so the first paint already matches the viewport (no flash). The
// app is a client-only SPA, so the `window` guard is just defensive.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange(); // sync in case the query changed between render and effect
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
