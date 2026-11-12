import type { Locator, Page } from '@playwright/test';
import { formatCalendarDate } from '../convex/lib/seasonInput';
import { checkReflow, expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { failFirstAnswer } from './support/fail-first-answer';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { goHomeBySidebar } from './support/go-home';
import { homeHeading } from './support/home';
import { expectLinkHeights, pointerOf } from './support/link-heights';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { expectOnScreen } from './support/sticky-footer';
import { dateFromToday, seedSeasons, seedTenant, type Tenant } from './support/tenant';
import { newUser, seedUser, type TestUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const SUNDAY = 'Sunday Reverse Coed 4s';
const THURSDAY = 'Thursday Night Coed 2s';
const slugOf = (name: string) => name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');

const SUMMER = {
  name: 'Summer 2099',
  slug: 'summer-2099',
  startDate: '2099-06-06',
  endDate: '2099-08-29',
  registrationDeadline: dateFromToday(10),
  playersPerSide: 4,
};
const THURSDAY_SUMMER = {
  name: 'Summer 2099',
  slug: 'summer-2099',
  startDate: '2099-06-03',
  endDate: '2099-08-26',
  registrationDeadline: dateFromToday(20),
  playersPerSide: 2,
};

const tasha = (): TestUser => ({ ...newUser('Tasha'), name: 'Tasha Greene' });

const main = (page: Page) => page.getByRole('main');
const nextStep = (page: Page) => page.getByRole('region', { name: 'Next step' });
const teams = (page: Page) => page.getByRole('region', { name: 'Your teams' });
const freeAgent = (page: Page) => page.getByRole('region', { name: 'Free agent' });
const cardOf = (page: Page, team: string) =>
  teams(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 3, name: team }) });

// The sidebar is in the closed menu on a phone, so its links are read hidden.
const sidebar = (page: Page) =>
  page.getByRole('navigation', { name: 'Your account', includeHidden: true });
const sidebarLinks = (page: Page, group: string) =>
  sidebar(page)
    .getByRole('list', { name: group, includeHidden: true })
    .getByRole('link', { includeHidden: true });

async function gulfCoast(): Promise<Tenant> {
  const tenant = await seedTenant({
    name: 'Gulf Coast Sport & Social',
    locations: [{ name: 'Alpha Beach', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
    leagues: [SUNDAY, THURSDAY].map((name) => ({
      name,
      sport: 'beachVolleyball' as const,
      locations: ['Alpha Beach'],
    })),
  });
  await Promise.all([
    seedSeasons(tenant, slugOf(SUNDAY), [SUMMER]),
    seedSeasons(tenant, slugOf(THURSDAY), [THURSDAY_SUMMER]),
  ]);
  return tenant;
}

async function seedTeam(
  tenant: Tenant,
  league: string,
  name: string,
  captain: TestUser,
): Promise<string> {
  const { teamId } = (await convexRun('testing:seedTeam', {
    organizationSlug: tenant.slug,
    leagueSlug: slugOf(league),
    seasonSlug: SUMMER.slug,
    name,
    captainEmail: captain.email,
  })) as { teamId: string };
  return teamId;
}

const addToTeam = (teamId: string, user: TestUser) =>
  convexRun('testing:addToTeam', { teamId, email: user.email });

async function seedTashasTeams(user: TestUser) {
  const tenant = await gulfCoast();
  const [captain, ...mates] = await Promise.all(
    ['Captain', 'Mate', 'Mate'].map((label) => seedUser(newUser(label))),
  );
  const sharks = await seedTeam(tenant, SUNDAY, 'Sand Sharks', user);
  const aces = await seedTeam(tenant, THURSDAY, 'Pair of Aces', captain);
  await Promise.all([...mates.map((mate) => addToTeam(sharks, mate)), addToTeam(aces, user)]);
  return { tenant, sharks, aces };
}

const waitInSeason = (tenant: Tenant, league: string, user: TestUser) =>
  convexRun('testing:seedFreeAgent', {
    organizationSlug: tenant.slug,
    leagueSlug: slugOf(league),
    seasonSlug: SUMMER.slug,
    email: user.email,
  });

const makeAdmin = (tenant: Tenant, user: TestUser) =>
  convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });

async function openHome(page: Page, greeting: string) {
  await page.goto('/app');
  await expect(homeHeading(page)).toHaveText(greeting);
}

