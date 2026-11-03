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

interface Season {
  tenant: Tenant;
  sharks: string;
  party: string;
  sharksCaptain: TestUser;
  partyCaptain: TestUser;
  partyPlayer: TestUser;
}

async function seedSeason(): Promise<Season> {
  const tenant = await seedTenant({
    name: 'E2E Roster Visibility',
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
  const [sharksCaptain, partyCaptain, partyPlayer] = await Promise.all([
    seedUser(newUser('Sharks Captain')),
    seedUser(newUser('Party Captain')),
    seedUser(newUser('Party Player')),
  ]);
  const team = async (name: string, captain: TestUser) =>
    (
      (await convexRun('testing:seedTeam', {
        organizationSlug: tenant.slug,
        leagueSlug: LEAGUE_SLUG,
        seasonSlug: SEASON,
        name,
        captainEmail: captain.email,
      })) as { teamId: string }
    ).teamId;
  const sharks = await team('Sand Sharks', sharksCaptain);
  const party = await team('Block Party', partyCaptain);
  await convexRun('testing:addToTeam', { teamId: party, email: partyPlayer.email });
  await convexRun('testing:addTeamInvite', {
    teamId: party,
    email: 'hidden-invite@example.com',
    expiresAt: Date.now() + 14 * DAY,
  });
  return { tenant, sharks, party, sharksCaptain, partyCaptain, partyPlayer };
}

const rosterPanel = (page: Page) => page.locator('section[aria-labelledby="roster-heading"]');
const seasonPanel = (page: Page) => page.locator('section[aria-labelledby="season-teams-heading"]');
const noAccess = (page: Page) =>
  page.getByRole('heading', { level: 1, name: 'You can’t open this team page' });

async function openTeam(page: Page, teamId: string, name: string): Promise<void> {
  await page.goto(`/app/teams/${teamId}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

test.describe('rosters in a season', () => {
  test('a player on another team reads the roster names and captain mark, with no email, pending invite, or control', async ({
    page,
  }, testInfo) => {
    const s = await seedSeason();
    const viewer = newUser('Sharks Player');
    await signUp(page, viewer);
    await convexRun('testing:addToTeam', { teamId: s.sharks, email: viewer.email });

    await openTeam(page, s.party, 'Block Party');
    await expect(rosterPanel(page).getByRole('heading', { level: 3 })).toHaveText([
      s.partyCaptain.name,
      s.partyPlayer.name,
    ]);
    await expect(rosterPanel(page).locator('[data-slot="badge"]')).toHaveText(['Captain']);
    await expect(page.getByTestId('viewer-note')).toHaveText(
      'You’re on Sand Sharks. Teams in a season see each other’s rosters, so everyone who plays is listed.',
    );
    await expect(seasonPanel(page).getByRole('link')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Pending invites' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Invite players' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Invite players' })).toHaveCount(0);
    await expect(page.locator('main').getByRole('button')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('@');
    await expect(page.locator('main')).not.toContainText('pending');
    await expectAccessible(page);
    await screenshot(page, testInfo, '138-opponent');

    const width = page.viewportSize()?.width ?? 0;
    const roster = (await rosterPanel(page).boundingBox())!;
    const season = (await seasonPanel(page).boundingBox())!;
    if (width >= 1024) expect(season.x).toBeGreaterThan(roster.x + roster.width - 1);
    else expect(season.y).toBeGreaterThan(roster.y + roster.height - 1);
  });

  test('Teams in this season links each team; following one opens that team page', async ({
    page,
  }, testInfo) => {
    const s = await seedSeason();
    const viewer = newUser('Sharks Player');
    await signUp(page, viewer);
    await convexRun('testing:addToTeam', { teamId: s.sharks, email: viewer.email });

    await openTeam(page, s.sharks, 'Sand Sharks');
    await expect(page.getByTestId('viewer-note')).toHaveText(
      `You’re on this team. ${s.sharksCaptain.name} is the captain.`,
    );
    await expect(seasonPanel(page).getByTestId('season-teams-count')).toHaveText('2 teams');
    const links = seasonPanel(page).getByRole('link');
    await expect(links).toHaveText([/^Block Party/, /^Sand Sharks\s*This team/]);
    await expect(links.nth(1)).toHaveAttribute('aria-current', 'page');
    await expectAccessible(page);
    await screenshot(page, testInfo, '138-season-list');

    await links.filter({ hasText: 'Block Party' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/teams/${s.party}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Block Party' })).toBeVisible();
    await expect(rosterPanel(page).getByRole('heading', { level: 3 })).toHaveText([
      s.partyCaptain.name,
      s.partyPlayer.name,
    ]);
    const sharksLink = seasonPanel(page).getByRole('link').filter({ hasText: 'Sand Sharks' });
    await expect(sharksLink).toContainText('Your team');
    await expect(
      seasonPanel(page).getByRole('link').filter({ hasText: 'Block Party' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('a signed-in user with no part, a removed player, and a waiting free agent each get the no-access view', async ({
    page,
  }, testInfo) => {
    const s = await seedSeason();
    const outsider = newUser('Outsider');
    await signUp(page, outsider);

    await page.goto(`/app/teams/${s.party}`);
    await expect(noAccess(page)).toBeVisible();
    await expect(page.locator('main')).not.toContainText(s.partyPlayer.name);
    await expectAccessible(page);
    await screenshot(page, testInfo, '138-no-access');

    await convexRun('testing:addToTeam', { teamId: s.sharks, email: outsider.email });
    await convexRun('testing:removeFromTeam', { teamId: s.sharks, email: outsider.email });
    await page.goto(`/app/teams/${s.party}`);
    await expect(noAccess(page)).toBeVisible();

    await convexRun('testing:seedFreeAgent', {
      organizationSlug: s.tenant.slug,
      leagueSlug: LEAGUE_SLUG,
      seasonSlug: SEASON,
      email: outsider.email,
    });
    await page.goto(`/app/teams/${s.sharks}`);
    await expect(noAccess(page)).toBeVisible();
    await expect(page.locator('main')).not.toContainText(s.sharksCaptain.name);
  });
});
