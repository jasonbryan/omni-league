import type { Locator, Page } from '@playwright/test';
import { axeScan, describeViolations, expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
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
