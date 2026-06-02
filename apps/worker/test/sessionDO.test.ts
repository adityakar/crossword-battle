// sessionDO.test.ts — DO state machine + anti-cheat integration tests
// (design §3, §4; plan Task 5). Driven two ways:
//   - REAL WebSockets via SELF.fetch (Upgrade: websocket) for hello/auth/submit/hint
//     (exercises attachments, private replies, broadcast).
//   - runInDurableObject / runDurableObjectAlarm for alarm transitions + storage
//     reads (getAlarm) + round_results row counts.
import {
  SELF,
  env,
  runInDurableObject,
  runDurableObjectAlarm,
  abortAllDurableObjects,
} from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Snapshot, ServerMsg } from '@cwb/shared';
import { rowToPuzzle, mostRecentDisplaySession } from '../src/db';

const ORIGIN = 'https://cwb.test';

// ---------------------------------------------------------------------------
// Helpers: directly insert a session row so the DO can lazily load from D1.
// (Avoids the auth/CSRF dance; the routes test already covers /api/session/create.)
// ---------------------------------------------------------------------------
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let counter = 0;
function uniqueCode(): string {
  // LLL-NNN-ish; uniqueness matters more than format here (DO key = join code).
  counter++;
  const n = String(counter).padStart(3, '0');
  return `TST-${n}`;
}

interface SeededSession {
  joinCode: string;
  hostToken: string;
  puzzleId: string;
  ownerId: string;
}

// Seed a 'mini-ai' preset session with a known host token. Presets are seeded by
// ensureSeed on the first /api/* request; hit health to trigger it.
// owner_id is UNIQUE per session by default (D1 isn't rolled back within a file,
// so a shared owner would let one test's leftover active session trip another's
// openLobby one-active guard). Pass `ownerId` to seed sessions under one owner.
async function seedSession(
  puzzleId = 'mini-ai',
  durationSec = 120,
  maxPlayers = 8,
  ownerId?: string,
  overrides: { allowLate?: boolean } = {},
): Promise<SeededSession> {
  await SELF.fetch(`${ORIGIN}/api/health`); // no-op, but harmless
  // Ensure presets exist (login triggers ensureSeed which seeds presets).
  await SELF.fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'seed@example.com', password: 'seed-password-123' }),
  });
  const joinCode = uniqueCode();
  const owner = ownerId ?? 'org_' + joinCode; // unique per session unless shared explicitly
  const hostToken = 'host-token-' + crypto.randomUUID();
  const hostTokenHash = await sha256Hex(hostToken);
  const config = {
    puzzleId,
    puzzleName: 'Sprint Mini',
    difficulty: 'medium',
    durationSec,
    hintPenalty: 5,
    wrongPenalty: 10,
    maxPlayers,
    allowLate: overrides.allowLate ?? false,
    strictValidation: true,
  };
  await env.DB.prepare(
    "INSERT INTO sessions (join_code, owner_id, puzzle_id, config_json, round, status, host_token_hash, created_at) VALUES (?, ?, ?, ?, 1, 'idle', ?, ?)",
  )
    .bind(joinCode, owner, puzzleId, JSON.stringify(config), hostTokenHash, Date.now())
    .run();
  return { joinCode, hostToken, puzzleId, ownerId: owner };
}

// Log in as the seeded organizer and return a replayable Cookie header. Used by
// the resume re-mint test so the created session's owner_id matches the JWT sub.
async function loginCookie(): Promise<string> {
  const res = await SELF.fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'seed@example.com', password: 'seed-password-123' }),
  });
  const setCookie = res.headers.get('Set-Cookie');
  if (!setCookie) throw new Error('no Set-Cookie header on login');
  return setCookie.split(';')[0]!; // "cwb_session=<jwt>"
}

