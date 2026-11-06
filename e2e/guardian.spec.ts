import type { Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { seedBatch, type BatchTeam } from './support/seed-batch';
import { signUp } from './support/session';
import { dateFromToday, newTenant, type Tenant } from './support/tenant';
import { newUser, seedUser, type TestUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LEAGUE = 'Sunday Reverse Coed 4s';
const LEAGUE_SLUG = 'sunday-reverse-coed-4s';
const SEASON = 'summer-open';
const DAY = 24 * 60 * 60 * 1000;

interface Season {
  tenant: Tenant;
  sharks: string;
  party: string;
  captain: TestUser;
  rivalCaptain: TestUser;
}

const named = (label: string, name: string): TestUser => ({ ...newUser(label), name });

interface SeasonOptions {
  /** Has already signed up in the browser. */
  captain?: TestUser;
  /** People who never sign in, for `sharks` to name. */
  accounts?: TestUser[];
  sharks?: Pick<BatchTeam, 'playerEmails' | 'minors'>;
}

/** The tenant, its season, and the teams Sand Sharks and Block Party, in one call. */
async function seedSeason({
  captain,
  accounts = [],
  sharks = {},
}: SeasonOptions = {}): Promise<Season> {
  const { tenant, args } = newTenant({
    name: 'E2E Minor Rosters',
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
  const sharksCaptain = captain ?? named('Captain', 'Tasha Greene');
  const rivalCaptain = named('Rival', 'Jalen Brooks');
  const slugs = { leagueSlug: LEAGUE_SLUG, seasonSlug: SEASON };
  const {
    teamIds: [sharksId, partyId],
  } = await seedBatch({
    tenant: args,
    accounts: [...(captain ? [] : [sharksCaptain]), rivalCaptain, ...accounts],
    seasons: [
      {
        ...slugs,
        name: 'Summer Open',
        slug: SEASON,
        startDate: dateFromToday(40),
        endDate: dateFromToday(100),
        registrationDeadline: dateFromToday(20),
      },
    ],
    teams: [
      { ...slugs, name: 'Sand Sharks', captainEmail: sharksCaptain.email, ...sharks },
      { ...slugs, name: 'Block Party', captainEmail: rivalCaptain.email },
    ],
  });
  return {
    tenant,
    sharks: sharksId,
    party: partyId,
    captain: sharksCaptain,
    rivalCaptain,
  };
}

const addPlayer = (teamId: string, user: TestUser) =>
  convexRun('testing:addToTeam', { teamId, email: user.email });

const addMinor = (teamId: string, guardian: TestUser, minorName: string) =>
  convexRun('testing:addMinorToTeam', { teamId, guardianEmail: guardian.email, minorName });

async function seedInvite(teamId: string, email: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await convexRun('testing:addTeamInvite', {
    teamId,
    email,
    expiresAt: Date.now() + 12 * DAY,
    token,
  });
  return token;
}

const main = (page: Page) => page.getByRole('main');
const roster = (page: Page) => page.locator('section[aria-labelledby="roster-heading"]');
const rosterRow = (page: Page, name: string) =>
  roster(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 3, name, exact: true }) });
const addPanel = (page: Page) => page.locator('#add-minor');

async function openTeam(page: Page, teamId: string, name: string): Promise<void> {
  await page.goto(`/app/teams/${teamId}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

test.describe('a guardian adds a minor', () => {
  test('accepts an invite with only "Add a minor": the minor is on the roster, and the guardian is not', async ({
    page,
  }, testInfo) => {
    const s = await seedSeason();
    const guardian = named('Guardian', 'Ana Rivera');
    await signUp(page, guardian);
    const token = await seedInvite(s.sharks, guardian.email);

    await page.goto(`/teams/join#${token}`);
    await expect(page).toHaveURL(`${baseURL}/teams/join`);
    const self = page.getByRole('checkbox', { name: 'Join the roster myself' });
    const minor = page.getByRole('checkbox', { name: 'Add a minor I’m responsible for' });
    await expect(self).toBeChecked();
    await expect(minor).not.toBeChecked();
    await expectAccessible(page);
    await screenshot(page, testInfo, '139-join-choices');

    await self.click();
    await page.getByRole('button', { name: 'Accept invite' }).click();
    await expect(page.locator('#choices-error')).toHaveText(
      'Choose at least one: join yourself, add a minor, or both.',
    );
    await expect(self).toBeFocused();
    await expectAccessible(page);
    await screenshot(page, testInfo, '139-join-choice-error');

    await minor.click();
    await page.getByRole('button', { name: 'Accept invite' }).click();
    await expect(page.locator('#minor-name-error')).toHaveText('Enter the minor’s name.');
    await expect(page.locator('#minor-name')).toBeFocused();
    await expectAccessible(page);
    await screenshot(page, testInfo, '139-join-minor-error');

    await page.locator('#minor-name').fill('Maya Rivera');
    await expectAccessible(page);
    await screenshot(page, testInfo, '139-join-minor');
    await page.getByRole('button', { name: 'Accept invite' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Maya Rivera is on Sand Sharks',
    );
    await expect(main(page)).toContainText('Maya Rivera is on the roster for Summer Open.');

    await page.getByRole('link', { name: 'Go to Sand Sharks' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sand Sharks' })).toBeVisible();
    await expect(roster(page).getByRole('heading', { level: 3 })).toHaveText([
      s.captain.name,
      'Maya Rivera',
    ]);
    await expect(rosterRow(page, 'Maya Rivera')).toContainText('Guardian: Ana Rivera');
    await expect(page.getByTestId('roster-count')).toHaveText('2 of 4 players');
    await expect(page.getByTestId('viewer-note')).toHaveText(
      'You’re the guardian of a minor on this team.',
    );
  });
});

test.describe('a guardian on the team page', () => {
  test.use({ expectedConvexErrors: ['rosterEntries:addMinor'] });

  test('adds a second minor from the team page and renames one', async ({ page }, testInfo) => {
    test.slow(); // REASON
    const guardian = named('Guardian', 'Marcus Bell');
    await signUp(page, guardian);
    const s = await seedSeason({
      sharks: {
        playerEmails: [guardian.email],
        minors: [{ guardianEmail: guardian.email, minorName: 'Theo Bell' }],
      },
    });

    await openTeam(page, s.sharks, 'Sand Sharks');
    await expect(page.getByTestId('roster-count')).toHaveText('3 of 4 players');
    await expect(rosterRow(page, 'Theo Bell').locator('[data-slot="badge"]')).toHaveText('Minor');
    await expectAccessible(page);
    await screenshot(page, testInfo, '139-team-guardian');

    const submit = addPanel(page).getByRole('button', { name: 'Add minor' });
    await submit.click();
    await expect(page.locator('#minor-name-error')).toHaveText('Enter the minor’s name.');
    await expect(page.locator('#minor-name')).toBeFocused();
    await expectAccessible(page);
    await screenshot(page, testInfo, '139-add-minor-empty');

    await page.locator('#minor-name').fill('theo  bell');
    await submit.click();
    await expect(page.locator('#minor-name-error')).toHaveText(
      'Theo Bell is already on Sand Sharks in this season.',
    );
    await expectAccessible(page);
    await screenshot(page, testInfo, '139-add-minor-in-season');

    await page.locator('#minor-name').fill('Nora Bell');
    await submit.click();
    const added = addPanel(page).getByRole('status').filter({ hasText: 'was added' });
    await expect(added).toHaveText('Nora Bell was added to Sand Sharks.');
    await expect(added).toBeFocused();
    await expect(rosterRow(page, 'Nora Bell')).toContainText('Guardian: Marcus Bell');
    await expect(page.getByTestId('roster-count')).toHaveText('4 of 4 players');
    await expectAccessible(page);
    await screenshot(page, testInfo, '139-add-minor-added');

    await rosterRow(page, 'Theo Bell').getByRole('button', { name: 'Rename Theo Bell' }).click();
    await expect(page.locator('#rename-name')).toHaveValue('Theo Bell');
    await expect(page.locator('#rename-name')).toBeFocused();
    await expectAccessible(page);
    await screenshot(page, testInfo, '139-rename');

    await page.locator('#rename-name').fill('');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(page.locator('#rename-name-error')).toHaveText('Enter the minor’s name.');
    await expectAccessible(page);
    await screenshot(page, testInfo, '139-rename-empty');

    await page.locator('#rename-name').fill('Theodore Bell');
    await page.getByRole('button', { name: 'Save name' }).click();
    await expect(roster(page).getByRole('status')).toHaveText('Renamed to Theodore Bell.');
    await expect(rosterRow(page, 'Theodore Bell')).toBeVisible();
  });
});

test.describe('a captain with a minor on the team', () => {
  test('a team with 3 adults and 1 minor meets a minimum of 4; its captain may remove the minor but not rename it', async ({
    page,
  }, testInfo) => {
    const captain = named('Captain', 'Tasha Greene');
    await signUp(page, captain);
    const [player, guardian] = [named('Player', 'Elena Ruiz'), named('Guardian', 'Marcus Bell')];
    const s = await seedSeason({
      captain,
      accounts: [player, guardian],
      sharks: {
        playerEmails: [player.email, guardian.email],
        minors: [{ guardianEmail: guardian.email, minorName: 'Theo Bell' }],
      },
    });

    await openTeam(page, s.sharks, 'Sand Sharks');
    await expect(page.getByTestId('roster-count')).toHaveText('4 of 4 players');
    await expect(page.getByTestId('roster-note')).toContainText(
      'The roster meets the minimum of 4 players.',
    );
    const theo = rosterRow(page, 'Theo Bell');
    await expect(theo).toContainText('Guardian: Marcus Bell');
    await expect(theo.getByRole('button')).toHaveText(['Remove Theo Bell from Sand Sharks']);
    await expect(addPanel(page)).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '139-team-captain');
  });
});

test.describe('who sees a minor', () => {
  test('a player on another team sees "Maya R." with no mark or guardian; a teammate sees the full name and the guardian', async ({
    page,
    browser,
  }, testInfo) => {
    const s = await seedSeason();
    const guardian = await seedUser(named('Guardian', 'Ana Rivera'));
    await addMinor(s.sharks, guardian, 'Maya Rivera');

    const opponent = named('Opponent', 'Devon Park');
    await signUp(page, opponent);
    await addPlayer(s.party, opponent);
    await openTeam(page, s.sharks, 'Sand Sharks');
    await expect(roster(page).getByRole('heading', { level: 3 })).toHaveText([
      s.captain.name,
      'Maya R.',
    ]);
    await expect(main(page)).not.toContainText('Rivera');
    await expect(main(page)).not.toContainText('Guardian:');
    await expect(roster(page).locator('[data-slot="badge"]')).toHaveText(['Captain']);
    await expect(addPanel(page)).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '139-opponent');

    const teammate = named('Teammate', 'Elena Ruiz');
    const teammatePage = await (async () => {
      const context = await browser.newContext({ baseURL });
      const other = await context.newPage();
      await signUp(other, teammate);
      return other;
    })();
    await addPlayer(s.sharks, teammate);
    await openTeam(teammatePage, s.sharks, 'Sand Sharks');
    const maya = rosterRow(teammatePage, 'Maya Rivera');
    await expect(maya.locator('[data-slot="badge"]')).toHaveText('Minor');
    await expect(maya).toContainText('Guardian: Ana Rivera');
    await expect(maya.getByRole('button')).toHaveCount(0);
    await expectAccessible(teammatePage);
    await screenshot(teammatePage, testInfo, '139-teammate');
    await teammatePage.context().close();
  });
});

test.describe('a guardian whose only entry in the season is a minor’s', () => {
  test('sees the register form, and /app lists the minor’s team once with the Guardian badge', async ({
    page,
  }, testInfo) => {
    const s = await seedSeason();
    const guardian = named('Guardian', 'Ana Rivera');
    await signUp(page, guardian);
    await addMinor(s.sharks, guardian, 'Maya Rivera');
    await addMinor(s.sharks, guardian, 'Leo Rivera');

    await page.goto(`/app/register/${s.tenant.slug}/${LEAGUE_SLUG}/${SEASON}/team`);
    await expect(page.locator('#team-name')).toBeVisible();
    await expect(main(page)).not.toContainText('You’re on Sand Sharks');

    await page.goto('/app');
    const teams = page.getByRole('region', { name: 'Your teams' });
    await expect(teams.getByRole('heading', { level: 3 })).toHaveText(['Sand Sharks']);
    await expect(teams.locator('[data-slot="badge"]')).toHaveText('Guardian');
    await expectAccessible(page);
    await screenshot(page, testInfo, '139-app-guardian');
  });
});
