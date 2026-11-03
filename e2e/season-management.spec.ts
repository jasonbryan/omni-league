import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { otherUser, signUp } from './support/session';
import { dateFromToday, seedSeasons, seedTenant, type Tenant } from './support/tenant';
import { newUser, type TestUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LEAGUE = 'Sunday Reverse Coed 4s';
const LEAGUE_SLUG = 'sunday-reverse-coed-4s';
const OTHER_LEAGUE_SLUG = 'thursday-coed-2s';
const SUMMER = 'summer-open';
const DRAFT = 'fall-draft';
const EMPTY = 'spring-open';
const OTHER_SEASON = 'thursday-only';
const DAY = 24 * 60 * 60 * 1000;
const FREE_AGENTS_QUERY = 'freeAgents:listForOrganizer';

const main = (page: Page) => page.getByRole('main');
const teamRows = (page: Page) => page.locator('#teams-list > li');
const freeAgentRows = (page: Page) => page.locator('#free-agents-list > li');
const noAccess = (page: Page) =>
  main(page).getByRole('heading', { level: 1, name: 'You can’t manage this league' });
const notFound = (page: Page) =>
  main(page).getByRole('heading', { level: 1, name: 'Page not found' });

async function seedUsers(users: TestUser[]): Promise<void> {
  const id = randomBytes(4).toString('hex');
  await convexRun('testing:seedLeague', {
    organization: { name: `E2E Users ${id}`, slug: `e2e-users-${id}` },
    locations: [],
    leagues: [],
    users,
  });
}

async function seedLeagues(): Promise<Tenant> {
  const tenant = await seedTenant({
    name: 'E2E Season Teams',
    locations: [{ name: 'Alpha Beach', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
    leagues: [
      {
        name: LEAGUE,
        sport: 'beachVolleyball',
        locations: ['Alpha Beach'],
        division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
      },
      {
        name: 'Thursday Coed 2s',
        sport: 'beachVolleyball',
        locations: ['Alpha Beach'],
        division: { gender: 'coed', playersPerSide: 2, level: 'bb', ageGroup: 'adult' },
      },
    ],
  });
  const dates = {
    startDate: dateFromToday(40),
    endDate: dateFromToday(100),
    registrationDeadline: dateFromToday(20),
  };
  await seedSeasons(tenant, LEAGUE_SLUG, [
    { name: 'Summer Open', slug: SUMMER, ...dates },
    { name: 'Spring Open', slug: EMPTY, ...dates },
    { name: 'Fall Draft', slug: DRAFT, ...dates, status: 'draft' },
  ]);
  await seedSeasons(tenant, OTHER_LEAGUE_SLUG, [
    { name: 'Thursday Only', slug: OTHER_SEASON, ...dates },
  ]);
  return tenant;
}

interface Season {
  tenant: Tenant;
  captains: TestUser[];
  teamIds: Record<string, string>;
  freeAgents: TestUser[];
}

async function seedSummer(tenant: Tenant, captains: TestUser[] = []): Promise<Season> {
  const all = [
    ...captains,
    ...Array.from({ length: 3 - captains.length }, () => newUser('Captain')),
  ];
  const players = Array.from({ length: 7 }, () => newUser('Player'));
  const freeAgents = [newUser('First'), newUser('Second')];
  await seedUsers([...all.slice(captains.length), ...players, ...freeAgents]);
  const slugs = { organizationSlug: tenant.slug, leagueSlug: LEAGUE_SLUG, seasonSlug: SUMMER };
  const teamIds: Record<string, string> = {};
  const roster: Record<string, TestUser[]> = {
    'Block Party': players.slice(0, 3),
    'Dig Deep': players.slice(3, 4),
    'Sand Sharks': players.slice(4, 7),
  };
  for (const [i, name] of ['Block Party', 'Dig Deep', 'Sand Sharks'].entries()) {
    const { teamId } = (await convexRun('testing:seedTeam', {
      ...slugs,
      name,
      captainEmail: all[i].email,
    })) as { teamId: string };
    teamIds[name] = teamId;
    for (const player of roster[name]) {
      await convexRun('testing:addToTeam', { teamId, email: player.email });
    }
  }
  await convexRun('testing:addTeamInvite', {
    teamId: teamIds['Dig Deep'],
    email: 'pending@example.com',
    expiresAt: Date.now() + 14 * DAY,
  });
  for (const freeAgent of freeAgents) {
    await convexRun('testing:seedFreeAgent', { ...slugs, email: freeAgent.email });
  }
  return { tenant, captains: all, teamIds, freeAgents };
}

async function asOrgAdmin(page: Page): Promise<Tenant> {
  const admin = newUser('Admin');
  await signUp(page, admin);
  const tenant = await seedLeagues();
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: admin.email,
    role: 'orgAdmin',
  });
  return tenant;
}

const seasonPath = (tenant: Tenant, season: string, league = LEAGUE_SLUG) =>
  `/app/organizations/${tenant.slug}/leagues/${league}/seasons/${season}`;

function framesSent(page: Page): string[] {
  const sent: string[] = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', (frame) => sent.push(String(frame.payload)));
  });
  return sent;
}

