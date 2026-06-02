// protocol-e2e.mjs — headless end-to-end driver for the live session loop.
//
// Run against a running `wrangler dev` (the controller starts it):
//   BASE_URL=http://127.0.0.1:8787 node apps/worker/scripts/protocol-e2e.mjs
//
// Proves: login → createSession → host opens lobby → player joins → countdown →
// live → wrong submit → correct submit (finished) → endRound → winner.
//
// SOLUTION SOURCE (no hardcoded answers): we import the worker's deterministic
// engine (`generatePuzzle`) and the `mini-ai` preset definition, then regenerate
// the puzzle with the SAME words+seed+id the seeder uses. The DO loads exactly
// that grid from D1, so our reconstructed grid is the authoritative solution.
//
// Node 24 strips TypeScript types by default. We import the engine SOURCE by
// RELATIVE PATH (../../../packages/engine/src/engine.ts) rather than the
// `@cwb/engine` package specifier, because the package's index.ts re-exports
// `./engine` extensionless, which native ESM cannot resolve. engine.ts's only
// relative import is `import type { … } from './types'` which fully erases, so
// after stripping it has zero runtime relative imports.
import { generatePuzzle } from '../../../packages/engine/src/engine.ts';
import { PRESET_DEFS } from '../src/presets.ts';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8787';
const SEED_EMAIL = process.env.SEED_EMAIL || 'admin@crosswordbattle.local';
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'L10CzHmFjZNcNCYDW1Hs';
const PUZZLE_ID = 'mini-ai';

