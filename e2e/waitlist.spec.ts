import type { Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { otherUser, signUp } from './support/session';
import { dateFromToday, seedTenant, type Tenant } from './support/tenant';
import { newUser, seedUser, type TestUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LEAGUE = 'Sunday Reverse Coed 4s';
const LEAGUE_SLUG = 'sunday-reverse-coed-4s';
const FULL = 'full-season';
const DAY = 24 * 60 * 60 * 1000;

const main = (page: Page) => page.getByRole('main');
const registerPath = (tenant: Tenant) => `/app/register/${tenant.slug}/${LEAGUE_SLUG}/${FULL}/team`;
const seasonPagePath = (tenant: Tenant) => `${tenant.path}/leagues/${LEAGUE_SLUG}/seasons/${FULL}`;
const managementPath = (tenant: Tenant) =>
  `/app/organizations/${tenant.slug}/leagues/${LEAGUE_SLUG}/seasons/${FULL}`;
const waitlist = (page: Page) => page.locator('#waitlist');

/** A published season at its maximum of 2 teams, open for registration. */
async function seedFullSeason(): Promise<{ tenant: Tenant; teamIds: string[] }> {
  const tenant = await seedTenant({
    name: 'E2E Waitlist',
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
  await convexRun('testing:seedSeason', {
    organizationSlug: tenant.slug,
    leagueSlug: LEAGUE_SLUG,
    name: 'Full Season',
    slug: FULL,
    startDate: dateFromToday(40),
    endDate: dateFromToday(100),
    registrationDeadline: dateFromToday(20),
    minimumRosterSize: 4,
    maxTeams: 2,
    status: 'published',
  });
  const teamIds: string[] = [];
  for (const name of ['Pair of Aces', 'Two Tall']) {
    const captain = await seedUser(newUser('Captain'));
    const { teamId } = (await convexRun('testing:seedTeam', {
      organizationSlug: tenant.slug,
      leagueSlug: LEAGUE_SLUG,
      seasonSlug: FULL,
      name,
      captainEmail: captain.email,
    })) as { teamId: string };
    teamIds.push(teamId);
  }
  return { tenant, teamIds };
}

async function seedWaiting(tenant: Tenant, teamName: string, captain: TestUser): Promise<void> {
  await convexRun('testing:seedWaitlistEntry', {
    organizationSlug: tenant.slug,
    leagueSlug: LEAGUE_SLUG,
    seasonSlug: FULL,
    teamName,
    captainEmail: captain.email,
  });
}

async function asOrgAdmin(page: Page, tenant: Tenant): Promise<void> {
  const admin = newUser('Admin');
  await signUp(page, admin);
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: admin.email,
    role: 'orgAdmin',
  });
}

test.describe('Waitlist: a captain', () => {
  test('joins the waitlist of a full season from the season page, sees position 1, and sees it again after a reload', async ({
    page,
  }, testInfo) => {
    const { tenant } = await seedFullSeason();
    await signUp(page, newUser('Late'));
    await page.goto(seasonPagePath(tenant));
    await page.locator('#registration').getByRole('link', { name: 'Join the waitlist' }).click();
    await expect(page).toHaveURL(`${baseURL}${registerPath(tenant)}`);
    await expect(main(page).locator('form [data-slot="alert"]')).toContainText(
      'This season is full, so your team joins the waitlist.',
    );

    await page.locator('#team-name').fill('Late Lobsters');
    await main(page).getByRole('button', { name: 'Join the waitlist' }).click();
    const status = main(page).getByRole('status').filter({ hasText: 'is on the waitlist' });
    await expect(status).toHaveText(
      'Late Lobsters is on the waitlist, position 1. Your team is first in line. If an organizer gives your team a place, it appears under Your teams, and you can invite your players.',
    );
    await expect(status).toBeFocused();
    await expect(page).toHaveURL(`${baseURL}${registerPath(tenant)}`);
    await expect(main(page).getByRole('link', { name: 'Back to the season page' })).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '145-register-waitlisted');

    await page.reload();
    await expect(main(page).locator('[data-slot="alert"]')).toContainText(
      'Late Lobsters is on the waitlist, position 1.',
    );
    await expect(page.locator('#team-name')).toHaveCount(0);
  });
});

test.describe('Waitlist: an organizer', () => {
  test.use({ expectedConvexErrors: ['waitlist:promote'] });

  test('sees the waiting team, is refused a promotion with no room, raises the limit, promotes it, and the captain sees the team', async ({
    page,
    browser,
  }, testInfo) => {
    const { tenant } = await seedFullSeason();
    const captain = newUser('Late');
    const captainPage = await otherUser(browser, captain);
    await seedWaiting(tenant, 'Late Lobsters', captain);
    await asOrgAdmin(page, tenant);

    await page.goto(managementPath(tenant));
    const panel = waitlist(page);
    await expect(panel.getByRole('heading', { level: 2, name: 'Waitlist' })).toBeVisible();
    await expect(page.getByTestId('waitlist-tile')).toHaveText('1');
    await expect(panel.getByTestId('waitlist-count')).toHaveText('1 waiting');
    await expect(panel.getByRole('note')).toContainText('The season is full');
    const row = panel.locator('#waitlist-list > li');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Position 1');
    await expect(row).toContainText('Late Lobsters');
    await expect(row).toContainText(`Captain: ${captain.name}`);
    await expect(row.getByRole('link', { name: captain.email })).toHaveAttribute(
      'href',
      `mailto:${captain.email}`,
    );
    await expectAccessible(page);
    await screenshot(page, testInfo, '145-waitlist-populated');

    await panel.getByRole('button', { name: 'Promote Late Lobsters' }).click();
    const refused = panel.getByRole('alert');
    await expect(refused).toHaveText(
      'Late Lobsters could not be promoted. The season is full. Raise the maximum teams first.',
    );
    await expect(refused).toBeFocused();
    await expect(page.getByTestId('team-count')).toHaveText('2 of 2');
    await expectAccessible(page);
    await screenshot(page, testInfo, '145-promote-refused');

    const limits = page.locator('section[aria-labelledby="limits-heading"]');
    await limits.getByRole('button', { name: 'Edit maximum teams' }).click();
    await page.locator('#edit-maximum-teams').fill('3');
    await limits.getByRole('button', { name: 'Save changes' }).click();
    await expect(limits.getByRole('status')).toHaveText(
      'Maximum teams saved. The season takes up to 3 teams. Teams on the waitlist keep their place: promote them to fill the place.',
    );
    await expect(panel.getByRole('note')).toContainText('Room for 1 more team');

    await panel.getByRole('button', { name: 'Promote Late Lobsters' }).click();
    const promoted = panel.getByRole('status').filter({ hasText: 'is a team now' });
    await expect(promoted).toHaveText(
      `Late Lobsters is a team now. ${captain.name} is its captain and can invite players. The season has 3 of 3 teams.`,
    );
    await expect(promoted).toBeFocused();
    await expect(page.getByTestId('team-count')).toHaveText('3 of 3');
    await expect(page.locator('#teams-list')).toContainText('Late Lobsters');
    await expect(page.getByTestId('waitlist-tile')).toHaveText('0');
    await expect(panel).toContainText('No teams waiting');
    await expectAccessible(page);
    await screenshot(page, testInfo, '145-waitlist-empty-after-promote');

    await captainPage.goto('/app');
    await expect(captainPage.getByRole('main')).toContainText('Late Lobsters');
    await captainPage.context().close();
  });
});

test.describe('Waitlist: the join page', () => {
  test.use({ expectedConvexErrors: ['teamInvites:accept'] });

  test('a waitlisted captain is refused an invite to a team in the season, with the position, and the invite stays pending', async ({
    page,
  }, testInfo) => {
    const { tenant, teamIds } = await seedFullSeason();
    const captain = newUser('Late');
    await signUp(page, captain);
    await seedWaiting(tenant, 'Late Lobsters', captain);
    const token = randomBytes(32).toString('base64url');
    await convexRun('testing:addTeamInvite', {
      teamId: teamIds[0],
      email: captain.email,
      expiresAt: Date.now() + 12 * DAY,
      token,
    });

    await page.goto(`/teams/join#${token}`);
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Join Pair of Aces');
    await main(page).getByRole('button', { name: 'Accept invite' }).click();
    const alert = main(page).getByRole('alert');
    await expect(alert).toContainText('You’re on the waitlist with Late Lobsters in this season.');
    await expect(alert).toContainText(
      'Late Lobsters is at position 1. While it waits, you can’t join another team in this season or add a minor to one.',
    );
    await expect(alert).toBeFocused();
    await expect(main(page).getByRole('button', { name: 'Accept invite' })).toHaveCount(0);
    await expect(main(page).getByRole('link', { name: 'Go to your account' })).toHaveAttribute(
      'href',
      '/app',
    );
    await expectAccessible(page);
    await screenshot(page, testInfo, '145-join-waitlisted');

    await page.goto(`/teams/join#${token}`);
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Join Pair of Aces');
  });
});
