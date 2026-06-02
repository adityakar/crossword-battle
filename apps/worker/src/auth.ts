// auth.ts — organizer authentication primitives (design §5).
//
// - Passwords: PBKDF2-SHA256 via Web Crypto, stored as a self-describing record
//   `pbkdf2$sha256$<iters>$<b64 salt>$<b64 hash>`. Verify is constant-time.
// - Sessions: HS256 JWT in an httpOnly/Secure/SameSite=Strict cookie.
// - CSRF: requireSameOrigin compares the Origin header host to the request host
//   on state-changing methods.
// - Seeding: ensureSeed seeds presets + a seed organizer (idempotent).
import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from './index';
import { ensurePrefixes, getOrganizerByEmail, seedOrganizer, seedPresets } from './db';

// ---------------------------------------------------------------------------
// Base64url + bytes helpers
// ---------------------------------------------------------------------------
const enc = new TextEncoder();

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64Url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return b64ToBytes(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

// Constant-time byte comparison. Compares the full length regardless of where
// the first mismatch occurs so timing does not leak the diverging index.
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

// ---------------------------------------------------------------------------
// PBKDF2 password hashing
// ---------------------------------------------------------------------------
// 100k is the MAXIMUM PBKDF2 iteration count the Cloudflare Workers runtime
// allows (workerd throws "iteration counts above 100000 are not supported" in
// production). Miniflare/Vitest don't enforce this cap, so a higher value passes
// locally but 500s on deploy — keep this at 100000.
const PBKDF2_ITERS = 100000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

async function pbkdf2(pw: string, salt: Uint8Array, iters: number, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iters },
    key,
    len * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(pw, salt, PBKDF2_ITERS, HASH_BYTES);
  return `pbkdf2$sha256$${PBKDF2_ITERS}$${bytesToB64(salt)}$${bytesToB64(hash)}`;
}

export async function verifyPassword(pw: string, record: string): Promise<boolean> {
  const parts = record.split('$');
  if (parts.length !== 5) return false;
  const [scheme, algo, itersStr, saltB64, hashB64] = parts as [string, string, string, string, string];
  if (scheme !== 'pbkdf2' || algo !== 'sha256') return false;
  const iters = Number(itersStr);
  if (!Number.isInteger(iters) || iters <= 0) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = b64ToBytes(saltB64);
    expected = b64ToBytes(hashB64);
  } catch {
    return false;
  }
  const actual = await pbkdf2(pw, salt, iters, expected.length);
  return timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// JWT (HS256)
// ---------------------------------------------------------------------------
export interface JwtPayload {
  sub: string; // organizer id
  email: string;
  iat: number;
  exp: number;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signJwt(
  payload: { sub: string; email: string },
  secret: string,
  expSec: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: JwtPayload = { sub: payload.sub, email: payload.email, iat: now, exp: now + expSec };
  const header = { alg: 'HS256', typ: 'JWT' };
  const h = bytesToB64Url(enc.encode(JSON.stringify(header)));
  const p = bytesToB64Url(enc.encode(JSON.stringify(full)));
  const data = `${h}.${p}`;
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return `${data}.${bytesToB64Url(sig)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const data = `${h}.${p}`;
  const key = await hmacKey(secret);
  let sig: Uint8Array;
  try {
    sig = b64UrlToBytes(s);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify('HMAC', key, sig as BufferSource, enc.encode(data));
  if (!ok) return null;
  let payload: JwtPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64UrlToBytes(p)));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null;
  return payload;
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------
const COOKIE_NAME = 'cwb_session';
const COOKIE_MAX_AGE = 60 * 60 * 12; // 12h, matches JWT exp below

export function setSessionCookie(c: Context, token: string): void {
  c.header(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE}`,
    { append: true },
  );
}

export function clearSessionCookie(c: Context): void {
  c.header(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`,
    { append: true },
  );
}

export function readSessionCookie(c: Context): string | null {
  const header = c.req.header('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (name === COOKIE_NAME) return part.slice(idx + 1).trim();
  }
  return null;
}

export const JWT_EXP_SEC = COOKIE_MAX_AGE;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
export interface OrganizerCtx {
  id: string;
  email: string;
}

// Hono variable typing: routes can read c.get('organizer') after requireOrganizer.
export type AuthVars = { organizer: OrganizerCtx };

export const requireOrganizer: MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }> = async (
  c,
  next,
) => {
  const token = readSessionCookie(c);
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  const payload = await verifyJwt(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'unauthorized' }, 401);
  c.set('organizer', { id: payload.sub, email: payload.email });
  await next();
};

// CSRF defense for state-changing methods: the Origin header's host must equal
// the request host. Requests without an Origin on a mutating method are rejected.
export const requireSameOrigin: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    await next();
    return;
  }
  const origin = c.req.header('Origin');
  if (!origin) return c.json({ error: 'forbidden' }, 403);
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return c.json({ error: 'forbidden' }, 403);
  }
  const requestHost = new URL(c.req.url).host;
  if (originHost !== requestHost) return c.json({ error: 'forbidden' }, 403);
  await next();
};

// ---------------------------------------------------------------------------
// Seed-on-first-boot (idempotent)
// ---------------------------------------------------------------------------
let seeded = false;

export async function ensureSeed(env: Env): Promise<void> {
  // Per-isolate guard avoids redundant DB round-trips; the underlying inserts are
  // also idempotent (INSERT OR IGNORE) so concurrent isolates stay correct.
  if (seeded) return;
  await seedPresets(env.DB);
  const email = env.SEED_ORGANIZER_EMAIL;
  const password = env.SEED_ORGANIZER_PASSWORD;
  if (email && password) {
    const existing = await getOrganizerByEmail(env.DB, email);
    if (!existing) {
      const hash = await hashPassword(password);
      await seedOrganizer(env.DB, email, hash);
    }
  }
  // Backfill booth prefixes for any pre-0003 organizers (idempotent — only
  // touches rows with a NULL/empty prefix; new orgs already get one at insert).
  await ensurePrefixes(env.DB);
  seeded = true;
}

// Test-only: reset the per-isolate seed guard.
export function __resetSeedGuard(): void {
  seeded = false;
}
