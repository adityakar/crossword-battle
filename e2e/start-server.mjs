// start-server.mjs — clean-room `wrangler dev` launcher for the Playwright suite.
//
// Invoked by playwright.config.ts's `webServer.command`. It brings up a fully
// reproducible local worker so the E2E run is deterministic:
//   1. Build the web SPA  → apps/web/dist (wrangler serves it as [assets]).
//   2. Wipe apps/worker/.wrangler/state → a pristine LOCAL D1 (no stale rows,
//      no stale DO storage, so presets re-seed from the deterministic engine and
//      the seed organizer is minted on first login).
//   3. Apply D1 migrations --local (non-interactive; --local never prompts).
//   4. exec `wrangler dev --port 8787`, which loads wrangler.toml + .dev.vars
//      from apps/worker (its cwd). Playwright polls /api/health until it's up.
//
// All worker steps run with cwd = apps/worker so wrangler picks up the config dir
// (wrangler.toml + .dev.vars). The final `wrangler dev` REPLACES this process
// (no extra child to forward signals to) so Playwright's teardown kills it
// cleanly.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const WORKER_DIR = resolve(ROOT, 'apps/worker');
const STATE_DIR = resolve(WORKER_DIR, '.wrangler/state');
const PORT = process.env.E2E_PORT || '8787';

function run(label, cmd, args, opts = {}) {
  console.log(`\n[start-server] ${label}: ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.status !== 0) {
    console.error(`[start-server] ${label} FAILED (exit ${res.status})`);
    process.exit(res.status ?? 1);
  }
}

// 1. Build the web SPA into apps/web/dist.
run('build web', 'pnpm', ['--filter', '@cwb/web', 'build'], { cwd: ROOT });

// 2. Wipe the local wrangler state (D1 + DO storage) for a pristine database.
console.log(`\n[start-server] wiping local state: ${STATE_DIR}`);
rmSync(STATE_DIR, { recursive: true, force: true });

// 3. Apply migrations into the freshly-wiped local D1. --local is non-interactive.
run('migrate D1 (local)', 'pnpm', ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'crossword-battle', '--local'], {
  cwd: WORKER_DIR,
});

// 4. Start wrangler dev (replaces this process). Loads .dev.vars from WORKER_DIR.
console.log(`\n[start-server] starting wrangler dev on port ${PORT}\n`);
const child = spawnSync('pnpm', ['exec', 'wrangler', 'dev', '--port', PORT], {
  cwd: WORKER_DIR,
  stdio: 'inherit',
});
process.exit(child.status ?? 0);
