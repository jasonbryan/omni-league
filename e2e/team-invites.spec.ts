import type { Locator, Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { signUp } from './support/session';
import { screenshot } from './support/screenshot';
import { seedBatch, type SeedBatch } from './support/seed-batch';
import { expectOnScreen } from './support/sticky-footer';
import { dateFromToday, newTenant, type Tenant } from './support/tenant';
import { newUser, seedUser, type TestUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LEAGUE = 'Sunday Reverse Coed 4s';
const LEAGUE_SLUG = 'sunday-reverse-coed-4s';
const SEASON = 'summer-open';
const DAY = 24 * 60 * 60 * 1000;

const SEASON_DATES = {
  startDate: dateFromToday(40),
  endDate: dateFromToday(100),
  registrationDeadline: dateFromToday(20),
};

async function seedTeam(
  captain: TestUser,
  ...extra: SeedBatch[]
): Promise<{ tenant: Tenant; teamId: string; teamIds: string[] }> {
  const { tenant, args } = newTenant({
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
  const { teamIds } = await seedBatch(
    {
      tenant: args,
      seasons: [{ leagueSlug: LEAGUE_SLUG, name: 'Summer Open', slug: SEASON, ...SEASON_DATES }],
      teams: [
        {
          leagueSlug: LEAGUE_SLUG,
          seasonSlug: SEASON,
          name: 'Sand Sharks',
          captainEmail: captain.email,
        },
      ],
    },
    ...extra,
  );
  return { tenant, teamId: teamIds[0], teamIds };
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

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 1024;
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
const slimBarBottom = async (page: Page) => {
  const box = await page.locator('header').first().boundingBox();
  return box ? box.y + box.height : 0;
};

async function expectBelowSlimBar(page: Page, section: Locator, target: Locator): Promise<void> {
  await expectOnScreen(page, target);
  const top = await section.evaluate((element) => element.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(await slimBarBottom(page));
}

async function expectFocusOnPageOrMain(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.activeElement === document.body || document.activeElement?.id === 'main',
      ),
    )
    .toBe(true);
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

  test('opened at #invite, lands on the email field with the invite form below the slim bar', async ({
    page,
  }) => {
    const captain = newUser('Captain');
    await signUp(page, captain);
    const { teamId } = await seedTeam(captain);
    for (const name of ['devon', 'kai', 'priya', 'marcus', 'elena']) {
      await addInvite(teamId, `${name}@example.com`);
    }
    await page.goto(`/app/teams/${teamId}#invite`);
    await expect(pendingList(page)).toContainText('elena@example.com');
    await expect(email(page)).toBeFocused();
    await expectBelowSlimBar(page, page.locator('#invite'), email(page));
    if (isPhone(page)) expect(await scrollY(page)).toBeGreaterThan(0);
  });

  test('a member opening #invite sees nothing scroll and focus stay on <main>', async ({
    page,
  }) => {
    const captain = await seedUser(newUser('Captain'));
    const member = newUser('Member');
    await signUp(page, member);
    const { teamId } = await seedTeam(captain);
    await convexRun('testing:addToTeam', { teamId, email: member.email });
    await page.goto(`/app/teams/${teamId}#invite`);
    await expect(rosterRows(page)).toHaveCount(2);
    await expectFocusOnPageOrMain(page);
    expect(await scrollY(page)).toBe(0);
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

  async function seedFullTeam(
    captain: TestUser,
    member: TestUser,
    accounts: TestUser[],
  ): Promise<string> {
    const other = newUser('Player');
    const { teamIds } = await seedTeam(captain, {
      accounts: [...accounts, other],
      seasons: [
        {
          leagueSlug: LEAGUE_SLUG,
          name: 'Roster Cap',
          slug: FULL,
          ...SEASON_DATES,
          maxRosterSize: 4,
        },
      ],
      teams: [
        {
          leagueSlug: LEAGUE_SLUG,
          seasonSlug: FULL,
          name: 'Sand Sharks',
          captainEmail: captain.email,
          playerEmails: [member.email, other.email],
          invites: [{ email: 'before@example.com', expiresAt: Date.now() + 14 * DAY }],
          minors: [{ guardianEmail: member.email, minorName: 'Theo Bell' }],
        },
      ],
    });
    return teamIds[1];
  }

  test('the captain sees 4 of 4 players, the full note, and no invite form; the pending invite stays listed', async ({
    page,
  }, testInfo) => {
    const captain = newUser('Captain');
    await signUp(page, captain);
    const member = newUser('Member');
    const teamId = await seedFullTeam(captain, member, [member]);
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

  test('opened at #invite, the full note scrolls into view and its heading has focus', async ({
    page,
  }) => {
    const captain = newUser('Captain');
    await signUp(page, captain);
    const member = newUser('Member');
    const teamId = await seedFullTeam(captain, member, [member]);
    await page.goto(`/app/teams/${teamId}#invite`);
    const full = page.getByTestId('team-full');
    await expect(pendingList(page)).toContainText('before@example.com');
    await expect(full.getByRole('heading', { name: 'Invite players' })).toBeFocused();
    await expectBelowSlimBar(page, full, full.getByRole('heading', { name: 'Invite players' }));
  });

  test('a teammate sees Add a minor give way to the full note', async ({ page }, testInfo) => {
    const captain = newUser('Captain');
    const member = newUser('Member');
    await signUp(page, member);
    const teamId = await seedFullTeam(captain, member, [captain]);
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