// Create a session through the REAL API so owner_id matches the cookie's subject
// (required for /api/sessions/:code/resume's ownership check).
async function createApiSession(cookie: string): Promise<{ joinCode: string; hostToken: string }> {
  // replace:true so back-to-back creates in this file don't trip the new
  // one-active-per-organizer guard (these tests just want a fresh session; the
  // one-active 409/replace behaviour is covered in routes.test.ts).
  const res = await SELF.fetch(`${ORIGIN}/api/session/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: ORIGIN },
    body: JSON.stringify({ puzzleId: 'mini-ai', replace: true }),
  });
  return res.json() as Promise<{ joinCode: string; hostToken: string }>;
}

// Read the correct solution entries ("r,c"->letter) directly from the puzzle row.
async function correctEntries(puzzleId: string): Promise<Record<string, string>> {
  const row = await env.DB.prepare('SELECT * FROM puzzles WHERE id = ?')
    .bind(puzzleId)
    .first<import('../src/db').PuzzleRow>();
  const puzzle = rowToPuzzle(row!);
  const entries: Record<string, string> = {};
  for (const [r, c] of puzzle.fill) {
    entries[`${r},${c}`] = puzzle.grid[r]![c]!;
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Tiny real-WS client over SELF.fetch. Collects frames and lets a test await a
// frame of a given type. Many snapshots broadcast, so filter by `t`.
// ---------------------------------------------------------------------------
class WsClient {
  private ws!: WebSocket;
  private queue: ServerMsg[] = [];
  private waiters: { type: string; resolve: (m: ServerMsg) => void }[] = [];

  static async open(joinCode: string): Promise<WsClient> {
    const c = new WsClient();
    const res = await SELF.fetch(`${ORIGIN}/ws/${joinCode}`, {
      headers: { Upgrade: 'websocket' },
    });
    if (!res.webSocket) throw new Error(`no webSocket on upgrade response (status ${res.status})`);
    c.ws = res.webSocket;
    c.ws.accept();
    c.ws.addEventListener('message', (ev: MessageEvent) => {
      const msg = JSON.parse(ev.data as string) as ServerMsg;
      const idx = c.waiters.findIndex((w) => w.type === msg.t);
      if (idx >= 0) {
        const [w] = c.waiters.splice(idx, 1);
        w!.resolve(msg);
      } else {
        c.queue.push(msg);
      }
    });
    return c;
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  // Await the next frame of `type` (checks already-queued frames first).
  next<T extends ServerMsg['t']>(type: T, timeoutMs = 2000): Promise<Extract<ServerMsg, { t: T }>> {
    const idx = this.queue.findIndex((m) => m.t === type);
    if (idx >= 0) {
      const [m] = this.queue.splice(idx, 1);
      return Promise.resolve(m as Extract<ServerMsg, { t: T }>);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for frame "${type}"`)), timeoutMs);
      this.waiters.push({
        type,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMsg, { t: T }>);
        },
      });
    });
  }

  // Await the next SNAPSHOT that satisfies `pred` (drains stale queued snapshots;
  // broadcasts pile up, so the first queued one is often pre-action).
  nextSnapshotWhere(pred: (s: Snapshot) => boolean, timeoutMs = 2000): Promise<Snapshot> {
    // scan queued snapshots first
    while (true) {
      const idx = this.queue.findIndex((m) => m.t === 'snapshot');
      if (idx < 0) break;
      const [m] = this.queue.splice(idx, 1);
      if (pred(m as Snapshot)) return Promise.resolve(m as Snapshot);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('timeout waiting for matching snapshot')),
        timeoutMs,
      );
      const tryResolve = (m: ServerMsg) => {
        if (m.t === 'snapshot' && pred(m)) {
          clearTimeout(timer);
          resolve(m);
        } else {
          // re-arm for the next snapshot
          this.waiters.push({ type: 'snapshot', resolve: tryResolve });
        }
      };
      this.waiters.push({ type: 'snapshot', resolve: tryResolve });
    });
  }

  // Value-agnostic sync barrier: drain queued snapshots, have the HOST send a
  // benign always-broadcasting verb (toggleLeaderboard — only the host has
  // hostOk), then await THIS client's next fresh snapshot. Used to confirm a
  // prior (possibly ignored, non-broadcasting) command was processed, without
  // depending on any field's absolute value.
  async syncBarrier(host: WsClient): Promise<Snapshot> {
    this.queue = this.queue.filter((m) => m.t !== 'snapshot');
    host.send({ t: 'toggleLeaderboard' });
    return this.nextSnapshotWhere(() => true);
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

function stubFor(joinCode: string): DurableObjectStub {
  const id = env.SESSION.idFromName(joinCode);
  return env.SESSION.get(id);
}

// Minimal shape of the DO instance the tests reach into (alarm handler + the
// private in-memory state). Cast within runInDurableObject callbacks.
type DOInternals = {
  alarm(): Promise<void>;
  s: {
    round: number;
    phase: string;
    startedAt: number;
    pausedAccumMs: number;
    alarmIntent: { kind: string; round: number; dueAt: number } | null;
    players: Record<string, { finishMs: number | null; connected: boolean }>;
  };
};

beforeEach(() => {
  void env;
});

// ===========================================================================
// 0. Real-WS round trip: hello → snapshot (proves route + upgrade + dispatch).
// ===========================================================================
describe('real WS: hello → snapshot', () => {
  it('a tv hello gets a snapshot back over a real websocket', async () => {
    const { joinCode } = await seedSession();
    const c = await WsClient.open(joinCode);
    c.send({ t: 'hello', role: 'tv', code: joinCode });
    const snap = await c.next('snapshot');
    expect(snap.joinCode).toBe(joinCode);
    expect(snap.phase).toBe('idle');
    c.close();
  });

  it('a player hello returns identity then snapshot', async () => {
    const { joinCode } = await seedSession();
    const c = await WsClient.open(joinCode);
    c.send({ t: 'hello', role: 'player', code: joinCode });
    const ident = await c.next('identity');
    expect(ident.playerId).toMatch(/^p_/);
    const snap = await c.next('snapshot');
    expect(snap.joinCode).toBe(joinCode);
    c.close();
  });

  it('rejects an unknown (valid-format) join code with 404', async () => {
    // ZZZ-999 matches the format but has no session row → DO load fails → 404.
    const res = await SELF.fetch(`${ORIGIN}/ws/ZZZ-999`, { headers: { Upgrade: 'websocket' } });
    expect(res.webSocket).toBeFalsy();
    expect(res.status).toBe(404);
  });

  // Fix 10 — malformed join codes are rejected with 400 BEFORE any DO lookup.
  it('rejects a malformed join code with 400 (no DO lookup)', async () => {
    for (const bad of ['NOPE-000', 'abc-123', 'AB-123', 'ABC-12', 'III-000']) {
      const res = await SELF.fetch(`${ORIGIN}/ws/${bad}`, { headers: { Upgrade: 'websocket' } });
      expect(res.webSocket).toBeFalsy();
      expect(res.status).toBe(400);
    }
  });
});

// ===========================================================================
// 1. Host auth (constant-time token).
// ===========================================================================
describe('host auth', () => {
  it('WRONG host token does not grant hostOk; startCountdown is rejected', async () => {
    const { joinCode } = await seedSession();
    // Open lobby first via a CORRECT host so startCountdown has a valid phase.
    const c = await WsClient.open(joinCode);
    c.send({ t: 'hello', role: 'host', code: joinCode, hostToken: 'totally-wrong' });
    // bad token → an error frame, no hostOk
    const err = await c.next('error');
    expect(err.code).toBe('bad_host_token');
    await c.next('snapshot'); // hello still replies a snapshot
    // try a host verb → forbidden, phase stays idle
    c.send({ t: 'openLobby' });
    const err2 = await c.next('error');
    expect(err2.code).toBe('forbidden');
    c.close();
    // confirm via DO read that phase never advanced
    await runInDurableObject(stubFor(joinCode), (instance, state) => {
      void instance;
      return state.storage.get('state');
    }).then((st) => {
      expect((st as { phase: string } | undefined)?.phase ?? 'idle').toBe('idle');
    });
  });

  it('CORRECT host token grants control: openLobby → startCountdown works', async () => {
    const { joinCode, hostToken } = await seedSession();
    const c = await WsClient.open(joinCode);
    c.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await c.next('snapshot');
    c.send({ t: 'openLobby' });
    const lobbySnap = await c.next('snapshot');
    expect(lobbySnap.phase).toBe('lobby');
    expect(lobbySnap.publicPuzzle).not.toBeNull();
    // anti-cheat: no answer letters in the public puzzle
    const raw = JSON.stringify(lobbySnap.publicPuzzle);
    expect(raw).not.toContain('answer');
    expect(raw).not.toContain('grid');
    c.send({ t: 'startCountdown' });
    const cdSnap = await c.next('snapshot');
    expect(cdSnap.phase).toBe('countdown');
    expect(cdSnap.countdownEndsAt).toBeGreaterThan(Date.now());
    c.close();
  });
});

// ===========================================================================
// 2. submit: server-authoritative finish.
// ===========================================================================
describe('submit (server-authoritative)', () => {
  // Bring a host + a joined player to the `live` phase. The player MUST join
  // during lobby (allowLate=false), then the host starts the round.
  async function reachLiveWithPlayer(
    joinCode: string,
    hostToken: string,
    playerName: string,
  ): Promise<{ host: WsClient; player: WsClient; playerId: string }> {
    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.next('snapshot');
    host.send({ t: 'openLobby' });
    await host.next('snapshot');
    const player = await WsClient.open(joinCode);
    player.send({ t: 'hello', role: 'player', code: joinCode });
    const ident = await player.next('identity');
    await player.next('snapshot');
    player.send({ t: 'join', name: playerName });
    await player.next('snapshot');
    host.send({ t: 'startCountdown' });
    await host.next('snapshot');
    await runDurableObjectAlarm(stubFor(joinCode)); // countdown → live
    await host.next('snapshot');
    await player.next('snapshot'); // player observes live
    return { host, player, playerId: ident.playerId };
  }

  it('WRONG entries do NOT record a finish (no finishMs)', async () => {
    const { joinCode, hostToken, puzzleId } = await seedSession();
    const { host, player: p, playerId } = await reachLiveWithPlayer(joinCode, hostToken, 'Wrong Wendy');
    const ident = { playerId };
    // Build a FULLY-FILLED but WRONG grid (all 'Z').
    const good = await correctEntries(puzzleId);
    const wrong: Record<string, string> = {};
    for (const k of Object.keys(good)) wrong[k] = 'Z';
    p.send({ t: 'submit', entries: wrong });
    const w = await p.next('wrong');
    expect(w.wrongAttempts).toBe(1);
    // no finished frame, and the snapshot player has finishMs null + wrongAttempts 1
    const snap = await p.nextSnapshotWhere(
      (s) => (s.players.find((pl) => pl.id === ident.playerId)?.wrongAttempts ?? 0) >= 1,
    );
    const me = snap.players.find((pl) => pl.id === ident.playerId);
    expect(me?.finishMs ?? null).toBeNull();
    expect(me?.wrongAttempts).toBe(1);
    host.close();
    p.close();
  });

  it('CORRECT solution records a server-stamped finishMs > 0', async () => {
    const { joinCode, hostToken, puzzleId } = await seedSession();
    const { host, player: p, playerId } = await reachLiveWithPlayer(joinCode, hostToken, 'Correct Carl');
    const ident = { playerId };
    const good = await correctEntries(puzzleId);
    p.send({ t: 'submit', entries: good });
    const fin = await p.next('finished');
    expect(fin.finishMs).toBeGreaterThan(0);
    expect(fin.score.points).toBeGreaterThan(0);
    const snap = await p.nextSnapshotWhere(
      (s) => (s.players.find((pl) => pl.id === ident.playerId)?.finishMs ?? null) != null,
    );
    const me = snap.players.find((pl) => pl.id === ident.playerId);
    expect(me?.finishMs).toBeGreaterThan(0);
    expect(me?.filledPct).toBe(1);
    host.close();
    p.close();
  });

  it('INCOMPLETE entries return incomplete with remainingCells', async () => {
    const { joinCode, hostToken, puzzleId } = await seedSession();
    const { host, player: p } = await reachLiveWithPlayer(joinCode, hostToken, 'Partial Pat');
    const good = await correctEntries(puzzleId);
    const keys = Object.keys(good);
    const partial: Record<string, string> = {};
    for (const k of keys.slice(0, 1)) partial[k] = good[k]!; // only one cell
    p.send({ t: 'submit', entries: partial });
    const inc = await p.next('incomplete');
    expect(inc.remainingCells).toBe(keys.length - 1);
    host.close();
    p.close();
  });
});

// ===========================================================================
// 3. Alarm transitions (countdown→live, live→winner) + stale no-op.
// ===========================================================================
describe('alarm transitions', () => {
  async function hostToCountdown(joinCode: string, hostToken: string): Promise<WsClient> {
    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.next('snapshot');
    host.send({ t: 'openLobby' });
    await host.next('snapshot');
    host.send({ t: 'startCountdown' });
    await host.next('snapshot');
    return host;
  }

  it('countdown → live via runDurableObjectAlarm (fires immediately)', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await hostToCountdown(joinCode, hostToken);
    const ran = await runDurableObjectAlarm(stubFor(joinCode));
    expect(ran).toBe(true);
    const snap = await host.next('snapshot');
    expect(snap.phase).toBe('live');
    expect(snap.startedAt).toBeGreaterThan(0);
    expect(snap.roundEndsAt).toBeGreaterThan(0);
    host.close();
  });

  it('live → winner when the roundEnd alarm fires', async () => {
    // durationSec 0 → roundEnd dueAt ≈ now, so the dueAt guard lets the alarm fire.
    const { joinCode, hostToken } = await seedSession('mini-ai', 1);
    const host = await hostToCountdown(joinCode, hostToken);
    await runDurableObjectAlarm(stubFor(joinCode)); // countdown → live
    await host.next('snapshot');
    const ran = await runDurableObjectAlarm(stubFor(joinCode)); // roundEnd → winner
    expect(ran).toBe(true);
    const snap = await host.next('snapshot');
    expect(snap.phase).toBe('winner');
    host.close();
  });

  it('a stale alarm (phase no longer matches the intent) is a no-op', async () => {
    // Real at-least-once scenario: a roundEnd alarm is scheduled while live, the
    // host manually ends the round (phase→winner, alarm deleted), then a delivery
    // of the now-stale alarm must NOT re-run END_ROUND or re-transition.
    const { joinCode, hostToken } = await seedSession();
    const host = await hostToCountdown(joinCode, hostToken);
    await runDurableObjectAlarm(stubFor(joinCode)); // countdown → live (roundEnd intent)
    await host.next('snapshot');
    host.send({ t: 'endRound' }); // → winner, intent cleared, alarm deleted
    const winnerSnap = await host.next('snapshot');
    expect(winnerSnap.phase).toBe('winner');
    // Fire alarm() directly (deleteAlarm already happened, so runDurableObjectAlarm
    // would no-op for lack of a scheduled alarm — call the handler to prove the
    // intent/phase guard itself no-ops).
    await runInDurableObject(stubFor(joinCode), (instance) =>
      (instance as unknown as DOInternals).alarm(),
    );
    const phase = await runInDurableObject(stubFor(joinCode), async (_i, state) => {
      const st = (await state.storage.get('state')) as { phase: string };
      return st.phase;
    });
    expect(phase).toBe('winner'); // unchanged — the stale alarm did nothing
    host.close();
  });

  it('a stale alarm intent (round mismatch) is a no-op against the live instance', async () => {
    // Drive against the SAME in-memory instance: mutate the instance's intent via
    // a direct call, then invoke alarm() — round mismatch must short-circuit.
    const { joinCode, hostToken } = await seedSession();
    const host = await hostToCountdown(joinCode, hostToken);
    const phaseAfter = await runInDurableObject(stubFor(joinCode), async (instance, state) => {
      // Corrupt the persisted intent's round AND force the instance to reload it,
      // emulating a stale at-least-once delivery whose round no longer matches.
      const st = (await state.storage.get('state')) as {
        round: number;
        alarmIntent: { round: number } | null;
      };
      // Bump the round in state so the intent (round 1) is now stale.
      st.round = 7;
      await state.storage.put('state', st);
      // Reflect the round bump into the in-memory instance so alarm() sees it.
      const internals = instance as unknown as DOInternals;
      internals.s.round = 7;
      await internals.alarm();
      const after = (await state.storage.get('state')) as { phase: string };
      return after.phase;
    });
    // alarm() saw intent.round(1) !== s.round(7) → no-op; phase stays countdown.
    expect(phaseAfter).toBe('countdown');
    host.close();
  });

  it('a redelivered alarm while live (roundEnd not yet due) does NOT end the round early', async () => {
    // Regression: alarm delivery is at-least-once. After countdown→live flips the
    // intent to roundEnd (dueAt = now + durationSec), a redelivered/duplicate
    // alarm re-enters alarm(); without the dueAt guard it would END the round
    // immediately. With a 120s duration, dueAt is far in the future, so the
    // extra alarm() must be a no-op and the phase must stay 'live'.
    const { joinCode, hostToken } = await seedSession(); // durationSec 120
    const host = await hostToCountdown(joinCode, hostToken);
    await runDurableObjectAlarm(stubFor(joinCode)); // countdown → live (roundEnd intent, dueAt +120s)
    await host.next('snapshot');
    const phase = await runInDurableObject(stubFor(joinCode), async (instance, state) => {
      await (instance as unknown as DOInternals).alarm(); // simulate redelivered alarm
      const st = (await state.storage.get('state')) as { phase: string };
      return st.phase;
    });
    expect(phase).toBe('live'); // NOT ended early
    host.close();
  });
});