test.describe('Season management: an org admin', () => {
  test('opens a season from the league page and sees its teams and its waiting free agents, oldest first', async ({
    page,
  }, testInfo) => {
    const tenant = await asOrgAdmin(page);
    const { freeAgents } = await seedSummer(tenant);
    await page.goto(`/app/organizations/${tenant.slug}/leagues/${LEAGUE_SLUG}`);
    await page.locator('#seasons-list').getByRole('link', { name: 'Summer Open' }).click();
    await expect(page).toHaveURL(seasonPath(tenant, SUMMER));
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Summer Open');
    await expect(page).toHaveTitle(`Summer Open | ${LEAGUE} | Omni League`);

    await expect(page.getByTestId('team-count')).toHaveText('3');
    await expect(page.getByTestId('free-agent-count')).toHaveText('2');
    await expect(teamRows(page).locator('h3')).toHaveText([
      'Block Party',
      'Dig Deep',
      'Sand Sharks',
    ]);
    const dig = teamRows(page).filter({ hasText: 'Dig Deep' });
    await expect(dig).toContainText('Captain: E2E Captain');
    await expect(dig.locator('[data-slot="roster"]')).toHaveText('2 of 4 players · 2 more needed');
    await expect(dig.locator('[data-slot="invites"]')).toHaveText('1 pending invite');
    await expect(dig.getByText('Below minimum')).toBeVisible();
    await expect(teamRows(page).getByText('Below minimum')).toHaveCount(1);
    await expect(
      teamRows(page).filter({ hasText: 'Block Party' }).locator('[data-slot="roster"]'),
    ).toHaveText('4 of 4 players');

    await expect(freeAgentRows(page).locator('h3')).toHaveText(freeAgents.map((u) => u.name));
    await expect(freeAgentRows(page).first().getByRole('link')).toHaveAttribute(
      'href',
      `mailto:${freeAgents[0].email}`,
    );
    await expect(freeAgentRows(page).first()).toContainText('Registered');
    await expectAccessible(page);
    await screenshot(page, testInfo, '134-season-populated');

    await dig.getByRole('link', { name: 'Dig Deep' }).click();
    await expect(main(page).getByRole('heading', { level: 1, name: 'Dig Deep' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create invite link' })).toBeVisible();
  });

  test('a season with free agents and no teams, and one with neither', async ({
    page,
  }, testInfo) => {
    const tenant = await asOrgAdmin(page);
    const waiting = newUser('Waiting');
    await seedUsers([waiting]);
    await convexRun('testing:seedFreeAgent', {
      organizationSlug: tenant.slug,
      leagueSlug: LEAGUE_SLUG,
      seasonSlug: SUMMER,
      email: waiting.email,
    });
    await page.goto(seasonPath(tenant, SUMMER));
    await expect(
      main(page).getByText('Teams appear here when captains register them.'),
    ).toBeVisible();
    await expect(freeAgentRows(page)).toHaveCount(1);
    await expectAccessible(page);
    await screenshot(page, testInfo, '134-season-no-teams');

    await page.goto(seasonPath(tenant, EMPTY));
    await expect(main(page).getByText('No free agents waiting')).toBeVisible();
    await expect(main(page).getByText('No teams yet')).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '134-season-no-free-agents');
  });

  test('a draft season shows no teams and links to the league to publish it', async ({
    page,
  }, testInfo) => {
    const tenant = await asOrgAdmin(page);
    await page.goto(seasonPath(tenant, DRAFT));
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Fall Draft');
    const publish = main(page).getByRole('link', { name: `Publish it from ${LEAGUE}` });
    await expect(publish).toHaveAttribute(
      'href',
      `/app/organizations/${tenant.slug}/leagues/${LEAGUE_SLUG}`,
    );
    await expectAccessible(page);
    await screenshot(page, testInfo, '134-season-draft');
  });

  test('past 200 waiting free agents, the page shows the first 200 and says so', async ({
    page,
  }, testInfo) => {
    const tenant = await asOrgAdmin(page);
    await convexRun('testing:seedWaitingFreeAgents', {
      organizationSlug: tenant.slug,
      leagueSlug: LEAGUE_SLUG,
      seasonSlug: SUMMER,
      count: 201,
      emailPrefix: `capped-${randomBytes(4).toString('hex')}`,
    });
    await page.goto(seasonPath(tenant, SUMMER));
    await expect(freeAgentRows(page)).toHaveCount(200);
    await expect(freeAgentRows(page).first().locator('h3')).toHaveText('Free Agent 001');
    await expect(page.getByTestId('free-agent-count')).toHaveText('200+');
    await expect(
      main(page).getByText('Showing the 200 who registered first. Place some to see the rest.'),
    ).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '134-season-capped');
  });

  test('an unknown season slug and a season slug of another league show the not-found view and request no free agents', async ({
    page,
  }, testInfo) => {
    const tenant = await asOrgAdmin(page);
    const sent = framesSent(page);
    await page.goto(seasonPath(tenant, 'no-such-season'));
    await expect(notFound(page)).toBeVisible();
    await expect(page.locator('#teams-list')).toHaveCount(0);
    await screenshot(page, testInfo, '134-season-not-found');
    await expectAccessible(page);

    await page.goto(seasonPath(tenant, OTHER_SEASON));
    await expect(notFound(page)).toBeVisible();
    expect(sent.some((frame) => frame.includes('seasons:getOrganizerView'))).toBe(true);
    expect(sent.some((frame) => frame.includes(FREE_AGENTS_QUERY))).toBe(false);
  });
});

test.describe('Season management: an assigned league organizer', () => {
  test('opens the page in their sidebar, with the league marked', async ({ page }, testInfo) => {
    const organizer = newUser('Organizer');
    await signUp(page, organizer);
    const tenant = await seedLeagues();
    await convexRun('testing:addLeagueOrganizer', {
      organizationSlug: tenant.slug,
      email: organizer.email,
      leagueSlugs: [LEAGUE_SLUG],
    });
    await seedSummer(tenant);
    await page.goto(seasonPath(tenant, SUMMER));
    await expect(teamRows(page)).toHaveCount(3);
    await expect(freeAgentRows(page)).toHaveCount(2);
    await expect(
      page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: LEAGUE }),
    ).toHaveCSS('text-decoration-line', 'underline');
    if (page.viewportSize()!.width < 1024) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
    const nav = page.getByRole('navigation', { name: `${tenant.name} leagues` }).last();
    await expect(nav.getByRole('link', { name: LEAGUE })).toHaveAttribute('aria-current', 'true');
    if (page.viewportSize()!.width < 1024) await page.keyboard.press('Escape');
    await expectAccessible(page);
    await screenshot(page, testInfo, '134-season-organizer');
  });
});

