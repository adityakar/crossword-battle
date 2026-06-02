// full-round.spec.ts — the multi-surface multiplayer round, end to end.
//
// Drives REAL browser contexts against a clean `wrangler dev` (see
// e2e/start-server.mjs): an organizer + two players on a mobile viewport, and a
// booth display on a 16:9 viewport. Each surface is its own browser context so
// cookies (organizer auth) and localStorage (player identity / grid) are
// isolated, exactly like real devices.
//
// Steps (task spec): login → create → lobby → 2 players join (realtime
// propagation to host + display) → countdown → player A solves correctly (typed
// into the real grid) → completion + display spotlight → end round → winner
// (host + display + player rank #1). Server-authoritative anti-cheat is proven in
// anti-cheat.spec.ts; reconnect persistence in reconnect.spec.ts.
import { test, expect, devices, type BrowserContext, type Page } from '@playwright/test';
import { reconstructSolution } from './solution.mjs';

const BASE_URL = 'http://127.0.0.1:8787';
const SEED_EMAIL = process.env.SEED_EMAIL || 'admin@crosswordbattle.local';
const SEED_PASSWORD = process.env.SEED_PASSWORD || 'L10CzHmFjZNcNCYDW1Hs';
const PUZZLE_ID = 'mini-ai';
const PUZZLE_NAME = 'Sprint Mini';

// Mobile (organizer/players) and 16:9 display context options.
const MOBILE = { ...devices['Pixel 5'] };
const DISPLAY = { viewport: { width: 1280, height: 720 } };

/** New mobile context + page, pointed at the local worker. */
async function mobilePage(browser: import('@playwright/test').Browser): Promise<{
  ctx: BrowserContext;
  page: Page;
}> {
  const ctx = await browser.newContext({ ...MOBILE, baseURL: BASE_URL });
  const page = await ctx.newPage();
  return { ctx, page };
}

/** Log a player into the round by name and confirm "You're in". */
async function joinAs(page: Page, code: string, name: string): Promise<void> {
  await page.goto(`${BASE_URL}/j/${code}`);
  // The Join screen's name field is the reliable "loaded" signal.
  const nameField = page.getByPlaceholder('Type your name');
  await expect(nameField).toBeVisible();
  await nameField.fill(name);
  await page.getByRole('button', { name: /Join the Sprint/ }).click();
  await expect(page.getByText(`You're in, ${name}`)).toBeVisible();
}

