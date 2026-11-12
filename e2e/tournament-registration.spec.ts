import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { convexRun } from './support/convex';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { dateFromToday, seedTenant, type Tenant } from './support/tenant';
import { seedTournament } from './support/tournament';
import { newUser, seedUser, type TestUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const OPEN = 'gulf-coast-beach-open';
const FULL = 'tiny-open';
const CLOSED = 'past-deadline-classic';
const DRAFT = 'secret-draft-open';

interface Seeded {
  tenant: Tenant;
  paths: Record<'open' | 'full' | 'closed' | 'draft', string>;
}

async function seed(): Promise<Seeded> {
  const tenant = await seedTenant({
    name: 'E2E Tournament Teams',
    locations: [
      { name: 'North Beach Sand Courts', address: '3500 Sandcourt Ln, Corpus Christi, TX' },
    ],
  });
  const common = {
    locations: ['North Beach Sand Courts'],
    division: {
      gender: 'coed' as const,
      playersPerSide: 2,
      level: 'open' as const,
      ageGroup: 'adult' as const,
    },
    startDate: dateFromToday(30),
    endDate: dateFromToday(31),
  };
  const open = await seedTournament(tenant, {
    ...common,
    name: 'Gulf Coast Beach Open',
    slug: OPEN,
    registrationDeadline: dateFromToday(20),
  });
  const full = await seedTournament(tenant, {
    ...common,
    name: 'Tiny Open',
    slug: FULL,
    registrationDeadline: dateFromToday(20),
    maximumTeams: 2,
  });
  const closed = await seedTournament(tenant, {
    ...common,
    name: 'Past Deadline Classic',
    slug: CLOSED,
    registrationDeadline: dateFromToday(-2),
  });
  const draft = await seedTournament(tenant, {
    ...common,
    name: 'Secret Draft Open',
    slug: DRAFT,
    registrationDeadline: dateFromToday(20),
    status: 'draft',
  });
  return { tenant, paths: { open, full, closed, draft } };
}

const registerPath = (tenant: Tenant, slug: string) =>
  `/app/organizations/${tenant.slug}/tournaments/${slug}/register`;

async function seedTeam(tenant: Tenant, slug: string, name: string, captain: TestUser) {
  return (await convexRun('testing:seedTournamentTeam', {
    organizationSlug: tenant.slug,
    tournamentSlug: slug,
    name,
    captainEmail: captain.email,
  })) as { teamId: string };
}

const teamName = (page: Page) => page.locator('#team-name');
const registerButton = (page: Page) => page.getByRole('button', { name: 'Register team' });
const card = (page: Page) => page.locator('#registration');
const alert = (page: Page) => page.locator('main [data-slot="alert"]');

test.describe('register a team for a tournament', () => {
  test('signed out: Register a team on the tournament page, sign up, submit, and land on the team page as captain', async ({
    page,
  }, testInfo) => {
    const { tenant, paths } = await seed();
    const path = registerPath(tenant, OPEN);
    await page.goto(paths.open);
    await expect(card(page)).toContainText('Registration open');
    await expectAccessible(page);
    await screenshot(page, testInfo, '340-tournament-open');
    await card(page).getByRole('link', { name: 'Register a team' }).click();
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
      page.getByRole('heading', { level: 1, name: 'Gulf Coast Beach Open' }),
    ).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '340-register-form');

    await registerButton(page).click();
    await expect(page.locator('#team-name-error')).toHaveText('Enter a team name.');
    await expect(teamName(page)).toBeFocused();
    await screenshot(page, testInfo, '340-register-empty');

    await teamName(page).fill('Sand Crabs');
    await registerButton(page).click();
    await expect(page).toHaveURL(new RegExp(`^${baseURL}/app/teams/[^/]+$`), { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Sand Crabs' })).toBeVisible();
    const main = page.locator('main');
    await expect(main.getByTestId('roster-count')).toHaveText('1 of 2 players');
    const roster = main.locator('section[aria-labelledby="roster-heading"] ul > li');
    await expect(roster).toHaveCount(1);
    await expect(roster).toContainText(user.name);
    await expect(roster).toContainText('Captain');
    await expect(main.getByRole('status').filter({ hasText: 'is registered for' })).toBeFocused();
    await expect(main.getByRole('link', { name: 'Gulf Coast Beach Open' })).toHaveAttribute(
      'href',
      paths.open,
    );
    await expect(main.getByRole('link', { name: 'Invite players' })).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '340-team-registered');

    await main.getByRole('link', { name: 'Gulf Coast Beach Open' }).click();
    await expect(page).toHaveURL(`${baseURL}${paths.open}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Gulf Coast Beach Open' }),
    ).toBeVisible();
  });

  test('closed: the card reads Registration closed with no action, and the register route shows the deadline and no form', async ({
    page,
  }, testInfo) => {
    const { tenant, paths } = await seed();
    await page.goto(paths.closed);
    await expect(card(page)).toContainText('Registration closed');
    await expect(card(page).locator('a, button')).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '340-tournament-closed');

    await signUp(page, newUser('Late'));
    await page.goto(registerPath(tenant, CLOSED));
    await expect(alert(page)).toContainText('Registration for this tournament is closed.');
    await expect(alert(page)).toContainText('It closed on');
    await expect(teamName(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to the tournament page' })).toHaveAttribute(
      'href',
      paths.closed,
    );
    await expectAccessible(page);
    await screenshot(page, testInfo, '340-register-closed');
  });

  test('full: the card reads Full with no action, and the register route offers no form', async ({
    page,
  }, testInfo) => {
    const { tenant, paths } = await seed();
    await seedTeam(tenant, FULL, 'One', await seedUser(newUser('One')));
    await seedTeam(tenant, FULL, 'Two', await seedUser(newUser('Two')));
    await page.goto(paths.full);
    await expect(card(page).locator('p').first()).toHaveText('Full');
    await expect(card(page).locator('a, button')).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '340-tournament-full');

    await signUp(page, newUser('Third'));
    await page.goto(registerPath(tenant, FULL));
    await expect(alert(page)).toContainText('This tournament is full.');
    await expect(teamName(page)).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '340-register-full');
  });

  test('already on a team: says so with a link to it and no form, also after the deadline', async ({
    page,
  }, testInfo) => {
    const { tenant } = await seed();
    const captain = newUser('OnTeam');
    await signUp(page, captain);
    const { teamId } = await seedTeam(tenant, OPEN, 'Sand Crabs', captain);
    await page.goto(registerPath(tenant, OPEN));
    await expect(alert(page)).toContainText('You’re on Sand Crabs in this tournament.');
    await expect(teamName(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Go to Sand Crabs' })).toHaveAttribute(
      'href',
      `/app/teams/${teamId}`,
    );
    await expectAccessible(page);
    await screenshot(page, testInfo, '340-register-on-team');
  });

  test('not found: an unknown slug, a draft, and another organization’s path show the not-found view and no form', async ({
    page,
  }, testInfo) => {
    const { tenant } = await seed();
    await signUp(page, newUser('Lost'));
    for (const path of [
      registerPath(tenant, 'no-such-tournament'),
      registerPath(tenant, DRAFT),
      `/app/organizations/no-such-org/tournaments/${OPEN}/register`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
      await expect(teamName(page)).toHaveCount(0);
      await expect(page).toHaveURL(`${baseURL}${path}`);
    }
    await expectAccessible(page);
    await screenshot(page, testInfo, '340-register-not-found');
  });
});

test.describe('register a team for a tournament: a refused name', () => {
  test.use({ expectedConvexErrors: ['teams:registerForTournament'] });

  test('a taken name shows its message under the field and keeps the name', async ({
    page,
  }, testInfo) => {
    const { tenant } = await seed();
    await seedTeam(tenant, OPEN, 'sand crabs', await seedUser(newUser('Rival')));
    await signUp(page, newUser('Second'));
    await page.goto(registerPath(tenant, OPEN));
    await expect(teamName(page)).toBeVisible();
    await teamName(page).fill('Sand  Crabs');
    await registerButton(page).click();
    await expect(page.locator('#team-name-error')).toHaveText(
      'sand crabs is already registered in this tournament. Choose another name.',
    );
    await expect(teamName(page)).toHaveValue('Sand  Crabs');
    await expectAccessible(page);
    await screenshot(page, testInfo, '340-register-taken');
  });
});

test.describe('Your teams', () => {
  test('lists a tournament team with the tournament’s name and dates, and no next step to invite players', async ({
    page,
  }, testInfo) => {
    const { tenant } = await seed();
    const captain = newUser('Crabs');
    await signUp(page, captain);
    const { teamId } = await seedTeam(tenant, OPEN, 'Sand Crabs', captain);
    await page.goto('/app');
    const teams = page.getByRole('region', { name: 'Your teams' });
    await expect(teams.getByRole('heading', { level: 3, name: 'Sand Crabs' })).toBeVisible();
    await expect(teams.getByRole('link', { name: 'Sand Crabs' })).toHaveAttribute(
      'href',
      `/app/teams/${teamId}`,
    );
    await expect(teams).toContainText('Gulf Coast Beach Open');
    await expect(teams.getByText('Tournament', { exact: true })).toBeVisible();
    await expect(teams).toContainText('1 of 2');
    await expect(page.getByRole('link', { name: /Invite players/ })).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '340-your-teams');
  });
});

test.describe('the team page of a tournament team', () => {
  test('another user gets the no-access view', async ({ page }, testInfo) => {
    const { tenant } = await seed();
    const { teamId } = await seedTeam(
      tenant,
      OPEN,
      'Private Crabs',
      await seedUser(newUser('Owner')),
    );
    await signUp(page, newUser('Stranger'));
    await page.goto(`/app/teams/${teamId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'You can’t open this team page' }),
    ).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '340-team-no-access');
  });
});
