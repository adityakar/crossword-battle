// useSolve.ts — local, server-authoritative crossword interaction state.
//
// The client has NO solution. This hook owns the player's LOCAL `entries`
// (`"r,c"->letter`) + `sel` (`{r,c,dir}`) and re-implements the prototype's
// SELECT / TYPE / BACKSPACE / SET_DIR reducer logic (store.jsx lines 437–489)
// on the answer-free PublicPuzzle using the engine helpers. It also:
//   • applies a server-revealed hint cell into `entries` when `lastHint` lands,
//   • debounces a `progress(progressFilled)` report (~300ms trailing),
//   • exposes a single submit guard so auto-submit (grid full) and the manual
//     ✓ both route through one path that fires once per "entries became full"
//     and never resubmits the identical grid (avoids the wrong-penalty loop).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  firstSel,
  pDirFor,
  pIsBlock,
  pStep,
  pWordAt,
  progressFilled,
  type Dir,
  type PublicPuzzle,
} from '@cwb/engine';
import type { LastHint, SessionSend } from '../../lib/useSession';

export interface Sel {
  r: number;
  c: number;
  dir: Dir;
}

export interface UseSolveResult {
  entries: Record<string, string>;
  sel: Sel;
  filled: number;
  /** filled cells / cellCount — the client-safe "solved %" (NO correctness). */
  progress: number;
  currentWordId: string | null;
  select(r: number, c: number): void;
  setDir(dir: Dir): void;
  type(letter: string): void;
  backspace(): void;
  move(dr: number, dc: number): void;
  /** Jump selection to an explicit word (Prev/Next clue nav). */
  goTo(r: number, c: number, dir: Dir): void;
  submit(): void;
}

const serialize = (e: Record<string, string>): string =>
  Object.keys(e)
    .filter((k) => e[k])
    .sort()
    .map((k) => `${k}=${e[k]}`)
    .join(';');

// --- grid persistence (survive a mid-round refresh) -------------------------
// A player who refreshes keeps their identity (playerId/rejoinSecret in
// localStorage → auto-rejoin), but `entries` is in-memory React state and was
// lost. We persist it under a key scoped to BOTH join code AND round, so a new
// round starts blank automatically (a different round = a different key). The
// stored blob also stamps puzzleId, and we discard on mismatch so a player can
// never resume a grid from a DIFFERENT puzzle. All access is try/catch-wrapped
// (private mode / quota). The clear-on-finish lives in PlayerApp (where the
// finish is observed) because Game/useSolve unmount the instant we finish.
interface StoredGrid {
  puzzleId: string;
  entries: Record<string, string>;
}

export function entriesKey(joinCode: string, round: number): string {
  return `cwb:entries:${joinCode}:${round}`;
}

function readStoredEntries(
  joinCode: string,
  round: number,
  puzzleId: string,
): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(entriesKey(joinCode, round));
    if (!raw) return null;
    const blob = JSON.parse(raw) as StoredGrid;
    // Discard a grid from a different puzzle (e.g. organizer swapped the puzzle
    // within the same round number) — never resume someone else's solution.
    if (!blob || blob.puzzleId !== puzzleId || typeof blob.entries !== 'object') return null;
    return blob.entries ?? null;
  } catch {
    return null; // unparseable / unavailable — start blank.
  }
}

function writeStoredEntries(
  joinCode: string,
  round: number,
  puzzleId: string,
  entries: Record<string, string>,
): void {
  try {
    const blob: StoredGrid = { puzzleId, entries };
    localStorage.setItem(entriesKey(joinCode, round), JSON.stringify(blob));
  } catch {
    // localStorage unavailable (private mode / quota) — non-fatal.
  }
}

/** Clear the persisted grid for a (code, round). Used on finish / round change. */
export function clearStoredEntries(joinCode: string, round: number): void {
  try {
    localStorage.removeItem(entriesKey(joinCode, round));
  } catch {
    // non-fatal.
  }
}

