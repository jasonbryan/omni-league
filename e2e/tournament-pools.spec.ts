import type { Locator, Page } from '@playwright/test';
import { axeScan, describeViolations, expectAccessible } from './support/a11y';
import { chipLabel, chooseChip } from './support/chip';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { seedPoolPlay, seedPoolResult, seedPoolsStructure, seedTeamPool } from './support/pools';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { dateFromToday, seedTenant, type Sport, type Tenant } from './support/tenant';
import { seedTournament } from './support/tournament';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LOCATION = { name: 'Pelican Shoals Sand Courts', address: '2150 Pelican Shoals Dr' };
const SLUG = 'fall-pool-play-open';
const TWELVE = [
  'Ace',
  'Bay',
  'Cove',
  'Dune',
  'Eddy',
  'Flow',
  'Gulf',
  'Haze',
  'Isle',
  'Jade',
  'Kite',
  'Lull',
];
const SIX = TWELVE.slice(0, 6);

interface Seeded {
  tenant: Tenant;
  managePath: string;
}

async function adminOf(
  page: Page,
  {
    teams,
    registration = 'closed',
    structure = 'pools',
    sport = 'beachVolleyball',
  }: {
    teams: readonly { name: string; players?: number }[];
    registration?: 'open' | 'closed';
    structure?: 'bracket' | 'pools';
    sport?: Sport;
  },
): Promise<Seeded> {
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenant({ name: 'E2E Pools', locations: [LOCATION] });
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });
  await seedTournament(tenant, {
    name: 'Fall Pool Play Open',
    slug: SLUG,
    sport,
    locations: [LOCATION.name],
    startDate: dateFromToday(30),
    endDate: dateFromToday(31),
    registrationDeadline: dateFromToday(registration === 'open' ? 20 : -2),
    maximumTeams: 16,
  });
  if (structure === 'pools') await seedPoolsStructure(tenant, SLUG);
  if (teams.length > 0) {
    await convexRun('testing:seedTournamentRosters', {
      organizationSlug: tenant.slug,
      tournamentSlug: SLUG,
      teams,
    });
  }
  return { tenant, managePath: `/app/organizations/${tenant.slug}/tournaments/${SLUG}` };
}

const full = (names: readonly string[]) => names.map((name) => ({ name }));

const panel = (page: Page) => page.locator('#pools');
const teamsIn = (page: Page, pool: string) =>
  panel(page).locator(`[data-pool="${pool}"] li[data-team-id] h4`);
const gamesIn = (page: Page, pool: string) =>
  panel(page).locator(`[data-pool="${pool}"] [data-slot="pool-game"]`);
const moveTo = (page: Page, team: string, pool: string) =>
  panel(page).getByRole('button', { name: `Move to Pool ${pool} ${team}` });
const seedNames = (page: Page) => panel(page).locator('#pool-seed-list > li h4');
const moveSeed = (page: Page, team: string, direction: 'up' | 'down') =>
  panel(page).getByRole('button', { name: `Move ${direction} ${team}` });
const seedStatus = (page: Page) => panel(page).locator('[data-slot="seed-status"]');
const poolStatus = (page: Page) => panel(page).locator('[data-slot="pool-status"]');
const splitButton = (page: Page) => panel(page).locator('#split-pools');
const createButton = (page: Page) => panel(page).locator('#create-pool-games');

async function split(page: Page, pools: number) {
  await chooseChip(chipLabel(panel(page), `${pools} pools`));
  await splitButton(page).click();
  await expect(
    panel(page).getByRole('status').filter({ hasText: 'Teams split into pools' }),
  ).toBeVisible();
}

