import { SELF, env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

const ORIGIN = 'https://cwb.test';
const SEED_EMAIL = 'seed@example.com';
const SEED_PASSWORD = 'seed-password-123';

function cookieFrom(res: Response): string {
  const setCookie = res.headers.get('Set-Cookie');
  if (!setCookie) throw new Error('no Set-Cookie header');
  return setCookie.split(';')[0]!;
}
async function loginCookie(): Promise<string> {
  const res = await SELF.fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return cookieFrom(res);
}
const validBrand = {
  appName: 'Acme Cup',
  eventLine: 'ACME · 2026',
  venueLabel: 'Room B',
  accent: '#1a2b3c',
  prizeLabel: 'Trophy',
  aiTone: 'warm, encouraging',
  topicHint: 'Company history',
};

describe('GET/PUT /api/config (brand)', () => {
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM event_brand').run();
  });

  it('GET returns DEFAULT_BRAND when unset (public, no auth)', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/config`);
    expect(res.status).toBe(200);
    const { event } = (await res.json()) as { event: { appName: string; accent: string } };
    expect(event.appName).toBe('Crossword Battle');
    expect(event.accent).toBe('#FE414D');
  });

  it('PUT requires authentication (401 without cookie)', async () => {
    const res = await SELF.fetch(`${ORIGIN}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: JSON.stringify(validBrand),
    });
    expect(res.status).toBe(401);
  });

  it('PUT requires same-origin (403 cross-origin)', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://evil.test' },
      body: JSON.stringify(validBrand),
    });
    expect(res.status).toBe(403);
  });

  it('PUT rejects an invalid brand (400)', async () => {
    const cookie = await loginCookie();
    const res = await SELF.fetch(`${ORIGIN}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ ...validBrand, accent: 'not-a-hex' }),
    });
    expect(res.status).toBe(400);
  });

  it('PUT persists; GET then reflects it (accent normalized)', async () => {
    const cookie = await loginCookie();
    const put = await SELF.fetch(`${ORIGIN}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify(validBrand),
    });
    expect(put.status).toBe(200);
    const get = await SELF.fetch(`${ORIGIN}/api/config`);
    const { event } = (await get.json()) as { event: { appName: string; accent: string } };
    expect(event.appName).toBe('Acme Cup');
    expect(event.accent).toBe('#1A2B3C');
  });
});

describe('session create snapshots aiTone', () => {
  it('writes the active brand tone into the new session config_json', async () => {
    const cookie = await loginCookie();
    // Set a distinctive tone.
    await SELF.fetch(`${ORIGIN}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ ...validBrand, aiTone: 'snapshot-marker-tone' }),
    });
    const pz = await SELF.fetch(`${ORIGIN}/api/puzzles`, { headers: { Cookie: cookie } });
    const { puzzles } = (await pz.json()) as { puzzles: { id: string }[] };
    const cs = await SELF.fetch(`${ORIGIN}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ puzzleId: puzzles[0]!.id, replace: true }),
    });
    const { joinCode } = (await cs.json()) as { joinCode: string };
    const row = await env.DB.prepare('SELECT config_json FROM sessions WHERE join_code = ?')
      .bind(joinCode)
      .first<{ config_json: string }>();
    const cfg = JSON.parse(row!.config_json) as { aiTone?: string };
    expect(cfg.aiTone).toBe('snapshot-marker-tone');
  });

  it('ignores a client-supplied aiTone in the create body (brand tone is authoritative)', async () => {
    const cookie = await loginCookie();
    await SELF.fetch(`${ORIGIN}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      body: JSON.stringify({ ...validBrand, aiTone: 'brand-tone' }),
    });
    const pz = await SELF.fetch(`${ORIGIN}/api/puzzles`, { headers: { Cookie: cookie } });
    const { puzzles } = (await pz.json()) as { puzzles: { id: string }[] };
    const cs = await SELF.fetch(`${ORIGIN}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
      // A malicious/confused client tries to inject its own tone via the config patch.
      body: JSON.stringify({ puzzleId: puzzles[0]!.id, config: { aiTone: 'client-injected' }, replace: true }),
    });
    const { joinCode } = (await cs.json()) as { joinCode: string };
    const row = await env.DB.prepare('SELECT config_json FROM sessions WHERE join_code = ?')
      .bind(joinCode)
      .first<{ config_json: string }>();
    const cfg = JSON.parse(row!.config_json) as { aiTone?: string };
    expect(cfg.aiTone).toBe('brand-tone'); // snapshot wins; client value ignored
  });
});
