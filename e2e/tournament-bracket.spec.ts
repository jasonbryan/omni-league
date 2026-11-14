import type { Browser, Locator, Page } from '@playwright/test';
import { axeScan, describeViolations, expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { expectLinkHeights, pointerOf } from './support/link-heights';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { dateFromToday, seedTenant, type Tenant } from './support/tenant';
import { seedTournament } from './support/tournament';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LOCATION = { name: 'Pelican Shoals Sand Courts', address: '2150 Pelican Shoals Dr' };
const SLUG = 'labor-day-sand-slam';
const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];

interface Seeded {
  tenant: Tenant;
  managePath: string;
}

async function adminOf(
  page: Page,
  {
    teams,
    registration,
  }: { teams: readonly { name: string; players?: number }[]; registration: 'open' | 'closed' },
): Promise<Seeded> {
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenant({ name: 'E2E Brackets', locations: [LOCATION] });
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });
  await seedTournament(tenant, {
    name: 'Labor Day Sand Slam',
    slug: SLUG,
    locations: [LOCATION.name],
    startDate: dateFromToday(30),
    endDate: dateFromToday(31),
    registrationDeadline: dateFromToday(registration === 'open' ? 20 : -2),
    maximumTeams: 16,
  });
  if (teams.length > 0) {
    await convexRun('testing:seedTournamentRosters', {
      organizationSlug: tenant.slug,
      tournamentSlug: SLUG,
      teams,
    });
  }
  return { tenant, managePath: `/app/organizations/${tenant.slug}/tournaments/${SLUG}` };
}

const panel = (page: Page) => page.locator('#bracket');
const seedRows = (page: Page) => panel(page).locator('#seed-list > li');
const seedNames = (page: Page) => seedRows(page).locator('h3');
const move = (page: Page, team: string, direction: 'up' | 'down') =>
  panel(page).getByRole('button', { name: `Move ${direction} ${team}` });
const seedStatus = (page: Page) => panel(page).locator('[data-slot="seed-status"]');
const createButton = (page: Page) => panel(page).locator('#create-bracket');
const reason = (page: Page) => panel(page).locator('[data-slot="create-reason"]');
const rounds = (page: Page) => panel(page).locator('#bracket-rounds');
const gameLabels = (page: Page) => rounds(page).locator('[data-slot="game-label"]');

const full = (names: readonly string[]) => names.map((name) => ({ name }));