async function expectNoSidewaysScroll(page: Page) {
  const { clientWidth, scrollWidth } = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test.describe('Tournaments: pools', () => {
  test('splits 12 teams into 3 pools in snake order, and moves a team to Pool B from the keyboard: a status says where it went, and a reload keeps it', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(TWELVE) });
    await page.goto(managePath);
    await expect(panel(page).locator('app-chip-radio-group label')).toHaveText([
      '2 pools',
      '3 pools',
      '4 pools',
    ]);
    await screenshot(page, testInfo, 'pools-ready');
    await expectAccessible(page);

    await split(page, 3);
    await expect(teamsIn(page, 'A')).toHaveText(['Ace', 'Flow', 'Gulf', 'Lull']);
    await expect(teamsIn(page, 'B')).toHaveText(['Bay', 'Eddy', 'Haze', 'Kite']);
    await expect(teamsIn(page, 'C')).toHaveText(['Cove', 'Dune', 'Isle', 'Jade']);
    await expect(splitButton(page)).toHaveText('Split again');
    await screenshot(page, testInfo, 'pools-split');
    await expectAccessible(page);

    await moveTo(page, 'Ace', 'B').focus();
    await page.keyboard.press('Enter');
    await expect(poolStatus(page)).toHaveText('Ace moved to Pool B. Pool B has 5 teams.');
    await expect(teamsIn(page, 'A')).toHaveText(['Flow', 'Gulf', 'Lull']);
    await expect(teamsIn(page, 'B')).toHaveText(['Ace', 'Bay', 'Eddy', 'Haze', 'Kite']);
    await expect(moveTo(page, 'Ace', 'A')).toBeFocused();
    await screenshot(page, testInfo, 'pools-moved');
    await expectAccessible(page);

    await page.reload();
    await expect(teamsIn(page, 'B')).toHaveText(['Ace', 'Bay', 'Eddy', 'Haze', 'Kite']);
  });

  test('moves a seed from the keyboard, and the split follows the new order', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(TWELVE) });
    await page.goto(managePath);
    await expect(seedNames(page)).toHaveText(TWELVE);
    await expect(moveSeed(page, 'Ace', 'up')).toHaveAttribute('aria-disabled', 'true');

    await moveSeed(page, 'Bay', 'up').focus();
    await page.keyboard.press('Enter');
    await expect(seedStatus(page)).toHaveText('Bay moved up to seed 1 of 12.');
    await expect(seedNames(page).first()).toHaveText('Bay');
    await expect(moveSeed(page, 'Bay', 'up')).toBeFocused();
    await screenshot(page, testInfo, 'pools-seed-moved');
    await expectAccessible(page);

    await split(page, 3);
    await expect(teamsIn(page, 'A')).toHaveText(['Bay', 'Flow', 'Gulf', 'Lull']);
    await expect(teamsIn(page, 'B')).toHaveText(['Ace', 'Eddy', 'Haze', 'Kite']);

    await moveSeed(page, 'Ace', 'down').click();
    await expect(seedStatus(page)).toHaveText('Ace moved down to seed 3 of 12.');
    await expect(panel(page).locator('[data-slot="seeds"] p').first()).toHaveText(
      'The pools keep the seeds they were split with. Split again to use this order.',
    );
    await page.reload();
    await expect(seedNames(page).nth(2)).toHaveText('Ace');
  });

  test('Undo on the split brings the earlier pools back, and is gone after the next change', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(TWELVE) });
    await page.goto(managePath);
    await split(page, 3);
    await moveTo(page, 'Ace', 'B').click();
    await expect(poolStatus(page)).toHaveText('Ace moved to Pool B. Pool B has 5 teams.');

    await chooseChip(chipLabel(panel(page), '2 pools'));
    await splitButton(page).click();
    const done = panel(page).getByRole('status').filter({ hasText: 'Teams split into pools' });
    await expect(done).toBeVisible();
    await expect(teamsIn(page, 'A')).toHaveText(['Ace', 'Dune', 'Eddy', 'Haze', 'Isle', 'Lull']);
    await screenshot(page, testInfo, 'pools-split-undo');
    await expectAccessible(page);

    await done.getByRole('button', { name: 'Undo' }).click();
    const restored = panel(page).getByRole('status').filter({ hasText: 'Earlier pools restored' });
    await expect(restored).toBeVisible();
    await expect(restored).toBeFocused();
    await expect(teamsIn(page, 'A')).toHaveText(['Flow', 'Gulf', 'Lull']);
    await expect(teamsIn(page, 'B')).toHaveText(['Ace', 'Bay', 'Eddy', 'Haze', 'Kite']);
    await expect(teamsIn(page, 'C')).toHaveText(['Cove', 'Dune', 'Isle', 'Jade']);

    await page.reload();
    await expect(teamsIn(page, 'B')).toHaveText(['Ace', 'Bay', 'Eddy', 'Haze', 'Kite']);
  });

  test.describe('an Undo the server refuses', () => {
    test.use({ expectedConvexErrors: ['tournamentGames:undoSplitPools'] });

    test('after a team moved, Undo says the pools changed and keeps them', async ({ page }) => {
      const { tenant, managePath } = await adminOf(page, { teams: full(TWELVE) });
      await page.goto(managePath);
      await split(page, 3);
      const done = panel(page).getByRole('status').filter({ hasText: 'Teams split into pools' });
      const undo = done.getByRole('button', { name: 'Undo' });
      await expect(undo).toBeVisible();
      // A second organizer's move, made while this status is still on the page.
      await seedTeamPool(tenant, SLUG, 'Ace', 'B');
      await expect(teamsIn(page, 'B')).toHaveText(['Ace', 'Bay', 'Eddy', 'Haze', 'Kite']);
      await undo.click();
      const alert = panel(page).getByRole('alert');
      await expect(alert).toContainText('The split could not be undone.');
      await expect(alert).toContainText('The pools changed since, so the split cannot be undone.');
      await expect(alert).toBeFocused();
      await expect(teamsIn(page, 'B')).toHaveText(['Ace', 'Bay', 'Eddy', 'Haze', 'Kite']);
    });
  });

  test('offers no move that the 3 to 8 limit always refuses', async ({ page }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(SIX) });
    await page.goto(managePath);
    await split(page, 2);
    await expect(teamsIn(page, 'A')).toHaveText(['Ace', 'Dune', 'Eddy']);
    await expect(teamsIn(page, 'B')).toHaveText(['Bay', 'Cove', 'Flow']);
    await expect(panel(page).locator('[data-move-to]')).toHaveCount(0);
    await screenshot(page, testInfo, 'pools-no-moves');
    await expectAccessible(page);
  });

  test('creates the pool games, 6 for each pool of 4, then recreates them after a confirmation that Cancel leaves alone', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(TWELVE.slice(0, 8)) });
    await page.goto(managePath);
    await expect(createButton(page)).toHaveCount(0);
    await expect(panel(page).locator('[data-slot="games-reason"]')).toHaveText(
      'Split the teams into pools first.',
    );
    await split(page, 2);
    await expect(createButton(page)).toHaveText('Create pool games');

    await createButton(page).click();
    await expect(
      panel(page).getByRole('status').filter({ hasText: 'Pool games created' }),
    ).toContainText('12 games in 2 pools.');
    await expect(createButton(page)).toHaveText('Recreate pool games');
    await expect(createButton(page)).toBeFocused();
    await expect(gamesIn(page, 'A')).toHaveCount(6);
    await expect(gamesIn(page, 'B')).toHaveCount(6);
    await expect(gamesIn(page, 'A').first().locator('[data-slot="game-label"]')).toHaveText(
      'Round 1: Ace v Haze',
    );
    await screenshot(page, testInfo, 'pools-games');
    await expectAccessible(page);

    await moveTo(page, 'Ace', 'B').click();
    await expect(poolStatus(page)).toHaveText('Ace moved to Pool B. Pool B has 5 teams.');
    await expect(panel(page).locator('[data-slot="stale-note"]')).toHaveText(
      'The pools changed after the games were created. Recreate the games to use the pools as they are.',
    );
    await expect(gamesIn(page, 'A')).toHaveCount(6);

    await createButton(page).click();
    const dialog = page.getByRole('alertdialog', { name: 'Recreate the pool games?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await screenshot(page, testInfo, 'pools-recreate-confirm');
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(createButton(page)).toBeFocused();
    await expect(gamesIn(page, 'A')).toHaveCount(6);
    await expect(gamesIn(page, 'B')).toHaveCount(6);

    await createButton(page).click();
    await dialog.getByRole('button', { name: 'Recreate pool games' }).click();
    await expect(
      panel(page).getByRole('status').filter({ hasText: 'Pool games recreated' }),
    ).toBeVisible();
    await expect(gamesIn(page, 'A')).toHaveCount(3);
    await expect(gamesIn(page, 'B')).toHaveCount(10);
    await expect(panel(page).locator('[data-slot="stale-note"]')).toHaveCount(0);
    await expect(createButton(page)).toBeFocused();
  });

  test('with 5 confirmed teams no split is offered, and the limits show instead', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, {
      teams: [...full(TWELVE.slice(0, 5)), { name: 'Short Handed', players: 1 }],
    });
    await page.goto(managePath);
    await expect(panel(page).locator('[data-slot="split-reason"]')).toHaveText(
      'Pools need 6 to 64 confirmed teams.',
    );
    await expect(panel(page).locator('[data-slot="unconfirmed"]')).toHaveText(
      '1 team has fewer than 2 players, so it is in no pool.',
    );
    await expect(splitButton(page)).toHaveCount(0);
    await expect(createButton(page)).toHaveCount(0);
    await screenshot(page, testInfo, 'pools-too-few');
    await expectAccessible(page);
  });

  test('no confirmed team shows the empty state with the limits', async ({ page }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: [] });
    await page.goto(managePath);
    const empty = panel(page).locator('[data-slot="empty"]');
    await expect(empty).toContainText('No confirmed teams yet');
    await expect(empty).toContainText('Pools need 6 to 64 confirmed teams.');
    await screenshot(page, testInfo, 'pools-empty');
    await expectAccessible(page);
  });

  test('before the registration deadline there is no split, only the reason', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(SIX), registration: 'open' });
    await page.goto(managePath);
    await expect(panel(page).locator('[data-slot="split-reason"]')).toContainText(
      'Registration is open until',
    );
    await expect(panel(page).locator('[data-slot="split-reason"]')).toContainText(
      'Split the teams into pools after it closes.',
    );
    await expect(splitButton(page)).toHaveCount(0);
    await screenshot(page, testInfo, 'pools-registration-open');
    await expectAccessible(page);
  });

  test('offline, Split, Move, and Create look disabled, a press shows the offline alert, and nothing is saved', async ({
    page,
    context,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(TWELVE.slice(0, 8)) });
    await page.goto(managePath);
    await split(page, 2);
    await expect(createButton(page)).not.toHaveAttribute('aria-disabled', /.*/);

    await context.setOffline(true);
    try {
      await expect(createButton(page)).toHaveAttribute('aria-disabled', 'true', { timeout: 5_000 });
      await expect(moveTo(page, 'Ace', 'B')).toHaveAttribute('aria-disabled', 'true');

      // `force`: Playwright treats aria-disabled as not actionable, and the page must still answer.
      await moveTo(page, 'Ace', 'B').click({ force: true });
      const alert = panel(page).getByRole('alert');
      await expect(alert).toContainText('Ace keeps its pool. Try again when you’re connected.');
      await expect(alert).toBeFocused();
      await expect(teamsIn(page, 'A')).toHaveText(['Ace', 'Dune', 'Eddy', 'Haze']);
      await screenshot(page, testInfo, 'pools-offline-move');
      await expectAccessible(page);

      await createButton(page).click({ force: true });
      await expect(alert).toContainText('No pool games were created.');
      await expect(gamesIn(page, 'A')).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
    await expect(createButton(page)).not.toHaveAttribute('aria-disabled', /.*/, {
      timeout: 20_000,
    });
  });

  test('the split, the games, and the confirmation do not scroll sideways at 320px', async ({
    page,
  }) => {
    const { managePath } = await adminOf(page, { teams: full(TWELVE) });
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(managePath);
    await expect(splitButton(page)).toBeVisible();
    await expectNoSidewaysScroll(page);

    await split(page, 4);
    await expectNoSidewaysScroll(page);

    await createButton(page).click();
    await expect(
      panel(page).getByRole('status').filter({ hasText: 'Pool games created' }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);

    await createButton(page).click();
    await expect(page.getByRole('alertdialog', { name: 'Recreate the pool games?' })).toBeVisible();
    await expectNoSidewaysScroll(page);
  });

  test('on a touch screen every button and pool choice in the panel is 44px or more', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'touch targets apply on touch screens only');
    const { managePath } = await adminOf(page, { teams: full(TWELVE.slice(0, 8)) });
    await page.goto(managePath);
    await expect(splitButton(page)).toBeVisible();
    await split(page, 2);
    await createButton(page).click();
    await expect(
      panel(page).getByRole('status').filter({ hasText: 'Pool games created' }),
    ).toBeVisible();

    const targets = panel(page).locator('button, label');
    const heights = await targets.evaluateAll((elements) =>
      elements.map((element) => ({
        name: element.textContent?.trim().slice(0, 40) ?? '',
        height: element.getBoundingClientRect().height,
      })),
    );
    expect(heights.length).toBeGreaterThan(10);
    expect(heights.filter((target) => target.height < 44)).toEqual([]);
  });
});

