// haptics.ts — feature-detected, RATIONED vibration for the two earned player
// moments: a correct solve and a wrong answer. Deliberately NOT wired to the
// keyboard — per-key buzz is the classic over-use (and drains battery). Both
// fire from a real tap/keystroke, so they have a valid user-gesture context.
//
// Silently no-ops where the Vibration API is absent (all of iOS Safari has never
// shipped it) and under prefers-reduced-motion, which we read as a "less
// stimulation" preference. There is no web API to detect the OS haptic setting,
// so this is the most respectful proxy available.
function vibrationAllowed(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
  if (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return false;
  }
  return true;
}

function buzz(pattern: number | number[]): void {
  if (!vibrationAllowed()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some engines throw if vibrate() isn't tied to a user gesture — non-fatal.
  }
}

/** A short ascending pulse — the positive, earned solve confirmation. */
export function hapticSolve(): void {
  buzz([18, 30, 60]);
}

/** A sharp, symmetric double-buzz — distinct from the solve, reads as "miss". */
export function hapticWrong(): void {
  buzz([24, 40, 24]);
}