test.describe.serial('Crossword Battle — full multiplayer round', () => {
  test('organizer + 2 players + display run a round to a winner', async ({ browser }) => {
    const sol = reconstructSolution(PUZZLE_ID);

    // ===== Step 1: organizer logs in, creates a session, opens the lobby =====
    const { ctx: orgCtx, page: org } = await mobilePage(browser);

    await org.goto(`${BASE_URL}/host`); // unauthed → redirects to /login
    // Login is a branded splash (no "Organizer login" heading); the Email field
    // is the reliable "login screen loaded" signal.
    await expect(org.getByLabel('Email')).toBeVisible();
    await org.getByLabel('Email').fill(SEED_EMAIL);
    await org.getByLabel('Password').fill(SEED_PASSWORD);
    await org.getByRole('button', { name: 'Sign in' }).click();

    // Landed on the organizer Home.
    await org.getByRole('button', { name: /Create New Session/ }).click();

    // Setup: select the Sprint Mini puzzle (mini-ai), then open the lobby.
    await expect(org.getByText('SESSION SETUP')).toBeVisible();
    await org.getByRole('button', { name: new RegExp(PUZZLE_NAME) }).click();

    // Capture the join code from the create-session response, then assert the UI
    // shows it too (satisfies "read the join code from the lobby UI").
    const [createResp] = await Promise.all([
      org.waitForResponse('**/api/session/create'),
      org.getByRole('button', { name: /Open Lobby/ }).click(),
    ]);
    const { joinCode } = (await createResp.json()) as { joinCode: string };
    expect(joinCode).toMatch(/^[A-Z]{3}-\d{3}$/);

    // HostApp auto-opens the lobby once the socket connects.
    await expect(org.getByText('LOBBY OPEN')).toBeVisible();
    await expect(org.getByText(joinCode, { exact: true })).toBeVisible();

    // ===== Step 2: display joins, shows the lobby with the join code =====
    const dispCtx = await browser.newContext({ ...DISPLAY, baseURL: BASE_URL });
    const disp = await dispCtx.newPage();
    await disp.goto(`${BASE_URL}/tv/${joinCode}`);
    await expect(disp.getByText('PLAYERS JOINED')).toBeVisible();
    await expect(disp.getByText(joinCode, { exact: true })).toBeVisible();

    // ===== Step 3: Player A (Maya) joins → host & display see her live =====
    const { ctx: aCtx, page: playerA } = await mobilePage(browser);
    await joinAs(playerA, joinCode, 'Maya');

    // Realtime propagation: the organizer lobby and the booth display both show
    // Maya by name (and the count ticks to 1).
    await expect(org.getByText('Maya')).toBeVisible();
    await expect(disp.getByText('Maya')).toBeVisible();
    // Organizer "PLAYERS JOINED" count = 1 (the coral count in the .h2.tnum row).
    await expect(org.locator('.h2.tnum .coral')).toHaveText('1');
    // Display "PLAYERS JOINED" big count = 1 (the huge .display.tnum number).
    await expect(disp.locator('.display.tnum')).toHaveText('1');

    // ===== Step 4: Player B (Diego) joins → host & display show 2 =====
    const { ctx: bCtx, page: playerB } = await mobilePage(browser);
    await joinAs(playerB, joinCode, 'Diego');

    await expect(org.getByText('Diego')).toBeVisible();
    await expect(disp.getByText('Diego')).toBeVisible();
    // Counts tick to 2 on both surfaces.
    await expect(org.locator('.h2.tnum .coral')).toHaveText('2');
    await expect(disp.locator('.display.tnum')).toHaveText('2');

    // ===== Step 5: organizer starts the countdown → players reach the game =====
    await org.getByRole('button', { name: /Start Countdown/ }).click();

    // The 3s countdown alarm flips phase → live. Player A lands on the game grid
    // (the player surface shows "TIME LEFT").
    await expect(playerA.getByText('TIME LEFT')).toBeVisible({ timeout: 25_000 });
    // Grid is fully rendered: rows*cols cells (incl. blocks) as direct children.
    await expect(playerA.locator('.xw > div')).toHaveCount(sol.rows * sol.cols);

    // ===== Step 6: Player A solves correctly by typing into the real grid =====
    // Click each fill cell (child index r*cols+c maps exactly to (r,c)) and press
    // its letter. The window keydown handler uppercases; no input is focused on
    // the game screen so presses land. Auto-submit fires when the grid is full.
    for (const cell of sol.cellsInOrder) {
      await playerA.locator('.xw > div').nth(cell.index).click();
      await playerA.keyboard.press(cell.letter.toLowerCase());
    }

    // Server marks Maya finished → player A swaps Game for the Completion screen.
    await expect(playerA.getByText(/Nice solve/)).toBeVisible({ timeout: 20_000 });
    await expect(playerA.getByText('✓ SOLVED · PENCILS DOWN')).toBeVisible();

    // Display leader spotlight shows Maya out in front, and the FINISHED count
    // increments to 1 (the spotlight renders regardless of board visibility).
    await expect(disp.getByText('OUT IN FRONT')).toBeVisible();
    await expect(
      disp.locator('text=Maya').first(),
    ).toBeVisible();
    await expect(disp.getByText(/1 FINISHED/)).toBeVisible({ timeout: 20_000 });

    // ===== Step 7: organizer ends the round → winner is Maya everywhere =====
    await org.getByRole('button', { name: 'End Round' }).click();

    // Host winner screen (the champion name renders in a .display block).
    await expect(org.getByText(/WINNER ·/)).toBeVisible({ timeout: 20_000 });
    await expect(org.locator('.display').filter({ hasText: 'Maya' })).toBeVisible();

    // Display winner screen.
    await expect(disp.getByText('🏆 ROUND WINNER')).toBeVisible({ timeout: 20_000 });
    await expect(disp.locator('.display').filter({ hasText: 'Maya' })).toBeVisible();

    // Player A's result: rank #1.
    await expect(playerA.getByText('YOUR RANK')).toBeVisible({ timeout: 20_000 });
    await expect(playerA.getByText('#1', { exact: true })).toBeVisible();
    // Winner banner labels Maya as "THAT'S YOU" (apostrophe is a curly U+2019).
    await expect(playerA.getByText(/THAT.S YOU/)).toBeVisible();

    // Cleanup contexts.
    await Promise.all([
      orgCtx.close(),
      dispCtx.close(),
      aCtx.close(),
      bCtx.close(),
    ]);
  });
});