test.describe('Tournaments: the structure', () => {
  const editForm = (page: Page) => page.locator('#edit-details');
  const save = (page: Page) => editForm(page).getByRole('button', { name: /^Save changes/ });
  const saveStatus = (page: Page) => editForm(page).locator('[data-slot="save-status"]');

  test('an organizer changes Bracket only to Pools, then bracket, the Pools panel replaces the bracket panel, and Undo restores it', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(SIX), structure: 'bracket' });
    await page.goto(managePath);
    await expect(page.locator('#bracket')).toBeVisible();
    await expect(page.locator('#pools')).toHaveCount(0);
    await expect(chipLabel(editForm(page), 'Bracket only').getByRole('radio')).toBeChecked();

    await chooseChip(chipLabel(editForm(page), 'Pools, then bracket'));
    await save(page).click();
    await expect(saveStatus(page)).toContainText('Details saved.');
    await expect(panel(page)).toBeVisible();
    await expect(page.locator('#bracket')).toHaveCount(0);
    await screenshot(page, testInfo, 'structure-pools');
    await expectAccessible(page);

    await saveStatus(page).getByRole('button', { name: /^Undo/ }).click();
    await expect(saveStatus(page)).toContainText('Earlier details restored.');
    await expect(page.locator('#bracket')).toBeVisible();
    await expect(page.locator('#pools')).toHaveCount(0);
    await expect(chipLabel(editForm(page), 'Bracket only').getByRole('radio')).toBeChecked();
  });

  test('once pool games exist the structure and Sets per game are text with the reason', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(SIX) });
    await page.goto(managePath);
    await expect(chipLabel(editForm(page), 'Pools, then bracket').getByRole('radio')).toBeChecked();
    await split(page, 2);
    await createButton(page).click();
    await expect(
      panel(page).getByRole('status').filter({ hasText: 'Pool games created' }),
    ).toBeVisible();

    await expect(editForm(page).locator('[data-slot="structure"]')).toContainText(
      'Games are created, so the structure cannot change.',
    );
    await expect(editForm(page).locator('[data-slot="sets-per-game"]')).toContainText(
      'Sets per game cannot change once the pool games are created.',
    );
    await expect(editForm(page).getByRole('radio')).toHaveCount(0);
    await screenshot(page, testInfo, 'structure-locked');
    await expectAccessible(page);
  });
});