let failed = false;
function pass(step, extra = '') {
  console.log(`PASS ${step}${extra ? ' — ' + extra : ''}`);
}
function fail(step, extra = '') {
  failed = true;
  console.log(`FAIL ${step}${extra ? ' — ' + extra : ''}`);
}
function die(step, extra = '') {
  fail(step, extra);
  console.log('RESULT FAIL');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- WebSocket helper: collects frames, lets us await a predicate ----------
function openSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames = [];
    const waiters = [];
    const tryResolveWaiters = () => {
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i];
        const match = frames.slice(w.from).find(w.pred);
        if (match) {
          clearTimeout(w.timer);
          waiters.splice(i, 1);
          w.resolve(match);
        }
      }
    };
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
      } catch {
        return;
      }
      frames.push(msg);
      tryResolveWaiters();
    });
    ws.addEventListener('open', () => {
      resolve({
        ws,
        send: (obj) => ws.send(JSON.stringify(obj)),
        frames,
        // Wait for the next frame (from now on) matching pred, or any already buffered.
        waitFor: (pred, { timeout = 15000, fromStart = false } = {}) =>
          new Promise((res, rej) => {
            const from = fromStart ? 0 : 0; // we always scan all buffered frames
            const existing = frames.slice(from).find(pred);
            if (existing) return res(existing);
            const timer = setTimeout(() => {
              const idx = waiters.indexOf(entry);
              if (idx >= 0) waiters.splice(idx, 1);
              rej(new Error('timeout waiting for frame'));
            }, timeout);
            const entry = { pred, resolve: res, timer, from };
            waiters.push(entry);
          }),
        latestSnapshot: () => [...frames].reverse().find((f) => f.t === 'snapshot') || null,
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

function wsBase() {
  return BASE_URL.replace(/^http/, 'ws');
}

async function main() {
  // === Step 1: login, capture cookie ======================================
  let cookie = '';
  {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
      body: JSON.stringify({ email: SEED_EMAIL, password: SEED_PASSWORD }),
    });
    if (!res.ok) die('login', `status ${res.status}`);
    const setCookie = res.headers.get('set-cookie');
    if (!setCookie) die('login', 'no Set-Cookie returned');
    // Keep just the name=value pair for the request Cookie header.
    cookie = setCookie.split(';')[0];
    pass('login', `cookie acquired`);
  }

  // === Step 2: create session =============================================
  let joinCode = '';
  let hostToken = '';
  {
    const res = await fetch(`${BASE_URL}/api/session/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: BASE_URL, // satisfies requireSameOrigin (host(Origin)===host(reqUrl))
        Cookie: cookie,
      },
      body: JSON.stringify({ puzzleId: PUZZLE_ID }),
    });
    if (!res.ok) die('createSession', `status ${res.status} ${await res.text()}`);
    const body = await res.json();
    joinCode = body.joinCode;
    hostToken = body.hostToken;
    if (!joinCode || !hostToken) die('createSession', 'missing joinCode/hostToken');
    pass('createSession', `joinCode=${joinCode}`);
  }

  // === Step 3: reconstruct the solution ===================================
  let solution = {}; // { "r,c": letter }
  let wrongGrid = {}; // complete-but-wrong full grid
  {
    const def = PRESET_DEFS.find((d) => d.id === PUZZLE_ID);
    if (!def) die('solution', `preset ${PUZZLE_ID} not found`);
    const gen = generatePuzzle(
      def.words.map(([answer, clue]) => ({ answer, clue })),
      { name: def.name, tag: def.tag, topic: def.topic, seed: def.seed, id: def.id },
    );
    if (!gen) die('solution', 'generatePuzzle returned null');
    const p = gen.puzzle;
    for (const [r, c] of p.fill) {
      const letter = p.grid[r][c];
      solution[`${r},${c}`] = letter;
      // a deliberately-wrong but COMPLETE entry so the server returns `wrong`,
      // not `incomplete` (every fill cell present, every letter differs).
      wrongGrid[`${r},${c}`] = letter === 'A' ? 'B' : 'A';
    }
    if (Object.keys(solution).length === 0) die('solution', 'empty solution map');
    pass('solution', `${Object.keys(solution).length} cells reconstructed`);
  }

  // === Step 4: host socket → hello + openLobby ============================
  const host = await openSocket(`${wsBase()}/ws/${joinCode}`);
  {
    host.send({ t: 'hello', role: 'host', code: joinCode, hostToken });
    // A snapshot confirms attach; an error frame would mean a bad token.
    const snap = await host.waitFor((f) => f.t === 'snapshot').catch(() => null);
    if (!snap) die('host hello', 'no snapshot after hello');
    const errFrame = host.frames.find((f) => f.t === 'error');
    if (errFrame) die('host hello', `error: ${errFrame.code}`);
    host.send({ t: 'openLobby' });
    await host.waitFor((f) => f.t === 'snapshot' && f.phase === 'lobby');
    pass('host openLobby', 'phase=lobby');
  }

  // === Step 5: player socket → hello + join ===============================
  const player = await openSocket(`${wsBase()}/ws/${joinCode}`);
  let playerName = 'E2E Bot';
  {
    player.send({ t: 'hello', role: 'player', code: joinCode });
    const identity = await player.waitFor((f) => f.t === 'identity').catch(() => null);
    if (!identity) die('player hello', 'no identity frame');
    player.send({ t: 'join', name: playerName });
    const snap = await player.waitFor(
      (f) => f.t === 'snapshot' && f.players.some((p) => p.name === playerName),
    );
    if (snap.players.length !== 1) {
      fail('player join', `expected 1 player, got ${snap.players.length}`);
    } else {
      pass('player join', `1 joined player (${playerName})`);
    }
  }

  // === Step 6: startCountdown → wait for live ============================
  {
    host.send({ t: 'startCountdown' });
    // The 3s countdown alarm flips phase → live.
    const live = await player
      .waitFor((f) => f.t === 'snapshot' && f.phase === 'live', { timeout: 20000 })
      .catch(() => null);
    if (!live) die('startCountdown', 'never reached phase=live');
    pass('startCountdown', 'phase=live');
  }

  // === Step 7: wrong submit, then correct submit ========================
  {
    player.send({ t: 'submit', entries: wrongGrid });
    const wrong = await player.waitFor((f) => f.t === 'wrong').catch(() => null);
    if (!wrong) die('wrong submit', 'expected a `wrong` frame');
    pass('wrong submit', `wrongAttempts=${wrong.wrongAttempts}`);

    player.send({ t: 'submit', entries: solution });
    const finished = await player.waitFor((f) => f.t === 'finished').catch(() => null);
    if (!finished) die('correct submit', 'expected a `finished` frame');
    if (!(finished.finishMs > 0)) {
      die('correct submit', `finishMs not positive: ${finished.finishMs}`);
    }
    pass('correct submit', `finished finishMs=${finished.finishMs}`);
  }

  // === Step 8: endRound → winner is the player ==========================
  {
    host.send({ t: 'endRound' });
    const winnerSnap = await player
      .waitFor((f) => f.t === 'snapshot' && f.phase === 'winner', { timeout: 15000 })
      .catch(() => null);
    if (!winnerSnap) die('endRound', 'never reached phase=winner');
    if (!winnerSnap.winner || winnerSnap.winner.name !== playerName) {
      die('endRound', `winner mismatch: ${JSON.stringify(winnerSnap.winner)}`);
    }
    pass('endRound', `winner=${winnerSnap.winner.name}`);
  }

  host.close();
  player.close();

  await sleep(100);
  if (failed) {
    console.log('RESULT FAIL');
    process.exit(1);
  }
  console.log('RESULT PASS — full live loop verified');
  process.exit(0);
}

main().catch((err) => {
  console.log(`FAIL unexpected — ${err && err.stack ? err.stack : err}`);
  console.log('RESULT FAIL');
  process.exit(1);
});