test.describe('/app: a user with teams', () => {
  test('greets the user, names the next step, and shows a card for each team', async ({
    page,
  }, testInfo) => {
    const user = tasha();
    await signUp(page, user);
    const { sharks, aces } = await seedTashasTeams(user);
    await openHome(page, 'Hi, Tasha');

    await expect(page).toHaveTitle('Home | Omni League');
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Hi, Tasha');
    await expect(main(page)).toContainText('Your teams and registrations.');

    await expect(nextStep(page).getByRole('heading', { level: 2 })).toHaveText('Next step');
    await expect(nextStep(page)).toContainText('Sand Sharks needs 1 more player');
    await expect(nextStep(page)).toContainText(
      `${SUNDAY} needs 4 players per team by ${formatCalendarDate(SUMMER.registrationDeadline)}.`,
    );
    await expect(nextStep(page).getByRole('link')).toHaveAccessibleName(
      'Invite players to Sand Sharks',
    );
    await expect(nextStep(page).getByRole('link')).toHaveAttribute(
      'href',
      `/app/teams/${sharks}#invite`,
    );

    await expect(teams(page).getByRole('heading', { level: 2 })).toHaveText('Your teams');
    await expect(teams(page).getByRole('heading', { level: 3 })).toHaveText([
      'Sand Sharks',
      'Pair of Aces',
    ]);
    const sharksCard = cardOf(page, 'Sand Sharks');
    await expect(sharksCard).toContainText(`${SUNDAY} · ${SUMMER.name}`);
    await expect(sharksCard.locator('[data-slot="badge"]')).toHaveText('Captain');
    await expect(sharksCard).toContainText('Jun 6 – Aug 29');
    await expect(sharksCard).toContainText('3 of 4 needed');
    await expect(sharksCard.getByRole('link')).toHaveAttribute('href', `/app/teams/${sharks}`);
    const acesCard = cardOf(page, 'Pair of Aces');
    await expect(acesCard).toContainText(`${THURSDAY} · ${THURSDAY_SUMMER.name}`);
    await expect(acesCard.locator('[data-slot="badge"]')).toHaveText('Player');
    await expect(acesCard).toContainText('Jun 3 – Aug 26');
    await expect(acesCard).toContainText('2 of 2 needed');
    await expect(acesCard.getByRole('link')).toHaveAttribute('href', `/app/teams/${aces}`);

    await expect(main(page).getByText('Run a league?')).toBeVisible();
    await expect(main(page).getByRole('link', { name: 'Create an organization' })).toHaveAttribute(
      'href',
      '/app/organizations/new',
    );

    await screenshot(page, testInfo, '300-home-populated');
    await expectAccessible(page);
  });

  test('the sidebar holds Home as current, Find a league, and each team', async ({ page }) => {
    const user = tasha();
    await signUp(page, user);
    const { sharks, aces } = await seedTashasTeams(user);
    await openHome(page, 'Hi, Tasha');

    await expect(sidebarLinks(page, 'Your teams')).toHaveText(['Sand Sharks', 'Pair of Aces']);
    await expect(sidebarLinks(page, 'Your teams').first()).toHaveAttribute(
      'href',
      `/app/teams/${sharks}`,
    );
    await expect(sidebarLinks(page, 'Your teams').nth(1)).toHaveAttribute(
      'href',
      `/app/teams/${aces}`,
    );
    const home = sidebar(page).getByRole('link', {
      name: 'Home',
      exact: true,
      includeHidden: true,
    });
    await expect(home).toHaveAttribute('aria-current', 'page');
    await expect(
      sidebar(page).getByRole('link', { name: 'Find a league', includeHidden: true }),
    ).toHaveAttribute('href', '/leagues');
    await expect(sidebar(page).locator('[aria-current]')).toHaveCount(1);
  });

  test('Invite players opens the team page at its invite form', async ({ page }) => {
    const user = tasha();
    await signUp(page, user);
    const { sharks } = await seedTashasTeams(user);
    await openHome(page, 'Hi, Tasha');

    await nextStep(page).getByRole('link', { name: 'Invite players to Sand Sharks' }).click();
    await expect(page).toHaveURL(`${baseURL}/app/teams/${sharks}#invite`);
    await expect(page.getByRole('heading', { level: 1, name: 'Sand Sharks' })).toBeVisible();
    await expect(page.locator('#email')).toBeFocused();
    await expectOnScreen(page, page.locator('#invite'));
  });

  test('a team name opens its team page', async ({ page }) => {
    const user = tasha();
    await signUp(page, user);
    const { aces } = await seedTashasTeams(user);
    await openHome(page, 'Hi, Tasha');

    await cardOf(page, 'Pair of Aces').getByRole('link', { name: 'Pair of Aces' }).click();
    await expect(page).toHaveURL(`${baseURL}/app/teams/${aces}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Pair of Aces' })).toBeVisible();
  });

  test('a team the user was removed from is not listed', async ({ page }) => {
    const user = tasha();
    await signUp(page, user);
    const { aces } = await seedTashasTeams(user);
    await convexRun('testing:removeFromTeam', { teamId: aces, email: user.email });
    await openHome(page, 'Hi, Tasha');

    await expect(teams(page).getByRole('heading', { level: 3 })).toHaveText(['Sand Sharks']);
    await expect(sidebarLinks(page, 'Your teams')).toHaveText(['Sand Sharks']);
  });

  test('a user with a team and an organization is not asked to run a league', async ({ page }) => {
    const user = tasha();
    await signUp(page, user);
    const { tenant } = await seedTashasTeams(user);
    await makeAdmin(tenant, user);
    await openHome(page, 'Hi, Tasha');

    await expect(teams(page)).toBeVisible();
    await expect(sidebarLinks(page, 'Your organizations')).toHaveText([tenant.name]);
    await expect(main(page)).not.toContainText('Run a league?');
    await expect(main(page)).not.toContainText(tenant.name);
  });

  test('a captain whose teams all have their players has no next step', async ({ page }) => {
    const user = tasha();
    await signUp(page, user);
    const { sharks } = await seedTashasTeams(user);
    await addToTeam(sharks, await seedUser(newUser('Fourth')));
    await openHome(page, 'Hi, Tasha');

    await expect(teams(page)).toContainText('4 of 4 needed');
    await expect(nextStep(page)).toHaveCount(0);
  });
});

test.describe('/app: a user on no team', () => {
  const devon = (): TestUser => ({ ...newUser('Devon'), name: '  Devon  Park ' });

  test('is pointed to Find a league and to creating an organization', async ({
    page,
  }, testInfo) => {
    const user = devon();
    await signUp(page, user);
    await expect(homeHeading(page)).toHaveText('Hi, Devon');

    await expect(main(page)).toContainText('Your teams and registrations will show here.');
    await expect(
      main(page).getByRole('heading', { level: 2, name: "You're not on a team yet" }),
    ).toBeVisible();
    await expect(main(page)).toContainText(
      'Find a league, then register a team or register as a free agent. Got an invite link from a captain? Open it to join their team.',
    );
    await expect(main(page).getByRole('link', { name: 'Find a league' })).toHaveAttribute(
      'href',
      '/leagues',
    );
    await expect(
      main(page).getByRole('heading', { level: 2, name: 'Run a league?' }),
    ).toBeVisible();
    await expect(main(page).getByRole('link', { name: 'Create an organization' })).toHaveAttribute(
      'href',
      '/app/organizations/new',
    );
    await expect(nextStep(page)).toHaveCount(0);
    await expect(teams(page)).toHaveCount(0);
    await screenshot(page, testInfo, '300-home-new-user');
    await expectAccessible(page);
  });

  test('Find a league opens the league search', VIEWPORT_AGNOSTIC, async ({ page }) => {
    await signUp(page, devon());
    await main(page).getByRole('link', { name: 'Find a league' }).click();
    await expect(page).toHaveURL(`${baseURL}/leagues`);
    await expect(page.getByRole('heading', { level: 1, name: 'Find a league' })).toBeVisible();
  });

  test('a user who manages an organization is not asked to run a league, and finds it in the sidebar only', async ({
    page,
  }, testInfo) => {
    const user = devon();
    await signUp(page, user);
    const tenant = await gulfCoast();
    await makeAdmin(tenant, user);
    await openHome(page, 'Hi, Devon');

    await expect(
      main(page).getByRole('heading', { level: 2, name: "You're not on a team yet" }),
    ).toBeVisible();
    await expect(main(page)).not.toContainText('Run a league?');
    await expect(main(page)).not.toContainText(tenant.name);
    await expect(sidebarLinks(page, 'Your organizations')).toHaveText([tenant.name]);
    await expect(sidebarLinks(page, 'Your organizations')).toHaveAttribute(
      'href',
      `/app/organizations/${tenant.slug}`,
    );
    await screenshot(page, testInfo, '300-home-new-user-organizer');
    await expectAccessible(page);
  });

  test('a league organizer’s sidebar link goes to their first assigned league', async ({
    page,
  }) => {
    const user = devon();
    await signUp(page, user);
    const tenant = await gulfCoast();
    await convexRun('testing:addLeagueOrganizer', {
      organizationSlug: tenant.slug,
      email: user.email,
      leagueSlugs: [slugOf(SUNDAY)],
    });
    await openHome(page, 'Hi, Devon');

    await expect(sidebarLinks(page, 'Your organizations')).toHaveAttribute(
      'href',
      `/app/organizations/${tenant.slug}/leagues/${slugOf(SUNDAY)}`,
    );
  });
});

test.describe('/app: a free agent waiting to be placed', () => {
  const placementNote = (tenant: Tenant) =>
    `${tenant.name}. An organizer places you on a team before ${formatCalendarDate(SUMMER.registrationDeadline)}.`;

  test('shows the registration under the team cards with its status and deadline', async ({
    page,
  }, testInfo) => {
    const user = tasha();
    await signUp(page, user);
    const tenant = await gulfCoast();
    const captain = await seedUser(newUser('Captain'));
    await addToTeam(await seedTeam(tenant, THURSDAY, 'Pair of Aces', captain), user);
    await waitInSeason(tenant, SUNDAY, user);
    await openHome(page, 'Hi, Tasha');

    await expect(teams(page).getByRole('heading', { level: 3 })).toHaveText(['Pair of Aces']);
    await expect(freeAgent(page).getByRole('heading', { level: 2 })).toHaveText('Free agent');
    const card = freeAgent(page).getByRole('listitem');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(`${SUNDAY} · ${SUMMER.name}`);
    await expect(card).toContainText(placementNote(tenant));
    await expect(card.locator('[data-slot="badge"]')).toHaveText('Waiting');
    const below = (await freeAgent(page).boundingBox())!.y - (await teams(page).boundingBox())!.y;
    expect(below, 'the card sits below the team cards').toBeGreaterThan(0);

    await screenshot(page, testInfo, '300-home-free-agent');
    await expectAccessible(page);
  });

  test('a user whose only registration is waiting does not see the new-user state', async ({
    page,
  }, testInfo) => {
    const user = tasha();
    await signUp(page, user);
    const tenant = await gulfCoast();
    await waitInSeason(tenant, SUNDAY, user);
    await openHome(page, 'Hi, Tasha');

    await expect(main(page)).toContainText('Your teams and registrations.');
    await expect(freeAgent(page).getByRole('listitem')).toContainText(placementNote(tenant));
    await expect(main(page)).not.toContainText("You're not on a team yet");
    await expect(teams(page)).toHaveCount(0);
    await expect(nextStep(page)).toHaveCount(0);
    await screenshot(page, testInfo, '300-home-free-agent-only');
    await expectAccessible(page);
  });

  test('a registration made while the home is open replaces the new-user state', async ({
    page,
  }) => {
    const user = tasha();
    await signUp(page, user);
    await expect(
      main(page).getByRole('heading', { level: 2, name: "You're not on a team yet" }),
    ).toBeVisible();

    const tenant = await gulfCoast();
    await waitInSeason(tenant, SUNDAY, user);
    await expect(freeAgent(page).getByRole('listitem')).toContainText(placementNote(tenant));
    await expect(main(page)).not.toContainText("You're not on a team yet");
  });
});

const skeleton = {
  heading: (page: Page) => page.locator('[data-slot="home-skeleton-heading"]'),
  card: (page: Page) => page.locator('[data-slot="home-skeleton-card"]').first(),
  nextStep: (page: Page) => page.locator('[data-slot="home-skeleton-next-step"]'),
  newUserCard: (page: Page) => page.locator('[data-slot="home-skeleton-new-user-card"]'),
};

const topOf = async (locator: Locator) => (await locator.boundingBox())!.y;

async function expectWhereItStood(arrived: Locator, stoodAt: number, what: string) {
  const now = await topOf(arrived);
  expect(Math.abs(now - stoodAt), `${what} moved from ${stoodAt} to ${now}`).toBeLessThanOrEqual(4);
}

async function expectLoadingStatus(page: Page) {
  await expect(homeHeading(page)).toBeVisible();
  await expect(main(page).getByRole('status')).toHaveText('Loading your teams and registrations.');
  await expect(main(page).getByRole('link')).toHaveCount(0);
}

async function expectSkeletonAccessible(page: Page) {
  await expectAccessible(page);
  expect(await checkReflow(page)).toMatchObject({ passed: true });
}

async function seedPlayerOnTeam(user: TestUser) {
  const tenant = await gulfCoast();
  const captain = await seedUser(newUser('Captain'));
  const aces = await seedTeam(tenant, THURSDAY, 'Pair of Aces', captain);
  await addToTeam(aces, user);
  return tenant;
}

async function loadHeld(page: Page, query: string) {
  const held = await holdQueries(page, [query]);
  await page.goto('/app');
  await expect.poll(() => held.isHolding()).toBe(true);
  return held;
}

/** `page.goto` reloads the page and loses what the tab holds in memory. */
async function goInTab(page: Page, path: string) {
  await page.evaluate((target) => {
    history.pushState(null, '', target);
    dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await expect(page).toHaveURL(`${baseURL}${path}`);
}

test.describe('/app: while the teams load', () => {
  test('a user with a next step sees a skeleton with no next-step block, and the heading does not move when the answer arrives', async ({
    page,
  }) => {
    const user = tasha();
    await signUp(page, user);
    await seedTashasTeams(user);
    const held = await loadHeld(page, 'teams:listMine');

    await expectLoadingStatus(page);
    await expect(skeleton.nextStep(page)).toHaveCount(0);
    const headingTop = await topOf(homeHeading(page));

    held.release();
    await expect(nextStep(page)).toBeVisible();
    await expect(main(page).getByRole('status')).toHaveCount(0);
    expect(await topOf(homeHeading(page))).toBe(headingTop);
  });

  test('the Your teams heading and first card arrive where the skeleton stood', async ({
    page,
  }, testInfo) => {
    const user = tasha();
    await signUp(page, user);
    await seedPlayerOnTeam(user);
    const held = await loadHeld(page, 'teams:listMine');

    await expectLoadingStatus(page);
    await expect(skeleton.nextStep(page)).toHaveCount(0);
    await screenshot(page, testInfo, '300-home-loading');
    await expectSkeletonAccessible(page);

    const placeholder = { heading: skeleton.heading(page), card: skeleton.card(page) };
    const [headingTop, cardTop] = [await topOf(placeholder.heading), await topOf(placeholder.card)];
    held.release();
    await expect(teams(page)).toBeVisible();
    await expect(main(page).getByRole('status')).toHaveCount(0);
    await expectWhereItStood(teams(page).getByRole('heading', { level: 2 }), headingTop, 'heading');
    await expectWhereItStood(teams(page).getByRole('listitem').first(), cardTop, 'first card');
  });

  test('the Free agent heading and card arrive where the skeleton stood', async ({ page }) => {
    const user = tasha();
    await signUp(page, user);
    const tenant = await gulfCoast();
    await waitInSeason(tenant, SUNDAY, user);
    const held = await loadHeld(page, 'freeAgents:listMine');

    await expectLoadingStatus(page);
    const placeholder = { heading: skeleton.heading(page), card: skeleton.card(page) };
    const [headingTop, cardTop] = [await topOf(placeholder.heading), await topOf(placeholder.card)];
    held.release();
    await expect(freeAgent(page)).toBeVisible();
    await expectWhereItStood(
      freeAgent(page).getByRole('heading', { level: 2 }),
      headingTop,
      'heading',
    );
    await expectWhereItStood(freeAgent(page).getByRole('listitem').first(), cardTop, 'first card');
  });

  test('back on Home from Account settings in the same tab, a user with a next step sees the next-step block, and the cards arrive where the skeleton stood', async ({
    page,
  }, testInfo) => {
    const user = tasha();
    await signUp(page, user);
    await seedTashasTeams(user);
    const held = await holdQueries(page, ['teams:listMine'], {
      watchFromStart: false,
      holdFromStart: false,
    });
    await openHome(page, 'Hi, Tasha');
    await expect(nextStep(page)).toBeVisible();

    await page.getByRole('link', { name: /^Account settings: / }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Account settings' })).toBeVisible();
    held.watchNewSubscriptions();
    held.holdNextAnswer();
    await goHomeBySidebar(page);
    await expect.poll(() => held.isHolding()).toBe(true);

    await expectLoadingStatus(page);
    await expect(skeleton.nextStep(page)).toBeVisible();
    await screenshot(page, testInfo, '300-home-loading-next-step');
    await expectSkeletonAccessible(page);
    const placeholder = { block: skeleton.nextStep(page), heading: skeleton.heading(page) };
    const [blockTop, headingTop] = [
      await topOf(placeholder.block),
      await topOf(placeholder.heading),
    ];
    held.release();
    await expect(nextStep(page)).toBeVisible();
    await expectWhereItStood(nextStep(page), blockTop, 'next-step block');
    await expectWhereItStood(teams(page).getByRole('heading', { level: 2 }), headingTop, 'heading');
  });

  test('a team registered in the tab drops the remembered new-user shape, and the skeleton is the default list', async ({
    page,
  }) => {
    const user = tasha();
    const tenant = await gulfCoast();
    const held = await holdQueries(page, ['teams:listMine'], {
      watchFromStart: false,
      holdFromStart: false,
    });
    await signUp(page, user);
    await expect(
      main(page).getByRole('heading', { level: 2, name: "You're not on a team yet" }),
    ).toBeVisible();

    await goInTab(page, `/app/register/${tenant.slug}/${slugOf(SUNDAY)}/${SUMMER.slug}/team`);
    await page.locator('#team-name').fill('Sand Sharks');
    await page.getByRole('button', { name: 'Register team' }).click();
    await expect(page).toHaveURL(new RegExp(`^${baseURL}/app/teams/[^/]+$`), { timeout: 20_000 });
    held.watchNewSubscriptions();
    held.holdNextAnswer();
    await goHomeBySidebar(page);
    await expect.poll(() => held.isHolding()).toBe(true);

    await expectLoadingStatus(page);
    await expect(skeleton.newUserCard(page)).toHaveCount(0);
    await expect(skeleton.nextStep(page)).toHaveCount(0);
    await expect(skeleton.heading(page)).toBeVisible();
    held.release();
    await expect(teams(page)).toBeVisible();
  });

  test('a visitor who signs up with no returnTo sees the new-user skeleton, and its card arrives where the skeleton stood', async ({
    page,
  }, testInfo) => {
    const held = await holdQueries(page, ['teams:listMine']);
    await signUp(page, tasha());
    await expect.poll(() => held.isHolding()).toBe(true);

    await expectLoadingStatus(page);
    await expect(skeleton.newUserCard(page)).toHaveCount(1);
    await expect(skeleton.heading(page)).toHaveCount(0);
    await expect(skeleton.nextStep(page)).toHaveCount(0);
    await screenshot(page, testInfo, '300-home-loading-new-user');
    await expectSkeletonAccessible(page);
    const cardTop = await topOf(skeleton.newUserCard(page));

    held.release();
    const arrived = main(page).locator('section[aria-labelledby="start-heading"]');
    await expect(arrived).toBeVisible();
    await expectWhereItStood(arrived, cardTop, 'first card');
  });
});

test.describe('/app: the slim bar', () => {
  test.skip(({ isMobile }) => !isMobile, 'the slim bar shows below 1024px only');

  test('reads Home on one 56px line while the teams load and once they have', async ({ page }) => {
    const user = tasha();
    await signUp(page, user);
    await seedTashasTeams(user);
    const bar = page.locator('header');
    const title = bar.locator('p');
    const held = await holdQueries(page, ['teams:listMine']);
    await page.goto('/app');
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(main(page).getByRole('status')).toBeVisible();
    await expect(title).toHaveText('Home');
    const loadingHeight = (await bar.boundingBox())!.height;

    held.release();
    await expect(teams(page)).toBeVisible();
    await expect(title).toHaveText('Home');
    expect((await bar.boundingBox())!.height).toBe(56);
    expect(loadingHeight).toBe(56);
    const lineHeight = await title.evaluate((element) =>
      parseFloat(getComputedStyle(element).lineHeight),
    );
    expect((await title.boundingBox())!.height).toBeLessThanOrEqual(lineHeight);
    await expect(title).toHaveCSS('text-overflow', 'ellipsis');
  });
});

test.describe('/app: the teams cannot be loaded', () => {
  test('shows an alert with Try again in place of the cards, and the cards return once the answer succeeds', async ({
    page,
  }, testInfo) => {
    const user = tasha();
    await signUp(page, user);
    await seedTashasTeams(user);
    await failFirstAnswer(page, 'teams:listMine');
    await page.goto('/app');

    const alert = main(page).getByRole('alert');
    await expect(alert).toContainText('Your teams and registrations could not be loaded.');
    await expect(alert).toContainText('Check your connection.');
    await expect(alert).not.toContainText('forced failure');
    await expect(teams(page)).toHaveCount(0);
    await expect(nextStep(page)).toHaveCount(0);
    await expect(main(page).getByRole('status')).toHaveCount(0);
    await expect(main(page).getByRole('link', { name: 'Manage notifications' })).toBeVisible();
    await screenshot(page, testInfo, '300-home-error');
    await expectAccessible(page);

    await alert.getByRole('link', { name: 'Try again' }).click();
    await expect(teams(page).getByRole('heading', { level: 3 })).toHaveText([
      'Sand Sharks',
      'Pair of Aces',
    ]);
    await expect(main(page).getByRole('alert')).toHaveCount(0);
  });
});

test.describe('/app: keyboard, touch, and live changes', () => {
  test('Tab reaches Invite players, then each team name, in reading order, and Enter goes to the team page', async ({
    page,
  }) => {
    const user = tasha();
    await signUp(page, user);
    const { sharks } = await seedTashasTeams(user);
    await openHome(page, 'Hi, Tasha');

    await main(page).focus();
    const focusedLink = () =>
      page.evaluate(() => {
        const active = document.activeElement;
        return active instanceof HTMLAnchorElement
          ? (active.getAttribute('aria-label') ?? active.textContent?.trim())
          : null;
      });
    const reached: (string | null | undefined)[] = [];
    for (let step = 0; step < 3; step++) {
      await page.keyboard.press('Tab');
      reached.push(await focusedLink());
    }
    expect(reached).toEqual(['Invite players to Sand Sharks', 'Sand Sharks', 'Pair of Aces']);

    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(nextStep(page).getByRole('link')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${baseURL}/app/teams/${sharks}#invite`);
  });

  test('links and the button are 44px tall on touch screens and keep their size with a mouse', async ({
    page,
  }, testInfo) => {
    const user = tasha();
    await signUp(page, user);
    await seedTashasTeams(user);
    await openHome(page, 'Hi, Tasha');

    const pointer = pointerOf(testInfo);
    await expectLinkHeights(page, teams(page).getByRole('link'), pointer);
    await expectLinkHeights(page, nextStep(page).getByRole('link'), pointer);
  });

  test('a player joining the team while the home is open clears the next step and completes the roster', async ({
    page,
  }) => {
    const user = tasha();
    await signUp(page, user);
    const { sharks } = await seedTashasTeams(user);
    await openHome(page, 'Hi, Tasha');
    await expect(nextStep(page)).toContainText('Sand Sharks needs 1 more player');

    await addToTeam(sharks, await seedUser(newUser('Fourth')));
    await expect(nextStep(page)).toHaveCount(0);
    await expect(cardOf(page, 'Sand Sharks')).toContainText('4 of 4 needed');
  });

  test('a team added while the home is open takes the new-user state away', async ({ page }) => {
    const user = tasha();
    await signUp(page, user);
    await expect(homeHeading(page)).toHaveText('Hi, Tasha');
    await expect(
      main(page).getByRole('heading', { level: 2, name: "You're not on a team yet" }),
    ).toBeVisible();

    await seedTashasTeams(user);
    await expect(teams(page).getByRole('heading', { level: 3 })).toHaveText([
      'Sand Sharks',
      'Pair of Aces',
    ]);
    await expect(main(page)).not.toContainText("You're not on a team yet");
  });

  test('a 60-character team name and first name stay inside the screen at 320px', async ({
    page,
  }) => {
    const unbroken = 'W'.repeat(60);
    const user = { ...newUser('Long'), name: unbroken };
    await signUp(page, user);
    const tenant = await gulfCoast();
    await convexRun('testing:seedTeam', {
      organizationSlug: tenant.slug,
      leagueSlug: slugOf(SUNDAY),
      seasonSlug: SUMMER.slug,
      name: unbroken,
      captainEmail: user.email,
    });
    await openHome(page, `Hi, ${unbroken}`);

    await expect(cardOf(page, unbroken)).toBeVisible();
    expect(await checkReflow(page)).toMatchObject({ passed: true });
  });
});