test.describe('Tournaments: seeds and the bracket', () => {
  test('moves a seed up from the keyboard: the order changes, a status says where the team went, and a reload keeps it', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, {
      teams: full(['Alpha', 'Bravo', 'Charlie']),
      registration: 'closed',
    });
    await page.goto(managePath);
    await expect(seedNames(page)).toHaveText(['Alpha', 'Bravo', 'Charlie']);
    await expect(move(page, 'Alpha', 'up')).toHaveAttribute('aria-disabled', 'true');
    await screenshot(page, testInfo, 'bracket-seeds');
    await expectAccessible(page);

    await move(page, 'Charlie', 'up').focus();
    await page.keyboard.press('Enter');
    await expect(seedStatus(page)).toHaveText('Charlie moved up to seed 2 of 3.');
    await expect(seedNames(page)).toHaveText(['Alpha', 'Charlie', 'Bravo']);
    await expect(move(page, 'Charlie', 'up')).toBeFocused();
    await screenshot(page, testInfo, 'bracket-seed-moved');
    await expectAccessible(page);

    // The accessibility check walks the page with Tab, so focus returns to the button first.
    await move(page, 'Charlie', 'up').focus();
    await page.keyboard.press('Space');
    await expect(seedStatus(page)).toHaveText('Charlie moved up to seed 1 of 3.');
    await expect(seedNames(page)).toHaveText(['Charlie', 'Alpha', 'Bravo']);
    await expect(move(page, 'Charlie', 'up')).toBeFocused();

    await move(page, 'Charlie', 'down').click();
    await expect(seedStatus(page)).toHaveText('Charlie moved down to seed 2 of 3.');

    await page.reload();
    await expect(seedNames(page)).toHaveText(['Alpha', 'Charlie', 'Bravo']);
  });

  test('creates a bracket for 5 teams: seeds 1 to 3 get byes and 4 plays 5, then recreates it after a confirmation', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(NAMES), registration: 'closed' });
    await page.goto(managePath);
    await expect(seedNames(page)).toHaveText(NAMES);
    await expect(createButton(page)).toHaveText('Create bracket');
    await screenshot(page, testInfo, 'bracket-ready');

    await createButton(page).click();
    const created = panel(page).getByRole('status').filter({ hasText: 'Bracket created' });
    await expect(created).toContainText('7 games in 3 rounds.');
    await expect(createButton(page)).toHaveText('Recreate bracket');
    await expect(createButton(page)).toBeFocused();
    await expect(rounds(page).locator('h4')).toHaveText(['Quarterfinals', 'Semifinals', 'Final']);
    await expect(gameLabels(page)).toHaveText([
      'Game 1: Alpha v Bye',
      'Game 2: Delta v Echo',
      'Game 3: Bravo v Bye',
      'Game 4: Charlie v Bye',
      'Game 1: Alpha v To be decided',
      'Game 2: Bravo v Charlie',
      'Game 1: To be decided v To be decided',
    ]);
    await screenshot(page, testInfo, 'bracket-created');
    await expectAccessible(page);

    await move(page, 'Echo', 'up').click();
    await expect(seedNames(page)).toHaveText(['Alpha', 'Bravo', 'Charlie', 'Echo', 'Delta']);
    await expect(panel(page).locator('[data-slot="seed-note"]')).toHaveText(
      'The bracket keeps the seeds it was created with. Recreate it to use this order.',
    );

    await createButton(page).click();
    const dialog = page.getByRole('alertdialog', { name: 'Recreate the bracket?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await screenshot(page, testInfo, 'bracket-recreate-confirm');
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(createButton(page)).toBeFocused();
    await expect(gameLabels(page).nth(1)).toHaveText('Game 2: Delta v Echo');

    await createButton(page).click();
    await dialog.getByRole('button', { name: 'Recreate bracket' }).click();
    await expect(
      panel(page).getByRole('status').filter({ hasText: 'Bracket recreated' }),
    ).toBeVisible();
    await expect(gameLabels(page).nth(1)).toHaveText('Game 2: Echo v Delta');
    await expect(createButton(page)).toBeFocused();
  });

  test('once the bracket is created, Sets per game is text with the reason', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, {
      teams: full(['Alpha', 'Bravo']),
      registration: 'closed',
    });
    await page.goto(managePath);
    await expect(page.locator('#sets-per-game-3')).toHaveCount(1);
    await createButton(page).click();
    await expect(
      panel(page).getByRole('status').filter({ hasText: 'Bracket created' }),
    ).toBeVisible();
    await page.reload();
    const sets = page.locator('#edit-details [data-slot="sets-per-game"]');
    await expect(sets).toContainText('1 set');
    await expect(sets).toContainText('The bracket is created, so sets per game cannot change.');
    await expect(page.locator('#sets-per-game-3')).toHaveCount(0);
    await screenshot(page, testInfo, 'bracket-sets-locked');
    await expectAccessible(page);
  });

  test('before the registration deadline there is no Create action, only the reason', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, {
      teams: full(['Alpha', 'Bravo']),
      registration: 'open',
    });
    await page.goto(managePath);
    await expect(seedNames(page)).toHaveText(['Alpha', 'Bravo']);
    await expect(createButton(page)).toHaveCount(0);
    await expect(reason(page)).toContainText('Registration is open until');
    await expect(reason(page)).toContainText('Create the bracket after it closes.');
    await screenshot(page, testInfo, 'bracket-registration-open');
    await expectAccessible(page);
  });

  test('one confirmed team gets no Create action and the reason, and a team below the roster minimum is not a seed', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, {
      teams: [{ name: 'Alpha' }, { name: 'Short Handed', players: 1 }],
      registration: 'closed',
    });
    await page.goto(managePath);
    await expect(seedNames(page)).toHaveText(['Alpha']);
    await expect(createButton(page)).toHaveCount(0);
    await expect(reason(page)).toHaveText('A bracket needs at least 2 confirmed teams.');
    await expect(panel(page).locator('[data-slot="unconfirmed"]')).toHaveText(
      '1 team has fewer than 2 players, so it is not seeded.',
    );
    await screenshot(page, testInfo, 'bracket-one-team');
    await expectAccessible(page);
  });

  test('no confirmed team shows the empty state with the reason', async ({ page }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: [], registration: 'closed' });
    await page.goto(managePath);
    const empty = panel(page).locator('[data-slot="empty"]');
    await expect(empty).toContainText('No confirmed teams yet');
    await expect(empty).toContainText('A bracket needs at least 2 confirmed teams.');
    await expect(createButton(page)).toHaveCount(0);
    await screenshot(page, testInfo, 'bracket-empty');
    await expectAccessible(page);
  });

  test('offline, Move and Create look disabled, a press shows the offline alert, and nothing is saved', async ({
    page,
    context,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(NAMES), registration: 'closed' });
    await page.goto(managePath);
    await expect(seedNames(page)).toHaveText(NAMES);
    await expect(createButton(page)).not.toHaveAttribute('aria-disabled', /.*/);

    await context.setOffline(true);
    try {
      await expect(createButton(page)).toHaveAttribute('aria-disabled', 'true', { timeout: 5_000 });
      await expect(move(page, 'Bravo', 'up')).toHaveAttribute('aria-disabled', 'true');

      // `force`: Playwright treats aria-disabled as not actionable, and the page must still answer.
      await move(page, 'Bravo', 'up').click({ force: true });
      const alert = panel(page).getByRole('alert');
      await expect(alert).toContainText('Bravo keeps its seed. Try again when you’re connected.');
      await expect(alert).toBeFocused();
      await expect(seedNames(page)).toHaveText(NAMES);
      await screenshot(page, testInfo, 'bracket-offline-move');
      await expectAccessible(page);

      await createButton(page).click({ force: true });
      await expect(alert).toContainText('No bracket was created.');
      await expect(rounds(page)).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
    await expect(createButton(page)).not.toHaveAttribute('aria-disabled', /.*/, {
      timeout: 20_000,
    });
    await page.reload();
    await expect(seedNames(page)).toHaveText(NAMES);
    await expect(createButton(page)).toHaveText('Create bracket');
  });

  test.describe('a deadline that would reopen registration', () => {
    const REOPENS =
      'The bracket is created, so registration cannot reopen. Choose a deadline that has passed.';
    const deadline = (page: Page) => page.locator('#details-registration-deadline');
    const deadlineError = (page: Page) => page.locator('#details-registration-deadline-error');
    const saveDetails = (page: Page) =>
      page.locator('#edit-details form').getByRole('button', { name: /^Save changes/ });

    async function expectRegistrationClosed(page: Page, tenant: Tenant) {
      await page.goto(`${tenant.path}/tournaments/${SLUG}`);
      await expect(page.locator('#registration')).toContainText('Registration closed');
      await expect(page.locator('#registration').locator('a, button')).toHaveCount(0);
      await page.goto(`/app/organizations/${tenant.slug}/tournaments/${SLUG}/register`);
      await expect(page.locator('main [data-slot="alert"]')).toContainText(
        'Registration for this tournament is closed.',
      );
      await expect(page.locator('#team-name')).toHaveCount(0);
    }

    test.describe('Save', () => {
      test.use({ expectedConvexErrors: ['tournaments:updateDetails'] });

      test('a later deadline after Create is refused under its field, and the public and register pages stay closed', async ({
        page,
      }, testInfo) => {
        const { tenant, managePath } = await adminOf(page, {
          teams: full(['Alpha', 'Bravo']),
          registration: 'closed',
        });
        await page.goto(managePath);
        await createButton(page).click();
        await expect(
          panel(page).getByRole('status').filter({ hasText: 'Bracket created' }),
        ).toBeVisible();

        await deadline(page).fill(dateFromToday(10));
        await saveDetails(page).click();
        await expect(deadlineError(page)).toHaveText(REOPENS);
        await expect(deadline(page)).toHaveValue(dateFromToday(10));
        await expect(deadline(page)).toBeFocused();
        await screenshot(page, testInfo, 'bracket-deadline-refused');
        await expectAccessible(page);

        await page.reload();
        await expect(deadline(page)).toHaveValue(dateFromToday(-2));
        await expectRegistrationClosed(page, tenant);
      });
    });

    test.describe('Undo', () => {
      test.use({ expectedConvexErrors: ['tournaments:undoUpdateDetails'] });

      test('Undo that would restore an open deadline after Create is refused with the same reason', async ({
        page,
      }) => {
        const { tenant, managePath } = await adminOf(page, {
          teams: full(['Alpha', 'Bravo']),
          registration: 'open',
        });
        await page.goto(managePath);
        await deadline(page).fill(dateFromToday(-2));
        await saveDetails(page).click();
        const undo = page.locator('#edit-details form').getByRole('button', { name: 'Undo' });
        await expect(undo).toBeVisible();

        await createButton(page).click();
        await expect(
          panel(page).getByRole('status').filter({ hasText: 'Bracket created' }),
        ).toBeVisible();
        await undo.click();
        await expect(page.locator('#edit-details form')).toContainText(REOPENS);
        await page.reload();
        await expect(deadline(page)).toHaveValue(dateFromToday(-2));
        await expectRegistrationClosed(page, tenant);
      });
    });
  });
});

const gameOf = (page: Page, label: string) =>
  rounds(page)
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

async function createBracket(page: Page) {
  await createButton(page).click();
  await expect(
    panel(page).getByRole('status').filter({ hasText: 'Bracket created' }),
  ).toBeVisible();
}

async function fillSet(game: Locator, a: string, b: string, set = 1) {
  await scoreInput(game, `a${set}`).fill(a);
  await scoreInput(game, `b${set}`).fill(b);
}

