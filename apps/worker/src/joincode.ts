// joincode.ts — human-friendly session join codes (design §5).
// Format LLL-NNN, letters exclude ambiguous I/O (and there are no vowels-only
// constraints — just the 24-letter unambiguous alphabet). 3 letters, dash, 3
// digits → e.g. "SPR-742". allocJoinCode retries until it finds an unused code.
// The canonical validator lives in @cwb/shared (isValidJoinCode).
import {
  getSessionByJoinCode,
  getOrganizerById,
  claimNextSeq,
  maxSuffixForPrefix,
  bumpSeqTo,
} from './db';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I, no O

export function newJoinCode(): string {
  const buf = crypto.getRandomValues(new Uint8Array(6));
  let letters = '';
  for (let i = 0; i < 3; i++) letters += ALPHABET[buf[i]! % ALPHABET.length];
  let digits = '';
  for (let i = 3; i < 6; i++) digits += String(buf[i]! % 10);
  return `${letters}-${digits}`;
}

export async function allocJoinCode(db: D1Database): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = newJoinCode();
    const existing = await getSessionByJoinCode(db, code);
    if (!existing) return code;
  }
  // Astronomically unlikely (24^3 * 10^3 ≈ 13.8M codes). Surface rather than loop.
  throw new Error('could not allocate a unique join code');
}

// Per-organizer prefixed sequential code: `<PREFIX>-NNN` (multi-booth, design §B).
// The number is the organizer's monotonic `next_session_seq`, claimed ATOMICALLY
// (claimNextSeq) so concurrent same-org creates can't collide. Codes are never
// reused, so they never alias an old DO (idFromName) or round_results row. A
// prefix-less organizer (only in the brief pre-backfill window) falls back to a
// legacy random code so create never hard-fails.
export async function allocPrefixedJoinCode(db: D1Database, ownerId: string): Promise<string> {
  const org = await getOrganizerById(db, ownerId);
  const prefix = org?.prefix ?? '';
  if (!prefix) return allocJoinCode(db);
  const fmt = (seq: number) => `${prefix}-${String(seq % 1000).padStart(3, '0')}`;

  // Common case: the org's own sequence lands on a free code in one shot.
  let code = fmt(await claimNextSeq(db, ownerId));
  if (!(await getSessionByJoinCode(db, code))) return code;

  // Collision: the prefix's low suffixes are already occupied — a RECLAIMED prefix
  // (a previous owner's `ABC-001…` rows persist), a legacy random code sharing the
  // letters, or a >999 wrap. Jump this org's counter past the highest existing
  // suffix for the prefix so the next claim lands in free space, then take it.
  await bumpSeqTo(db, ownerId, (await maxSuffixForPrefix(db, prefix)) + 1);
  for (let i = 0; i < 1000; i++) {
    code = fmt(await claimNextSeq(db, ownerId));
    if (!(await getSessionByJoinCode(db, code))) return code;
  }
  // Only reachable if the ENTIRE 1000-code space for this prefix is occupied —
  // effectively never (one session hosts many rounds). Surface rather than loop.
  throw new Error('could not allocate a unique prefixed join code');
}
