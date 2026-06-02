import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('harness smoke', () => {
  it('serves /api/health', async () => {
    const res = await SELF.fetch('https://example.com/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('has DB binding with migrations applied', async () => {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='organizers'",
    ).first();
    expect(row).toMatchObject({ name: 'organizers' });
  });
});