// ===========================================================================
// Auto-end when every connected player has finished.
// ===========================================================================
describe('auto-end all connected finishers', () => {
  const ALL_FINISHED_GRACE_MS = 4000;

  type StoredAlarm = { kind: string; round: number; dueAt: number };
  type StoredState = { phase: string; alarmIntent: StoredAlarm | null };

  async function readState(joinCode: string): Promise<StoredState> {
    return runInDurableObject(stubFor(joinCode), async (_i, state) =>
      (await state.storage.get('state')) as StoredState,
    );
  }

  async function readAlarm(joinCode: string): Promise<number | null> {
    return runInDurableObject(stubFor(joinCode), (_i, state) => state.storage.getAlarm());
  }

  async function reachLiveWithPlayers(
    joinCode: string,
    hostToken: string,
    names: string[],
  ): Promise<{ host: WsClient; players: WsClient[] }> {
    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.next('snapshot');
    host.send({ t: 'openLobby' });
    await host.nextSnapshotWhere((s) => s.phase === 'lobby');

    const players: WsClient[] = [];
    for (const name of names) {
      const player = await WsClient.open(joinCode);
      player.send({ t: 'hello', role: 'player', code: joinCode });
      await player.next('identity');
      await player.next('snapshot');
      player.send({ t: 'join', name });
      await player.nextSnapshotWhere((s) => s.players.some((p) => p.name === name));
      players.push(player);
    }

    host.send({ t: 'startCountdown' });
    await host.nextSnapshotWhere((s) => s.phase === 'countdown');
    await runDurableObjectAlarm(stubFor(joinCode)); // countdown → live
    await host.nextSnapshotWhere((s) => s.phase === 'live');
    for (const player of players) await player.nextSnapshotWhere((s) => s.phase === 'live');
    return { host, players };
  }

  async function submitCorrect(player: WsClient, entries: Record<string, string>): Promise<void> {
    player.send({ t: 'submit', entries });
    await player.next('finished');
  }

  // Pull the rescheduled roundEnd intent into the past (storage + in-memory) and
  // invoke alarm() DIRECTLY — the same forcing pattern the round-mismatch test
  // uses. (setAlarm(pastTime) + runDurableObjectAlarm is unreliable: a past alarm
  // self-fires before the outer runDurableObjectAlarm checks for one.)
  async function makeAlarmDueAndFire(joinCode: string): Promise<void> {
    await runInDurableObject(stubFor(joinCode), async (instance, state) => {
      const internals = instance as unknown as DOInternals;
      const st = (await state.storage.get('state')) as StoredState;
      if (!st.alarmIntent) throw new Error('expected an alarmIntent');
      st.alarmIntent.dueAt = Date.now() - 1000;
      await state.storage.put('state', st);
      if (internals.s.alarmIntent) internals.s.alarmIntent.dueAt = st.alarmIntent.dueAt;
      await internals.alarm();
    });
  }

  it('allowLate=false, partial finish keeps the round live without rescheduling to grace', async () => {
    const { joinCode, hostToken, puzzleId } = await seedSession('mini-ai', 120);
    const { host, players } = await reachLiveWithPlayers(joinCode, hostToken, ['Ada', 'Ben']);
    const original = (await readState(joinCode)).alarmIntent!;
    const entries = await correctEntries(puzzleId);

    await submitCorrect(players[0]!, entries);
    await host.syncBarrier(host);

    const after = await readState(joinCode);
    expect(after.phase).toBe('live');
    expect(after.alarmIntent?.kind).toBe('roundEnd');
    expect(after.alarmIntent?.dueAt).toBe(original.dueAt);
    expect(await readAlarm(joinCode)).toBe(original.dueAt);
    host.close();
    for (const player of players) player.close();
  });

  it('allowLate=false, all finish reschedules roundEnd to grace and then transitions to winner', async () => {
    const { joinCode, hostToken, puzzleId } = await seedSession('mini-ai', 120);
    const { host, players } = await reachLiveWithPlayers(joinCode, hostToken, ['Ada', 'Ben']);
    const original = (await readState(joinCode)).alarmIntent!;
    const entries = await correctEntries(puzzleId);

    await submitCorrect(players[0]!, entries);
    await host.syncBarrier(host);
    const beforeLastFinish = Date.now();
    await submitCorrect(players[1]!, entries);
    await host.syncBarrier(host);

    const after = await readState(joinCode);
    expect(after.phase).toBe('live');
    expect(after.alarmIntent?.kind).toBe('roundEnd');
    expect(after.alarmIntent?.dueAt).toBeLessThan(original.dueAt);
    expect(after.alarmIntent?.dueAt).toBeGreaterThanOrEqual(beforeLastFinish + ALL_FINISHED_GRACE_MS - 500);
    expect(after.alarmIntent?.dueAt).toBeLessThanOrEqual(Date.now() + ALL_FINISHED_GRACE_MS + 500);
    expect(await readAlarm(joinCode)).toBe(after.alarmIntent?.dueAt);

    await makeAlarmDueAndFire(joinCode);
    const winner = await host.nextSnapshotWhere((s) => s.phase === 'winner');
    expect(winner.phase).toBe('winner');
    host.close();
    for (const player of players) player.close();
  });

  it('allowLate=true, all finish does not reschedule early', async () => {
    const { joinCode, hostToken, puzzleId } = await seedSession(
      'mini-ai',
      120,
      8,
      undefined,
      { allowLate: true },
    );
    const { host, players } = await reachLiveWithPlayers(joinCode, hostToken, ['Ada', 'Ben']);
    const original = (await readState(joinCode)).alarmIntent!;
    const entries = await correctEntries(puzzleId);

    await submitCorrect(players[0]!, entries);
    await submitCorrect(players[1]!, entries);
    await host.syncBarrier(host);

    const after = await readState(joinCode);
    expect(after.phase).toBe('live');
    expect(after.alarmIntent?.kind).toBe('roundEnd');
    expect(after.alarmIntent?.dueAt).toBe(original.dueAt);
    expect(await readAlarm(joinCode)).toBe(original.dueAt);
    expect(await runDurableObjectAlarm(stubFor(joinCode))).toBe(true);
    expect((await readState(joinCode)).phase).toBe('live');
    host.close();
    for (const player of players) player.close();
  });

  it('an unfinished connected player blocks auto-end even if all others finished', async () => {
    const { joinCode, hostToken, puzzleId } = await seedSession('mini-ai', 120);
    const { host, players } = await reachLiveWithPlayers(joinCode, hostToken, [
      'Ada',
      'Ben',
      'Cy',
    ]);
    const original = (await readState(joinCode)).alarmIntent!;
    const entries = await correctEntries(puzzleId);

    await submitCorrect(players[0]!, entries);
    await submitCorrect(players[1]!, entries);
    await host.syncBarrier(host);

    const after = await readState(joinCode);
    expect(after.phase).toBe('live');
    expect(after.alarmIntent?.kind).toBe('roundEnd');
    expect(after.alarmIntent?.dueAt).toBe(original.dueAt);
    expect(await readAlarm(joinCode)).toBe(original.dueAt);
    host.close();
    for (const player of players) player.close();
  });

  it('a straggler reconnecting during the grace restores the clock (no cutoff); the clock still ends the round', async () => {
    // Reconnect-during-grace: A disconnects unfinished, B finishes (so maybeAutoEnd
    // schedules the grace for the connected set = {B}), then A reconnects. At
    // grace-fire A is a connected non-finisher again — alarm() must RESTORE the
    // original clock, not cut A off. Drive the post-grace state directly: the
    // links that produce it (grace excludes disconnected players; disconnect→
    // reattach) are each verified separately, but the full timed chain isn't
    // staged here — the 4s grace window is tighter than reconnect latency.
    const { joinCode, hostToken } = await seedSession('mini-ai', 120);
    const { host, players } = await reachLiveWithPlayers(joinCode, hostToken, ['Ada', 'Ben']);
    const original = (await readState(joinCode)).alarmIntent!; // full +120s clock

    const afterGrace = await runInDurableObject(stubFor(joinCode), async (instance, state) => {
      const internals = instance as unknown as DOInternals;
      const ps = Object.values(internals.s.players);
      ps[0]!.finishMs = null; // Ada — reconnected, still unfinished
      ps[0]!.connected = true;
      ps[1]!.finishMs = 1234; // Ben — finished
      ps[1]!.connected = true;
      // A pulled-forward, already-due grace alarm (as scheduled while Ada was off).
      internals.s.alarmIntent = { kind: 'roundEnd', round: internals.s.round, dueAt: Date.now() - 1000 };
      await state.storage.put('state', internals.s);
      await internals.alarm(); // grace fire → should restore, not end
      return { phase: internals.s.phase, dueAt: internals.s.alarmIntent?.dueAt ?? null };
    });
    // Restored: still live, clock pushed back to the original full-duration end.
    expect(afterGrace.phase).toBe('live');
    expect(afterGrace.dueAt).toBe(original.dueAt);

    // Termination: the GENUINE clock expiry ends the round even with Ada still
    // connected + unfinished (proves restore can't become a never-ending round).
    // Backdate startedAt so roundEndsAt() is in the past, then fire the clock alarm.
    await runInDurableObject(stubFor(joinCode), async (instance, state) => {
      const internals = instance as unknown as DOInternals;
      internals.s.startedAt = Date.now() - (120_000 + 5_000);
      const endsAt = internals.s.startedAt + 120_000 + internals.s.pausedAccumMs;
      internals.s.alarmIntent = { kind: 'roundEnd', round: internals.s.round, dueAt: endsAt };
      await state.storage.put('state', internals.s);
      await internals.alarm();
    });
    const winner = await host.nextSnapshotWhere((s) => s.phase === 'winner');
    expect(winner.phase).toBe('winner');
    host.close();
    for (const player of players) player.close();
  });
});

// ===========================================================================
// 4. pauseToggle deletes the alarm; resume reschedules it.
// ===========================================================================
describe('pause / resume', () => {
  it('pause deletes the alarm; resume reschedules', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.next('snapshot');
    host.send({ t: 'openLobby' });
    await host.next('snapshot');
    host.send({ t: 'startCountdown' });
    await host.next('snapshot');
    await runDurableObjectAlarm(stubFor(joinCode)); // → live, sets roundEnd alarm
    await host.next('snapshot');

    // alarm exists while live
    const before = await runInDurableObject(stubFor(joinCode), (_i, state) =>
      state.storage.getAlarm(),
    );
    expect(before).not.toBeNull();

    host.send({ t: 'pauseToggle' }); // pause → deleteAlarm
    await host.next('snapshot');
    const paused = await runInDurableObject(stubFor(joinCode), (_i, state) =>
      state.storage.getAlarm(),
    );
    expect(paused).toBeNull();

    host.send({ t: 'pauseToggle' }); // resume → reschedule
    await host.next('snapshot');
    const resumed = await runInDurableObject(stubFor(joinCode), (_i, state) =>
      state.storage.getAlarm(),
    );
    expect(resumed).not.toBeNull();
    host.close();
  });
});