const poolGame = (page: Page, label: string) =>
  panel(page)
    .locator('[data-game]')
    .filter({ has: page.locator('[data-slot="game-label"]', { hasText: label }) });
const enterButton = (game: Locator) => game.getByRole('button', { name: /^Enter result/ });
const correctButton = (game: Locator) => game.getByRole('button', { name: /^Correct result/ });
const clearButton = (game: Locator) => game.getByRole('button', { name: /^Clear result/ });
const undoButton = (game: Locator) => game.getByRole('button', { name: 'Undo' });
const saveButton = (game: Locator) =>
  game.getByRole('button', { name: /^Save (result|correction)/ });
const savedStatus = (game: Locator, title: string) =>
  game.getByRole('status').filter({ hasText: title });
const scoreInput = (game: Locator, box: string) => game.locator(`input[id$="-${box}"]`);
const gameResult = (game: Locator) => game.locator('[data-slot="game-result"]');

/** Six teams in 2 pools: Pool A is Ace, Dune, and Eddy, who play Dune v Eddy, then Ace v Eddy, then Ace v Dune. */
const ROUND_ONE_OF_A = 'Round 1: Dune v Eddy';
const ROUND_TWO_OF_A = 'Round 2: Ace v Eddy';

test.describe('Tournaments: pool results', () => {
  test('enters a result for a pool game: the game shows it, the pools lock, and a reload keeps it', async ({
    page,
  }, testInfo) => {
    const { tenant, managePath } = await adminOf(page, { teams: full(SIX) });
    await seedPoolPlay(tenant, SLUG, 2);
    await page.goto(managePath);
    const game = poolGame(page, ROUND_ONE_OF_A);
    await expect(game.locator('[data-slot="game-label"]')).toHaveText(ROUND_ONE_OF_A);
    await enterButton(game).click();
    await scoreInput(game, 'a1').fill('21');
    await scoreInput(game, 'b1').fill('15');
    await screenshot(page, testInfo, 'pool-result-form');
    await expectAccessible(page);

    await saveButton(game).click();
    await expect(savedStatus(game, 'Result saved')).toContainText('Dune won.');
    await expect(gameResult(game)).toHaveText('Dune 21–15 Eddy. Dune won.');
    await expect(panel(page).locator('[data-slot="split-reason"]')).toHaveText(
      'A pool result is entered, so the pools cannot change.',
    );
    await expect(moveTo(page, 'Ace', 'B')).toHaveCount(0);
    await screenshot(page, testInfo, 'pool-result-saved');
    await expectAccessible(page);

    await page.reload();
    await expect(gameResult(poolGame(page, ROUND_ONE_OF_A))).toHaveText(
      'Dune 21–15 Eddy. Dune won.',
    );
    await expect(correctButton(poolGame(page, ROUND_ONE_OF_A))).toBeVisible();
    await expect(clearButton(poolGame(page, ROUND_ONE_OF_A))).toBeVisible();
  });

  test('a tied set in beach volleyball shows its error under the set and sends nothing', async ({
    page,
  }) => {
    const { tenant, managePath } = await adminOf(page, { teams: full(SIX) });
    await seedPoolPlay(tenant, SLUG, 2);
    await page.goto(managePath);
    const game = poolGame(page, ROUND_ONE_OF_A);
    await enterButton(game).click();
    await scoreInput(game, 'a1').fill('21');
    await scoreInput(game, 'b1').fill('21');
    await saveButton(game).click();
    await expect(game.locator('[data-slot="field-error"]')).toHaveText(
      'Set 1 is tied. A set needs a winner.',
    );
    await expect(scoreInput(game, 'a1')).toBeFocused();
    await expect(gameResult(game)).toHaveCount(0);
  });

  test('a soccer pool game can end in a tie, which is corrected, cleared, and restored', async ({
    page,
  }, testInfo) => {
    const { tenant, managePath } = await adminOf(page, { teams: full(SIX), sport: 'soccer' });
    await seedPoolPlay(tenant, SLUG, 2);
    await page.goto(managePath);
    const game = poolGame(page, ROUND_TWO_OF_A);
    await enterButton(game).click();
    await scoreInput(game, 'a1').fill('2');
    await scoreInput(game, 'b1').fill('2');
    await saveButton(game).focus();
    await expect(game.locator('[data-slot="field-error"]')).toHaveCount(0);
    await saveButton(game).click();
    await expect(savedStatus(game, 'Result saved')).toContainText('The game ended in a tie.');
    await expect(gameResult(game)).toHaveText('Ace 2–2 Eddy. The game was tied.');
    await expect(panel(page).locator('[data-slot="split-reason"]')).toHaveText(
      'A pool result is entered, so the pools cannot change.',
    );
    await screenshot(page, testInfo, 'pool-result-tied');
    await expectAccessible(page);

    await correctButton(game).click();
    await scoreInput(game, 'a1').fill('3');
    await saveButton(game).click();
    await expect(savedStatus(game, 'Result corrected')).toContainText('Ace won.');
    await expect(gameResult(game)).toHaveText('Ace 3–2 Eddy. Ace won.');

    await clearButton(game).click();
    await expect(savedStatus(game, 'Result cleared')).toBeVisible();
    await expect(panel(page).locator('[data-slot="split-reason"]')).toHaveCount(0);
    await undoButton(game).click();
    await expect(savedStatus(game, 'Result restored')).toContainText('Ace won.');
    await expect(gameResult(game)).toHaveText('Ace 3–2 Eddy. Ace won.');
  });
});

