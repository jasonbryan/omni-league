import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { signUp } from './support/session';
import { screenshot } from './support/screenshot';
import { dateFromToday, seedSeasons, seedTenant, type Tenant } from './support/tenant';
import { newUser, seedUser, type TestUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LEAGUE = 'Sunday Reverse Coed 4s';
const LEAGUE_SLUG = 'sunday-reverse-coed-4s';
const SEASON = 'summer-open';
const DAY = 24 * 60 * 60 * 1000;

async function seedTeam(captain: TestUser): Promise<{ tenant: Tenant; teamId: string }> {
  const tenant = await seedTenant({
    name: 'E2E Team Invites',
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
      slug: SEASON,
      startDate: dateFromToday(40),
      endDate: dateFromToday(100),
      registrationDeadline: dateFromToday(20),
    },
  ]);
  const { teamId } = (await convexRun('testing:seedTeam', {
    organizationSlug: tenant.slug,
    leagueSlug: LEAGUE_SLUG,
    seasonSlug: SEASON,
    name: 'Sand Sharks',
    captainEmail: captain.email,
  })) as { teamId: string };
  return { tenant, teamId };
}

const addInvite = (teamId: string, email: string, expiresAt = Date.now() + 14 * DAY) =>
  convexRun('testing:addTeamInvite', { teamId, email, expiresAt });

const email = (page: Page) => page.locator('#email');
const createButton = (page: Page) => page.getByRole('button', { name: 'Create invite link' });
const pendingList = (page: Page) => page.locator('#pending-list');
const rosterRows = (page: Page) => page.locator('section[aria-labelledby="roster-heading"] li');
const revokeButton = (page: Page, address: string) =>
  page.getByRole('button', { name: `Revoke the invite to ${address}` });