// ===========================================================================
// 5. nextRound keeps the same join code, increments round; round_results has
//    exactly one row per (join_code, round) even if END_ROUND runs twice.
// ===========================================================================
describe('nextRound + idempotent round_results', () => {
  it('keeps join code, increments round, single result row despite double end', async () => {
    const { joinCode, hostToken } = await seedSession('mini-ai', 1);
    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.next('snapshot');
    host.send({ t: 'openLobby' });
    await host.next('snapshot');
    host.send({ t: 'startCountdown' });
    await host.next('snapshot');
    await runDurableObjectAlarm(stubFor(joinCode)); // → live (schedules roundEnd alarm)
    await host.next('snapshot');

    // END_ROUND #1: let the roundEnd ALARM fire → winner + writeResults (real path).
    const ranAlarm = await runDurableObjectAlarm(stubFor(joinCode));
    expect(ranAlarm).toBe(true);
    const winnerSnap = await host.nextSnapshotWhere((s) => s.phase === 'winner');
    expect(winnerSnap.phase).toBe('winner');
    expect(winnerSnap.round).toBe(1);

    // END_ROUND #2: a redelivered roundEnd alarm re-enters endRoundInternal
    // (at-least-once delivery). This MUST hit the resultsWritten guard (skip the
    // write) so round_results stays at exactly one row — the codex #6 idempotency
    // contract. Driven directly because Fix 4 makes a host `endRound` during
    // `winner` a no-op (phase guard), so we exercise the write path itself twice.
    await runInDurableObject(stubFor(joinCode), (instance) =>
      (instance as unknown as { endRoundInternal(): Promise<void> }).endRoundInternal(),
    );
    const stillWinner = await runInDurableObject(stubFor(joinCode), async (_i, state) => {
      const st = (await state.storage.get('state')) as { phase: string };
      return st.phase;
    });
    expect(stillWinner).toBe('winner');

    const count1 = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM round_results WHERE join_code = ? AND round = 1',
    )
      .bind(joinCode)
      .first<{ n: number }>();
    expect(count1!.n).toBe(1);

    // nextRound → same join code, round 2, lobby. Wait for the round-2 lobby
    // snapshot specifically (the direct endRoundInternal above queued a winner
    // snapshot that host.next('snapshot') would otherwise grab first).
    host.send({ t: 'nextRound' });
    const next = await host.nextSnapshotWhere((s) => s.phase === 'lobby' && s.round === 2);
    expect(next.joinCode).toBe(joinCode); // SAME code
    expect(next.round).toBe(2);
    expect(next.phase).toBe('lobby');

    // sessions.round was bumped
    const sess = await env.DB.prepare('SELECT round FROM sessions WHERE join_code = ?')
      .bind(joinCode)
      .first<{ round: number }>();
    expect(sess!.round).toBe(2);
    host.close();
  });
});

// ===========================================================================
// 6. useHint reveals exactly one new cell, increments hintsUsed, dedupes.
// ===========================================================================
describe('useHint reveal + dedupe', () => {
  it('reveals one new cell, increments hintsUsed, second hint reveals a different cell', async () => {
    const { joinCode, hostToken, puzzleId } = await seedSession();
    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.next('snapshot');
    host.send({ t: 'openLobby' });
    await host.next('snapshot');
    // player joins during lobby (allowLate=false)
    const p = await WsClient.open(joinCode);
    p.send({ t: 'hello', role: 'player', code: joinCode });
    const ident = await p.next('identity');
    await p.next('snapshot');
    p.send({ t: 'join', name: 'Hint Hank' });
    await p.next('snapshot');
    host.send({ t: 'startCountdown' });
    await host.next('snapshot');
    await runDurableObjectAlarm(stubFor(joinCode)); // → live
    await host.next('snapshot');
    await p.next('snapshot'); // player observes live

    // Pick the first across word id.
    const puzzle = rowToPuzzle(
      (await env.DB.prepare('SELECT * FROM puzzles WHERE id = ?')
        .bind(puzzleId)
        .first<import('../src/db').PuzzleRow>())!,
    );
    const firstAcross = puzzle.across[0]!;
    const wordId = `across:${firstAcross.num}`;
    const correctLetter = (r: number, c: number) => puzzle.grid[r]![c];

    p.send({ t: 'useHint', wordId });
    const hint1 = await p.next('hint');
    expect(hint1.letter).toBe(correctLetter(hint1.r, hint1.c));
    const snap1 = await p.nextSnapshotWhere(
      (s) => (s.players.find((pl) => pl.id === ident.playerId)?.hintsUsed ?? 0) >= 1,
    );
    expect(snap1.players.find((pl) => pl.id === ident.playerId)?.hintsUsed).toBe(1);

    // Reset the per-player hint rate-limit clock so the immediately-following
    // second hint isn't swallowed by HINT_MIN_INTERVAL_MS (Fix 6). In Miniflare
    // the two sends are <500ms apart; rate-limiting is exercised separately.
    await runInDurableObject(stubFor(joinCode), (instance) => {
      const internals = instance as unknown as {
        s: { players: Record<string, { lastHintAt: number }> };
      };
      internals.s.players[ident.playerId]!.lastHintAt = 0;
    });

    p.send({ t: 'useHint', wordId });
    const hint2 = await p.next('hint');
    // different cell than the first (dedupe)
    expect(`${hint2.r},${hint2.c}`).not.toBe(`${hint1.r},${hint1.c}`);
    expect(hint2.letter).toBe(correctLetter(hint2.r, hint2.c));
    const snap2 = await p.nextSnapshotWhere(
      (s) => (s.players.find((pl) => pl.id === ident.playerId)?.hintsUsed ?? 0) >= 2,
    );
    expect(snap2.players.find((pl) => pl.id === ident.playerId)?.hintsUsed).toBe(2);

    host.close();
    p.close();
  });
});

// ===========================================================================
// 7. Hibernation restore: abortAllDurableObjects() drops in-memory instances
//    (but KEEPS persisted data), simulating eviction. The constructor must
//    rebuild BOTH the persisted state AND the in-memory puzzle from D1, so a
//    fresh connection on a cold instance still serves a correct snapshot.
// ===========================================================================
describe('hibernation / eviction restore', () => {
  it('rebuilds state + puzzle from storage+D1 after the instance is dropped', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.next('snapshot');
    host.send({ t: 'openLobby' });
    const lobbySnap = await host.next('snapshot');
    expect(lobbySnap.phase).toBe('lobby');
    host.close();

    // Drop all in-memory DO instances (keeps persisted storage) → forces the
    // constructor to re-run on next access.
    await abortAllDurableObjects();

    // A brand-new connection lands on a cold instance: phase must be restored to
    // 'lobby' (from storage) and publicPuzzle must be present (rebuilt from D1).
    const tv = await WsClient.open(joinCode);
    tv.send({ t: 'hello', role: 'tv', code: joinCode });
    const snap = await tv.next('snapshot');
    expect(snap.phase).toBe('lobby');
    expect(snap.joinCode).toBe(joinCode);
    expect(snap.publicPuzzle).not.toBeNull();
    expect(snap.publicPuzzle!.cellCount).toBeGreaterThan(0);
    tv.close();
  });
});

// ===========================================================================
// 8. Hardening fixes (review): rejoin secret, close-race, phase guards,
//    progress gating, hint rate-limit.
// ===========================================================================

// Open a host + bring the session to lobby. Returns the host client.
async function hostToLobby(joinCode: string, hostToken: string): Promise<WsClient> {
  const host = await WsClient.open(joinCode);
  host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
  await host.next('snapshot');
  host.send({ t: 'openLobby' });
  await host.next('snapshot');
  return host;
}

// Hello + join a player during lobby; returns the client + its identity frame.
async function joinPlayer(
  joinCode: string,
  name: string,
): Promise<{ client: WsClient; playerId: string; rejoinSecret: string }> {
  const p = await WsClient.open(joinCode);
  p.send({ t: 'hello', role: 'player', code: joinCode });
  const ident = await p.next('identity');
  await p.next('snapshot');
  p.send({ t: 'join', name });
  await p.next('snapshot');
  return { client: p, playerId: ident.playerId, rejoinSecret: ident.rejoinSecret };
}

// Read a player's server-side record fields via runInDurableObject.
async function readPlayer(
  joinCode: string,
  playerId: string,
): Promise<{ connected: boolean; filledPct: number; hintsUsed: number } | undefined> {
  return runInDurableObject(stubFor(joinCode), async (_i, state) => {
    const st = (await state.storage.get('state')) as {
      players: Record<string, { connected: boolean; filledPct: number; hintsUsed: number }>;
    };
    return st.players[playerId];
  });
}

// ---------------------------------------------------------------------------
// Fix 1 — playerId is NOT a reattach credential; the rejoinSecret gates it.
// ---------------------------------------------------------------------------
describe('Fix 1: rejoin secret gates identity reattach', () => {
  it('identity frame carries a rejoinSecret', async () => {
    const { joinCode } = await seedSession();
    const c = await WsClient.open(joinCode);
    c.send({ t: 'hello', role: 'player', code: joinCode });
    const ident = await c.next('identity');
    expect(ident.playerId).toMatch(/^p_/);
    expect(typeof ident.rejoinSecret).toBe('string');
    expect(ident.rejoinSecret.length).toBeGreaterThan(0);
    c.close();
  });

  it('rejoinSecret never appears in a snapshot (anti-cheat)', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await hostToLobby(joinCode, hostToken);
    const victim = await joinPlayer(joinCode, 'Victim Val');
    const snap = await victim.client.nextSnapshotWhere((s) =>
      s.players.some((pl) => pl.id === victim.playerId),
    );
    expect(JSON.stringify(snap)).not.toContain(victim.rejoinSecret);
    // and not on the player projection
    const me = snap.players.find((pl) => pl.id === victim.playerId)!;
    expect((me as Record<string, unknown>).rejoinSecret).toBeUndefined();
    host.close();
    victim.client.close();
  });

  it('a forged hello (victim playerId, WRONG secret) gets a FRESH id and cannot act as the victim', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await hostToLobby(joinCode, hostToken);
    const victim = await joinPlayer(joinCode, 'Victim Val');

    // Attacker saw the victim's id in a snapshot; presents it with a bad secret.
    const attacker = await WsClient.open(joinCode);
    attacker.send({
      t: 'hello',
      role: 'player',
      code: joinCode,
      playerId: victim.playerId,
      rejoinSecret: 'definitely-not-the-secret',
    });
    const aIdent = await attacker.next('identity');
    expect(aIdent.playerId).not.toBe(victim.playerId); // FRESH id, no hijack
    await attacker.next('snapshot');

    // Attacker joins (creates its own row) then finishes — must NOT stamp the victim.
    attacker.send({ t: 'join', name: 'Mallory' });
    await attacker.nextSnapshotWhere((s) => s.players.some((pl) => pl.id === aIdent.playerId));

    host.send({ t: 'startCountdown' });
    await host.next('snapshot');
    await runDurableObjectAlarm(stubFor(joinCode)); // → live
    await host.next('snapshot');

    // Attacker submits the correct solution → only the ATTACKER's row gets finishMs.
    const good = await correctEntries('mini-ai');
    attacker.send({ t: 'submit', entries: good });
    await attacker.next('finished');
    const finalSnap = await attacker.nextSnapshotWhere(
      (s) => (s.players.find((pl) => pl.id === aIdent.playerId)?.finishMs ?? null) != null,
    );
    const victimRow = finalSnap.players.find((pl) => pl.id === victim.playerId);
    expect(victimRow?.finishMs ?? null).toBeNull(); // victim untouched
    host.close();
    victim.client.close();
    attacker.close();
  });

  it('a hello with the CORRECT secret reattaches to the same playerId', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await hostToLobby(joinCode, hostToken);
    const first = await joinPlayer(joinCode, 'Returning Rae');
    first.client.close();

    const again = await WsClient.open(joinCode);
    again.send({
      t: 'hello',
      role: 'player',
      code: joinCode,
      playerId: first.playerId,
      rejoinSecret: first.rejoinSecret,
    });
    const ident = await again.next('identity');
    expect(ident.playerId).toBe(first.playerId); // same identity restored
    again.close();
    host.close();
  });
});

