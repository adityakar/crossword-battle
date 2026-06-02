import { useEffect } from 'react';

// useFullBleed — surfaces that own their full-viewport layout opt OUT of the
// phone-column frame the host/player game surfaces use: the booth display (/tv*,
// a big screen), and the login + landing (their own desktop two-pane / hero
// layouts, which a 440px clamp would squeeze and clip). While any such surface
// is mounted this adds `.full-bleed` to #root (dropping the max-width + side
// hairlines in global.css) and restores the frame when the LAST one unmounts.
//
// Ref-counted: TvRoute and a child PrefixEntry (the invalid-slug fallback) can
// both mount the hook at once, so a plain add/remove would let the inner unmount
// strip the class while the outer is still mounted. The counter keeps the class
// until every opted-out surface is gone.
let mounted = 0;

export function useFullBleed(): void {
  useEffect(() => {
    const root = document.getElementById('root');
    mounted += 1;
    root?.classList.add('full-bleed');
    return () => {
      mounted -= 1;
      if (mounted <= 0) {
        mounted = 0;
        root?.classList.remove('full-bleed');
      }
    };
  }, []);
}
