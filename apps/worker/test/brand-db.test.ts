import { env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { getBrand, upsertBrand } from '../src/db';
import { DEFAULT_BRAND } from '@cwb/shared';

describe('brand storage (event_brand singleton)', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM event_brand').run();
  });

  it('returns null when no brand is set', async () => {
    expect(await getBrand(env.DB)).toBeNull();
  });

  it('round-trips an upserted brand and stays a singleton', async () => {
    const b = { ...DEFAULT_BRAND, appName: 'Acme Cup', venueLabel: 'Room B', accent: '#1A2B3C' };
    await upsertBrand(env.DB, b, 'org_1');
    expect(await getBrand(env.DB)).toEqual({
      appName: 'Acme Cup',
      eventLine: '',
      venueLabel: 'Room B',
      accent: '#1A2B3C',
      prizeLabel: 'Prize',
      aiTone: DEFAULT_BRAND.aiTone,
      topicHint: DEFAULT_BRAND.topicHint,
    });
    await upsertBrand(env.DB, { ...b, appName: 'Acme Cup 2' }, 'org_2');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM event_brand').first<{ n: number }>();
    expect(count!.n).toBe(1);
    expect((await getBrand(env.DB))!.appName).toBe('Acme Cup 2');
  });

  it('is defensive when the table is missing (deploy/migration window)', async () => {
    const throwingDb = {
      prepare() {
        return { first() { throw new Error('no such table: event_brand'); } };
      },
    } as unknown as D1Database;
    expect(await getBrand(throwingDb)).toBeNull();
  });
});