// ---------------------------------------------------------------------------
// Fix 3 — reconnect close-race must not flip an active player offline.
// ---------------------------------------------------------------------------
describe('Fix 3: stale close does not flip an active player offline', () => {
  it('closing socket A keeps the player connected when socket B is open with the same id', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await hostToLobby(joinCode, hostToken);
    const a = await joinPlayer(joinCode, 'Dup Dan');

    // Socket B reattaches the SAME playerId with the correct secret.
    const b = await WsClient.open(joinCode);
    b.send({
      t: 'hello',
      role: 'player',
      code: joinCode,
      playerId: a.playerId,
      rejoinSecret: a.rejoinSecret,
    });
    const bIdent = await b.next('identity');
    expect(bIdent.playerId).toBe(a.playerId);
    await b.next('snapshot');

    // Close the OLD socket A (stale close). Player must remain connected.
    a.client.close();
    // Drive a broadcast on B (toggle nothing — just ensure the close handler ran
    // before we read) and give the close a beat to process.
    await b.syncBarrier(host);

    const rec = await readPlayer(joinCode, a.playerId);
    expect(rec?.connected).toBe(true);
    host.close();
    b.close();
  });
});

// ---------------------------------------------------------------------------
// Fix 4 — phase machine enforced on host verbs.
// ---------------------------------------------------------------------------
describe('Fix 4: host verb phase guards', () => {
  it('endRound during lobby is a no-op (no round_results row, phase unchanged)', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await hostToLobby(joinCode, hostToken);
    host.send({ t: 'endRound' }); // lobby → ignored
    // toggleLeaderboard is always-on, so use it to get a fresh snapshot AFTER endRound.
    const snap = await host.syncBarrier(host);
    expect(snap.phase).toBe('lobby'); // unchanged

    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM round_results WHERE join_code = ?',
    )
      .bind(joinCode)
      .first<{ n: number }>();
    expect(count!.n).toBe(0); // no results written
    host.close();
  });

  it('nextRound from idle is a no-op (phase stays idle, no results)', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.next('snapshot'); // phase idle
    host.send({ t: 'nextRound' }); // idle → ignored
    const snap = await host.syncBarrier(host);
    expect(snap.phase).toBe('idle'); // unchanged
    expect(snap.round).toBe(1); // not advanced

    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM round_results WHERE join_code = ?',
    )
      .bind(joinCode)
      .first<{ n: number }>();
    expect(count!.n).toBe(0);
    host.close();
  });

  it('openLobby is ignored mid-round (live), accepted from winner', async () => {
    const { joinCode, hostToken } = await seedSession('mini-ai', 1);
    const host = await hostToLobby(joinCode, hostToken);
    host.send({ t: 'startCountdown' });
    await host.next('snapshot');
    await runDurableObjectAlarm(stubFor(joinCode)); // → live
    await host.next('snapshot');

    host.send({ t: 'openLobby' }); // live → ignored
    const liveSnap = await host.syncBarrier(host);
    expect(liveSnap.phase).toBe('live'); // still live

    host.send({ t: 'endRound' }); // live → winner
    await host.nextSnapshotWhere((s) => s.phase === 'winner');
    host.send({ t: 'openLobby' }); // winner → allowed
    const lobbySnap = await host.nextSnapshotWhere((s) => s.phase === 'lobby');
    expect(lobbySnap.phase).toBe('lobby');
    host.close();
  });
});

// ---------------------------------------------------------------------------
// Fix 8 — setConfig must NOT change the puzzle (puzzleId/puzzleName stripped).
// ---------------------------------------------------------------------------
describe('Fix 8: setConfig cannot swap the puzzle', () => {
  it('a setConfig patch carrying puzzleId is stripped; other fields still apply', async () => {
    const { joinCode, hostToken, puzzleId } = await seedSession();
    const host = await hostToLobby(joinCode, hostToken);

    // Patch tries to swap puzzle, mutate the snapshotted aiTone, AND change an
    // allowed field (hintPenalty). puzzleId/puzzleName/aiTone must be stripped.
    host.send({
      t: 'setConfig',
      patch: { puzzleId: 'some-other-puzzle', puzzleName: 'Hacked', aiTone: 'hacked', hintPenalty: 99 },
    });
    // Sync barrier, then read the authoritative persisted config.
    await host.syncBarrier(host);

    const cfg = await runInDurableObject(stubFor(joinCode), async (_i, state) => {
      const st = (await state.storage.get('state')) as {
        config: { puzzleId: string; puzzleName: string; hintPenalty: number; aiTone?: string };
      };
      return st.config;
    });
    expect(cfg.hintPenalty).toBe(99); // allowed field applied
    expect(cfg.puzzleId).toBe(puzzleId); // puzzle UNCHANGED
    expect(cfg.puzzleName).not.toBe('Hacked');
    expect(cfg.aiTone).not.toBe('hacked'); // snapshotted tone is immutable post-create
    host.close();
  });
});

// ---------------------------------------------------------------------------
// Fix 5 — progress ignored outside a live round / after finishing.
// ---------------------------------------------------------------------------
describe('Fix 5: progress gating', () => {
  it('a progress sent during winner does not change filledPct', async () => {
    const { joinCode, hostToken } = await seedSession('mini-ai', 1);
    const host = await hostToLobby(joinCode, hostToken);
    const p = await joinPlayer(joinCode, 'Prog Pam');
    host.send({ t: 'startCountdown' });
    await host.next('snapshot');
    await runDurableObjectAlarm(stubFor(joinCode)); // → live
    await host.next('snapshot');
    await p.client.next('snapshot');

    host.send({ t: 'endRound' }); // → winner
    await host.nextSnapshotWhere((s) => s.phase === 'winner');

    const before = await readPlayer(joinCode, p.playerId);
    expect(before?.filledPct).toBe(0);
    // progress during winner → ignored
    p.client.send({ t: 'progress', filledPct: 0.9 });
    // nudge a broadcast and wait so the progress (if processed) would land
    await host.syncBarrier(host);

    const after = await readPlayer(joinCode, p.playerId);
    expect(after?.filledPct).toBe(0); // unchanged
    host.close();
    p.client.close();
  });
});

// ---------------------------------------------------------------------------
// Fix 6 — hints are rate-limited (HINT_MIN_INTERVAL_MS).
// ---------------------------------------------------------------------------
describe('Fix 6: hint rate-limit', () => {
  it('two useHint within the cooldown → only one reveal, second is throttled', async () => {
    const { joinCode, hostToken, puzzleId } = await seedSession();
    const host = await hostToLobby(joinCode, hostToken);
    const p = await joinPlayer(joinCode, 'Rapid Rita');
    host.send({ t: 'startCountdown' });
    await host.next('snapshot');
    await runDurableObjectAlarm(stubFor(joinCode)); // → live
    await host.next('snapshot');
    await p.client.next('snapshot');

    const puzzle = rowToPuzzle(
      (await env.DB.prepare('SELECT * FROM puzzles WHERE id = ?')
        .bind(puzzleId)
        .first<import('../src/db').PuzzleRow>())!,
    );
    const wordId = `across:${puzzle.across[0]!.num}`;

    // Two rapid hints back-to-back (well under 500ms in Miniflare).
    p.client.send({ t: 'useHint', wordId });
    const hint1 = await p.client.next('hint');
    expect(hint1.letter).toBeTruthy();
    p.client.send({ t: 'useHint', wordId }); // within the cooldown → refused

    // The refused hint replies with a throttle message (no reveal).
    const throttled = await p.client.next('hintThrottled');
    expect(throttled.t).toBe('hintThrottled');

    // Confirm exactly one reveal: hintsUsed stays at 1. Use a host-driven
    // snapshot as a sync barrier, then read the authoritative record.
    await host.syncBarrier(host);
    const rec = await readPlayer(joinCode, p.playerId);
    expect(rec?.hintsUsed).toBe(1);

    host.close();
    p.client.close();
  });
});