export function useSolve(
  pp: PublicPuzzle,
  send: SessionSend,
  lastHint: LastHint | null,
  active: boolean,
  joinCode: string,
  round: number,
): UseSolveResult {
  // Lazy init restores any persisted grid on the FIRST paint (so a refreshed
  // player sees their letters immediately). Guarded by puzzleId inside the read.
  // useSolve only mounts inside <Game> (phase === 'live', finishMs == null), so
  // we never restore into a finished/non-live state by construction.
  const [entries, setEntries] = useState<Record<string, string>>(
    () => readStoredEntries(joinCode, round, pp.id) ?? {},
  );
  const [sel, setSel] = useState<Sel>(() => firstSel(pp));

  // Refs so the submit guard + key handlers read fresh state without re-binding.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const selRef = useRef(sel);
  selRef.current = sel;

  // --- hint application: write the revealed letter into entries ---
  // Baseline = the lastHint present at MOUNT. useSession keeps `lastHint` until the
  // next code change, so a hint from a PREVIOUS round is still present when <Game>
  // remounts for a new round. We must apply ONLY hints that arrive AFTER mount —
  // each server `hint` frame is a fresh object, so ref-identity tells "new this
  // round" from "left over". Also guard that the cell is a real fill cell of THIS
  // puzzle (never paint a block / out-of-range cell from a stale or malformed hint).
  const appliedHintRef = useRef<LastHint | null>(lastHint);
  useEffect(() => {
    if (!lastHint || lastHint === appliedHintRef.current) return;
    appliedHintRef.current = lastHint;
    if (pIsBlock(pp, lastHint.r, lastHint.c)) return;
    setEntries((prev) => ({ ...prev, [`${lastHint.r},${lastHint.c}`]: lastHint.letter }));
  }, [lastHint, pp]);

  // --- progress report: trailing debounce on entry changes ---
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => send.progress(progressFilled(pp, entries)), 300);
    return () => clearTimeout(id);
    // pp is stable per pp.id; depend on the id so a new snapshot object doesn't re-debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, pp.id, active, send]);

  // --- grid persistence: trailing-debounced write on entry changes ---
  // Entries change rapidly while typing, so we debounce (~250ms trailing) to
  // avoid hammering localStorage. Scoped to (joinCode, round, puzzleId).
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => writeStoredEntries(joinCode, round, pp.id, entries), 250);
    return () => clearTimeout(id);
  }, [entries, pp.id, active, joinCode, round]);

  // --- interaction reducer ports (store.jsx 437–489) ---
  const select = useCallback(
    (r: number, c: number) => {
      if (pIsBlock(pp, r, c)) return;
      setSel((cur) => {
        if (cur.r === r && cur.c === c) {
          const other: Dir = cur.dir === 'across' ? 'down' : 'across';
          return { r, c, dir: pDirFor(pp, r, c, other) };
        }
        return { r, c, dir: pDirFor(pp, r, c, cur.dir) };
      });
    },
    [pp],
  );

  const setDir = useCallback(
    (dir: Dir) => {
      setSel((cur) => ({ ...cur, dir: pDirFor(pp, cur.r, cur.c, dir) }));
    },
    [pp],
  );

  const goTo = useCallback((r: number, c: number, dir: Dir) => {
    setSel({ r, c, dir });
  }, []);

  const type = useCallback(
    (letter: string) => {
      const cur = selRef.current;
      if (pIsBlock(pp, cur.r, cur.c)) return;
      setEntries((prev) => ({ ...prev, [`${cur.r},${cur.c}`]: letter }));
      const next = pStep(pp, cur.r, cur.c, cur.dir, +1);
      setSel((s) => ({ ...s, r: next.r, c: next.c }));
    },
    [pp],
  );

  const backspace = useCallback(() => {
    const cur = selRef.current;
    const key = `${cur.r},${cur.c}`;
    if (entriesRef.current[key]) {
      // Current cell has a letter → clear it, selection stays put.
      setEntries((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      // Empty cell → step back one and clear that cell, moving the selection.
      const p = pStep(pp, cur.r, cur.c, cur.dir, -1);
      setEntries((prev) => {
        const next = { ...prev };
        delete next[`${p.r},${p.c}`];
        return next;
      });
      setSel((s) => ({ ...s, r: p.r, c: p.c }));
    }
  }, [pp]);

  // Arrow-key movement: clamp to grid, skip blocks (prototype keydown handler).
  const move = useCallback(
    (dr: number, dc: number) => {
      const cur = selRef.current;
      const nr = Math.max(0, Math.min(pp.rows - 1, cur.r + dr));
      const nc = Math.max(0, Math.min(pp.cols - 1, cur.c + dc));
      if (!pIsBlock(pp, nr, nc)) select(nr, nc);
    },
    [pp, select],
  );

  // --- submit guard: fire once per distinct full grid ---
  const lastSubmittedRef = useRef<string | null>(null);
  const submit = useCallback(() => {
    const e = entriesRef.current;
    const sig = serialize(e);
    if (sig === lastSubmittedRef.current) return;
    lastSubmittedRef.current = sig;
    send.submit(e);
  }, [send]);

  const filled = useMemo(
    () => pp.fill.filter(([r, c]) => entries[`${r},${c}`]).length,
    [entries, pp],
  );
  const progress = pp.cellCount ? filled / pp.cellCount : 0;

  // Auto-submit when every fill cell is filled (matches prototype auto-finish).
  // Guarded by the submit signature so it fires once per full grid and re-arms
  // only when entries change (a `wrong` snapshot won't re-trigger it).
  useEffect(() => {
    if (!active) return;
    if (filled >= pp.cellCount && pp.cellCount > 0) submit();
  }, [filled, pp.cellCount, active, submit]);

  const currentWordId = useMemo(() => {
    const w = pWordAt(pp, sel.r, sel.c, sel.dir);
    return w ? `${w.dir}:${w.num}` : null;
  }, [pp, sel]);

  return {
    entries,
    sel,
    filled,
    progress,
    currentWordId,
    select,
    setDir,
    type,
    backspace,
    move,
    goTo,
    submit,
  };
}
