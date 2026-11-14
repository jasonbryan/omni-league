import type { Page } from '@playwright/test';
import { axeScan, describeViolations, expectAccessible } from './support/a11y';
import { chipLabel, chooseChip } from './support/chip';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { seedPoolsStructure } from './support/pools';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { dateFromToday, seedTenant, type Tenant } from './support/tenant';
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
  }: {
    teams: readonly { name: string; players?: number }[];
    registration?: 'open' | 'closed';
    structure?: 'bracket' | 'pools';
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

  test.describe('a move the limits refuse', () => {
    test.use({ expectedConvexErrors: ['tournamentGames:movePoolTeam'] });

    test('a team cannot leave a pool of 3, and the message names the limits under the panel heading', async ({
      page,
    }, testInfo) => {
      const { managePath } = await adminOf(page, { teams: full(SIX) });
      await page.goto(managePath);
      await split(page, 2);
      await expect(teamsIn(page, 'A')).toHaveText(['Ace', 'Dune', 'Eddy']);

      await moveTo(page, 'Ace', 'B').focus();
      await page.keyboard.press('Space');
      const alert = panel(page).getByRole('alert');
      await expect(alert).toContainText('Ace could not be moved.');
      await expect(alert).toContainText('Pool A would have 2 teams. Each pool needs 3 to 8 teams.');
      await expect(alert).toBeFocused();
      await expect(teamsIn(page, 'A')).toHaveText(['Ace', 'Dune', 'Eddy']);
      await screenshot(page, testInfo, 'pools-move-refused');
      await expectAccessible(page);
    });
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
    await expect(gamesIn(page, 'A').first()).toHaveText('Round 1: Ace v Haze');
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
    const { managePath } = await adminOf(page, { teams: full(SIX) });
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
      await expect(teamsIn(page, 'A')).toHaveText(['Ace', 'Dune', 'Eddy']);
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