// ---------------------------------------------------------------------------
// Fix 5 (worker) — maxPlayers cap + reconnect always allowed.
// ---------------------------------------------------------------------------
describe('worker Fix 5: maxPlayers cap', () => {
  it('rejects a 3rd distinct join with error code "full"; first 2 succeed; reconnect still works', async () => {
    const { joinCode, hostToken } = await seedSession('mini-ai', 120, 2); // maxPlayers = 2
    const host = await hostToLobby(joinCode, hostToken);

    // Player 1 + 2 join successfully.
    const p1 = await joinPlayer(joinCode, 'One');
    const p2 = await joinPlayer(joinCode, 'Two');

    // Player 3: distinct identity → hello (fresh id), then join is rejected 'full'.
    const p3 = await WsClient.open(joinCode);
    p3.send({ t: 'hello', role: 'player', code: joinCode });
    const p3Ident = await p3.next('identity');
    await p3.next('snapshot');
    p3.send({ t: 'join', name: 'Three' });
    const err = await p3.next('error');
    expect(err.code).toBe('full');

    // The session still has exactly 2 players (p3 not added).
    const players = await runInDurableObject(stubFor(joinCode), async (_i, state) => {
      const st = (await state.storage.get('state')) as { players: Record<string, unknown> };
      return Object.keys(st.players);
    });
    expect(players).toHaveLength(2);
    expect(players).not.toContain(p3Ident.playerId);
    expect(players).toContain(p1.playerId);
    expect(players).toContain(p2.playerId);

    // Reconnect of player #1 (existing id, correct secret) is always allowed even
    // at capacity — a fresh socket re-helloing then re-joining must succeed.
    const again = await WsClient.open(joinCode);
    again.send({
      t: 'hello',
      role: 'player',
      code: joinCode,
      playerId: p1.playerId,
      rejoinSecret: p1.rejoinSecret,
    });
    const againIdent = await again.next('identity');
    expect(againIdent.playerId).toBe(p1.playerId);
    await again.next('snapshot');
    again.send({ t: 'join', name: 'One Again' });
    // join succeeds → broadcast snapshot (not an error). Player count stays 2.
    const snap = await again.nextSnapshotWhere((s) =>
      s.players.some((pl) => pl.id === p1.playerId && pl.name === 'One Again'),
    );
    expect(snap.players).toHaveLength(2);

    host.close();
    p1.client.close();
    p2.client.close();
    p3.close();
    again.close();
  });

  it('strips control chars and clamps a long name to 24 chars', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await hostToLobby(joinCode, hostToken);
    const p = await WsClient.open(joinCode);
    p.send({ t: 'hello', role: 'player', code: joinCode });
    const ident = await p.next('identity');
    await p.next('snapshot');
    // Name with control chars (NUL, BEL, newline) + internal space, padded > 24
    // chars. Control chars are stripped; the internal space is PRESERVED; the
    // result is trimmed then clamped to 24 chars.
    const rawName = '  Ab\u0000 cd\u0007\n' + 'X'.repeat(40) + '  ';
    p.send({ t: 'join', name: rawName });
    const snap = await p.nextSnapshotWhere((s) =>
      s.players.some((pl) => pl.id === ident.playerId),
    );
    const me = snap.players.find((pl) => pl.id === ident.playerId)!;
    // Control chars gone, internal space kept, length clamped.
    expect(me.name).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(me.name.length).toBeLessThanOrEqual(24);
    expect(me.name.startsWith('Ab cd')).toBe(true); // 'Ab\0 cd\7' -> 'Ab cd'
    host.close();
    p.close();
  });
});

// ---------------------------------------------------------------------------
// Fix 7 (worker) — host token re-issued in D1 is accepted (re-read on mismatch).
// ---------------------------------------------------------------------------
describe('worker Fix 7: host token re-validation from D1', () => {
  it('a hello with a NEWLY-ISSUED token (D1 updated) is accepted; control verbs work', async () => {
    const { joinCode, hostToken } = await seedSession();
    // Warm the DO so the OLD hash is cached (a WS open runs loadFromD1). Authing
    // with the ORIGINAL token here proves the OLD hash is in the in-memory cache,
    // so the later new-token hello genuinely exercises the cache-miss → D1 re-read.
    const warm = await WsClient.open(joinCode);
    warm.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await warm.next('snapshot');
    warm.close();

    // Simulate the "resume session" flow re-minting the host token: rewrite D1.
    const newToken = 'host-token-reissued-' + crypto.randomUUID();
    const newHash = await sha256Hex(newToken);
    await env.DB.prepare('UPDATE sessions SET host_token_hash = ? WHERE join_code = ?')
      .bind(newHash, joinCode)
      .run();

    // A garbage token must STILL fail (the re-read path must not become a bypass).
    const bogus = await WsClient.open(joinCode);
    bogus.send({ t: 'hello', role: 'host', code: joinCode, hostToken: 'totally-wrong-token' });
    const bogusErr = await bogus.next('error');
    expect(bogusErr.code).toBe('bad_host_token');
    bogus.close();

    // New token mismatches the CACHED old hash → DO re-reads D1 → matches the fresh
    // hash → accepted. Verify by a control verb (openLobby) succeeding.
    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken: newToken });
    await host.next('snapshot');
    host.send({ t: 'openLobby' });
    const lobbySnap = await host.next('snapshot');
    expect(lobbySnap.phase).toBe('lobby'); // control verb succeeded → hostOk true
    host.close();
  });
});

// ---------------------------------------------------------------------------
// resume re-mints the host token end-to-end (onHello D1 re-read). This is the
// load-bearing integration test for POST /api/sessions/:code/resume: it proves
// the route rewrites sessions.host_token_hash AND that the SessionDO honours the
// new token while rejecting the old one — exercised through the REAL HTTP route
// (not a direct D1 UPDATE like the Fix 7 test above).
//
// NOTE: we deliberately do NOT warm the DO before re-minting. /api/session/create
// and /api/sessions/:code/resume are both D1-only (no DO calls), so the DO is not
// woken until the first hello below — its first cold load reads the ALREADY-new
// hash. That makes the old-token hello a genuine mismatch (cold hash = new), so
// it is rejected, while the new-token hello matches. (Warming first would cache
// the OLD hash; re-presenting the old token would then match the cache with no
// re-read and be accepted — the wrong assertion. See Fix 7 above for the
// stale-cache re-read accept path, which this test does not duplicate.)
// ---------------------------------------------------------------------------
describe('resume re-mints host token (onHello D1 re-read)', () => {
  it('rotates the token via the resume route: old token rejected, new token controls', async () => {
    const cookie = await loginCookie(); // seeded org (owner of the created session)
    const { joinCode, hostToken: oldToken } = await createApiSession(cookie);
    expect(joinCode).toMatch(/^[A-HJ-NP-Z]{3}-\d{3}$/);

    // Re-mint via the resume route (rewrites sessions.host_token_hash in D1). The
    // DO has not been woken yet, so no stale hash is cached.
    const res = await SELF.fetch(`${ORIGIN}/api/sessions/${joinCode}/resume`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN },
    });
    expect(res.status).toBe(200);
    const { hostToken: newToken } = (await res.json()) as { hostToken: string };
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(oldToken);

    // OLD token now rejected: the DO's first cold load reads the FRESH hash from
    // D1, so the old token mismatches (and re-reading D1 still sees the new hash).
    const hOld = await WsClient.open(joinCode);
    hOld.send({ t: 'hello', role: 'host', code: joinCode, hostToken: oldToken });
    const errOld = await hOld.next('error');
    expect(errOld.code).toBe('bad_host_token');
    hOld.close();

    // NEW token controls: hello succeeds, openLobby drives the authoritative phase.
    const hNew = await WsClient.open(joinCode);
    hNew.send({ t: 'hello', role: 'host', code: joinCode, hostToken: newToken });
    await hNew.next('snapshot');
    hNew.send({ t: 'openLobby' });
    const snap = await hNew.next('snapshot'); // openLobby broadcasts a fresh snapshot
    expect(snap.phase).toBe('lobby');
    hNew.close();
  });

  // The production flow the resume feature actually targets: the session DO is
  // ALREADY AWAKE with the OLD hash cached (a host was connected), the organizer
  // resumes from another tab, and the awake DO must honour the re-minted token by
  // re-reading D1 on the onHello cache miss (sessionDO #11 path). loadFromD1
  // short-circuits once loaded and never refreshes host_token_hash, so the cache
  // stays stale across the new WS open — this is the ONLY test that drives the
  // resume ROUTE + stale-cache re-read ACCEPT together end-to-end.
  it('a live DO with a stale cached hash accepts the re-minted token via D1 re-read', async () => {
    const cookie = await loginCookie();
    const { joinCode, hostToken: oldToken } = await createApiSession(cookie);

    // Warm the DO so the OLD hash is cached in the live instance.
    const warm = await WsClient.open(joinCode);
    warm.send({ t: 'hello', role: 'host', code: joinCode, hostToken: oldToken });
    await warm.next('snapshot');
    warm.close();

    // Resume via the real route → D1 host_token_hash rewritten (DO cache now stale).
    const res = await SELF.fetch(`${ORIGIN}/api/sessions/${joinCode}/resume`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: ORIGIN },
    });
    expect(res.status).toBe(200);
    const { hostToken: newToken } = (await res.json()) as { hostToken: string };
    expect(newToken).not.toBe(oldToken);

    // NEW token vs the STALE cached old hash → mismatch → DO re-reads D1 → matches
    // the fresh hash → accepted. A control verb (openLobby) proves hostOk is true.
    const hNew = await WsClient.open(joinCode);
    hNew.send({ t: 'hello', role: 'host', code: joinCode, hostToken: newToken });
    await hNew.next('snapshot');
    hNew.send({ t: 'openLobby' });
    const snap = await hNew.next('snapshot');
    expect(snap.phase).toBe('lobby');
    hNew.close();

    // The OLD token is now rejected (the re-read above refreshed the cache to new).
    const hOld = await WsClient.open(joinCode);
    hOld.send({ t: 'hello', role: 'host', code: joinCode, hostToken: oldToken });
    const errOld = await hOld.next('error');
    expect(errOld.code).toBe('bad_host_token');
    hOld.close();
  });
});

// ---------------------------------------------------------------------------
// Winner commentary — server-authoritative. The DO sets a deterministic line at
// round end (the test pool has OPENROUTER_API_KEY='' so the live AI upgrade is a
// no-op), includes it in the snapshot for ALL surfaces, and clears it on a fresh
// round. A winnerless round leaves it null (surfaces show their own no-solve copy).
// ---------------------------------------------------------------------------
describe('winner commentary in the snapshot', () => {
  async function hostToLive(joinCode: string, hostToken: string): Promise<WsClient> {
    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.next('snapshot');
    host.send({ t: 'openLobby' });
    await host.next('snapshot');
    host.send({ t: 'startCountdown' });
    await host.next('snapshot');
    await runDurableObjectAlarm(stubFor(joinCode)); // countdown → live
    await host.next('snapshot');
    return host;
  }

  it('sets a deterministic line at winner and clears it on nextRound', async () => {
    const { joinCode, hostToken, puzzleId } = await seedSession('mini-ai', 1);
    // Reach live with one player who then solves correctly.
    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.next('snapshot');
    host.send({ t: 'openLobby' });
    await host.next('snapshot');
    const player = await WsClient.open(joinCode);
    player.send({ t: 'hello', role: 'player', code: joinCode });
    await player.next('identity');
    await player.next('snapshot');
    player.send({ t: 'join', name: 'Champion Cho' });
    await player.next('snapshot');
    host.send({ t: 'startCountdown' });
    await host.next('snapshot');
    await runDurableObjectAlarm(stubFor(joinCode)); // countdown → live
    await host.next('snapshot');
    await player.next('snapshot');

    const good = await correctEntries(puzzleId);
    player.send({ t: 'submit', entries: good });
    await player.next('finished');

    host.send({ t: 'endRound' });
    const winSnap = await host.nextSnapshotWhere((s) => s.phase === 'winner');
    expect(winSnap.winner).not.toBeNull();
    expect(typeof winSnap.commentary).toBe('string');
    expect((winSnap.commentary ?? '').length).toBeGreaterThan(0);

    // A fresh round clears the line.
    host.send({ t: 'nextRound' });
    const lobbySnap = await host.nextSnapshotWhere((s) => s.phase === 'lobby');
    expect(lobbySnap.commentary).toBeNull();
    host.close();
    player.close();
  });

  it('leaves commentary null for a winnerless round', async () => {
    const { joinCode, hostToken } = await seedSession('mini-ai', 1);
    const host = await hostToLive(joinCode, hostToken); // no players joined
    host.send({ t: 'endRound' });
    const winSnap = await host.nextSnapshotWhere((s) => s.phase === 'winner');
    expect(winSnap.winner).toBeNull();
    expect(winSnap.commentary).toBeNull();
    host.close();
  });
});

