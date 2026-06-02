// leaderboard.ts — composes the all-time, per-puzzle, owner-scoped top-10 board from the
// owner-scoped DB helpers + the shared `topScores` ranking. Used by both the public booth endpoint
// (latest puzzle) and the host endpoint (any of the org's puzzles-with-results).
import { topScores, fmtTime } from '@cwb/shared';
import { puzzlesWithResults, leaderboardEntriesForPuzzle, hintsNote } from './db';

export interface LbPuzzle {
  id: string;
  name: string;
}

export interface TopScoreDto {
  rank: number;
  name: string;
  points: number;
  time: string; // m:ss
  note: string; // 'clean' | 'N hint(s)'
}

// Owner-scoped leaderboard. `selectedId` (host) picks among the owner's OWN puzzles-with-results; an
// unknown id falls back to the latest, so a client-supplied id can never surface a foreign puzzle's
// name (the puzzle identity comes only from the owner-scoped `puzzlesWithResults`). Public callers
// omit it (always the latest puzzle = element [0]).
export async function buildLeaderboard(
  db: D1Database,
  ownerId: string,
  selectedId?: string,
): Promise<{ puzzle: LbPuzzle | null; entries: TopScoreDto[]; puzzles: LbPuzzle[] }> {
  const puzzles = await puzzlesWithResults(db, ownerId);
  if (puzzles.length === 0) return { puzzle: null, entries: [], puzzles: [] };
  const target = (selectedId && puzzles.find((p) => p.id === selectedId)) || puzzles[0]!;
  const raw = await leaderboardEntriesForPuzzle(db, ownerId, target.id);
  const entries: TopScoreDto[] = topScores(raw, 10).map((e) => ({
    rank: e.rank,
    name: e.name,
    points: e.points,
    time: fmtTime(e.raw),
    note: hintsNote(e.hintsUsed),
  }));
  return { puzzle: target, entries, puzzles };
}
