import { randomBytes } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { axeScan, describeViolations, expectAccessible, tabKey } from './support/a11y';
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
    await expect(main(page).getByText('No team to place them on yet')).toBeVisible();
    await expect(main(page).getByText('Place free agents once a team registers.')).toBeVisible();
    await expect(main(page).getByRole('button', { name: /Place on team/ })).toHaveCount(0);
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

const placeDialog = (page: Page) => page.getByRole('dialog');

async function placeAsOrgAdmin(page: Page, browser: Browser) {
  const tenant = await asOrgAdmin(page);
  const season = await seedSummer(tenant);
  const waiting = newUser('Waiting');
  const waitingPage = await otherUser(browser, waiting);
  await convexRun('testing:seedFreeAgent', {
    organizationSlug: tenant.slug,
    leagueSlug: LEAGUE_SLUG,
    seasonSlug: SUMMER,
    email: waiting.email,
  });
  return { tenant, season, waiting, waitingPage };
}

test.describe('Season management: placing a free agent', () => {
  test('an org admin places a waiting free agent on a team below the minimum; the free agent sees the team and opens it', async ({
    page,
    browser,
  }, testInfo) => {
    const { tenant, season, waiting, waitingPage } = await placeAsOrgAdmin(page, browser);
    try {
      await page.goto(seasonPath(tenant, SUMMER));
      await expect(freeAgentRows(page)).toHaveCount(3);
      await expect(page.getByTestId('free-agent-count')).toHaveText('3');
      const row = freeAgentRows(page).filter({ hasText: waiting.name });
      const open = row.getByRole('button', { name: `Place on team: ${waiting.name}` });
      await expect(open).toHaveAttribute('aria-haspopup', 'dialog');
      await open.click();

      const dialog = placeDialog(page);
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole('heading', { name: `Place ${waiting.name} on a team` }),
      ).toBeVisible();
      await expect(dialog.getByRole('radio', { name: 'Block Party' })).toBeFocused();
      await expect(dialog.getByRole('radio', { name: 'Dig Deep' })).toHaveAccessibleDescription(
        '2 of 4 players · 2 more needed',
      );
      await expect(page.locator('app-season-management')).toHaveAttribute('inert', '');
      // The modal holds focus, so the page-wide Tab walk (which expects to leave the page) does not
      // apply: axe, and a Tab that cycles inside the dialog.
      expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
      await page.keyboard.press(tabKey(page));
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await page.keyboard.press(tabKey(page));
      await expect(dialog.getByRole('button', { name: 'Place on team' })).toBeFocused();
      await page.keyboard.press(`Shift+${tabKey(page)}`);
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await dialog.getByRole('radio', { name: 'Block Party' }).focus();
      await screenshot(page, testInfo, '135-place-choose');

      await dialog.getByRole('button', { name: 'Place on team' }).click();
      await expect(dialog.getByText('Choose a team.')).toBeVisible();
      await expect(dialog.getByRole('radio', { name: 'Block Party' })).toBeFocused();

      await dialog.getByRole('radio', { name: 'Dig Deep' }).check();
      await dialog.getByRole('button', { name: 'Place on team' }).click();
      await expect(dialog).toHaveCount(0);
      const status = main(page).locator('#free-agents [role="status"]');
      await expect(status).toContainText(`${waiting.name} is on Dig Deep now.`);
      await expect(status).toContainText('Dig Deep has 3 of 4 players.');
      await expect(status).toBeFocused();
      await expect(freeAgentRows(page)).toHaveCount(2);
      await expect(freeAgentRows(page).filter({ hasText: waiting.name })).toHaveCount(0);
      await expect(page.getByTestId('free-agent-count')).toHaveText('2');
      const dig = teamRows(page).filter({ hasText: 'Dig Deep' });
      await expect(dig.locator('[data-slot="roster"]')).toHaveText(
        '3 of 4 players · 1 more needed',
      );
      await screenshot(page, testInfo, '135-placed');
      await expectAccessible(page);

      await waitingPage.goto(`/app/register/${tenant.slug}/${LEAGUE_SLUG}/${SUMMER}/free-agent`);
      await expect(waitingPage.locator('main [data-slot="alert"]')).toContainText(
        'You’re on Dig Deep in this season.',
      );
      await waitingPage.getByRole('link', { name: 'Go to Dig Deep' }).click();
      await expect(waitingPage).toHaveURL(`/app/teams/${season.teamIds['Dig Deep']}`);
      await expect(
        waitingPage.getByRole('main').getByRole('heading', { level: 1, name: 'Dig Deep' }),
      ).toBeVisible();
    } finally {
      await waitingPage.context().close();
    }
  });
});

