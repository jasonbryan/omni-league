import type { Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { axeScan, describeViolations, expectAccessible } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { convexRun } from './support/convex';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { otherUser, signUp } from './support/session';
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
const managementPath = (tenant: Tenant, slug: string) =>
  `/app/organizations/${tenant.slug}/tournaments/${slug}`;

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
    await expect(main.locator('app-team-invite-panel')).toBeVisible();
    await expect(main.locator('app-season-teams-panel')).toContainText('Teams in this tournament');
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

  test('full: the card reads Full and offers the waitlist, and the register route is the waitlist form', async ({
    page,
  }, testInfo) => {
    const { tenant, paths } = await seed();
    await seedTeam(tenant, FULL, 'One', await seedUser(newUser('One')));
    await seedTeam(tenant, FULL, 'Two', await seedUser(newUser('Two')));
    await page.goto(paths.full);
    await expect(card(page).locator('p').first()).toHaveText('Full');
    await expect(card(page)).not.toContainText('Registration open');
    await expectAccessible(page);
    await screenshot(page, testInfo, '341-tournament-full');

    await signUp(page, newUser('Third'));
    await page.goto(paths.full);
    await card(page).getByRole('link', { name: 'Join the waitlist' }).click();
    await expect(page).toHaveURL(`${baseURL}${registerPath(tenant, FULL)}`);
    await expect(page.locator('main form [data-slot="alert"]')).toContainText(
      'This tournament is full, so your team joins the waitlist.',
    );
    await expect(teamName(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join the waitlist' })).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '341-register-full');
  });

  test('a captain joins the waitlist of a full tournament, sees position 1, and sees it again after a reload', async ({
    page,
  }, testInfo) => {
    const { tenant } = await seed();
    await seedTeam(tenant, FULL, 'One', await seedUser(newUser('One')));
    await seedTeam(tenant, FULL, 'Two', await seedUser(newUser('Two')));
    await signUp(page, newUser('Late'));
    await page.goto(registerPath(tenant, FULL));
    await teamName(page).fill('Late Lobsters');
    await page.getByRole('button', { name: 'Join the waitlist' }).click();
    const status = page
      .getByRole('main')
      .getByRole('status')
      .filter({ hasText: 'is on the waitlist' });
    await expect(status).toHaveText(
      'Late Lobsters is on the waitlist, position 1. Your team is first in line. If an organizer gives your team a place, it appears under Your teams, and you can invite your players.',
    );
    await expect(status).toBeFocused();
    await expect(page).toHaveURL(`${baseURL}${registerPath(tenant, FULL)}`);
    await expect(page.getByRole('link', { name: 'Back to the tournament page' })).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '341-register-waitlisted');

    await page.reload();
    await expect(alert(page)).toContainText('Late Lobsters is on the waitlist, position 1.');
    await expect(teamName(page)).toHaveCount(0);
  });

  test('full: the organization page shows Full on the row and the open card, with no Register link, and Registration open for a tournament with room', async ({
    page,
  }, testInfo) => {
    const { tenant } = await seed();
    await seedTeam(tenant, FULL, 'One', await seedUser(newUser('One')));
    await seedTeam(tenant, FULL, 'Two', await seedUser(newUser('Two')));
    await page.goto(tenant.path);
    const row = (name: string) =>
      page.locator('#tournaments li').filter({ has: page.getByRole('heading', { name }) });
    await expect(row('Tiny Open')).toContainText('Full');
    await expect(row('Tiny Open')).not.toContainText('Registration open');
    await expect(row('Tiny Open').getByRole('link', { name: /^Register/ })).toHaveCount(0);
    await expect(row('Gulf Coast Beach Open')).toContainText('Registration open');
    await expect(
      row('Gulf Coast Beach Open').getByRole('link', {
        name: 'Register for Gulf Coast Beach Open',
      }),
    ).toBeVisible();
    const card = (name: string) =>
      page.locator('#registration-open li').filter({ has: page.getByRole('heading', { name }) });
    await expect(card('Tiny Open')).toContainText('Full');
    await expect(card('Tiny Open').getByRole('link', { name: /^Register/ })).toHaveCount(0);
    await expect(
      card('Gulf Coast Beach Open').getByRole('link', { name: /^Register/ }),
    ).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '340-organization-full');
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
  test.use({ expectedConvexErrors: ['teams:registerForTournamentOrWaitlist'] });

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

test.describe('the waitlist of a full tournament: an organizer', () => {
  test.use({ expectedConvexErrors: ['waitlist:promoteForTournament'] });

  test('sees the waiting team with no roster entries, is refused a promotion with no room, raises the maximum, promotes it, and the captain sees the team', async ({
    page,
    browser,
  }, testInfo) => {
    const captain = newUser('Late');
    const admin = newUser('Admin');
    const [captainPage] = await Promise.all([otherUser(browser, captain), signUp(page, admin)]);
    const { tenant } = await seed();
    await convexRun('testing:addMembership', {
      organizationSlug: tenant.slug,
      email: admin.email,
      role: 'orgAdmin',
    });
    await seedTeam(tenant, FULL, 'One', await seedUser(newUser('One')));
    await seedTeam(tenant, FULL, 'Two', await seedUser(newUser('Two')));
    await convexRun('testing:seedTournamentWaitlistEntry', {
      organizationSlug: tenant.slug,
      tournamentSlug: FULL,
      teamName: 'Late Lobsters',
      captainEmail: captain.email,
    });

    await page.goto(managementPath(tenant, FULL));
    const panel = page.locator('#waitlist');
    await expect(panel.getByRole('heading', { level: 2, name: 'Waitlist' })).toBeVisible();
    await expect(panel.getByTestId('waitlist-count')).toHaveText('1 waiting');
    await expect(panel.locator('[data-slot="alert"]')).toContainText('The tournament is full');
    const row = panel.locator('#waitlist-list > li');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Late Lobsters');
    await expect(row).toContainText('Position 1');
    await expect(row).toContainText(`Captain: ${captain.name}`);
    await expect(row.getByRole('link', { name: captain.email })).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '341-management-waitlist');

    await panel.getByRole('button', { name: 'Promote Late Lobsters' }).click();
    const refused = panel.locator('[role="alert"]');
    await expect(refused).toContainText('Late Lobsters could not be promoted.');
    await expect(refused).toContainText('The tournament is full. Raise the maximum teams first.');
    await expect(refused).toBeFocused();
    await expect(row).toHaveCount(1);
    await screenshot(page, testInfo, '341-management-no-room');

    const maximum = page.locator('#details-maximum-teams');
    await maximum.fill('3');
    await page
      .locator('#edit-details form')
      .getByRole('button', { name: /^Save changes/ })
      .click();
    await expect(page.locator('#edit-details [data-slot="save-status"]')).toContainText(
      'Details saved.',
    );
    await expect(
      panel.locator('[data-slot="alert"]').filter({ hasText: 'Room for 1 more team' }),
    ).toBeVisible();

    await panel.getByRole('button', { name: 'Promote Late Lobsters' }).click();
    const promoted = panel.locator('[role="status"][data-slot="alert"]');
    await expect(promoted).toHaveText(
      `Late Lobsters is a team now. ${captain.name} is its captain and can invite players. The tournament has 3 of 3 teams.`,
    );
    await expect(promoted).toBeFocused();
    await expect(panel.getByTestId('waitlist-count')).toHaveCount(0);
    await expect(panel).toContainText('No teams waiting');
    await expectAccessible(page);
    await screenshot(page, testInfo, '341-management-promoted');

    await captainPage.goto('/app');
    const teams = captainPage.getByRole('region', { name: 'Your teams' });
    await expect(teams.getByRole('heading', { level: 3, name: 'Late Lobsters' })).toBeVisible();
    await teams.getByRole('link', { name: 'Late Lobsters' }).click();
    await expect(
      captainPage.getByRole('heading', { level: 1, name: 'Late Lobsters' }),
    ).toBeVisible();
    await expect(captainPage.getByTestId('roster-count')).toHaveText('1 of 2 players');
    const roster = captainPage.locator('section[aria-labelledby="roster-heading"] ul > li');
    await expect(roster).toHaveCount(1);
    await expect(roster).toContainText(captain.name);
    await expect(roster).toContainText('Captain');
  });
});

test.describe('Your teams', () => {
  test('lists a tournament team with the tournament’s name and dates, and a next step to invite players', async ({
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
    const next = page.getByRole('region', { name: 'Next step' });
    await expect(next).toContainText('Sand Crabs needs 1 more player');
    await expect(next).toContainText('Gulf Coast Beach Open needs 2 players per team by');
    await expect(next.getByRole('link', { name: 'Invite players to Sand Crabs' })).toHaveAttribute(
      'href',
      `/app/teams/${teamId}#invite`,
    );
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

const DAY = 24 * 60 * 60 * 1000;
const newToken = () => randomBytes(32).toString('base64url');
const main = (page: Page) => page.getByRole('main');
const rosterRows = (page: Page) =>
  page.locator('section[aria-labelledby="roster-heading"] ul > li');

async function seedInvite(teamId: string, email: string): Promise<string> {
  const token = newToken();
  await convexRun('testing:addTeamInvite', {
    teamId,
    email,
    expiresAt: Date.now() + 12 * DAY,
    token,
  });
  return token;
}

async function openLink(page: Page, token: string) {
  await page.goto(`/teams/join#${token}`);
  await expect(page).toHaveURL(`${baseURL}/teams/join`);
}

test.describe('invites and joining a tournament team', () => {
  test('the captain invites by email: the link shows once, the invite is pending, and the roster is unchanged', async ({
    page,
  }, testInfo) => {
    const { tenant } = await seed();
    const captain = newUser('Inviter');
    await signUp(page, captain);
    const { teamId } = await seedTeam(tenant, OPEN, 'Sand Crabs', captain);
    await page.goto(`/app/teams/${teamId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Sand Crabs' })).toBeVisible();
    await expect(page.getByTestId('pending-count')).toHaveText('0 pending invites');
    await expect(page.getByText('No pending invites')).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '370-team-captain');

    await page.locator('#email').fill('partner@example.com');
    await page.getByRole('button', { name: 'Create invite link' }).click();
    await expect(page.locator('#invite-link')).toHaveValue(/\/teams\/join#[A-Za-z0-9_-]{43}$/);
    await expect(page.locator('#pending-list')).toContainText('partner@example.com');
    await expect(page.getByTestId('pending-count')).toHaveText('1 pending invite');
    await expect(page.getByTestId('roster-count')).toHaveText('1 of 2 players');
    await expect(rosterRows(page)).toHaveCount(1);
    await expectAccessible(page);
    await screenshot(page, testInfo, '370-invite-link');
  });

  test('a partner signs up with the invited address and accepts: the invite names the tournament and links to it, and they are on the roster', async ({
    page,
  }, testInfo) => {
    const { tenant, paths } = await seed();
    const captain = await seedUser(newUser('Captain'));
    const { teamId } = await seedTeam(tenant, OPEN, 'Sand Crabs', captain);
    const partner = newUser('Partner');
    const token = await seedInvite(teamId, partner.email);

    await openLink(page, token);
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Join Sand Crabs');
    const details = main(page).locator('dl');
    for (const value of ['Sand Crabs', 'Gulf Coast Beach Open', tenant.name]) {
      await expect(details).toContainText(value);
    }
    await expect(details).not.toContainText('Season');
    await expect(details.getByRole('link', { name: 'Gulf Coast Beach Open' })).toHaveAttribute(
      'href',
      paths.open,
    );
    await expectAccessible(page);
    await screenshot(page, testInfo, '370-join-signed-out');

    await main(page).getByRole('link', { name: 'Create an account' }).click();
    await page.locator('#name').fill(partner.name);
    await page.locator('#email').fill(partner.email);
    await page.locator('#password').fill(partner.password);
    await page.getByRole('checkbox', { name: 'I am 18 or older' }).click();
    await page.getByRole('button', { name: /Create account/ }).click();
    await expect(page).toHaveURL(`${baseURL}/teams/join`, { timeout: 20_000 });
    await expectAccessible(page);
    await screenshot(page, testInfo, '370-join-ready');

    await main(page).getByRole('button', { name: 'Accept invite' }).click();
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('You’re on Sand Crabs');
    await expect(main(page)).toContainText(
      `You’re on the roster for Gulf Coast Beach Open. ${captain.name} is the captain.`,
    );
    await expectAccessible(page);
    await screenshot(page, testInfo, '370-join-accepted');

    await main(page).getByRole('link', { name: 'Go to Sand Crabs' }).click();
    await expect(page).toHaveURL(`${baseURL}/app/teams/${teamId}`);
    await expect(page.getByTestId('roster-count')).toHaveText('2 of 2 players');
    await expect(rosterRows(page).filter({ hasText: partner.name })).toHaveCount(1);
    await expect(main(page).locator('app-add-minor-panel')).toBeVisible();
  });

  test.describe('refused', () => {
    test.use({ expectedConvexErrors: ['teamInvites:accept'] });

    test('someone on another team in the tournament is refused, naming that team, and may still add a minor', async ({
      page,
    }, testInfo) => {
      const { tenant } = await seed();
      const captain = await seedUser(newUser('Captain'));
      const { teamId } = await seedTeam(tenant, OPEN, 'Sand Crabs', captain);
      const rival = newUser('Rival');
      await signUp(page, rival);
      await seedTeam(tenant, OPEN, 'Net Results', rival);
      const token = await seedInvite(teamId, rival.email);

      await openLink(page, token);
      await main(page).getByRole('button', { name: 'Accept invite' }).click();
      const alert = main(page).getByRole('alert');
      await expect(alert).toContainText('You’re already on Net Results in this tournament.');
      await expect(alert).toContainText(
        'Each person plays on one team per tournament, so you can’t join Sand Crabs yourself. You can still add a minor you’re responsible for.',
      );
      await expect(alert).toBeFocused();
      await expect(
        main(page).getByRole('checkbox', { name: 'Join the roster myself' }),
      ).toBeDisabled();
      await expect(main(page).locator('#join-self-description')).toHaveText(
        'Not available: you’re on Net Results in this tournament.',
      );
      await expectAccessible(page);
      await screenshot(page, testInfo, '370-join-other-team');
    });

    test('a captain waiting on the tournament waitlist is refused, naming the waiting team and the tournament', async ({
      page,
    }, testInfo) => {
      const { tenant } = await seed();
      const captain = await seedUser(newUser('Captain'));
      const { teamId } = await seedTeam(tenant, FULL, 'One', captain);
      await seedTeam(tenant, FULL, 'Two', await seedUser(newUser('Two')));
      const waiting = newUser('Waiting');
      await signUp(page, waiting);
      await convexRun('testing:seedTournamentWaitlistEntry', {
        organizationSlug: tenant.slug,
        tournamentSlug: FULL,
        teamName: 'Late Lobsters',
        captainEmail: waiting.email,
      });
      const token = await seedInvite(teamId, waiting.email);

      await openLink(page, token);
      await main(page).getByRole('button', { name: 'Accept invite' }).click();
      const alert = main(page).getByRole('alert');
      await expect(alert).toContainText(
        'You’re on the waitlist with Late Lobsters in this tournament.',
      );
      await expect(alert).toContainText(
        'Late Lobsters is at position 1. While it waits, you can’t join another team in this tournament or add a minor to one.',
      );
      await expect(alert).not.toContainText('season');
      await expectAccessible(page);
      await screenshot(page, testInfo, '341-join-waitlisted');
    });
  });

  test('a captain of another team in the tournament sees the roster, and the tournament’s teams link to each team page', async ({
    page,
  }, testInfo) => {
    const { tenant } = await seed();
    const captain = await seedUser(newUser('Captain'));
    const { teamId } = await seedTeam(tenant, OPEN, 'Sand Crabs', captain);
    const rival = newUser('Rival');
    await signUp(page, rival);
    const { teamId: rivalsId } = await seedTeam(tenant, OPEN, 'Net Results', rival);
    await page.goto(`/app/teams/${teamId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Sand Crabs' })).toBeVisible();
    await expect(rosterRows(page)).toHaveCount(1);
    await expect(rosterRows(page)).toContainText(captain.name);
    await expect(main(page).locator('app-team-invite-panel')).toHaveCount(0);
    const teams = main(page).locator('app-season-teams-panel');
    await expect(teams.getByRole('heading', { name: 'Teams in this tournament' })).toBeVisible();
    await expect(teams.getByTestId('season-teams-count')).toHaveText('2 teams');
    await expectAccessible(page);
    await screenshot(page, testInfo, '370-other-team-roster');

    await teams.getByRole('link', { name: /Net Results/ }).click();
    await expect(page).toHaveURL(`${baseURL}/app/teams/${rivalsId}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Net Results' })).toBeVisible();
  });

  test('the captain removes a player after a confirmation, and the roster and count follow', async ({
    page,
  }, testInfo) => {
    const { tenant } = await seed();
    const captain = newUser('Remover');
    await signUp(page, captain);
    const { teamId } = await seedTeam(tenant, OPEN, 'Sand Crabs', captain);
    const player = await seedUser(newUser('Leaver'));
    await convexRun('testing:addToTeam', { teamId, email: player.email });
    await page.goto(`/app/teams/${teamId}`);
    await expect(page.getByTestId('roster-count')).toHaveText('2 of 2 players');
    await page.getByRole('button', { name: `Remove ${player.name} from Sand Crabs` }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(
      dialog.getByRole('heading', { name: `Remove ${player.name} from Sand Crabs?` }),
    ).toBeVisible();
    // The modal holds focus, so the page-wide Tab walk does not apply.
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    await screenshot(page, testInfo, '370-remove-confirm');
    await dialog.getByRole('button', { name: 'Remove player' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(rosterRows(page)).toHaveCount(1);
    await expect(page.getByTestId('roster-count')).toHaveText('1 of 2 players');
    await expect(
      page.locator('section[aria-labelledby="roster-heading"] [role="status"]'),
    ).toContainText(`${player.name} was removed from Sand Crabs.`);
  });
});
