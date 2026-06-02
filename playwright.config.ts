// playwright.config.ts — mobile-viewport E2E for Crossword Battle.
//
// Drives a real multi-surface multiplayer round against a clean `wrangler dev`.
// One chromium project; each surface gets its own browser CONTEXT inside the
// test (mobile for organizer/players, 16:9 desktop for the booth display) so
// cookies/localStorage are isolated per surface — see e2e/full-round.spec.ts.
//
// The webServer wipes local D1, re-seeds presets deterministically, and starts
// the worker (which serves the built SPA from apps/web/dist). See
// e2e/start-server.mjs.
import { defineConfig } from '@playwright/test';

const PORT = 8787;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // One worker: a single wrangler dev / single local D1. Serialize to avoid
  // cross-session races; the spec is also marked describe.serial.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // The full round (build + countdown + solve + reconnect) needs headroom.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  // Already-gitignored artifacts dir.
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node e2e/start-server.mjs',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
