// organizer-prefix.test.ts — booth prefix data layer (migration 0003).
// db-level tests against the per-test D1 (env.DB). Uses unique emails so rows
// don't collide across this shared, non-rolled-back database.
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import {
  insertOrganizer,
  seedOrganizer,
  getOrganizerByEmail,
  getOrganizerById,
  getOrganizerByPrefix,
  setOrganizerPrefix,
  claimNextSeq,
  ensurePrefixes,
} from '../src/db';
import { allocPrefixedJoinCode } from '../src/joincode';
import { isValidPrefix, isValidJoinCode } from '@cwb/shared';

function uniqueEmail(tag: string): string {
  return `${tag}-${crypto.randomUUID().slice(0, 8)}@example.com`;
}

describe('organizer prefix data layer (0003)', () => {
  it('insertOrganizer assigns a unique valid prefix and next_session_seq = 1', async () => {
    const org = await insertOrganizer(env.DB, uniqueEmail('ins'), 'hash');
    expect(org.prefix).not.toBeNull();
    expect(isValidPrefix(org.prefix!)).toBe(true);
    expect(org.next_session_seq).toBe(1);
    // round-trips by prefix
    const back = await getOrganizerByPrefix(env.DB, org.prefix!);
    expect(back?.id).toBe(org.id);
  });

  it('claimNextSeq returns the pre-increment value and advances monotonically', async () => {
    const org = await insertOrganizer(env.DB, uniqueEmail('seq'), 'hash');
    expect(await claimNextSeq(env.DB, org.id)).toBe(1);
    expect(await claimNextSeq(env.DB, org.id)).toBe(2);
    const row = await getOrganizerById(env.DB, org.id);
    expect(row?.next_session_seq).toBe(3);
  });

  it('setOrganizerPrefix enforces uniqueness (throws on a taken prefix)', async () => {
    const a = await insertOrganizer(env.DB, uniqueEmail('uniqa'), 'hash');
    const b = await insertOrganizer(env.DB, uniqueEmail('uniqb'), 'hash');
    await expect(setOrganizerPrefix(env.DB, b.id, a.prefix!)).rejects.toThrow();
    // b kept its own prefix (the failed update didn't mutate it)
    const bRow = await getOrganizerById(env.DB, b.id);
    expect(bRow?.prefix).toBe(b.prefix);
  });

  it('ensurePrefixes backfills a null-prefix organizer and is idempotent', async () => {
    // Simulate a pre-0003 organizer (no prefix) by inserting a raw row.
    const id = `org_legacy_${crypto.randomUUID().slice(0, 8)}`;
    await env.DB
      .prepare('INSERT INTO organizers (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, uniqueEmail('legacy'), 'hash', Date.now())
      .run();
    // Raw insert leaves prefix NULL.
    expect((await getOrganizerById(env.DB, id))?.prefix).toBeNull();

    await ensurePrefixes(env.DB);
    const after = await getOrganizerById(env.DB, id);
    expect(after?.prefix).not.toBeNull();
    expect(isValidPrefix(after!.prefix!)).toBe(true);

    // Idempotent: a second pass leaves the assigned prefix unchanged.
    await ensurePrefixes(env.DB);
    expect((await getOrganizerById(env.DB, id))?.prefix).toBe(after!.prefix);
  });

  it('seedOrganizer assigns a prefix on first insert and is idempotent', async () => {
    const email = uniqueEmail('seed');
    await seedOrganizer(env.DB, email, 'hash');
    const first = await getOrganizerByEmail(env.DB, email);
    expect(first?.prefix).not.toBeNull();
    expect(isValidPrefix(first!.prefix!)).toBe(true);

    // Second call is a no-op (INSERT OR IGNORE) — prefix unchanged, no new row.
    await seedOrganizer(env.DB, email, 'hash');
    const second = await getOrganizerByEmail(env.DB, email);
    expect(second?.id).toBe(first?.id);
    expect(second?.prefix).toBe(first?.prefix);
  });
});

describe('allocPrefixedJoinCode', () => {
  it('produces <PREFIX>-NNN sequentially and is a valid join code', async () => {
    const org = await insertOrganizer(env.DB, uniqueEmail('alloc'), 'hash');
    const c1 = await allocPrefixedJoinCode(env.DB, org.id);
    const c2 = await allocPrefixedJoinCode(env.DB, org.id);
    expect(c1).toBe(`${org.prefix}-001`);
    expect(c2).toBe(`${org.prefix}-002`);
    expect(isValidJoinCode(c1)).toBe(true);
    expect(isValidJoinCode(c2)).toBe(true);
    // counter advanced to 3
    expect((await getOrganizerById(env.DB, org.id))?.next_session_seq).toBe(3);
  });

  it('falls back to a legacy random code when the organizer has no prefix', async () => {
    const id = `org_noprefix_${crypto.randomUUID().slice(0, 8)}`;
    await env.DB
      .prepare('INSERT INTO organizers (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, uniqueEmail('noprefix'), 'hash', Date.now())
      .run();
    const code = await allocPrefixedJoinCode(env.DB, id);
    expect(isValidJoinCode(code)).toBe(true);
  });

  it('skips past occupied suffixes for a reclaimed prefix (no failure after collisions)', async () => {
    // New org with a fresh unique prefix; simulate that prefix already having its
    // low suffixes occupied (as a previous owner would leave behind) with the new
    // owner's counter reset to 1 — the reclaimed-prefix condition. 25 > the old
    // 20-collision cap, so the naive allocator would throw here.
    const org = await insertOrganizer(env.DB, uniqueEmail('reclaim'), 'hash');
    const pfx = org.prefix!;
    for (let n = 1; n <= 25; n++) {
      const code = `${pfx}-${String(n).padStart(3, '0')}`;
      await env.DB
        .prepare(
          "INSERT OR IGNORE INTO sessions (join_code, owner_id, puzzle_id, config_json, round, status, host_token_hash, created_at) VALUES (?, ?, 'pz', '{}', 1, 'ended', 'h', ?)",
        )
        .bind(code, org.id, Date.now())
        .run();
    }
    await env.DB.prepare('UPDATE organizers SET next_session_seq = 1 WHERE id = ?').bind(org.id).run();

    const code = await allocPrefixedJoinCode(env.DB, org.id);
    expect(code.startsWith(`${pfx}-`)).toBe(true);
    expect(Number(code.slice(4))).toBeGreaterThan(25); // jumped past the occupied 001..025
    expect(await env.DB.prepare('SELECT 1 FROM sessions WHERE join_code = ?').bind(code).first()).toBeNull();
  });
});