async function enterSet(game: Locator, a: string, b: string) {
  await enterButton(game).click();
  await fillSet(game, a, b);
  await saveButton(game).click();
}

async function expectNoSidewaysScroll(page: Page) {
  const { clientWidth, scrollWidth } = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test.describe('Tournaments: bracket results', () => {
  test('a result moves the winner on, locks the seeds, and can be undone, corrected, and played to a winner', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(NAMES), registration: 'closed' });
    await page.goto(managePath);
    await createBracket(page);
    const first = gameOf(page, 'Game 2: Delta v Echo');
    await expect(enterButton(gameOf(page, 'Game 1: Alpha v Bye'))).toHaveCount(0);
    await expect(enterButton(gameOf(page, 'Game 1: Alpha v To be decided'))).toHaveCount(0);

    await enterButton(first).click();
    await expect(scoreInput(first, 'a1')).toBeFocused();
    await screenshot(page, testInfo, 'bracket-result-form');
    await expectAccessible(page);

    await fillSet(first, '21', '15');
    await saveButton(first).click();
    const saved = savedStatus(first, 'Result saved');
    await expect(saved).toContainText('Delta advances to the Semifinals.');
    await expect(saved).toBeFocused();
    await expect(first.locator('[data-slot="game-result"]')).toHaveText(
      'Delta 21–15 Echo. Delta won.',
    );
    await expect(gameLabels(page).nth(4)).toHaveText('Game 1: Alpha v Delta');
    await expect(panel(page).locator('[data-move]')).toHaveCount(0);
    await expect(reason(page)).toHaveText(
      'A result is entered, so the bracket cannot be recreated.',
    );
    await screenshot(page, testInfo, 'bracket-result-saved');
    await expectAccessible(page);

    await saved.getByRole('button', { name: 'Undo' }).click();
    await expect(savedStatus(first, 'Result undone')).toBeFocused();
    await expect(gameLabels(page).nth(4)).toHaveText('Game 1: Alpha v To be decided');
    await expect(panel(page).locator('[data-move]').first()).toBeVisible();
    await expect(createButton(page)).toBeVisible();

    await enterSet(first, '21', '15');
    await expect(savedStatus(first, 'Result saved')).toBeVisible();

    await correctButton(first).click();
    await expect(scoreInput(first, 'a1')).toHaveValue('21');
    await fillSet(first, '12', '21');
    await saveButton(first).click();
    await expect(savedStatus(first, 'Result corrected')).toContainText(
      'Echo advances to the Semifinals.',
    );
    await expect(gameLabels(page).nth(4)).toHaveText('Game 1: Alpha v Echo');
    await screenshot(page, testInfo, 'bracket-result-corrected');

    const semifinal = gameOf(page, 'Game 1: Alpha v Echo');
    await enterSet(semifinal, '21', '10');
    await expect(savedStatus(semifinal, 'Result saved')).toContainText(
      'Alpha advances to the Final.',
    );
    await expect(first.locator('[data-slot="locked"]')).toHaveText(
      'The next game has a result, so this result cannot change.',
    );
    await expect(correctButton(first)).toHaveCount(0);
    await screenshot(page, testInfo, 'bracket-result-locked');
    await expectAccessible(page);

    await enterSet(gameOf(page, 'Game 2: Bravo v Charlie'), '21', '19');
    await expect(gameLabels(page).nth(6)).toHaveText('Game 1: Alpha v Bravo');
    const final = gameOf(page, 'Game 1: Alpha v Bravo');
    await enterSet(final, '21', '15');
    await expect(savedStatus(final, 'Result saved')).toContainText('Alpha wins the tournament.');
    await expect(rounds(page).locator('[data-slot="winner"]')).toHaveText('Winner: Alpha');
    await screenshot(page, testInfo, 'bracket-winner');
    await expectAccessible(page);

    await page.reload();
    await expect(rounds(page).locator('[data-slot="winner"]')).toHaveText('Winner: Alpha');
    await expect(first.locator('[data-slot="game-result"]')).toHaveText(
      'Delta 12–21 Echo. Echo won.',
    );
  });

  test('a tied set shows its error under the set once the pair is left, keeps the scores, and clears while typing the fix', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(NAMES), registration: 'closed' });
    await page.goto(managePath);
    await createBracket(page);
    const game = gameOf(page, 'Game 2: Delta v Echo');
    await enterButton(game).click();
    await scoreInput(game, 'a1').fill('21');
    await scoreInput(game, 'b1').fill('21');
    await expect(game.locator('[data-slot="field-error"]')).toHaveCount(0);
    await saveButton(game).focus();
    const error = game.locator('[data-slot="field-error"]');
    await expect(error).toHaveText('Set 1 is tied. A set needs a winner.');
    await expect(scoreInput(game, 'a1')).toHaveAttribute('aria-invalid', 'true');
    await screenshot(page, testInfo, 'bracket-result-tied');
    await expectAccessible(page);

    await saveButton(game).click();
    await expect(scoreInput(game, 'a1')).toBeFocused();
    await expect(scoreInput(game, 'b1')).toHaveValue('21');

    await scoreInput(game, 'b1').fill('15');
    await expect(error).toHaveCount(0);
    await saveButton(game).click();
    await expect(savedStatus(game, 'Result saved')).toBeVisible();
  });

  test('a forfeit records the sport’s forfeit score and the other team wins', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(NAMES), registration: 'closed' });
    await page.goto(managePath);
    await createBracket(page);
    const game = gameOf(page, 'Game 2: Delta v Echo');
    await enterButton(game).click();
    await game.getByRole('checkbox', { name: 'A team forfeits' }).click();
    await expect(scoreInput(game, 'a1')).toHaveCount(0);
    await expect(game.getByText('The other team wins 21–0.')).toBeVisible();
    await saveButton(game).click();
    await expect(game.getByText('Choose the team that forfeits.')).toBeVisible();
    await screenshot(page, testInfo, 'bracket-result-forfeit');
    await expectAccessible(page);

    await game.locator('label', { hasText: 'Echo' }).click();
    await saveButton(game).click();
    await expect(savedStatus(game, 'Result saved')).toContainText('Delta advances');
    await expect(game.locator('[data-slot="game-result"]')).toHaveText(
      'Delta 21–0 Echo. Echo forfeited. Delta won.',
    );
  });

  test('a forfeit cleared after a reload is restored by Undo as a forfeit by the same team', async ({
    page,
  }) => {
    const { managePath } = await adminOf(page, { teams: full(NAMES), registration: 'closed' });
    await page.goto(managePath);
    await createBracket(page);
    const game = gameOf(page, 'Game 2: Delta v Echo');
    await enterButton(game).click();
    await game.getByRole('checkbox', { name: 'A team forfeits' }).click();
    await game.locator('label', { hasText: 'Echo' }).click();
    await saveButton(game).click();
    await expect(savedStatus(game, 'Result saved')).toBeVisible();
    await page.reload();

    await clearButton(game).click();
    const cleared = savedStatus(game, 'Result cleared');
    await expect(game.locator('[data-slot="game-result"]')).toHaveCount(0);
    await undoButton(cleared).click();
    await expect(savedStatus(game, 'Result restored')).toContainText(
      'Delta advances to the Semifinals.',
    );
    await expect(game.locator('[data-slot="game-result"]')).toHaveText(
      'Delta 21–0 Echo. Echo forfeited. Delta won.',
    );
    await expect(gameLabels(page).nth(4)).toHaveText('Game 1: Alpha v Delta');
  });

  test('a best of 3 needs the third set when the teams split the first two', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(NAMES), registration: 'closed' });
    await page.goto(managePath);
    await page.locator('label', { has: page.locator('#sets-per-game-3') }).click();
    await page
      .locator('#edit-details form')
      .getByRole('button', { name: /^Save changes/ })
      .click();
    await expect(page.locator('#edit-details form')).toContainText('Details saved.');
    await createBracket(page);
    const game = gameOf(page, 'Game 2: Delta v Echo');
    await enterButton(game).click();
    await expect(game.locator('legend')).toHaveText(['Set 1', 'Set 2', 'Set 3']);
    await fillSet(game, '21', '15');
    await fillSet(game, '18', '21', 2);
    await saveButton(game).click();
    await expect(game.locator('[data-slot="field-error"]')).toHaveText('Enter the score of set 3.');
    await expect(scoreInput(game, 'a3')).toBeFocused();
    await screenshot(page, testInfo, 'bracket-result-best-of-3');
    await expectAccessible(page);

    await fillSet(game, '9', '15', 3);
    await saveButton(game).click();
    await expect(savedStatus(game, 'Result saved')).toContainText('Echo advances');
    await expect(game.locator('[data-slot="game-result"]')).toHaveText(
      'Delta 21–15, 18–21, 9–15 Echo. Echo won.',
    );
  });

  test('a result entered earlier is cleared after a reload, which frees the seeds and Recreate, and Undo enters it again', async ({
    page,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(NAMES), registration: 'closed' });
    await page.goto(managePath);
    await createBracket(page);
    const first = gameOf(page, 'Game 2: Delta v Echo');
    await enterSet(first, '21', '15');
    await expect(savedStatus(first, 'Result saved')).toBeVisible();

    await page.reload();
    await expect(first.locator('[data-slot="game-result"]')).toHaveText(
      'Delta 21–15 Echo. Delta won.',
    );
    await expect(correctButton(first)).toBeVisible();
    await expect(clearButton(first)).toHaveAccessibleName('Clear result Delta v Echo');
    await expect(first.getByRole('status')).toHaveCount(0);
    await expect(panel(page).locator('[data-move]')).toHaveCount(0);
    await expectLinkHeights(
      page,
      first.getByRole('button', { name: /^(Correct|Clear) result/ }),
      pointerOf(testInfo),
    );
    await screenshot(page, testInfo, 'bracket-result-clear');
    await expectAccessible(page);

    await clearButton(first).click();
    const cleared = savedStatus(first, 'Result cleared');
    await expect(cleared).toContainText('The game is waiting for a result again.');
    await expect(cleared).toBeFocused();
    await expect(first.locator('[data-slot="game-result"]')).toHaveCount(0);
    await expect(enterButton(first)).toBeVisible();
    await expect(gameLabels(page).nth(4)).toHaveText('Game 1: Alpha v To be decided');
    await expect(panel(page).locator('[data-move]').first()).toBeVisible();
    await expect(createButton(page)).toBeVisible();
    await expectLinkHeights(page, undoButton(cleared), pointerOf(testInfo));
    await screenshot(page, testInfo, 'bracket-result-cleared');
    await expectAccessible(page);

    await undoButton(cleared).click();
    const restored = savedStatus(first, 'Result restored');
    await expect(restored).toContainText('Delta advances to the Semifinals.');
    await expect(restored).toBeFocused();
    await expect(undoButton(restored)).toHaveCount(0);
    await expect(first.locator('[data-slot="game-result"]')).toHaveText(
      'Delta 21–15 Echo. Delta won.',
    );
    await expect(clearButton(first)).toBeVisible();
    await expect(gameLabels(page).nth(4)).toHaveText('Game 1: Alpha v Delta');
    await expect(panel(page).locator('[data-move]')).toHaveCount(0);
    await expect(reason(page)).toHaveText(
      'A result is entered, so the bracket cannot be recreated.',
    );
    await screenshot(page, testInfo, 'bracket-result-restored');
    await expectAccessible(page);
  });

  test('offline, Clear result looks disabled, a press shows the offline alert, and the result stays', async ({
    page,
    context,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(NAMES), registration: 'closed' });
    await page.goto(managePath);
    await createBracket(page);
    const game = gameOf(page, 'Game 2: Delta v Echo');
    await enterSet(game, '21', '15');
    await expect(savedStatus(game, 'Result saved')).toBeVisible();
    await page.reload();
    await expect(clearButton(game)).toBeVisible();
    await context.setOffline(true);
    try {
      await expect(clearButton(game)).toHaveAttribute('aria-disabled', 'true', { timeout: 5_000 });
      // `force`: Playwright treats aria-disabled as not actionable, and the page must still answer.
      await clearButton(game).click({ force: true });
      const alert = game.getByRole('alert');
      await expect(alert).toContainText(
        'The result is unchanged. Try again when you’re connected.',
      );
      await expect(alert).toBeFocused();
      await expect(game.locator('[data-slot="game-result"]')).toHaveText(
        'Delta 21–15 Echo. Delta won.',
      );
      await screenshot(page, testInfo, 'bracket-result-clear-offline');
      await expectAccessible(page);
    } finally {
      await context.setOffline(false);
    }
    await expect(clearButton(game)).not.toHaveAttribute('aria-disabled', /.*/, { timeout: 20_000 });
    await clearButton(game).click();
    await expect(savedStatus(game, 'Result cleared')).toBeVisible();
  });

  test('with a stored result, its Clear result and Undo states do not scroll sideways at 320px', async ({
    page,
  }) => {
    const { managePath } = await adminOf(page, { teams: full(NAMES), registration: 'closed' });
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(managePath);
    await createBracket(page);
    const game = gameOf(page, 'Game 2: Delta v Echo');
    await enterSet(game, '21', '15');
    await expect(savedStatus(game, 'Result saved')).toBeVisible();
    await expectNoSidewaysScroll(page);

    await page.reload();
    await expect(clearButton(game)).toBeVisible();
    await expectNoSidewaysScroll(page);

    await clearButton(game).click();
    const cleared = savedStatus(game, 'Result cleared');
    await expect(undoButton(cleared)).toBeVisible();
    await expectNoSidewaysScroll(page);

    await undoButton(cleared).click();
    await expect(savedStatus(game, 'Result restored')).toBeVisible();
    await expectNoSidewaysScroll(page);
  });

  test('offline, Save looks disabled, a press shows the offline alert, and the scores stay', async ({
    page,
    context,
  }, testInfo) => {
    const { managePath } = await adminOf(page, { teams: full(NAMES), registration: 'closed' });
    await page.goto(managePath);
    await createBracket(page);
    const game = gameOf(page, 'Game 2: Delta v Echo');
    await enterButton(game).click();
    await fillSet(game, '21', '15');
    await context.setOffline(true);
    try {
      await expect(saveButton(game)).toHaveAttribute('aria-disabled', 'true', { timeout: 5_000 });
      // `force`: Playwright treats aria-disabled as not actionable, and the page must still answer.
      await saveButton(game).click({ force: true });
      const alert = game.getByRole('alert');
      await expect(alert).toContainText('Your scores are still here.');
      await expect(alert).toBeFocused();
      await expect(scoreInput(game, 'a1')).toHaveValue('21');
      await screenshot(page, testInfo, 'bracket-result-offline');
      await expectAccessible(page);
    } finally {
      await context.setOffline(false);
    }
    await expect(saveButton(game)).not.toHaveAttribute('aria-disabled', /.*/, { timeout: 20_000 });
    await saveButton(game).click();
    await expect(savedStatus(game, 'Result saved')).toBeVisible();
  });
});