// ---------------------------------------------------------------------------
// Backward-compat: pre-migration session (no aiTone in config_json) still gets
// commentary at round end. Proves the `?? DEFAULT_BRAND.aiTone` path never
// throws on undefined. OPENROUTER_API_KEY='' in tests so the line is the
// deterministic fallback (non-null).
// ---------------------------------------------------------------------------
describe('backward-compat: pre-migration session without aiTone in config', () => {
  it('produces a non-empty commentary line even when config_json has no aiTone', async () => {
    const { joinCode, hostToken, puzzleId } = await seedSession('mini-ai', 1);
    // Strip aiTone from config_json before the DO wakes, simulating a
    // pre-migration session row. seedSession does not include aiTone so this
    // is a no-op in the SQL, but included per plan for explicit documentation.
    await env.DB.prepare(
      "UPDATE sessions SET config_json = json_remove(config_json, '$.aiTone') WHERE join_code = ?",
    ).bind(joinCode).run();

    // Drive to winner with a player who solves correctly (required to get a
    // non-null commentary; modeled on "sets a deterministic line at winner").
    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.next('snapshot');
    host.send({ t: 'openLobby' });
    await host.next('snapshot');
    const player = await WsClient.open(joinCode);
    player.send({ t: 'hello', role: 'player', code: joinCode });
    await player.next('identity');
    await player.next('snapshot');
    player.send({ t: 'join', name: 'Pre-Migration Player' });
    await player.next('snapshot');
    host.send({ t: 'startCountdown' });
    await host.next('snapshot');
    await runDurableObjectAlarm(stubFor(joinCode)); // countdown -> live
    await host.next('snapshot');
    await player.next('snapshot');

    const good = await correctEntries(puzzleId);
    player.send({ t: 'submit', entries: good });
    await player.next('finished');

    host.send({ t: 'endRound' });
    const winSnap = await host.nextSnapshotWhere((s) => s.phase === 'winner');
    expect(winSnap.winner).not.toBeNull();
    expect(typeof winSnap.commentary).toBe('string');
    expect((winSnap.commentary ?? '').length).toBeGreaterThan(0);
    host.close();
    player.close();
  });
});

// ===========================================================================
// DO terminate lifecycle (multi-booth replace, design §I).
// ===========================================================================
describe('SessionDO terminate (replace)', () => {
  type TermInternals = {
    alarm(): Promise<void>;
    s: { terminated: boolean; phase: string; round: number; alarmIntent: unknown };
  };

  it('terminate marks ended, idles, deletes the alarm, and broadcasts standby', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.next('snapshot');
    host.send({ t: 'openLobby' });
    await host.nextSnapshotWhere((s) => s.phase === 'lobby');
    host.send({ t: 'startCountdown' }); // schedules an alarm
    await host.nextSnapshotWhere((s) => s.phase === 'countdown');

    // Terminate via the server-to-DO fetch (what create-with-replace calls).
    const res = await stubFor(joinCode).fetch('https://do/terminate', {
      headers: { 'x-terminate': env.JWT_SECRET, 'x-join-code': joinCode },
    });
    expect(res.status).toBe(200);

    // The booth/host socket receives an idle snapshot (recycle to standby).
    const idle = await host.nextSnapshotWhere((s) => s.phase === 'idle');
    expect(idle.phase).toBe('idle');

    // D1 row is the terminal marker; the alarm is gone; the flag is set.
    const row = await env.DB.prepare('SELECT status, ended_at FROM sessions WHERE join_code = ?')
      .bind(joinCode).first<{ status: string; ended_at: number | null }>();
    expect(row?.status).toBe('ended');
    expect(row?.ended_at).not.toBeNull();
    await runInDurableObject(stubFor(joinCode), async (_inst, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
      const s = (_inst as unknown as TermInternals).s;
      expect(s.terminated).toBe(true);
      expect(s.phase).toBe('idle');
    });
    host.close();
  });

  it('after terminate, host verbs are rejected and a stale alarm is a no-op', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.next('snapshot');

    await stubFor(joinCode).fetch('https://do/terminate', {
      headers: { 'x-terminate': env.JWT_SECRET, 'x-join-code': joinCode },
    });
    await host.nextSnapshotWhere((s) => s.phase === 'idle');

    // A host verb now returns a 'terminated' error rather than acting.
    host.send({ t: 'openLobby' });
    const err = await host.next('error');
    expect(err.code).toBe('terminated');

    // Even if an alarm intent were set and alarm() fired, it must not resurrect.
    await runInDurableObject(stubFor(joinCode), async (inst) => {
      const di = inst as unknown as TermInternals;
      di.s.alarmIntent = { kind: 'roundEnd', round: di.s.round, dueAt: 0 };
      di.s.phase = 'live'; // pretend a stale live alarm is about to fire
      await di.alarm(); // guarded by `terminated` → no-op
      expect(di.s.phase).toBe('live'); // alarm() returned before any transition
    });
    const row = await env.DB.prepare('SELECT status FROM sessions WHERE join_code = ?')
      .bind(joinCode).first<{ status: string }>();
    expect(row?.status).toBe('ended'); // never flipped back out of 'ended'
    host.close();
  });

  it('a cold DO derives terminated from D1 status=ended (survives restart / lost storage)', async () => {
    const { joinCode, hostToken } = await seedSession();
    // Mark ended directly in D1 WITHOUT going through terminate(), so the DO's
    // hibernated storage never recorded the flag. Evict any live instance so the
    // next access is a genuine cold load.
    await env.DB.prepare("UPDATE sessions SET status = 'ended' WHERE join_code = ?").bind(joinCode).run();
    await abortAllDurableObjects();

    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.next('snapshot');
    host.send({ t: 'openLobby' });
    const err = await host.next('error');
    expect(err.code).toBe('terminated'); // cold load saw status=ended → terminated

    const row = await env.DB.prepare('SELECT status FROM sessions WHERE join_code = ?')
      .bind(joinCode).first<{ status: string }>();
    expect(row?.status).toBe('ended'); // never resurrected
    host.close();
  });

  it('a forged x-terminate via the public /ws proxy is stripped (cannot end a session)', async () => {
    const { joinCode } = await seedSession();
    // A non-browser client who knows the join code tries to terminate by smuggling
    // x-terminate through the WS upgrade. The proxy strips it → normal WS upgrade.
    const res = await SELF.fetch(`${ORIGIN}/ws/${joinCode}`, {
      headers: { Upgrade: 'websocket', 'x-terminate': '1' },
    });
    expect(res.webSocket).toBeTruthy(); // treated as a WS upgrade, NOT a terminate
    res.webSocket?.accept();
    res.webSocket?.close();
    const row = await env.DB.prepare('SELECT status FROM sessions WHERE join_code = ?')
      .bind(joinCode).first<{ status: string }>();
    expect(row?.status).not.toBe('ended'); // session was NOT ended
  });

  it('a direct terminate with a wrong/absent credential is rejected (403)', async () => {
    const { joinCode } = await seedSession();
    const bad = await stubFor(joinCode).fetch('https://do/terminate', {
      headers: { 'x-terminate': 'wrong-secret', 'x-join-code': joinCode },
    });
    expect(bad.status).toBe(403);
    const row = await env.DB.prepare('SELECT status FROM sessions WHERE join_code = ?')
      .bind(joinCode).first<{ status: string }>();
    expect(row?.status).not.toBe('ended');
  });
});

