import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { goHomeBySidebar } from './support/go-home';
import { holdQueries } from './support/hold-queries';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { otherUser, signUp } from './support/session';
import { dateFromToday, seedSeasons, seedTenant, type Tenant } from './support/tenant';
import { newUser, type TestUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LEAGUE = 'Sunday Reverse Coed 4s';
const LEAGUE_SLUG = 'sunday-reverse-coed-4s';
const OPEN = 'summer-open';
const CLOSED = 'closed-season';
const STARTED = 'started-season';
const DRAFT = 'draft-season';
const REGISTER = 'freeAgents:register';

async function seed(): Promise<Tenant> {
  const tenant = await seedTenant({
    name: 'E2E Free Agents',
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
      name: 'Closed Season',
      slug: CLOSED,
      startDate: dateFromToday(10),
      endDate: dateFromToday(70),
      registrationDeadline: dateFromToday(-5),
    },
    // Seeded past `seasons.create`'s rules: the deadline is after the start date, which is today.
    {
      name: 'Started Season',
      slug: STARTED,
      startDate: dateFromToday(0),
      endDate: dateFromToday(60),
      registrationDeadline: dateFromToday(5),
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
  `/app/register/${tenant.slug}/${league}/${season}/free-agent`;

async function seedTeam(tenant: Tenant, season: string, name: string, captain: TestUser) {
  return (await convexRun('testing:seedTeam', {
    organizationSlug: tenant.slug,
    leagueSlug: LEAGUE_SLUG,
    seasonSlug: season,
    name,
    captainEmail: captain.email,
  })) as { teamId: string };
}

async function seedFreeAgent(
  tenant: Tenant,
  season: string,
  user: TestUser,
  placedTeamId?: string,
) {
  await convexRun('testing:seedFreeAgent', {
    organizationSlug: tenant.slug,
    leagueSlug: LEAGUE_SLUG,
    seasonSlug: season,
    email: user.email,
    ...(placedTeamId === undefined ? {} : { placedTeamId }),
  });
}

function watchRegisterCalls(page: Page): string[] {
  const sent: string[] = [];
  page.on('websocket', (socket) =>
    socket.on('framesent', ({ payload }) => {
      if (String(payload).includes(`"${REGISTER}"`)) sent.push(String(payload));
    }),
  );
  return sent;
}

const card = (page: Page) => page.locator('main [data-slot="alert"]');
const registerButton = (page: Page) =>
  page.getByRole('main').getByRole('button', { name: 'Register as a free agent' });

test.describe('register as a free agent', () => {
  test('signed out: Register as a free agent on the season page, sign up, confirm, and wait; a reload shows the wait again', async ({
    page,
  }, testInfo) => {
    const tenant = await seed();
    const path = registerPath(tenant, OPEN);
    await page.goto(`${tenant.path}/leagues/${LEAGUE_SLUG}/seasons/${OPEN}`);
    await page
      .locator('#registration')
      .getByRole('link', { name: 'Register as a free agent' })
      .click();
    await expect(page).toHaveURL(/\/sign-in\?/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(path);

    await page.getByRole('main').getByRole('link', { name: 'Create an account' }).click();
    const user = newUser('FreeAgent');
    await page.locator('#name').fill(user.name);
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.getByRole('checkbox', { name: 'I am 18 or older' }).click();
    await page.getByRole('button', { name: /Create account/ }).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, { timeout: 20_000 });

    await expect(
      page.getByRole('heading', { level: 1, name: `${LEAGUE}, Summer Open` }),
    ).toBeVisible();
    await expect(page).toHaveTitle('Register as a free agent | Summer Open | Omni League');
    await expectAccessible(page);
    await screenshot(page, testInfo, '133-register-form');

    await registerButton(page).click();
    await expect(card(page)).toContainText('You’re registered as a free agent.');
    await expect(card(page)).toContainText('An organizer will place you on a team.');
    await expect(card(page)).toContainText(/Registered [A-Z][a-z]{2} \d{1,2}, \d{4}\./);
    await expect(card(page)).toBeFocused();
    await expect(registerButton(page)).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '133-waiting');

    await page.reload();
    await expect(card(page)).toContainText('You’re registered as a free agent.');
    await expect(registerButton(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to the season page' })).toHaveAttribute(
      'href',
      `${tenant.path}/leagues/${LEAGUE_SLUG}/seasons/${OPEN}`,
    );
  });

  test('signed out: after signing up from the season page and registering, Home in the same tab shows the default skeleton, not the new-user one', async ({
    page,
  }) => {
    const tenant = await seed();
    const path = registerPath(tenant, OPEN);
    const held = await holdQueries(page, ['freeAgents:listMine'], {
      watchFromStart: false,
      holdFromStart: false,
    });
    await page.goto(`${tenant.path}/leagues/${LEAGUE_SLUG}/seasons/${OPEN}`);
    await page
      .locator('#registration')
      .getByRole('link', { name: 'Register as a free agent' })
      .click();
    await page.getByRole('main').getByRole('link', { name: 'Create an account' }).click();
    const user = newUser('FreeAgent');
    await page.locator('#name').fill(user.name);
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.getByRole('checkbox', { name: 'I am 18 or older' }).click();
    await page.getByRole('button', { name: /Create account/ }).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, { timeout: 20_000 });
    await registerButton(page).click();
    await expect(card(page)).toContainText('You’re registered as a free agent.');

    held.watchNewSubscriptions();
    held.holdNextAnswer();
    await goHomeBySidebar(page);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(page.getByRole('main').getByRole('status')).toHaveText(
      'Loading your teams and registrations.',
    );
    await expect(page.locator('[data-slot="home-skeleton-heading"]')).toBeVisible();
    await expect(page.locator('[data-slot="home-skeleton-new-user-card"]')).toHaveCount(0);
    held.release();
    await expect(page.getByRole('region', { name: 'Free agent' })).toBeVisible();
  });

  test('closed: past the deadline and from the start date, the route shows the closed state and no button', async ({
    page,
  }, testInfo) => {
    const tenant = await seed();
    await signUp(page, newUser('Late'));
    for (const season of [CLOSED, STARTED]) {
      await page.goto(registerPath(tenant, season));
      await expect(card(page)).toContainText('Registration for this season is closed.');
      await expect(card(page)).toContainText(
        'To play on a team that has already registered, ask its captain for an invite.',
      );
      await expect(registerButton(page)).toHaveCount(0);
    }
    await expect(card(page)).toContainText('It closed when the season started on');
    await page.goto(registerPath(tenant, CLOSED));
    await expect(card(page)).toContainText('It closed on');
    await expectAccessible(page);
    await screenshot(page, testInfo, '133-closed');
  });

  test('past the deadline: a waiting free agent sees the wait, and a placed one the team, not the closed state', async ({
    page,
    browser,
  }, testInfo) => {
    const tenant = await seed();
    const captain = newUser('Captain');
    const captainPage = await otherUser(browser, captain);
    await captainPage.context().close();
    const { teamId } = await seedTeam(tenant, CLOSED, 'Sand Sharks', captain);

    const waiting = newUser('Waiting');
    await signUp(page, waiting);
    await seedFreeAgent(tenant, CLOSED, waiting);
    await page.goto(registerPath(tenant, CLOSED));
    await expect(card(page)).toContainText('You’re registered as a free agent.');
    await expect(page.locator('main')).not.toContainText('Registration for this season is closed.');
    await expect(registerButton(page)).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '133-waiting-after-deadline');

    const placed = newUser('Placed');
    const placedPage = await otherUser(browser, placed);
    await seedFreeAgent(tenant, CLOSED, placed, teamId);
    await placedPage.goto(registerPath(tenant, CLOSED));
    await expect(card(placedPage)).toContainText('You’re on Sand Sharks in this season.');
    await expect(placedPage.locator('main')).not.toContainText(
      'Registration for this season is closed.',
    );
    await expect(placedPage.getByRole('link', { name: 'Go to Sand Sharks' })).toHaveAttribute(
      'href',
      `/app/teams/${teamId}`,
    );
    await placedPage.context().close();
  });

  test('on a team: a rostered player sees their team with a link, and no button', async ({
    page,
  }, testInfo) => {
    const tenant = await seed();
    const captain = newUser('OnTeam');
    await signUp(page, captain);
    const { teamId } = await seedTeam(tenant, OPEN, 'Sand Sharks', captain);
    await page.goto(registerPath(tenant, OPEN));
    await expect(card(page)).toContainText('You’re on Sand Sharks in this season.');
    await expect(card(page)).toContainText('there’s no need to register as a free agent');
    await expect(registerButton(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Go to Sand Sharks' })).toHaveAttribute(
      'href',
      `/app/teams/${teamId}`,
    );
    await expectAccessible(page);
    await screenshot(page, testInfo, '133-on-team');
  });

  test('not found: an unknown slug, a draft season, and another league’s path show the not-found view and call no mutation', async ({
    page,
  }, testInfo) => {
    const tenant = await seed();
    await signUp(page, newUser('Lost'));
    const sent = watchRegisterCalls(page);
    for (const path of [
      registerPath(tenant, 'no-such-season'),
      registerPath(tenant, DRAFT),
      registerPath(tenant, OPEN, 'no-such-league'),
      `/app/register/no-such-org/${LEAGUE_SLUG}/${OPEN}/free-agent`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
      await expect(registerButton(page)).toHaveCount(0);
      await expect(page).toHaveURL(`${baseURL}${path}`);
    }
    expect(sent).toEqual([]);
    await expectAccessible(page);
    await screenshot(page, testInfo, '133-not-found');
  });
});