async function withSecondOrganizer(
  browser: Browser,
  page: Page,
  { tenant }: { tenant: Tenant },
  use: (otherPage: Page) => Promise<void>,
) {
  const other = await browser.newContext({ baseURL, viewport: page.viewportSize() });
  try {
    const otherPage = await other.newPage();
    const second = newUser('Second');
    await signUp(otherPage, second);
    await convexRun('testing:addMembership', {
      organizationSlug: tenant.slug,
      email: second.email,
      role: 'orgAdmin',
    });
    await use(otherPage);
  } finally {
    await other.close();
  }
}

async function correctOnOtherPage(otherPage: Page, managePath: string) {
  await otherPage.goto(managePath);
  const theirs = gameOf(otherPage, 'Game 2: Delta v Echo');
  await correctButton(theirs).click();
  await fillSet(theirs, '12', '21');
  await saveButton(theirs).click();
  await expect(savedStatus(theirs, 'Result corrected')).toBeVisible();
}

test.describe('Tournaments: bracket results shared between organizers and the public', () => {
  test('a set of 21–20 is saved, because a set needs only a winner', async ({ page }) => {
    const { managePath } = await adminOf(page, { teams: full(NAMES), registration: 'closed' });
    await page.goto(managePath);
    await createBracket(page);
    const game = gameOf(page, 'Game 2: Delta v Echo');
    await enterSet(game, '21', '20');
    await expect(savedStatus(game, 'Result saved')).toContainText('Delta advances');
    await expect(game.locator('[data-slot="game-result"]')).toHaveText(
      'Delta 21–20 Echo. Delta won.',
    );
  });

  test('Undo goes with no press when another organizer corrects the result, and the game shows the correction', async ({
    page,
    browser,
  }, testInfo) => {
    const seeded = await adminOf(page, { teams: full(NAMES), registration: 'closed' });
    await withSecondOrganizer(browser, page, seeded, async (otherPage) => {
      await page.goto(seeded.managePath);
      await createBracket(page);
      const game = gameOf(page, 'Game 2: Delta v Echo');
      await enterSet(game, '21', '15');
      await expect(undoButton(savedStatus(game, 'Result saved'))).toBeVisible();

      await correctOnOtherPage(otherPage, seeded.managePath);
      await expect(game.locator('[data-slot="game-result"]')).toHaveText(
        'Delta 12–21 Echo. Echo won.',
      );
      await expect(undoButton(game)).toHaveCount(0);
      await expect(clearButton(game)).toBeVisible();
      await expect(gameLabels(page).nth(4)).toHaveText('Game 1: Alpha v Echo');
      await screenshot(page, testInfo, 'bracket-result-undo-gone');
      await expectAccessible(page);
    });
  });

  test('Undo on Result cleared goes with no press when another organizer corrects a game that feeds it', async ({
    page,
    browser,
  }, testInfo) => {
    const seeded = await adminOf(page, { teams: full(NAMES), registration: 'closed' });
    await withSecondOrganizer(browser, page, seeded, async (otherPage) => {
      await page.goto(seeded.managePath);
      await createBracket(page);
      await enterSet(gameOf(page, 'Game 2: Delta v Echo'), '21', '15');
      const semifinal = gameOf(page, 'Game 1: Alpha v Delta');
      await enterSet(semifinal, '21', '10');
      await expect(savedStatus(semifinal, 'Result saved')).toBeVisible();
      await clearButton(semifinal).click();
      await expect(undoButton(savedStatus(semifinal, 'Result cleared'))).toBeVisible();

      await correctOnOtherPage(otherPage, seeded.managePath);
      await expect(gameLabels(page).nth(4)).toHaveText('Game 1: Alpha v Echo');
      const changed = gameOf(page, 'Game 1: Alpha v Echo');
      await expect(enterButton(changed)).toBeVisible();
      await expect(undoButton(changed)).toHaveCount(0);
      await screenshot(page, testInfo, 'bracket-result-cleared-undo-gone');
      await expectAccessible(page);
    });
  });

  test('the public bracket marks each winner and names the tournament winner as results are entered', async ({
    page,
    browser,
  }, testInfo) => {
    const { tenant, managePath } = await adminOf(page, {
      teams: full(NAMES),
      registration: 'closed',
    });
    const publicContext = await browser.newContext({ baseURL, viewport: page.viewportSize() });
    try {
      const visitor = await publicContext.newPage();
      const publicPath = `${tenant.path}/tournaments/${SLUG}`;
      const publicGames = visitor.getByTestId('bracket-game');
      await page.goto(managePath);
      await createBracket(page);
      await visitor.goto(publicPath);
      await expect(publicGames).toHaveCount(7);
      await expect(visitor.getByTestId('bracket-winner')).toHaveCount(0);

      await enterSet(gameOf(page, 'Game 2: Delta v Echo'), '21', '15');
      await expect(savedStatus(gameOf(page, 'Game 2: Delta v Echo'), 'Result saved')).toBeVisible();
      await visitor.reload();
      await expect(publicGames.nth(1)).toContainText('Delta');
      await expect(publicGames.nth(1).getByText('Won', { exact: true })).toHaveCount(1);
      await expect(publicGames.nth(1).getByTestId('bracket-team').first()).toContainText('Won');
      await expect(publicGames.nth(4)).toContainText('Alpha');
      await expect(publicGames.nth(4)).toContainText('Delta');

      await enterSet(gameOf(page, 'Game 1: Alpha v Delta'), '21', '10');
      await enterSet(gameOf(page, 'Game 2: Bravo v Charlie'), '21', '19');
      await enterSet(gameOf(page, 'Game 1: Alpha v Bravo'), '21', '20');
      await expect(page.locator('[data-slot="winner"]')).toHaveText('Winner: Alpha');
      await visitor.reload();
      await expect(visitor.getByTestId('bracket-winner')).toHaveText('Winner: Alpha');
      await screenshot(visitor, testInfo, 'public-bracket-winner');
      await expectAccessible(visitor);
    } finally {
      await publicContext.close();
    }
  });
});

