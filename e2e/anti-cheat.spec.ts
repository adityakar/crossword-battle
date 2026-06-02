// anti-cheat.spec.ts — proves a forged/incorrect finish is rejected server-side.
//
// This runs at the PROTOCOL level (Node fetch + global WebSocket, like
// apps/worker/scripts/protocol-e2e.mjs) rather than the UI, because the UI never
// lets a player submit a deliberately-wrong COMPLETE grid (it has no answers and
// auto-submits the real entries). Driving the socket directly lets us forge a
// full-but-wrong grid and assert the server (sessionDO submit) refuses to mark it
// finished — correctness is decided only on the server.
import { test, expect } from '@playwright/test';
import { reconstructSolution } from './solution.mjs';

const BASE_URL = 'http://127.0.0.1:8787';
const SEED_EMAIL = process.env.SEED_EMAIL || 'admin@crosswordbattle.local';
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'L10CzHmFjZNcNCYDW1Hs';
const PUZZLE_ID = 'mini-ai';

function wsBase() {
  return BASE_URL.replace(/^http/, 'ws');
}

// Minimal frame-collecting socket helper (ported from protocol-e2e.mjs).
function openSocket(url: string): Promise<{
  send: (obj: unknown) => void;
  frames: any[];
  waitFor: (pred: (f: any) => boolean, opts?: { timeout?: number }) => Promise<any>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames: any[] = [];
    const waiters: { pred: (f: any) => boolean; resolve: (f: any) => void; timer: any }[] = [];
    const tryResolve = () => {
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i]!;
        const match = frames.find(w.pred);
        if (match) {
          clearTimeout(w.timer);
          waiters.splice(i, 1);
          w.resolve(match);
        }
      }
    };
    ws.addEventListener('message', (ev: MessageEvent) => {
      let msg: any;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      } catch {
        return;
      }
      frames.push(msg);
      tryResolve();
    });
    ws.addEventListener('open', () => {
      resolve({
        send: (obj) => ws.send(JSON.stringify(obj)),
        frames,
        waitFor: (pred, { timeout = 15000 } = {}) =>
          new Promise((res, rej) => {
            const existing = frames.find(pred);
            if (existing) return res(existing);
            const timer = setTimeout(() => {
              const idx = waiters.indexOf(entry);
              if (idx >= 0) waiters.splice(idx, 1);
              rej(new Error('timeout waiting for frame'));
            }, timeout);
            const entry = { pred, resolve: res, timer };
            waiters.push(entry);
          }),
        close: () => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        },
      });
    });
    ws.addEventListener('error', (e) => reject(e instanceof Error ? e : new Error('ws error')));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.describe.serial('Crossword Battle — server-authoritative anti-cheat', () => {
  test('a complete-but-wrong grid does NOT finish and yields no winner', async () => {
    const { wrongGrid } = reconstructSolution(PUZZLE_ID);

    // --- login (capture cookie) ---
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
      body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
    });
    expect(loginRes.ok).toBeTruthy();
    const cookie = (loginRes.headers.get('set-cookie') || '').split(';')[0];
    expect(cookie).toBeTruthy();

    // --- create a fresh session/round ---
    const createRes = await fetch(`${BASE_URL}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL, Cookie: cookie },
      body: JSON.stringify({ puzzleId: PUZZLE_ID }),
    });
    expect(createRes.ok).toBeTruthy();
    const { joinCode, hostToken } = (await createRes.json()) as {
      joinCode: string;
      hostToken: string;
    };
    expect(joinCode).toBeTruthy();

    // --- host: hello + openLobby ---
    const host = await openSocket(`${wsBase()}/ws/${joinCode}`);
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    await host.waitFor((f) => f.t === 'snapshot');
    host.send({ t: 'openLobby' });
    await host.waitFor((f) => f.t === 'snapshot' && f.phase === 'lobby');

    // --- player: hello + join ---
    const player = await openSocket(`${wsBase()}/ws/${joinCode}`);
    player.send({ t: 'hello', role: 'player', code: joinCode });
    await player.waitFor((f) => f.t === 'identity');
    player.send({ t: 'join', name: 'Forger' });
    await player.waitFor((f) => f.t === 'snapshot' && f.players.some((p: any) => p.name === 'Forger'));

    // --- start the round, wait for live ---
    host.send({ t: 'startCountdown' });
    await player.waitFor((f) => f.t === 'snapshot' && f.phase === 'live', { timeout: 20000 });

    // --- submit a COMPLETE but WRONG grid ---
    player.send({ t: 'submit', entries: wrongGrid });

    // The server must reply `wrong` (not `finished`): every cell present, none
    // correct. Assert a `wrong` frame arrives.
    const wrong = await player.waitFor((f) => f.t === 'wrong', { timeout: 10000 });
    expect(wrong.wrongAttempts).toBeGreaterThanOrEqual(1);

    // And assert NO `finished` frame is ever produced by the forged grid.
    await sleep(1500);
    expect(player.frames.find((f) => f.t === 'finished')).toBeUndefined();

    // --- end the round → no winner (no legitimate finisher) ---
    host.send({ t: 'endRound' });
    const winnerSnap = await player.waitFor(
      (f) => f.t === 'snapshot' && f.phase === 'winner',
      { timeout: 15000 },
    );
    expect(winnerSnap.winner).toBeFalsy();

    host.close();
    player.close();
  });
});
