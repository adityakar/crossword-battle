// reconnect.spec.ts — reload-as-reconnect grid persistence (BONUS, step 9).
//
// A player who refreshes mid-round keeps their identity (playerId/rejoinSecret in
// localStorage → auto-rejoin) AND their typed grid (entries persisted under a
// (joinCode, round) key, written on a ~250ms trailing debounce — see useSolve.ts).
// We type two letters, wait out the debounce, reload, and assert the letters are
// restored and the player is still in the live round (not bounced to Join).
import { test, expect, devices, type Page } from '@playwright/test';
import { reconstructSolution } from './solution.mjs';

const BASE_URL = 'http://127.0.0.1:8787';
const SEED_EMAIL = process.env.SEED_EMAIL || 'admin@crosswordbattle.local';
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'L10CzHmFjZNcNCYDW1Hs';
const PUZZLE_ID = 'mini-ai';
const PUZZLE_NAME = 'Sprint Mini';
const MOBILE = { ...devices['Pixel 5'] };

test.describe.serial('Crossword Battle — reload-as-reconnect persistence', () => {
  test('a refreshed player keeps their typed grid and stays in the round', async ({ browser }) => {
    const sol = reconstructSolution(PUZZLE_ID);

    // --- organizer: login → create → lobby (own context) ---
    const orgCtx = await browser.newContext({ ...MOBILE, baseURL: BASE_URL });
    const org = await orgCtx.newPage();
    await org.goto(`${BASE_URL}/host`);
    await org.getByLabel('Email').fill(SEED_EMAIL);
    await org.getByLabel('Password').fill(SEED_PASSWORD);
    await org.getByRole('button', { name: 'Sign in' }).click();
    await org.getByRole('button', { name: /Create New Session/ }).click();
    await expect(org.getByText('SESSION SETUP')).toBeVisible();
    await org.getByRole('button', { name: new RegExp(PUZZLE_NAME) }).click();
    const [createResp] = await Promise.all([
      org.waitForResponse('**/api/session/create'),
      org.getByRole('button', { name: /Open Lobby/ }).click(),
    ]);
    const { joinCode } = (await createResp.json()) as { joinCode: string };
    await expect(org.getByText('LOBBY OPEN')).toBeVisible();

    // --- player: join, start, reach live ---
    const pCtx = await browser.newContext({ ...MOBILE, baseURL: BASE_URL });
    const player: Page = await pCtx.newPage();
    await player.goto(`${BASE_URL}/j/${joinCode}`);
    await player.getByPlaceholder('Type your name').fill('Robin');
    await player.getByRole('button', { name: /Join the Sprint/ }).click();
    await expect(player.getByText("You're in, Robin")).toBeVisible();

    await org.getByRole('button', { name: /Start Countdown/ }).click();
    await expect(player.getByText('TIME LEFT')).toBeVisible({ timeout: 25_000 });
    await expect(player.locator('.xw > div')).toHaveCount(sol.rows * sol.cols);

    // --- type two letters into the first two fill cells ---
    const c0 = sol.cellsInOrder[0]!;
    const c1 = sol.cellsInOrder[1]!;
    await player.locator('.xw > div').nth(c0.index).click();
    await player.keyboard.press(c0.letter.toLowerCase());
    await player.locator('.xw > div').nth(c1.index).click();
    await player.keyboard.press(c1.letter.toLowerCase());

    // Both letters should be on-screen pre-reload.
    await expect(player.locator('.xw > div').nth(c0.index)).toContainText(c0.letter);
    await expect(player.locator('.xw > div').nth(c1.index)).toContainText(c1.letter);

    // Wait out the ~250ms persistence debounce before reloading (else the write
    // may not have committed → the restore would be empty). This is the
    // legitimate fixme trigger if it ever proves flaky.
    await player.waitForTimeout(600);

    // --- reload (reconnect): identity + grid restored, still live ---
    await player.reload();

    // Back in the live game (not bounced to Join), grid re-rendered.
    await expect(player.getByText('TIME LEFT')).toBeVisible({ timeout: 25_000 });
    await expect(player.locator('.xw > div')).toHaveCount(sol.rows * sol.cols);

    // The two typed letters are restored from localStorage.
    await expect(player.locator('.xw > div').nth(c0.index)).toContainText(c0.letter);
    await expect(player.locator('.xw > div').nth(c1.index)).toContainText(c1.letter);

    await Promise.all([orgCtx.close(), pCtx.close()]);
  });
});
