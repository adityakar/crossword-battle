// scoring.ts — points + ranking. Ported verbatim from prototype store.jsx
// (scoreFor lines 315–322, rank logic lines 529–539).
import { z } from 'zod';
import type { PublicPlayer } from './state';

export interface ScoreCfg {
  hintPenalty: number;
  wrongPenalty: number;
}

export const ScoreSchema = z.object({
  raw: z.number(),
  pen: z.number(),
  adj: z.number(),
  points: z.number(),
});
export type Score = z.infer<typeof ScoreSchema>;

// Prototype formula, byte-for-byte:
//   raw = finishMs/1000; pen = hintsUsed*hintPenalty + wrongAttempts*wrongPenalty;
//   adj = raw + pen; points = max(100, round(2000 - adj*6))
export function scoreFor(
  p: { finishMs: number | null; hintsUsed: number; wrongAttempts: number },
  cfg: ScoreCfg,
): Score | null {
  if (p.finishMs == null) return null;
  const raw = p.finishMs / 1000;
  const pen = p.hintsUsed * cfg.hintPenalty + p.wrongAttempts * cfg.wrongPenalty;
  const adj = raw + pen;
  const points = Math.max(100, Math.round(2000 - adj * 6));
  return { raw, pen, adj, points };
}

// fmtTime — `m:ss` from SECONDS. Ported verbatim from prototype store.jsx
// (lines 548–552). Distinct from web's `formatClock`, which takes MILLISECONDS
// and ceils; `fmtTime` takes seconds and rounds. Used by `LbRow` on `score.raw`
// (which is `finishMs/1000`, i.e. seconds).
export function fmtTime(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export type RankedPlayer = PublicPlayer & { score: Score | null; rank: number };

export interface RankOpts {
   /**
   * Keep still-solving (non-finisher) players in their incoming (join) order
   * instead of ranking them by filledPct. Used by the LIVE boards: filledPct
   * churns constantly as players type and is never shown (it can't verify
   * correctness), so ranking by it would make rows shuffle with no visible cause.
   * Preserving join order also means a late joiner (allowLate) appends at the
   * bottom rather than cutting in by random id. The only meaningful live reorder
   * is a player FINISHING and slotting into the ranked finishers. Default (false)
   * preserves the original DNF-by-progress order for the final boards.
   */
  stableUnfinished?: boolean;
}

// Finishers first (ascending adj), then non-finishers by descending filledPct
// (the prototype ranked DNF players by progress). `rank` is 1-based.
//
// Ties are broken DETERMINISTICALLY so the ordering is stable across runs
// (Array.prototype.sort is not guaranteed stable, and a tied leaderboard must
// not flicker between identical inputs). Finishers with an equal adjusted score
// break by: lower raw time, fewer hintsUsed, fewer wrongAttempts, then id
// lexicographic. Non-finishers with equal filledPct break by id lexicographic.
export function rankPlayers(
  players: PublicPlayer[],
  cfg: ScoreCfg,
  opts?: RankOpts,
): RankedPlayer[] {
  const withScore = players.map((p) => ({ ...p, score: scoreFor(p, cfg) }));
  withScore.sort((a, b) => {
    const af = a.finishMs != null;
    const bf = b.finishMs != null;
    if (af && bf) {
      if (a.score!.adj !== b.score!.adj) return a.score!.adj - b.score!.adj;
      if (a.score!.raw !== b.score!.raw) return a.score!.raw - b.score!.raw;
      if (a.hintsUsed !== b.hintsUsed) return a.hintsUsed - b.hintsUsed;
      if (a.wrongAttempts !== b.wrongAttempts) return a.wrongAttempts - b.wrongAttempts;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    }
    if (af) return -1;
    if (bf) return 1;
    // Both unfinished. On the LIVE boards (stableUnfinished) preserve the INPUT
    // order — the DO supplies players in JOIN order (Object.values over the
    // insertion-ordered players map). Returning 0 keeps that order (Array sort is
    // stable, ES2019+), so still-solving rows never reshuffle and a late joiner
    // (allowLate) appends at the bottom instead of cutting in by random UUID id.
    if (opts?.stableUnfinished) return 0;
    if (a.filledPct !== b.filledPct) return b.filledPct - a.filledPct;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return withScore.map((p, i) => ({ ...p, rank: i + 1 }));
}

export interface TopScore {
  rank: number; // 1-based, reassigned across rounds
  name: string;
  points: number;
  raw: number; // seconds
  hintsUsed: number;
}

// All-time leaderboard ranking. Flattens finisher entries (score != null) from one-or-more rounds'
// leaderboards and orders by points DESC, then adj ASC, raw ASC, hintsUsed, wrongAttempts, name —
// consistent with rankPlayers' finisher ordering (adj-first), so the all-time board never
// contradicts the in-round ranking, while keeping the displayed points non-increasing down the
// board (points is a rounded/floored projection of adj). DNFs are excluded; returns the top `limit`.
export function topScores(entries: RankedPlayer[], limit = 10): TopScore[] {
  // Defensive: a malformed/hand-edited leaderboard_json row could yield a null or
  // shapeless entry; require a real numeric points score so a single bad row can
  // never throw the whole board (the aggregator parses untrusted stored JSON).
  const finishers = entries.filter((e) => e != null && e.score != null && typeof e.score.points === 'number');
  finishers.sort((a, b) => {
    const sa = a.score!;
    const sb = b.score!;
    if (sa.points !== sb.points) return sb.points - sa.points;
    if (sa.adj !== sb.adj) return sa.adj - sb.adj;
    if (sa.raw !== sb.raw) return sa.raw - sb.raw;
    if (a.hintsUsed !== b.hintsUsed) return a.hintsUsed - b.hintsUsed;
    if (a.wrongAttempts !== b.wrongAttempts) return a.wrongAttempts - b.wrongAttempts;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return finishers.slice(0, limit).map((e, i) => ({
    rank: i + 1,
    name: e.name,
    points: e.score!.points,
    raw: e.score!.raw,
    hintsUsed: e.hintsUsed,
  }));
}
