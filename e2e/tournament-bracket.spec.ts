import type { Page } from '@playwright/test';
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
    await expect(rounds(page).locator('li')).toHaveText([
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
    await expect(rounds(page).locator('li').nth(1)).toHaveText('Game 2: Delta v Echo');

    await createButton(page).click();
    await dialog.getByRole('button', { name: 'Recreate bracket' }).click();
    await expect(
      panel(page).getByRole('status').filter({ hasText: 'Bracket recreated' }),
    ).toBeVisible();
    await expect(rounds(page).locator('li').nth(1)).toHaveText('Game 2: Echo v Delta');
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
});