// ===========================================================================
// Booth orphan self-heal: terminal End Session, the openLobby one-active guard,
// and the empty-and-idle lobby recycle alarm. (Design:
// docs/superpowers/specs/2026-05-31-booth-orphan-self-heal-design.md)
// ===========================================================================
describe('booth orphan self-heal', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const MIN = 60 * 1000;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type PersistedState = any;
  async function readState(joinCode: string): Promise<PersistedState> {
    return runInDurableObject(stubFor(joinCode), async (_i, state) =>
      (await state.storage.get('state')) as PersistedState,
    );
  }
  // Poll persisted state until `pred` holds (webSocketClose side effects are async).
  async function waitForState(
    joinCode: string,
    pred: (s: PersistedState) => boolean,
    tries = 80,
  ): Promise<PersistedState> {
    for (let i = 0; i < tries; i++) {
      const st = await readState(joinCode);
      if (st && pred(st)) return st;
      await new Promise((r) => setTimeout(r, 20));
    }
    return readState(joinCode);
  }

  async function hostOpenLobby(joinCode: string, hostToken: string): Promise<WsClient> {
    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.next('snapshot');
    host.send({ t: 'openLobby' });
    await host.nextSnapshotWhere((s) => s.phase === 'lobby');
    return host;
  }

  it('endSession is terminal: status ended, later host verbs rejected, booth shows nothing', async () => {
    const { joinCode, hostToken, ownerId } = await seedSession();
    const host = await hostOpenLobby(joinCode, hostToken);
    host.send({ t: 'endSession' });
    const idle = await host.nextSnapshotWhere((s) => s.phase === 'idle');
    expect(idle.phase).toBe('idle');
    const row = await env.DB.prepare('SELECT status FROM sessions WHERE join_code = ?')
      .bind(joinCode).first<{ status: string }>();
    expect(row?.status).toBe('ended');
    host.send({ t: 'openLobby' }); // terminated → rejected
    expect((await host.next('error')).code).toBe('terminated');
    const code = await mostRecentDisplaySession(env.DB, ownerId, Date.now() - DAY, Date.now() - MIN);
    expect(code).toBeNull();
    host.close();
  });

  it('endSession clears the roster so joined players are not left on "waiting"', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await hostOpenLobby(joinCode, hostToken);
    const player = await WsClient.open(joinCode);
    player.send({ t: 'hello', role: 'player', code: joinCode });
    await player.next('identity');
    await player.next('snapshot');
    player.send({ t: 'join', name: 'Ada' });
    await host.nextSnapshotWhere((s) => s.players.length === 1);
    host.send({ t: 'endSession' });
    // The player's idle snapshot must list NO players, so PlayerApp drops them to
    // "No active session" instead of the joined "waiting for organizer" screen.
    const snap = await player.nextSnapshotWhere((s) => s.phase === 'idle');
    expect(snap.players.length).toBe(0);
    host.close();
    player.close();
  });

  it('endSession by one host terminates for ALL host sockets', async () => {
    const { joinCode, hostToken } = await seedSession();
    const h1 = await hostOpenLobby(joinCode, hostToken);
    const h2 = await WsClient.open(joinCode);
    h2.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await h2.next('snapshot');
    h1.send({ t: 'endSession' });
    await h2.nextSnapshotWhere((s) => s.phase === 'idle');
    h2.send({ t: 'openLobby' });
    expect((await h2.next('error')).code).toBe('terminated');
    h2.send({ t: 'startCountdown' });
    expect((await h2.next('error')).code).toBe('terminated');
    h2.send({ t: 'reset' });
    expect((await h2.next('error')).code).toBe('terminated');
    h1.close();
    h2.close();
  });

  it('openLobby REFUSES to resurrect a 2nd active lobby for an owner (no booth bounce)', async () => {
    const owner = 'org_coexist_' + Date.now();
    // X: the owner's real, active lobby.
    const x = await seedSession('mini-ai', 120, 8, owner);
    const hx = await hostOpenLobby(x.joinCode, x.hostToken);
    // Y: a SECOND owned session, idle — a stale host reconnects and auto-opens it.
    const y = await seedSession('mini-ai', 120, 8, owner);
    const hy = await WsClient.open(y.joinCode);
    hy.send({ t: 'hello', role: 'host', code: y.joinCode, hostToken: y.hostToken });
    await hy.next('snapshot');
    hy.send({ t: 'openLobby' }); // refused: X already active for this owner
    expect((await hy.next('error')).code).toBe('superseded'); // host is told → it bails to Home
    // Barrier: toggleLeaderboard always broadcasts; Y must still be idle.
    const snap = await hy.syncBarrier(hy);
    expect(snap.phase).toBe('idle');
    const yrow = await env.DB.prepare('SELECT status FROM sessions WHERE join_code = ?')
      .bind(y.joinCode).first<{ status: string }>();
    expect(yrow?.status).toBe('idle'); // never flipped to lobby
    // The booth still shows X (the real session), not the resurrected Y.
    const code = await mostRecentDisplaySession(env.DB, owner, Date.now() - DAY, Date.now() - MIN);
    expect(code).toBe(x.joinCode);
    hx.close();
    hy.close();
  });

  it('openLobby DOES open when the owner has no other active session', async () => {
    const { joinCode, hostToken } = await seedSession(); // unique owner
    const host = await WsClient.open(joinCode);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.next('snapshot');
    host.send({ t: 'openLobby' });
    expect((await host.next('snapshot')).phase).toBe('lobby');
    host.close();
  });

  it('two idle same-owner sessions opening concurrently: at most one becomes active', async () => {
    // The guard is an ATOMIC conditional UPDATE, so even a concurrent open of two
    // idle same-owner sessions (separate DOs) can't produce two active lobbies —
    // D1 serializes the updates and the loser sees the winner's 'lobby'.
    const owner = 'org_race_' + Date.now();
    const a = await seedSession('mini-ai', 120, 8, owner);
    const b = await seedSession('mini-ai', 120, 8, owner);
    const ha = await WsClient.open(a.joinCode);
    const hb = await WsClient.open(b.joinCode);
    ha.send({ t: 'hello', role: 'host', code: a.joinCode, hostToken: a.hostToken });
    hb.send({ t: 'hello', role: 'host', code: b.joinCode, hostToken: b.hostToken });
    await ha.next('snapshot');
    await hb.next('snapshot');
    ha.send({ t: 'openLobby' }); // fired together
    hb.send({ t: 'openLobby' });
    await new Promise((r) => setTimeout(r, 300));
    const rows = await env.DB.prepare(
      "SELECT status FROM sessions WHERE owner_id = ? AND status IN ('new','lobby','countdown','live','winner')",
    ).bind(owner).all<{ status: string }>();
    expect(rows.results.length).toBeLessThanOrEqual(1); // never two active
    ha.close();
    hb.close();
  });

  it('a tv attaching to an empty lobby with no pending recycle schedules one', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await hostOpenLobby(joinCode, hostToken);
    host.close();
    await waitForState(joinCode, (s) => s.alarmIntent?.kind === 'lobbyRecycle');
    // Simulate an orphan that never got a recycle scheduled (e.g. an ungraceful
    // drop where webSocketClose didn't run): clear the alarm.
    await runInDurableObject(stubFor(joinCode), async (instance, state) => {
      const s = (await state.storage.get('state')) as PersistedState;
      s.alarmIntent = null;
      await state.storage.put('state', s);
      (instance as unknown as { s: PersistedState }).s.alarmIntent = null;
      await state.storage.deleteAlarm();
    });
    // A booth/tv attaching must (re)schedule the recycle so it still self-heals.
    const tv = await WsClient.open(joinCode);
    tv.send({ t: 'hello', role: 'tv', code: joinCode });
    await tv.next('snapshot');
    const st = await waitForState(joinCode, (s) => s.alarmIntent?.kind === 'lobbyRecycle');
    expect(st.alarmIntent?.kind).toBe('lobbyRecycle');
    tv.close();
  });

  it('Clear Players (reset → openLobby) still reopens an empty lobby (sole session passes the guard)', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await hostOpenLobby(joinCode, hostToken);
    const player = await WsClient.open(joinCode);
    player.send({ t: 'hello', role: 'player', code: joinCode });
    await player.next('identity');
    await player.next('snapshot');
    player.send({ t: 'join', name: 'Ada' });
    await host.nextSnapshotWhere((s) => s.players.length === 1);
    // Clear Players = reset (→ idle), then the host auto-reopens the lobby. The
    // owner's sole session must pass the new one-active guard.
    host.send({ t: 'reset' });
    await host.nextSnapshotWhere((s) => s.phase === 'idle');
    host.send({ t: 'openLobby' });
    const reopened = await host.nextSnapshotWhere((s) => s.phase === 'lobby');
    expect(reopened.phase).toBe('lobby');
    expect(reopened.players.length).toBe(0); // roster cleared
    host.close();
    player.close();
  });

  it('an empty, idle lobby recycles to standby after the idle window (early fire is a no-op)', async () => {
    const { joinCode, hostToken, ownerId } = await seedSession();
    const host = await hostOpenLobby(joinCode, hostToken);
    host.close(); // abandon — no players left
    const scheduled = await waitForState(joinCode, (s) => s.alarmIntent?.kind === 'lobbyRecycle');
    expect(scheduled.alarmIntent?.kind).toBe('lobbyRecycle');
    // Firing BEFORE dueAt (the alarm is ~45min out) must be a no-op.
    await runDurableObjectAlarm(stubFor(joinCode));
    expect((await readState(joinCode)).phase).toBe('lobby');
    // Advance past the window and fire → recycle to idle (booth → standby).
    const phase = await runInDurableObject(stubFor(joinCode), async (instance, state) => {
      const s = (await state.storage.get('state')) as PersistedState;
      s.alarmIntent.dueAt = Date.now() - 5000;
      await state.storage.put('state', s);
      (instance as unknown as { s: PersistedState }).s.alarmIntent = { ...s.alarmIntent };
      await (instance as unknown as DOInternals).alarm();
      return ((await state.storage.get('state')) as PersistedState).phase;
    });
    expect(phase).toBe('idle');
    const row = await env.DB.prepare('SELECT status FROM sessions WHERE join_code = ?')
      .bind(joinCode).first<{ status: string }>();
    expect(row?.status).toBe('idle');
    expect(await mostRecentDisplaySession(env.DB, ownerId, Date.now() - DAY, Date.now() - MIN)).toBeNull();
  });

  it('a lobby with a player present is NOT recycled when the host drops', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await hostOpenLobby(joinCode, hostToken);
    const player = await WsClient.open(joinCode);
    player.send({ t: 'hello', role: 'player', code: joinCode });
    await player.next('identity');
    await player.next('snapshot');
    player.send({ t: 'join', name: 'Ada' });
    await player.next('snapshot');
    host.close(); // host gone, player still present → must NOT schedule
    await new Promise((r) => setTimeout(r, 250));
    expect((await readState(joinCode)).alarmIntent).toBeNull();
    // Player leaves too → fully empty → now it schedules.
    player.close();
    const scheduled = await waitForState(joinCode, (s) => s.alarmIntent?.kind === 'lobbyRecycle');
    expect(scheduled.alarmIntent?.kind).toBe('lobbyRecycle');
  });

  it('a returning host cancels a pending recycle; a bad-token host does not', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await hostOpenLobby(joinCode, hostToken);
    host.close();
    await waitForState(joinCode, (s) => s.alarmIntent?.kind === 'lobbyRecycle');
    // A bad-token host hello must NOT cancel (it isn't a valid presence).
    const badHost = await WsClient.open(joinCode);
    badHost.send({ t: 'hello', role: 'host', code: joinCode, hostToken: 'wrong-token' });
    await badHost.next('error');
    await badHost.next('snapshot');
    expect((await readState(joinCode)).alarmIntent?.kind).toBe('lobbyRecycle'); // still pending
    badHost.close();
    // A valid host returning DOES cancel.
    const host2 = await WsClient.open(joinCode);
    host2.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host2.next('snapshot');
    const cleared = await waitForState(joinCode, (s) => s.alarmIntent == null);
    expect(cleared.alarmIntent).toBeNull();
    host2.close();
  });

  it('recycle is a no-op if a host is present when the alarm fires', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await hostOpenLobby(joinCode, hostToken); // stays connected
    const phase = await runInDurableObject(stubFor(joinCode), async (instance, state) => {
      const s = (await state.storage.get('state')) as PersistedState;
      s.alarmIntent = { kind: 'lobbyRecycle', round: s.round, dueAt: Date.now() - 5000 };
      await state.storage.put('state', s);
      (instance as unknown as { s: PersistedState }).s.alarmIntent = { ...s.alarmIntent };
      await (instance as unknown as DOInternals).alarm();
      return ((await state.storage.get('state')) as PersistedState).phase;
    });
    expect(phase).toBe('lobby'); // host present → not recycled
    host.close();
  });

  it('abandoning during live does not schedule a lobbyRecycle (round-end alarm governs)', async () => {
    const { joinCode, hostToken } = await seedSession();
    const host = await hostOpenLobby(joinCode, hostToken);
    const player = await WsClient.open(joinCode);
    player.send({ t: 'hello', role: 'player', code: joinCode });
    await player.next('identity');
    await player.next('snapshot');
    player.send({ t: 'join', name: 'Ada' });
    await player.next('snapshot');
    host.send({ t: 'startCountdown' });
    await host.next('snapshot');
    await runDurableObjectAlarm(stubFor(joinCode)); // countdown → live (roundEnd intent)
    await host.next('snapshot');
    host.close(); // abandon during live
    await new Promise((r) => setTimeout(r, 250));
    expect((await readState(joinCode)).alarmIntent?.kind).toBe('roundEnd'); // NOT lobbyRecycle
    player.close();
  });
});