async function openTeam(page: Page, teamId: string): Promise<void> {
  await page.goto(`/app/teams/${teamId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Sand Sharks' })).toBeVisible();
}

async function invite(page: Page, address: string): Promise<void> {
  await email(page).fill(address);
  await createButton(page).click();
}

test.describe('team invites', () => {
  test('the captain invites by email: the link shows once, the invite is pending, and the roster is unchanged', async ({
    page,
  }, testInfo) => {
    const captain = newUser('Captain');
    await signUp(page, captain);
    const { teamId } = await seedTeam(captain);
    await openTeam(page, teamId);
    await expect(page.getByTestId('roster-count')).toHaveText('1 of 4 players');
    await expect(page.getByTestId('pending-count')).toHaveText('0 pending invites');
    await expect(page.getByText('No pending invites')).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '131-team-captain-empty');

    await createButton(page).click();
    await expect(page.locator('#email-error')).toHaveText('Enter their email address.');
    await expect(email(page)).toBeFocused();
    await screenshot(page, testInfo, '131-invite-empty');

    await invite(page, 'x@');
    await expect(page.locator('#email-error')).toHaveText(
      'Enter an email address like name@example.com.',
    );
    await screenshot(page, testInfo, '131-invite-malformed');

    await invite(page, 'x@example.com');
    const link = page.locator('#invite-link');
    await expect(link).toHaveValue(/\/teams\/join#[A-Za-z0-9_-]{43}$/);
    await expect(page.locator('#invite-link-heading')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Copy link' })).toBeVisible();
    await expect(pendingList(page)).toContainText('x@example.com');
    await expect(page.getByTestId('roster-count')).toHaveText('1 of 4 players');
    await expect(page.getByTestId('pending-count')).toHaveText('1 pending invite');
    await expect(rosterRows(page)).toHaveCount(1);
    await expectAccessible(page);
    await screenshot(page, testInfo, '131-invite-link');

    const token = (await link.inputValue()).split('#')[1];
    await page.reload();
    await expect(pendingList(page)).toContainText('x@example.com');
    await expect(page.locator('#invite-link')).toHaveCount(0);
    expect(await page.content()).not.toContain(token);

    await revokeButton(page, 'x@example.com').click();
    const status = page.getByRole('status').filter({ hasText: 'Invite to x@example.com revoked.' });
    await expect(status).toBeFocused();
    await expect(pendingList(page)).toHaveCount(0);
    await expect(page.getByTestId('pending-count')).toHaveText('0 pending invites');
    await expectAccessible(page);
    await screenshot(page, testInfo, '131-invite-revoked');
  });

  test('a member sees no form, no pending list, and no addresses', async ({ page }, testInfo) => {
    const captain = await seedUser(newUser('Captain'));
    const member = newUser('Member');
    await signUp(page, member);
    const { teamId } = await seedTeam(captain);
    await addInvite(teamId, 'hidden@example.com');
    await convexRun('testing:addToTeam', { teamId, email: member.email });
    await openTeam(page, teamId);
    await expect(rosterRows(page)).toHaveCount(2);
    await expect(email(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Pending invites' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Invite players' })).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('@');
    await expectAccessible(page);
    await screenshot(page, testInfo, '131-member-view');
  });

  test('an organizer of the league invites and revokes on the team page', async ({
    page,
  }, testInfo) => {
    const captain = await seedUser(newUser('Captain'));
    const organizer = newUser('Organizer');
    await signUp(page, organizer);
    const { tenant, teamId } = await seedTeam(captain);
    await convexRun('testing:addLeagueOrganizer', {
      organizationSlug: tenant.slug,
      email: organizer.email,
      leagueSlugs: [LEAGUE_SLUG],
    });
    await openTeam(page, teamId);
    await expect(
      page.getByText(`You’re an organizer of ${LEAGUE}, so you can manage this team’s roster.`),
    ).toBeVisible();
    await invite(page, 'y@example.com');
    await expect(page.locator('#invite-link')).toHaveValue(/\/teams\/join#/);
    await expect(pendingList(page)).toContainText('y@example.com');
    await expectAccessible(page);
    await screenshot(page, testInfo, '131-team-organizer');

    await revokeButton(page, 'y@example.com').click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Invite to y@example.com revoked.' }),
    ).toBeFocused();
    await expect(pendingList(page)).toHaveCount(0);
  });
});

test.describe('team invites: refusals', () => {
  test.use({ expectedConvexErrors: ['teamInvites:create'] });

  test('an expired pending invite and a rostered member are refused; after revoking, the address invites again', async ({
    page,
  }, testInfo) => {
    const captain = newUser('Captain');
    await signUp(page, captain);
    const member = await seedUser(newUser('Member'));
    const { teamId } = await seedTeam(captain);
    await addInvite(teamId, 'kai@example.com', Date.now() - DAY);
    await convexRun('testing:addToTeam', { teamId, email: member.email });
    await openTeam(page, teamId);
    await expect(pendingList(page)).toContainText('Expired');
    await expect(pendingList(page)).toContainText('Revoke it to invite this address again.');

    await invite(page, 'Kai@Example.com ');
    await expect(page.locator('#email-error')).toHaveText(
      'kai@example.com already has a pending invite. To send a new link, revoke that invite first.',
    );
    await expect(email(page)).toBeFocused();
    await expect(email(page)).toHaveValue('Kai@Example.com');
    await expectAccessible(page);
    await screenshot(page, testInfo, '131-invite-already-invited');

    await invite(page, member.email);
    await expect(page.locator('#email-error')).toHaveText(
      `${member.email} is already on the team.`,
    );
    await screenshot(page, testInfo, '131-invite-on-team');

    await revokeButton(page, 'kai@example.com').click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Invite to kai@example.com revoked.' }),
    ).toBeFocused();
    await invite(page, 'kai@example.com');
    await expect(page.locator('#invite-link')).toHaveValue(/\/teams\/join#/);
    await expect(pendingList(page)).toContainText('kai@example.com');
  });
});

test.describe('team invites: a full team', () => {
  const FULL = 'roster-cap';

  async function seedFullTeam(captain: TestUser, member: TestUser): Promise<string> {
    const { tenant } = await seedTeam(captain);
    await convexRun('testing:seedSeason', {
      organizationSlug: tenant.slug,
      leagueSlug: LEAGUE_SLUG,
      name: 'Roster Cap',
      slug: FULL,
      startDate: dateFromToday(40),
      endDate: dateFromToday(100),
      registrationDeadline: dateFromToday(20),
      minimumRosterSize: 4,
      maxRosterSize: 4,
      status: 'published',
    });
    const { teamId } = (await convexRun('testing:seedTeam', {
      organizationSlug: tenant.slug,
      leagueSlug: LEAGUE_SLUG,
      seasonSlug: FULL,
      name: 'Sand Sharks',
      captainEmail: captain.email,
    })) as { teamId: string };
    const other = await seedUser(newUser('Player'));
    await convexRun('testing:addToTeam', { teamId, email: member.email });
    await convexRun('testing:addToTeam', { teamId, email: other.email });
    await addInvite(teamId, 'before@example.com');
    await convexRun('testing:addMinorToTeam', {
      teamId,
      guardianEmail: member.email,
      minorName: 'Theo Bell',
    });
    return teamId;
  }

  test('the captain sees 4 of 4 players, the full note, and no invite form; the pending invite stays listed', async ({
    page,
  }, testInfo) => {
    const captain = newUser('Captain');
    await signUp(page, captain);
    const member = await seedUser(newUser('Member'));
    const teamId = await seedFullTeam(captain, member);
    await openTeam(page, teamId);
    await expect(page.getByTestId('roster-count')).toHaveText('4 of 4 players');
    await expect(page.getByTestId('roster-note')).toHaveText(
      'The team is full: 4 players is this season’s maximum.',
    );
    await expect(email(page)).toHaveCount(0);
    await expect(page.locator('#minor-name')).toHaveCount(0);
    const full = page.getByTestId('team-full');
    await expect(full.getByRole('heading', { name: 'Invite players' })).toBeVisible();
    await expect(full).toContainText(
      'Sand Sharks has 4 players, this season’s maximum. Remove a player to invite someone else or add a minor.',
    );
    await expect(pendingList(page)).toContainText('before@example.com');
    await expectAccessible(page);
    await screenshot(page, testInfo, '144-team-full');
  });

  test('a teammate sees Add a minor give way to the full note', async ({ page }, testInfo) => {
    const captain = await seedUser(newUser('Captain'));
    const member = newUser('Member');
    await signUp(page, member);
    const teamId = await seedFullTeam(captain, member);
    await openTeam(page, teamId);
    await expect(page.getByTestId('roster-count')).toHaveText('4 of 4 players');
    await expect(page.locator('#minor-name')).toHaveCount(0);
    const full = page.getByTestId('team-full');
    await expect(full.getByRole('heading', { name: 'Add a minor' })).toBeVisible();
    await expect(full).toContainText('Ask the captain to remove a player first.');
    await expectAccessible(page);
    await screenshot(page, testInfo, '144-team-full-teammate');
  });
});