const PUBLIC_RESULTS: [readonly [string, string], { a: number; b: number }][] = [
  [['Dune', 'Eddy'], { a: 21, b: 15 }],
  [['Ace', 'Eddy'], { a: 21, b: 10 }],
];

async function seedPublicPools(
  played: boolean,
  { sport = 'beachVolleyball', names = SIX }: { sport?: Sport; names?: readonly string[] } = {},
): Promise<{ tenant: Tenant; path: string }> {
  const tenant = await seedTenant({ name: 'E2E Public Pools', locations: [LOCATION] });
  const path = await seedTournament(tenant, {
    name: 'Fall Pool Play Open',
    slug: SLUG,
    sport,
    locations: [LOCATION.name],
    startDate: dateFromToday(30),
    endDate: dateFromToday(31),
    registrationDeadline: dateFromToday(-2),
    maximumTeams: 16,
  });
  await seedPoolsStructure(tenant, SLUG);
  await convexRun('testing:seedTournamentRosters', {
    organizationSlug: tenant.slug,
    tournamentSlug: SLUG,
    teams: full(names),
  });
  await seedPoolPlay(tenant, SLUG, 2);
  if (played && sport === 'beachVolleyball') {
    for (const [teams, { a, b }] of PUBLIC_RESULTS) {
      await seedPoolResult(tenant, SLUG, teams, { score: { kind: 'sets', sets: [{ a, b }] } });
    }
  }
  return { tenant, path };
}