test.describe('Season management: placing a free agent, while the placement is held', () => {
  test('the Placing… button is disabled and the dialog stays accessible', async ({
    page,
    browser,
  }, testInfo) => {
    const { tenant, waiting, waitingPage } = await placeAsOrgAdmin(page, browser);
    await waitingPage.context().close();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.routeWebSocket(/.*/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage(async (message) => {
        if (typeof message === 'string' && message.includes('"Mutation"')) await held;
        server.send(message);
      });
      server.onMessage((message) => ws.send(message));
    });
    await page.goto(seasonPath(tenant, SUMMER));
    await freeAgentRows(page)
      .filter({ hasText: waiting.name })
      .getByRole('button', { name: `Place on team: ${waiting.name}` })
      .click();
    const dialog = placeDialog(page);
    await dialog.getByRole('radio', { name: 'Dig Deep' }).check();
    await dialog.getByRole('button', { name: 'Place on team' }).click();
    const placing = dialog.getByRole('button', { name: 'Placing…' });
    await expect(placing).toHaveAttribute('aria-disabled', 'true');
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    await screenshot(page, testInfo, '135-placing');
    release();
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('Season management: placing a free agent someone else placed', () => {
  test.use({ expectedConvexErrors: ['freeAgents:place'] });

  test('a free agent another organizer placed first: the dialog says so and nothing changes; Cancel returns focus', async ({
    page,
    browser,
  }, testInfo) => {
    const { tenant, waiting, waitingPage } = await placeAsOrgAdmin(page, browser);
    await waitingPage.context().close();
    await page.goto(seasonPath(tenant, SUMMER));
    const row = freeAgentRows(page).filter({ hasText: waiting.name });
    await row.getByRole('button', { name: `Place on team: ${waiting.name}` }).click();
    const dialog = placeDialog(page);
    await dialog.getByRole('radio', { name: 'Sand Sharks' }).check();

    const otherTab = await page.context().newPage();
    await otherTab.goto(seasonPath(tenant, SUMMER));
    await freeAgentRows(otherTab)
      .filter({ hasText: waiting.name })
      .getByRole('button', { name: /Place on team/ })
      .click();
    await placeDialog(otherTab).getByRole('radio', { name: 'Block Party' }).check();
    await placeDialog(otherTab).getByRole('button', { name: 'Place on team' }).click();
    await expect(placeDialog(otherTab)).toHaveCount(0);
    await otherTab.close();

    await dialog.getByRole('button', { name: 'Place on team' }).click();
    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText(`${waiting.name} could not be placed.`);
    await expect(alert).toContainText('They’ve already been placed on a team.');
    await expect(alert).toBeFocused();
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    await screenshot(page, testInfo, '135-place-error');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      freeAgentRows(page)
        .first()
        .getByRole('button', { name: /Place on team/ }),
    ).toBeFocused();
    const sharks = teamRows(page).filter({ hasText: 'Sand Sharks' });
    await expect(sharks.locator('[data-slot="roster"]')).toHaveText('4 of 4 players');
    await expect(freeAgentRows(page).filter({ hasText: waiting.name })).toHaveCount(0);

    await freeAgentRows(page)
      .first()
      .getByRole('button', { name: /Place on team/ })
      .click();
    await placeDialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(
      freeAgentRows(page)
        .first()
        .getByRole('button', { name: /Place on team/ }),
    ).toBeFocused();
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

test.describe('Season management: maximum teams', () => {
  const FULL = 'full-open';
  const limits = (page: Page) => page.locator('section[aria-labelledby="limits-heading"]');
  const summary = (page: Page) => page.getByTestId('max-teams-summary');
  const field = (page: Page) => page.locator('#edit-maximum-teams');
  const saveButton = (page: Page) => limits(page).getByRole('button', { name: 'Save changes' });

  async function seedFullSeason(tenant: Tenant): Promise<void> {
    await convexRun('testing:seedSeason', {
      organizationSlug: tenant.slug,
      leagueSlug: LEAGUE_SLUG,
      name: 'Full Open',
      slug: FULL,
      startDate: dateFromToday(40),
      endDate: dateFromToday(100),
      registrationDeadline: dateFromToday(20),
      minimumRosterSize: 4,
      maxTeams: 2,
      status: 'published',
    });
    await addTeam(tenant, 'Pair of Aces');
    await addTeam(tenant, 'Two Tall');
  }

  async function addTeam(tenant: Tenant, name: string): Promise<void> {
    const captain = newUser('Captain');
    await seedUsers([captain]);
    await convexRun('testing:seedTeam', {
      organizationSlug: tenant.slug,
      leagueSlug: LEAGUE_SLUG,
      seasonSlug: FULL,
      name,
      captainEmail: captain.email,
    });
  }

  test('the create form takes Maximum teams, refuses one out of range, and the new season shows it', async ({
    page,
  }, testInfo) => {
    const tenant = await asOrgAdmin(page);
    await page.goto(`/app/organizations/${tenant.slug}/leagues/${LEAGUE_SLUG}`);
    const create = page.locator('#create-season form');
    await page.locator('#name').fill('Winter Cap');
    await page.locator('#start-date').fill(dateFromToday(60));
    await page.locator('#end-date').fill(dateFromToday(120));
    await page.locator('#registration-deadline').fill(dateFromToday(30));
    await page.locator('#maximum-teams').fill('201');
    await create.getByRole('button', { name: /^Create draft season/ }).click();
    await expect(page.locator('#maximum-teams-error')).toHaveText(
      'Enter a whole number from 2 to 200, or leave it blank.',
    );
    await expect(page.locator('#maximum-teams')).toBeFocused();
    await page.locator('#maximum-teams').scrollIntoViewIfNeeded();
    await expectAccessible(page);
    await screenshot(page, testInfo, '143-create-maximum-teams-error');

    await page.locator('#maximum-teams').fill('8');
    await create.getByRole('button', { name: /^Create draft season/ }).click();
    await expect(create.locator('[data-slot="created-title"]')).toHaveText(
      'Winter Cap created as a draft.',
    );
    await page.goto(seasonPath(tenant, 'winter-cap'));
    await expect(summary(page)).toHaveText('8 teams · 0 registered');
    await expect(page.getByTestId('team-count')).toHaveText('0 of 8');
  });

  test.describe('editing', () => {
    test.use({ expectedConvexErrors: ['seasons:setMaxTeams'] });

    test('a full season shows 2 of 2 teams; the limit is raised, refused below the count, and removed', async ({
      page,
    }, testInfo) => {
      const tenant = await asOrgAdmin(page);
      await seedFullSeason(tenant);
      await page.goto(seasonPath(tenant, FULL));
      await expect(page.getByTestId('team-count')).toHaveText('2 of 2');
      await expect(summary(page)).toHaveText('2 teams · 2 registered, so the season is full');
      await expectAccessible(page);
      await screenshot(page, testInfo, '143-organizer-full');

      await limits(page).getByRole('button', { name: 'Edit maximum teams' }).click();
      await expect(field(page)).toBeFocused();
      await expect(field(page)).toHaveValue('2');
      await expect(page.locator('#edit-maximum-teams-description')).toHaveText(
        '2 to 200, or blank for no limit. At least the 2 teams already registered.',
      );
      await expectAccessible(page);
      await screenshot(page, testInfo, '143-edit-maximum-teams');

      await field(page).fill('3');
      await saveButton(page).click();
      const status = limits(page).getByRole('status');
      await expect(status).toHaveText('Maximum teams saved. The season takes up to 3 teams.');
      await expect(status).toBeFocused();
      await expect(page.getByTestId('team-count')).toHaveText('2 of 3');
      await expect(summary(page)).toHaveText('3 teams · 2 registered');

      await addTeam(tenant, 'Third Wheel');
      await expect(page.getByTestId('team-count')).toHaveText('3 of 3');
      await limits(page).getByRole('button', { name: 'Edit maximum teams' }).click();
      await field(page).fill('2');
      await saveButton(page).click();
      await expect(page.locator('#edit-maximum-teams-error')).toHaveText(
        '3 teams are already registered. Enter 3 or more, or leave it blank.',
      );
      await expect(field(page)).toBeFocused();
      await expectAccessible(page);
      await screenshot(page, testInfo, '143-edit-maximum-teams-error');

      await field(page).fill('');
      await saveButton(page).click();
      await expect(limits(page).getByRole('status')).toHaveText(
        'Maximum teams removed. There’s no limit now.',
      );
      await expect(summary(page)).toHaveText('No limit · 3 registered');
      await expect(page.getByTestId('team-count')).toHaveText('3');
    });
  });
});

test.describe('Season management: maximum roster size', () => {
  const CAP = 'roster-cap';
  const limits = (page: Page) => page.locator('section[aria-labelledby="limits-heading"]');
  const summary = (page: Page) => page.getByTestId('max-roster-size-summary');
  const field = (page: Page) => page.locator('#edit-maximum-roster-size');
  const saveButton = (page: Page) => limits(page).getByRole('button', { name: 'Save changes' });

  async function seedCapSeason(tenant: Tenant): Promise<TestUser> {
    await convexRun('testing:seedSeason', {
      organizationSlug: tenant.slug,
      leagueSlug: LEAGUE_SLUG,
      name: 'Roster Cap',
      slug: CAP,
      startDate: dateFromToday(40),
      endDate: dateFromToday(100),
      registrationDeadline: dateFromToday(20),
      minimumRosterSize: 4,
      maxRosterSize: 4,
      status: 'published',
    });
    const captains = [newUser('Captain'), newUser('Captain')];
    const players = [newUser('Player'), newUser('Player'), newUser('Player')];
    const waiting = newUser('Waiting');
    await seedUsers([...captains, ...players, waiting]);
    const slugs = { organizationSlug: tenant.slug, leagueSlug: LEAGUE_SLUG, seasonSlug: CAP };
    for (const [i, name] of ['Block Party', 'Dig Deep'].entries()) {
      const { teamId } = (await convexRun('testing:seedTeam', {
        ...slugs,
        name,
        captainEmail: captains[i].email,
      })) as { teamId: string };
      if (i > 0) continue;
      for (const player of players) {
        await convexRun('testing:addToTeam', { teamId, email: player.email });
      }
    }
    await convexRun('testing:seedFreeAgent', { ...slugs, email: waiting.email });
    return waiting;
  }

  test('the create form takes Maximum roster size, refuses one below the minimum, and the new season shows it', async ({
    page,
  }, testInfo) => {
    const tenant = await asOrgAdmin(page);
    await page.goto(`/app/organizations/${tenant.slug}/leagues/${LEAGUE_SLUG}`);
    const create = page.locator('#create-season form');
    await page.locator('#name').fill('Winter Roster');
    await page.locator('#start-date').fill(dateFromToday(60));
    await page.locator('#end-date').fill(dateFromToday(120));
    await page.locator('#registration-deadline').fill(dateFromToday(30));
    await page.locator('#maximum-roster-size').fill('3');
    await create.getByRole('button', { name: /^Create draft season/ }).click();
    await expect(page.locator('#maximum-roster-size-error')).toHaveText(
      'Enter a whole number from 4 to 99, or leave it blank.',
    );
    await expect(page.locator('#maximum-roster-size')).toBeFocused();
    await page.locator('#maximum-roster-size').scrollIntoViewIfNeeded();
    await expectAccessible(page);
    await screenshot(page, testInfo, '144-create-maximum-roster-size-error');

    await page.locator('#maximum-roster-size').fill('4');
    await create.getByRole('button', { name: /^Create draft season/ }).click();
    await expect(create.locator('[data-slot="created-title"]')).toHaveText(
      'Winter Roster created as a draft.',
    );
    await page.goto(seasonPath(tenant, 'winter-roster'));
    await expect(summary(page)).toHaveText('4 players per team');
  });

  test.describe('editing', () => {
    test.use({ expectedConvexErrors: ['seasons:setMaxRosterSize'] });

    test('the limit is refused below the largest roster, naming the team, then raised and removed', async ({
      page,
    }, testInfo) => {
      const tenant = await asOrgAdmin(page);
      await seedCapSeason(tenant);
      await page.goto(seasonPath(tenant, CAP));
      await expect(summary(page)).toHaveText('4 players per team');

      await limits(page).getByRole('button', { name: 'Edit maximum roster size' }).click();
      await expect(field(page)).toBeFocused();
      await expect(field(page)).toHaveValue('4');
      await expect(page.locator('#edit-maximum-roster-size-description')).toHaveText(
        'From the minimum roster size (4) to 99, or blank for no limit.',
      );
      await expectAccessible(page);
      await screenshot(page, testInfo, '144-edit-maximum-roster-size');

      await field(page).fill('3');
      await saveButton(page).click();
      await expect(page.locator('#edit-maximum-roster-size-error')).toHaveText(
        'Block Party already has 4 players. Enter 4 or more, or leave it blank.',
      );
      await expect(field(page)).toBeFocused();
      await expectAccessible(page);
      await screenshot(page, testInfo, '144-edit-maximum-roster-size-error');

      await field(page).fill('6');
      await saveButton(page).click();
      const status = limits(page).getByRole('status');
      await expect(status).toHaveText('Maximum roster size saved. Teams can have up to 6 players.');
      await expect(status).toBeFocused();
      await expect(summary(page)).toHaveText('6 players per team');

      await limits(page).getByRole('button', { name: 'Edit maximum roster size' }).click();
      await field(page).fill('');
      await saveButton(page).click();
      await expect(limits(page).getByRole('status')).toHaveText(
        'Maximum roster size removed. There’s no limit now.',
      );
      await expect(summary(page)).toHaveText('No limit');
    });
  });

  test('the place dialog keeps a full team in the list as unavailable', async ({
    page,
  }, testInfo) => {
    const tenant = await asOrgAdmin(page);
    const waiting = await seedCapSeason(tenant);
    await page.goto(seasonPath(tenant, CAP));
    await freeAgentRows(page)
      .filter({ hasText: waiting.name })
      .getByRole('button', { name: `Place on team: ${waiting.name}` })
      .click();
    const dialog = placeDialog(page);
    const full = dialog.getByRole('radio', { name: 'Block Party' });
    await expect(full).toBeDisabled();
    await expect(full).toHaveAccessibleDescription('Full: 4 of 4 players');
    await expect(dialog.getByRole('radio', { name: 'Dig Deep' })).toBeFocused();
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    await screenshot(page, testInfo, '144-place-full-team');
  });
});
