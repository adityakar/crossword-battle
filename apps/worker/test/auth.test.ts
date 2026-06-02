import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  signJwt,
  verifyJwt,
  verifyPassword,
} from '../src/auth';

describe('password hashing (PBKDF2-SHA256)', () => {
  it('produces a self-describing versioned record', async () => {
    const record = await hashPassword('correct horse battery staple');
    const parts = record.split('$');
    expect(parts[0]).toBe('pbkdf2');
    expect(parts[1]).toBe('sha256');
    expect(Number(parts[2])).toBe(100000); // Workers runtime caps PBKDF2 at 100k
    expect(parts).toHaveLength(5);
  });

  it('round-trips: verifies the correct password', async () => {
    const record = await hashPassword('s3cret-pass');
    expect(await verifyPassword('s3cret-pass', record)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const record = await hashPassword('s3cret-pass');
    expect(await verifyPassword('wrong-pass', record)).toBe(false);
  });

  it('uses a random salt (same password → different records)', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
    // both still verify (constant-time compare path)
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  it('rejects a malformed record without throwing', async () => {
    expect(await verifyPassword('x', 'not-a-real-record')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2$sha256$bad')).toBe(false);
  });
});

describe('JWT (HS256)', () => {
  const secret = 'unit-test-secret';

  it('signs and verifies a valid token', async () => {
    const token = await signJwt({ sub: 'org_1', email: 'a@b.com' }, secret, 3600);
    const payload = await verifyJwt(token, secret);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe('org_1');
    expect(payload!.email).toBe('a@b.com');
    expect(payload!.exp).toBeGreaterThan(payload!.iat);
  });

  it('rejects a tampered payload', async () => {
    const token = await signJwt({ sub: 'org_1', email: 'a@b.com' }, secret, 3600);
    const [h, , s] = token.split('.');
    // forge a payload with a different sub, keep the original signature
    const forgedPayload = btoa(JSON.stringify({ sub: 'org_admin', email: 'a@b.com', iat: 1, exp: 9999999999 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const tampered = `${h}.${forgedPayload}.${s}`;
    expect(await verifyJwt(tampered, secret)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signJwt({ sub: 'org_1', email: 'a@b.com' }, secret, 3600);
    expect(await verifyJwt(token, 'other-secret')).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signJwt({ sub: 'org_1', email: 'a@b.com' }, secret, -10);
    expect(await verifyJwt(token, secret)).toBeNull();
  });

  it('rejects a structurally invalid token', async () => {
    expect(await verifyJwt('garbage', secret)).toBeNull();
    expect(await verifyJwt('a.b', secret)).toBeNull();
  });
});