test.describe('Tournaments: an Undo the server refuses after another organizer changed the result', () => {
  test.use({ expectedConvexErrors: ['tournamentGames:undoResult'] });

  test('Undo is refused once, then the status goes and the game shows the correction with Clear result', async ({
    page,
    browser,
  }, testInfo) => {
    const seeded = await adminOf(page, { teams: full(NAMES), registration: 'closed' });
    // The first page keeps showing Undo until its updates are released, which is the only way to press it after the correction.
    const held = await holdQueries(page, ['tournamentGames:getSetup'], { holdFromStart: false });
    await withSecondOrganizer(browser, page, seeded, async (otherPage) => {
      await page.goto(seeded.managePath);
      await createBracket(page);
      const game = gameOf(page, 'Game 2: Delta v Echo');
      await enterSet(game, '21', '15');
      const saved = savedStatus(game, 'Result saved');
      await expect(undoButton(saved)).toBeVisible();
      held.holdNextAnswer();

      await correctOnOtherPage(otherPage, seeded.managePath);
      await expect.poll(() => held.isHolding()).toBe(true);
      await expect(undoButton(saved)).toBeVisible();
      await undoButton(saved).click();
      const note = game.locator('[data-slot="undo-note"]');
      await expect(note).toContainText(
        'The result could not be undone. Someone else changed this result first. The game shows their result now.',
      );
      await expect(note.getByRole('alert')).toBeFocused();
      await expect(saved).toHaveCount(0);
      await expect(undoButton(game)).toHaveCount(0);

      held.release();
      await expect(game.locator('[data-slot="game-result"]')).toHaveText(
        'Delta 12–21 Echo. Echo won.',
      );
      await expect(gameLabels(page).nth(4)).toHaveText('Game 1: Alpha v Echo');
      await expect(note.getByRole('alert')).toBeFocused();
      await expect(undoButton(game)).toHaveCount(0);
      await expect(clearButton(game)).toBeVisible();
      // The axe helper's tab walk moves focus, so it runs after the focus checks.
      await screenshot(page, testInfo, 'bracket-result-undo-refused');
      await expectAccessible(page);
      await otherPage.reload();
      await expect(
        gameOf(otherPage, 'Game 2: Delta v Echo').locator('[data-slot="game-result"]'),
      ).toHaveText('Delta 12–21 Echo. Echo won.');

      await clearButton(game).click();
      await expect(savedStatus(game, 'Result cleared')).toBeFocused();
    });
  });
});