test.describe('Season management: callers who may not open it', () => {
  test('an organizer of another league, a captain in the season, and a non-member get the no-access view, with no free agents requested', async ({
    page,
    browser,
  }, testInfo) => {
    const tenant = await asOrgAdmin(page);
    const otherOrganizer = newUser('Other organizer');
    const captain = newUser('Captain');
    const stranger = newUser('Stranger');
    const pages = [
      await otherUser(browser, otherOrganizer),
      await otherUser(browser, captain),
      await otherUser(browser, stranger),
    ];
    try {
      await convexRun('testing:addLeagueOrganizer', {
        organizationSlug: tenant.slug,
        email: otherOrganizer.email,
        leagueSlugs: [OTHER_LEAGUE_SLUG],
      });
      await seedSummer(tenant, [captain]);
      for (const intruder of pages) {
        const sent = framesSent(intruder);
        await intruder.goto(seasonPath(tenant, SUMMER));
        await expect(noAccess(intruder)).toBeVisible();
        await expect(intruder).toHaveTitle('No access | Omni League');
        await expect(intruder.locator('#teams-list')).toHaveCount(0);
        expect(sent.some((frame) => frame.includes(FREE_AGENTS_QUERY))).toBe(false);
      }
      await expectAccessible(pages[1]);
      await screenshot(pages[1], testInfo, '134-season-no-access');
    } finally {
      for (const intruder of pages) await intruder.context().close();
    }
  });
});