const textOf = (html: string | undefined) =>
  (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

test.describe('public tournament page: pools', () => {
  test(
    'Fall Pool Play Open fetched without JavaScript has each pool’s standings table and games in the raw HTML',
    RAW_HTTP,
    async ({ request }) => {
      const { path } = await seedPublicPools(true);
      const { status, html } = await fetchRawHtml(request, path);
      expect(status).toBe(200);
      const pools = html.slice(html.indexOf('id="pools"'), html.indexOf('id="bracket"'));
      expect(
        [...pools.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map(([, h3]) => textOf(h3)),
      ).toEqual(['Pool A', 'Pool B']);
      expect(pools).toContain('<caption');
      expect(textOf(/<caption\b[^>]*>([\s\S]*?)<\/caption>/.exec(pools)?.[1])).toBe(
        'Pool A standings',
      );
      expect(pools).toContain('scope="col"');
      expect(pools).toContain('scope="row"');
      expect(
        [...pools.matchAll(/<tr\b[^>]*data-testid="standing"[\s\S]*?<\/tr>/g)].map(([row]) =>
          textOf(row),
        ),
      ).toEqual(['1 Ace 1 1 0 100% +11', '2 Dune 1 1 0 100% +6', '3 Eddy 2 0 2 0% -17']);
      expect(
        [...pools.matchAll(/<li\b[^>]*data-testid="pool-game"[\s\S]*?<\/li>/g)].map(([game]) =>
          textOf(game),
        ),
      ).toEqual([
        'Round 1 Dune v Eddy 21–15. Dune won.',
        'Round 2 Ace v Eddy 21–10. Ace won.',
        'Round 3 Ace v Dune',
        'Round 1 Cove v Flow',
        'Round 2 Bay v Flow',
        'Round 3 Bay v Cove',
      ]);
      expect(textOf(pools)).toContain('Standings appear after the first result.');
      expect(html.indexOf('id="pools"')).toBeLessThan(html.indexOf('id="bracket"'));
    },
  );

  test('shows the standings and games to a reader, accessible and without sideways scroll', async ({
    page,
  }, testInfo) => {
    const { path } = await seedPublicPools(true);
    await page.goto(path);
    const section = page.locator('section#pools');
    await expect(section.locator('h3')).toHaveText(['Pool A', 'Pool B']);
    await expect(section.locator('table')).toHaveCount(1);
    await expect(section.locator('table caption')).toHaveText('Pool A standings');
    await expect(section.locator('tbody th')).toHaveText(['Ace', 'Dune', 'Eddy']);
    await expect(section.locator('[data-testid="no-standings"]')).toHaveText(
      'Standings appear after the first result.',
    );
    await screenshot(page, testInfo, 'public-pools');
    await expectAccessible(page);
  });

  test('says when standings appear while no game has a result, and lists the games', async ({
    page,
  }, testInfo) => {
    const { path } = await seedPublicPools(false);
    await page.goto(path);
    const section = page.locator('section#pools');
    await expect(section.locator('[data-testid="no-standings"]')).toHaveText([
      'Standings appear after the first result.',
      'Standings appear after the first result.',
    ]);
    await expect(section.locator('table')).toHaveCount(0);
    await expect(section.locator('[data-testid="pool-game"]')).toHaveCount(6);
    await screenshot(page, testInfo, 'public-pools-empty');
    await expectAccessible(page);
  });

  test('follows a result entered while the page is open', async ({ page }) => {
    const { tenant, path } = await seedPublicPools(false);
    await page.goto(path);
    const section = page.locator('section#pools');
    await expect(section.locator('table')).toHaveCount(0);
    await seedPoolResult(tenant, SLUG, ['Dune', 'Eddy'], {
      score: { kind: 'sets', sets: [{ a: 21, b: 15 }] },
    });
    await expect(section.locator('table')).toHaveCount(1);
    await expect(section.locator('tbody th').first()).toHaveText('Dune');
  });

  test('a soccer standings table with long team names scrolls inside itself at 320px, and the page does not scroll sideways', async ({
    page,
  }, testInfo) => {
    // The snake split puts seeds 1, 4, and 5 in Pool A.
    const names = [
      'Intergalactic Wanderers',
      'Wolverhampton Rovers',
      'Llanfairpwllgwyngyll',
    ] as const;
    const { tenant, path } = await seedPublicPools(false, {
      sport: 'soccer',
      names: [names[0], 'Dune', 'Eddy', names[1], names[2], 'Flow'],
    });
    await seedPoolResult(tenant, SLUG, [names[0], names[1]], {
      score: { kind: 'goals', a: 2, b: 2 },
    });
    await seedPoolResult(tenant, SLUG, [names[0], names[2]], {
      score: { kind: 'goals', a: 3, b: 0 },
    });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(path);
    const table = page.locator('section#pools [data-testid="standings"]').first();
    await expect(table.locator('tbody th').first()).toHaveText('Intergalactic Wanderers');
    await expect(table.locator('tbody tr:first-child td').last()).toHaveText('4');
    const container = table.locator('xpath=..');
    const { scrollWidth, clientWidth } = await container.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(scrollWidth).toBeGreaterThan(clientWidth);
    await expectNoSidewaysScroll(page);
    await container.scrollIntoViewIfNeeded();
    await container.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
    await expect(table.locator('thead th').last()).toBeInViewport();
    await expectNoSidewaysScroll(page);
    await screenshot(page, testInfo, 'public-pools-soccer-320');
    await expectAccessible(page);
  });
});