const reportPanel = (page: Page) => page.getByTestId('score-report');
const reportBox = (page: Page, team: string) =>
  reportPanel(page).getByRole('textbox', { name: team, exact: true });
const reportButton = (page: Page) =>
  reportPanel(page).getByRole('button', { name: 'Report score' });
const reportedLines = (game: Locator) => game.locator('[data-slot="report"] > span:first-child');
const confirmButtons = (game: Locator) => game.getByRole('button', { name: /^Confirm/ });
const correctScoreButton = (game: Locator) => game.getByRole('button', { name: /^Correct score/ });

interface ReportWorld {
  tenant: Tenant;
  managePath: string;
  crabs: Page;
  squad: Page;
  teamPath: (name: string) => string;
}

/**
 * Four teams, so the first semifinal is Sand Crabs v Spike Squad, each of those two with a captain who has signed in on a page of their own.
 */
async function withReportWorld(
  page: Page,
  browser: Browser,
  { bracket = true }: { bracket?: boolean },
  use: (world: ReportWorld) => Promise<void>,
) {
  const seeded = await adminOf(page, { teams: [], registration: 'closed' });
  const contexts = await Promise.all(
    [0, 1].map(() => browser.newContext({ baseURL, viewport: page.viewportSize() })),
  );
  try {
    const [crabs, squad] = await Promise.all(contexts.map((context) => context.newPage()));
    const captains = [newUser('Crabs'), newUser('Squad')];
    await signUp(crabs, captains[0]);
    await signUp(squad, captains[1]);
    const names = ['Sand Crabs', 'Beach Bombers', 'Set Point', 'Spike Squad'];
    const { teamIds } = (await convexRun('testing:seedTournamentRosters', {
      organizationSlug: seeded.tenant.slug,
      tournamentSlug: SLUG,
      teams: names.map((name) => ({
        name,
        ...(name === 'Sand Crabs' && { captainEmail: captains[0].email }),
        ...(name === 'Spike Squad' && { captainEmail: captains[1].email }),
      })),
    })) as { teamIds: string[] };
    if (bracket) {
      await convexRun('testing:seedTournamentBracket', {
        organizationSlug: seeded.tenant.slug,
        tournamentSlug: SLUG,
      });
    }
    await use({
      ...seeded,
      crabs,
      squad,
      teamPath: (name) => `/app/teams/${teamIds[names.indexOf(name)]}`,
    });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
}

const FIRST_SEMIFINAL = 'Game 1: Sand Crabs v Spike Squad';

test.describe('Tournaments: score reports', () => {
  test('a captain reports 21–18, the organizer sees it as reported while the public bracket has no winner, and Confirm advances the winner', async ({
    page,
    browser,
  }, testInfo) => {
    await withReportWorld(page, browser, {}, async (world) => {
      const { crabs, tenant, managePath } = world;
      await crabs.goto(world.teamPath('Sand Crabs'));
      await expect(reportPanel(crabs).locator('[data-slot="game-label"]')).toHaveText(
        'Semifinals: Sand Crabs v Spike Squad',
      );
      await expect(reportBox(crabs, 'Sand Crabs')).toBeVisible();
      await screenshot(crabs, testInfo, 'score-report-form');
      await expectAccessible(crabs);

      await reportBox(crabs, 'Sand Crabs').fill('21');
      await reportBox(crabs, 'Spike Squad').fill('18');
      await reportButton(crabs).click();
      const status = reportPanel(crabs).getByRole('status').filter({ hasText: 'Score reported' });
      await expect(status).toBeFocused();
      await expect(reportPanel(crabs).locator('[data-slot="reported"]')).toHaveText(
        'Your report: Sand Crabs 21–18 Spike Squad.',
      );
      await screenshot(crabs, testInfo, 'score-report-reported');
      await expectAccessible(crabs);

      await page.goto(managePath);
      const game = gameOf(page, FIRST_SEMIFINAL);
      await expect(game.locator('[data-slot="badge"]')).toHaveText('Reported');
      await expect(reportedLines(game)).toHaveText([
        'Sand Crabs reported Sand Crabs 21–18 Spike Squad.',
      ]);
      await expect(enterButton(game)).toHaveCount(0);
      await expect(game.locator('[data-slot="game-result"]')).toHaveCount(0);
      await screenshot(page, testInfo, 'score-report-organizer-reported');
      await expectAccessible(page);

      const publicContext = await browser.newContext({ baseURL, viewport: page.viewportSize() });
      try {
        const visitor = await publicContext.newPage();
        await visitor.goto(`${tenant.path}/tournaments/${SLUG}`);
        await expect(visitor.getByTestId('bracket-game')).toHaveCount(3);
        await expect(visitor.getByText('Won', { exact: true })).toHaveCount(0);
        await expect(visitor.getByTestId('bracket-winner')).toHaveCount(0);

        await confirmButtons(game).click();
        const confirmed = savedStatus(game, 'Report confirmed');
        await expect(confirmed).toContainText('Sand Crabs advances to the Final.');
        await expect(confirmed).toBeFocused();
        await expect(game.locator('[data-slot="game-result"]')).toHaveText(
          'Sand Crabs 21–18 Spike Squad. Sand Crabs won.',
        );
        await expect(gameLabels(page).nth(2)).toHaveText('Game 1: Sand Crabs v To be decided');
        await screenshot(page, testInfo, 'score-report-organizer-confirmed');

        await visitor.reload();
        await expect(
          visitor.getByTestId('bracket-game').nth(0).getByText('Won', { exact: true }),
        ).toHaveCount(1);
      } finally {
        await publicContext.close();
      }

      await crabs.reload();
      await expect(reportPanel(crabs).locator('[data-slot="empty"]')).toContainText(
        'No game to report right now.',
      );
    });
  });

  test('two reports that differ show both, and Confirm on one of them settles the game', async ({
    page,
    browser,
  }, testInfo) => {
    await withReportWorld(page, browser, {}, async (world) => {
      const { crabs, squad, managePath } = world;
      await crabs.goto(world.teamPath('Sand Crabs'));
      await reportBox(crabs, 'Sand Crabs').fill('21');
      await reportBox(crabs, 'Spike Squad').fill('18');
      await reportButton(crabs).click();
      await expect(reportPanel(crabs).locator('[data-slot="reported"]')).toBeVisible();

      await squad.goto(world.teamPath('Spike Squad'));
      await reportBox(squad, 'Sand Crabs').fill('19');
      await reportBox(squad, 'Spike Squad').fill('21');
      await reportButton(squad).click();
      await expect(reportPanel(squad).locator('[data-slot="reported"]')).toHaveText(
        'Your report: Sand Crabs 19–21 Spike Squad.',
      );

      await page.goto(managePath);
      const game = gameOf(page, FIRST_SEMIFINAL);
      await expect(reportedLines(game)).toHaveText([
        'Sand Crabs reported Sand Crabs 21–18 Spike Squad.',
        'Spike Squad reported Sand Crabs 19–21 Spike Squad.',
      ]);
      await expect(game).toContainText('The two teams reported different scores.');
      await expect(confirmButtons(game)).toHaveCount(2);
      await screenshot(page, testInfo, 'score-report-organizer-differing');
      await expectAccessible(page);

      await confirmButtons(game).nth(1).click();
      await expect(savedStatus(game, 'Report confirmed')).toContainText(
        'Spike Squad advances to the Final.',
      );
      await expect(game.locator('[data-slot="game-result"]')).toHaveText(
        'Sand Crabs 19–21 Spike Squad. Spike Squad won.',
      );
    });
  });

  test('Correct score opens the form with the reported score, and the organizer’s own score becomes the result', async ({
    page,
    browser,
  }) => {
    await withReportWorld(page, browser, {}, async (world) => {
      const { crabs, managePath } = world;
      await crabs.goto(world.teamPath('Sand Crabs'));
      await reportBox(crabs, 'Sand Crabs').fill('21');
      await reportBox(crabs, 'Spike Squad').fill('18');
      await reportButton(crabs).click();
      await expect(reportPanel(crabs).locator('[data-slot="reported"]')).toBeVisible();

      await page.goto(managePath);
      const game = gameOf(page, FIRST_SEMIFINAL);
      await correctScoreButton(game).click();
      await expect(scoreInput(game, 'a1')).toHaveValue('21');
      await expect(scoreInput(game, 'b1')).toHaveValue('18');
      await fillSet(game, '21', '12');
      await saveButton(game).click();
      await expect(savedStatus(game, 'Result saved')).toContainText('Sand Crabs advances');
      await expect(game.locator('[data-slot="game-result"]')).toHaveText(
        'Sand Crabs 21–12 Spike Squad. Sand Crabs won.',
      );
    });
  });

  test('a captain changes the report until the organizer confirms, and the organizer sees the latest one', async ({
    page,
    browser,
  }) => {
    await withReportWorld(page, browser, {}, async (world) => {
      const { crabs, managePath } = world;
      await crabs.goto(world.teamPath('Sand Crabs'));
      await reportBox(crabs, 'Sand Crabs').fill('21');
      await reportBox(crabs, 'Spike Squad').fill('18');
      await reportButton(crabs).click();
      await crabs.getByRole('button', { name: 'Change score' }).click();
      await expect(reportBox(crabs, 'Sand Crabs')).toBeFocused();
      await expect(reportBox(crabs, 'Sand Crabs')).toHaveValue('21');
      await reportBox(crabs, 'Spike Squad').fill('10');
      await reportButton(crabs).click();
      await expect(reportPanel(crabs).locator('[data-slot="reported"]')).toHaveText(
        'Your report: Sand Crabs 21–10 Spike Squad.',
      );

      await page.goto(managePath);
      await expect(reportedLines(gameOf(page, FIRST_SEMIFINAL))).toHaveText([
        'Sand Crabs reported Sand Crabs 21–10 Spike Squad.',
      ]);
    });
  });

  test('a team with no bracket yet shows the empty state, and its states do not scroll sideways at 320px', async ({
    page,
    browser,
  }, testInfo) => {
    await withReportWorld(page, browser, { bracket: false }, async (world) => {
      const { crabs } = world;
      await crabs.setViewportSize({ width: 320, height: 640 });
      await crabs.goto(world.teamPath('Sand Crabs'));
      await expect(reportPanel(crabs).locator('[data-slot="empty"]')).toContainText(
        'No game to report right now.',
      );
      await expectNoSidewaysScroll(crabs);
      await screenshot(crabs, testInfo, 'score-report-empty');
      await expectAccessible(crabs);
    });
  });

  test('the form, the report, and the organizer’s Reported states do not scroll sideways at 320px', async ({
    page,
    browser,
  }) => {
    await withReportWorld(page, browser, {}, async (world) => {
      const { crabs, squad, managePath } = world;
      await crabs.setViewportSize({ width: 320, height: 640 });
      await crabs.goto(world.teamPath('Sand Crabs'));
      await expect(reportBox(crabs, 'Sand Crabs')).toBeVisible();
      await expectNoSidewaysScroll(crabs);
      await reportBox(crabs, 'Sand Crabs').fill('21');
      await reportBox(crabs, 'Spike Squad').fill('18');
      await reportButton(crabs).click();
      await expect(reportPanel(crabs).locator('[data-slot="reported"]')).toBeVisible();
      await expectNoSidewaysScroll(crabs);

      await squad.goto(world.teamPath('Spike Squad'));
      await reportBox(squad, 'Sand Crabs').fill('19');
      await reportBox(squad, 'Spike Squad').fill('21');
      await reportButton(squad).click();
      await expect(reportPanel(squad).locator('[data-slot="reported"]')).toBeVisible();

      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto(managePath);
      await expect(confirmButtons(gameOf(page, FIRST_SEMIFINAL))).toHaveCount(2);
      await expectNoSidewaysScroll(page);
    });
  });

  test('a tied score shows its error under the set, keeps the scores, and sends nothing', async ({
    page,
    browser,
  }, testInfo) => {
    await withReportWorld(page, browser, {}, async (world) => {
      const { crabs } = world;
      await crabs.goto(world.teamPath('Sand Crabs'));
      await reportBox(crabs, 'Sand Crabs').fill('21');
      await reportBox(crabs, 'Spike Squad').fill('21');
      await reportButton(crabs).focus();
      await expect(reportPanel(crabs).locator('[data-slot="field-error"]')).toHaveText(
        'Set 1 is tied. A set needs a winner.',
      );
      await reportButton(crabs).click();
      await expect(reportBox(crabs, 'Sand Crabs')).toBeFocused();
      await expect(reportBox(crabs, 'Spike Squad')).toHaveValue('21');
      await expect(reportPanel(crabs).locator('[data-slot="reported"]')).toHaveCount(0);
      await screenshot(crabs, testInfo, 'score-report-tied');
      await expectAccessible(crabs);
    });
  });

  test('offline, Report score looks disabled, a press shows the offline alert, and the scores stay', async ({
    page,
    browser,
  }) => {
    await withReportWorld(page, browser, {}, async (world) => {
      const { crabs } = world;
      await crabs.goto(world.teamPath('Sand Crabs'));
      await reportBox(crabs, 'Sand Crabs').fill('21');
      await reportBox(crabs, 'Spike Squad').fill('18');
      await crabs.context().setOffline(true);
      try {
        await expect(reportButton(crabs)).toHaveAttribute('aria-disabled', 'true', {
          timeout: 5_000,
        });
        // `force`: Playwright treats aria-disabled as not actionable, and the page must still answer.
        await reportButton(crabs).click({ force: true });
        const alert = reportPanel(crabs).getByRole('alert');
        await expect(alert).toContainText('Your scores are still here.');
        await expect(alert).toBeFocused();
        await expect(reportBox(crabs, 'Sand Crabs')).toHaveValue('21');
      } finally {
        await crabs.context().setOffline(false);
      }
      await expect(reportButton(crabs)).not.toHaveAttribute('aria-disabled', /.*/, {
        timeout: 20_000,
      });
      await reportButton(crabs).click();
      await expect(reportPanel(crabs).locator('[data-slot="reported"]')).toBeVisible();
    });
  });
});

test.describe('Tournaments: a confirmed report, then Clear and Undo', () => {
  test('Clear result returns the game to Reported with its Confirm, and Undo enters the score again', async ({
    page,
    browser,
  }) => {
    await withReportWorld(page, browser, {}, async (world) => {
      const { crabs, managePath } = world;
      await crabs.goto(world.teamPath('Sand Crabs'));
      await reportBox(crabs, 'Sand Crabs').fill('21');
      await reportBox(crabs, 'Spike Squad').fill('18');
      await reportButton(crabs).click();
      await expect(reportPanel(crabs).locator('[data-slot="reported"]')).toBeVisible();

      await page.goto(managePath);
      await confirmButtons(gameOf(page, FIRST_SEMIFINAL)).click();
      await page.reload();
      const game = gameOf(page, FIRST_SEMIFINAL);
      await expect(game.locator('[data-slot="game-result"]')).toHaveText(
        'Sand Crabs 21–18 Spike Squad. Sand Crabs won.',
      );
      await expect(game.locator('[data-slot="report"]')).toHaveCount(0);

      await clearButton(game).click();
      const cleared = savedStatus(game, 'Result cleared');
      await expect(cleared).toBeFocused();
      await expect(game.locator('[data-slot="badge"]')).toHaveText('Reported');
      await expect(reportedLines(game)).toHaveText([
        'Sand Crabs reported Sand Crabs 21–18 Spike Squad.',
      ]);
      await expect(confirmButtons(game)).toHaveCount(1);
      await expect(gameLabels(page).nth(2)).toHaveText('Game 1: To be decided v To be decided');

      await undoButton(cleared).click();
      await expect(savedStatus(game, 'Result restored')).toContainText(
        'Sand Crabs advances to the Final.',
      );
      await expect(game.locator('[data-slot="game-result"]')).toHaveText(
        'Sand Crabs 21–18 Spike Squad. Sand Crabs won.',
      );
      await expect(gameLabels(page).nth(2)).toHaveText('Game 1: Sand Crabs v To be decided');
    });
  });
});

test.describe('Tournaments: Confirm of a report the team changed', () => {
  test.use({ expectedConvexErrors: ['scoreReports:confirm'] });

  test('is refused in the server’s words, nothing is confirmed, and the game then shows the new report', async ({
    page,
    browser,
  }) => {
    await withReportWorld(page, browser, {}, async (world) => {
      const { crabs, managePath } = world;
      await crabs.goto(world.teamPath('Sand Crabs'));
      await reportBox(crabs, 'Sand Crabs').fill('21');
      await reportBox(crabs, 'Spike Squad').fill('18');
      await reportButton(crabs).click();
      await expect(reportPanel(crabs).locator('[data-slot="reported"]')).toBeVisible();

      // The organizer's page keeps the first report until its updates are released, which is the only way to press Confirm after the change.
      const held = await holdQueries(page, ['tournamentGames:getSetup'], { holdFromStart: false });
      await page.goto(managePath);
      const game = gameOf(page, FIRST_SEMIFINAL);
      await expect(reportedLines(game)).toHaveText([
        'Sand Crabs reported Sand Crabs 21–18 Spike Squad.',
      ]);
      held.holdNextAnswer();

      await crabs.getByRole('button', { name: 'Change score' }).click();
      await reportBox(crabs, 'Spike Squad').fill('10');
      await reportButton(crabs).click();
      await expect(reportPanel(crabs).locator('[data-slot="reported"]')).toHaveText(
        'Your report: Sand Crabs 21–10 Spike Squad.',
      );
      await expect.poll(() => held.isHolding()).toBe(true);

      await confirmButtons(game).click();
      const note = game.locator('[data-slot="undo-note"]');
      await expect(note).toContainText(
        'The report could not be confirmed. The team reported a different score first. The game shows it now.',
      );
      await expect(game.locator('[data-slot="game-result"]')).toHaveCount(0);

      held.release();
      await expect(reportedLines(game)).toHaveText([
        'Sand Crabs reported Sand Crabs 21–10 Spike Squad.',
      ]);
      await expect(game.locator('[data-slot="game-result"]')).toHaveCount(0);
      await expect(gameLabels(page).nth(2)).toHaveText('Game 1: To be decided v To be decided');
    });
  });
});
