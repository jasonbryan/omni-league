import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { convexRun } from './support/convex';
import { expect, test } from './support/fixtures';
import { otherUser, signUp } from './support/session';
import { screenshot } from './support/screenshot';
import { dateFromToday, seedSeasons, seedTenant, type Tenant } from './support/tenant';
import { newUser, type TestUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LEAGUE = 'Sunday Reverse Coed 4s';
const LEAGUE_SLUG = 'sunday-reverse-coed-4s';
const OPEN = 'summer-open';
const OTHER_OPEN = 'fall-open';
const CLOSED = 'closed-season';
const DRAFT = 'draft-season';

async function seed(): Promise<Tenant> {
  const tenant = await seedTenant({
    name: 'E2E Teams',
    locations: [{ name: 'Alpha Beach', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
    leagues: [
      {
        name: LEAGUE,
        sport: 'beachVolleyball',
        locations: ['Alpha Beach'],
        division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
      },
    ],
  });
  await seedSeasons(tenant, LEAGUE_SLUG, [
    {
      name: 'Summer Open',
      slug: OPEN,
      startDate: dateFromToday(40),
      endDate: dateFromToday(100),
      registrationDeadline: dateFromToday(20),
    },
    {
      name: 'Fall Open',
      slug: OTHER_OPEN,
      startDate: dateFromToday(140),
      endDate: dateFromToday(200),
      registrationDeadline: dateFromToday(120),
    },
    {
      name: 'Closed Season',
      slug: CLOSED,
      startDate: dateFromToday(10),
      endDate: dateFromToday(70),
      registrationDeadline: dateFromToday(-5),
    },
    {
      name: 'Draft Season',
      slug: DRAFT,
      startDate: dateFromToday(40),
      endDate: dateFromToday(100),
      registrationDeadline: dateFromToday(20),
      status: 'draft',
    },
  ]);
  return tenant;
}

const registerPath = (tenant: Tenant, season: string, league = LEAGUE_SLUG) =>
  `/app/register/${tenant.slug}/${league}/${season}/team`;

async function seedTeam(tenant: Tenant, season: string, name: string, captain: TestUser) {
  return (await convexRun('testing:seedTeam', {
    organizationSlug: tenant.slug,
    leagueSlug: LEAGUE_SLUG,
    seasonSlug: season,
    name,
    captainEmail: captain.email,
  })) as { teamId: string };
}

const teamName = (page: Page) => page.locator('#team-name');
const registerButton = (page: Page) => page.getByRole('button', { name: 'Register team' });

async function openForm(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(teamName(page)).toBeVisible();
}

test.describe('register a team', () => {
  test('signed out: Register a team on the season page, sign up, submit, and land on the team page', async ({
    page,
  }, testInfo) => {
    const tenant = await seed();
    const path = registerPath(tenant, OPEN);
    await page.goto(`${tenant.path}/leagues/${LEAGUE_SLUG}/seasons/${OPEN}`);
    await screenshot(page, testInfo, '129-season-open');
    await page.locator('#registration').getByRole('link', { name: 'Register a team' }).click();
    await expect(page).toHaveURL(/\/sign-in\?/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(path);

    await page.getByRole('main').getByRole('link', { name: 'Create an account' }).click();
    const user = newUser('Captain');
    await page.locator('#name').fill(user.name);
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.getByRole('checkbox', { name: 'I am 18 or older' }).click();
    await page.getByRole('button', { name: /Create account/ }).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, { timeout: 20_000 });

    await expect(
      page.getByRole('heading', { level: 1, name: `${LEAGUE}, Summer Open` }),
    ).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '129-register-form');

    await registerButton(page).click();
    await expect(page.locator('#team-name-error')).toHaveText('Enter a team name.');
    await expect(teamName(page)).toBeFocused();
    await screenshot(page, testInfo, '129-register-empty');

    await teamName(page).fill('Sand Sharks');
    await registerButton(page).click();
    await expect(page).toHaveURL(new RegExp(`^${baseURL}/app/teams/[^/]+$`), { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Sand Sharks' })).toBeVisible();
    const main = page.locator('main');
    await expect(main.getByTestId('roster-count')).toHaveText('1 of 4 players');
    await expect(main.getByTestId('roster-note')).toContainText('3 more needed');
    await expect(main.locator('section ul > li')).toHaveCount(1);
    await expect(main.locator('section ul > li')).toContainText(user.name);
    await expect(main.locator('section ul > li')).toContainText('Captain');
    await expect(main.getByRole('status').filter({ hasText: 'is registered for' })).toBeFocused();
    await expectAccessible(page);
    await screenshot(page, testInfo, '129-team-registered');
  });

  test('closed: the register route shows the deadline and no form', async ({ page }, testInfo) => {
    const tenant = await seed();
    await signUp(page, newUser('Late'));
    await page.goto(registerPath(tenant, CLOSED));
    const card = page.locator('main [data-slot="alert"]');
    await expect(card).toContainText('Registration for this season is closed.');
    await expect(card).toContainText(`It closed on`);
    await expect(teamName(page)).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '129-register-closed');
  });

  test('already on a team: says so with a link and no form, also after the deadline', async ({
    page,
  }, testInfo) => {
    const tenant = await seed();
    const captain = newUser('OnTeam');
    await signUp(page, captain);
    const { teamId } = await seedTeam(tenant, OPEN, 'Team A', captain);
    await seedTeam(tenant, CLOSED, 'Team B', captain);

    for (const [season, team, id] of [
      [OPEN, 'Team A', teamId],
      [CLOSED, 'Team B', undefined],
    ] as const) {
      await page.goto(registerPath(tenant, season));
      await expect(page.locator('main [data-slot="alert"]')).toContainText(
        `You’re on ${team} in this season.`,
      );
      await expect(teamName(page)).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText(
        'Registration for this season is closed.',
      );
      const link = page.getByRole('link', { name: `Go to ${team}` });
      if (id !== undefined) await expect(link).toHaveAttribute('href', `/app/teams/${id}`);
      else await expect(link).toHaveAttribute('href', /^\/app\/teams\/[^/]+$/);
    }
    await page.goto(registerPath(tenant, OPEN));
    await expect(page.getByRole('link', { name: 'Go to Team A' })).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '129-register-on-team');
  });

  test('not found: an unknown slug, a draft season, and another league’s path show the not-found view and no form', async ({
    page,
  }, testInfo) => {
    const tenant = await seed();
    for (const path of [
      registerPath(tenant, 'no-such-season'),
      registerPath(tenant, DRAFT),
      registerPath(tenant, OPEN, 'no-such-league'),
      `/app/register/no-such-org/${LEAGUE_SLUG}/${OPEN}/team`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
      await expect(teamName(page)).toHaveCount(0);
      await expect(page).toHaveURL(`${baseURL}${path}`);
    }
    await expectAccessible(page);
    await screenshot(page, testInfo, '129-register-not-found');
  });
});

test.describe('register a team: a refused name', () => {
  test.use({ expectedConvexErrors: ['teams:register'] });

  test('a taken name shows its message; the same name registers in another season', async ({
    page,
    browser,
  }, testInfo) => {
    const tenant = await seed();
    const rival = newUser('Rival');
    const rivalPage = await otherUser(browser, rival);
    await rivalPage.context().close();
    await seedTeam(tenant, OPEN, 'sand sharks', rival);

    await signUp(page, newUser('Second'));
    await openForm(page, registerPath(tenant, OPEN));
    await teamName(page).fill('Sand  Sharks');
    await registerButton(page).click();
    await expect(page.locator('#team-name-error')).toHaveText(
      'sand sharks is already registered in this season. Choose another name.',
    );
    await expect(teamName(page)).toHaveValue('Sand  Sharks');
    await expectAccessible(page);
    await screenshot(page, testInfo, '129-register-taken');

    await openForm(page, registerPath(tenant, OTHER_OPEN));
    await teamName(page).fill('Sand  Sharks');
    await registerButton(page).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sand Sharks' })).toBeVisible({
      timeout: 20_000,
    });
  });
});

test.describe('team page', () => {
  test('/app/teams/not-an-id shows the not-found view', VIEWPORT_AGNOSTIC, async ({ page }) => {
    await signUp(page, newUser('Lost'));
    await page.goto('/app/teams/not-an-id');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  });

  test('another user gets the no-access view', async ({ page }, testInfo) => {
    const tenant = await seed();
    const captain = newUser('Owner');
    const captainPage = await otherUser(page.context().browser()!, captain);
    await captainPage.context().close();
    const { teamId } = await seedTeam(tenant, OPEN, 'Private Team', captain);

    await signUp(page, newUser('Stranger'));
    await page.goto(`/app/teams/${teamId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'You can’t open this team page' }),
    ).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '129-team-no-access');
  });
});
