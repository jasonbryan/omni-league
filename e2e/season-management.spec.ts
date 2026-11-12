import { randomBytes } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { axeScan, describeViolations, expectAccessible, tabKey } from './support/a11y';
import { expectBadges, SIGNED_IN_BADGE_HEIGHT } from './support/badges';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdMutations } from './support/hold-mutations';
import { screenshot } from './support/screenshot';
import { seedAccountsInCalls } from './support/seed-accounts';
import { seedBatch, type SeedBatch } from './support/seed-batch';
import { otherUser, signUp } from './support/session';
import { dateFromToday, newTenant, type Tenant } from './support/tenant';
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

const SEASON_DATES = {
  startDate: dateFromToday(40),
  endDate: dateFromToday(100),
  registrationDeadline: dateFromToday(20),
};

function leagues(): { tenant: Tenant; batch: SeedBatch } {
  const { tenant, args } = newTenant({
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
  const seasons = [
    { leagueSlug: LEAGUE_SLUG, name: 'Summer Open', slug: SUMMER, ...SEASON_DATES },
    { leagueSlug: LEAGUE_SLUG, name: 'Spring Open', slug: EMPTY, ...SEASON_DATES },
    {
      leagueSlug: LEAGUE_SLUG,
      name: 'Fall Draft',
      slug: DRAFT,
      ...SEASON_DATES,
      status: 'draft' as const,
    },
    { leagueSlug: OTHER_LEAGUE_SLUG, name: 'Thursday Only', slug: OTHER_SEASON, ...SEASON_DATES },
  ];
  return { tenant, batch: { tenant: args, seasons } };
}

interface Season {
  captains: TestUser[];
  freeAgents: TestUser[];
  batch: SeedBatch;
}

const SUMMER_TEAMS = ['Block Party', 'Dig Deep', 'Sand Sharks'];

/** `captains` have signed up in a browser; the other people never sign in, so they are accounts. */
function summer(captains: TestUser[] = []): Season {
  const all = [
    ...captains,
    ...Array.from({ length: 3 - captains.length }, () => newUser('Captain')),
  ];
  const players = Array.from({ length: 7 }, () => newUser('Player'));
  const freeAgents = [newUser('First'), newUser('Second')];
  const slugs = { leagueSlug: LEAGUE_SLUG, seasonSlug: SUMMER };
  const rosters = [players.slice(0, 3), players.slice(3, 4), players.slice(4, 7)];
  return {
    captains: all,
    freeAgents,
    batch: {
      accounts: [...all.slice(captains.length), ...players, ...freeAgents],
      teams: SUMMER_TEAMS.map((name, i) => ({
        ...slugs,
        name,
        captainEmail: all[i].email,
        playerEmails: rosters[i].map((player) => player.email),
        ...(name === 'Dig Deep' && {
          invites: [{ email: 'pending@example.com', expiresAt: Date.now() + 14 * DAY }],
        }),
      })),
      freeAgents: freeAgents.map(({ email }) => ({ ...slugs, email })),
    },
  };
}

const teamIdsByName = (teamIds: string[]): Record<string, string> =>
  Object.fromEntries(SUMMER_TEAMS.map((name, i) => [name, teamIds[i]]));

async function asOrgAdmin(
  page: Page,
  ...extra: SeedBatch[]
): Promise<{ tenant: Tenant; teamIds: string[] }> {
  const admin = newUser('Admin');
  await signUp(page, admin);
  return seedForOrgAdmin(admin, ...extra);
}

/** `admin` has signed up in a browser. */
async function seedForOrgAdmin(
  admin: TestUser,
  ...extra: SeedBatch[]
): Promise<{ tenant: Tenant; teamIds: string[] }> {
  const { tenant, batch } = leagues();
  const { teamIds } = await seedBatch(
    batch,
    { memberships: [{ email: admin.email, role: 'orgAdmin' }] },
    ...extra,
  );
  return { tenant, teamIds };
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
    const { freeAgents, batch } = summer();
    const { tenant } = await asOrgAdmin(page, batch);
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
    await expectBadges(main(page).locator('[data-slot="badge"]'), SIGNED_IN_BADGE_HEIGHT);
    await expect(dig.locator('[data-slot="badge"]')).toHaveAttribute(
      'data-variant',
      'outline-destructive',
    );
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
    const waiting = newUser('Waiting');
    const { tenant } = await asOrgAdmin(page, {
      accounts: [waiting],
      freeAgents: [{ leagueSlug: LEAGUE_SLUG, seasonSlug: SUMMER, email: waiting.email }],
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
    const { tenant } = await asOrgAdmin(page);
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
    test.slow(); // a 201-account seed and an axe Tab walk over about 210 tab stops
    const { tenant } = await asOrgAdmin(page);
    await seedAccountsInCalls('testing:seedWaitingFreeAgents', 201, {
      organizationSlug: tenant.slug,
      leagueSlug: LEAGUE_SLUG,
      seasonSlug: SUMMER,
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
    const { tenant } = await asOrgAdmin(page);
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
  const admin = newUser('Admin');
  const waiting = newUser('Waiting');
  const [waitingPage] = await Promise.all([otherUser(browser, waiting), signUp(page, admin)]);
  const { tenant, teamIds } = await seedForOrgAdmin(admin, summer().batch, {
    freeAgents: [{ leagueSlug: LEAGUE_SLUG, seasonSlug: SUMMER, email: waiting.email }],
  });
  return { tenant, teamIds: teamIdsByName(teamIds), waiting, waitingPage };
}

test.describe('Season management: placing a free agent', () => {
  test('an org admin places a waiting free agent on a team below the minimum; the free agent sees the team and opens it', async ({
    page,
    browser,
  }, testInfo) => {
    const { tenant, teamIds, waiting, waitingPage } = await placeAsOrgAdmin(page, browser);
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
      await expect(dialog.getByRole('radiogroup', { name: 'Team' }).getByRole('radio')).toHaveCount(
        3,
      );
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
      await expect(waitingPage).toHaveURL(`/app/teams/${teamIds['Dig Deep']}`);
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
    const held = await holdMutations(page);
    await page.goto(seasonPath(tenant, SUMMER));
    await freeAgentRows(page)
      .filter({ hasText: waiting.name })
      .getByRole('button', { name: `Place on team: ${waiting.name}` })
      .click();
    const dialog = placeDialog(page);
    await dialog.getByRole('radio', { name: 'Dig Deep' }).check();
    held.hold();
    await dialog.getByRole('button', { name: 'Place on team' }).click();
    const placing = dialog.getByRole('button', { name: 'Placing…' });
    await expect(placing).toHaveAttribute('aria-disabled', 'true');
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    await screenshot(page, testInfo, '135-placing');
    held.release();
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
    const { tenant, batch } = leagues();
    const organizerOfLeague = {
      email: organizer.email,
      role: 'leagueOrganizer' as const,
      leagueSlugs: [LEAGUE_SLUG],
    };
    await seedBatch(batch, { memberships: [organizerOfLeague] }, summer().batch);
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
    const admin = newUser('Admin');
    const otherOrganizer = newUser('Other organizer');
    const captain = newUser('Captain');
    const stranger = newUser('Stranger');
    const [, ...pages] = await Promise.all([
      signUp(page, admin),
      ...[otherOrganizer, captain, stranger].map((user) => otherUser(browser, user)),
    ]);
    try {
      const organizerOfOtherLeague = {
        email: otherOrganizer.email,
        role: 'leagueOrganizer' as const,
        leagueSlugs: [OTHER_LEAGUE_SLUG],
      };
      const { tenant } = await seedForOrgAdmin(
        admin,
        { memberships: [organizerOfOtherLeague] },
        summer([captain]).batch,
      );
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

  function fullSeason(): SeedBatch {
    const captains = [newUser('Captain'), newUser('Captain')];
    return {
      accounts: captains,
      seasons: [
        { leagueSlug: LEAGUE_SLUG, name: 'Full Open', slug: FULL, ...SEASON_DATES, maxTeams: 2 },
      ],
      teams: ['Pair of Aces', 'Two Tall'].map((name, i) => team(name, captains[i])),
    };
  }

  const team = (name: string, captain: TestUser) => ({
    leagueSlug: LEAGUE_SLUG,
    seasonSlug: FULL,
    name,
    captainEmail: captain.email,
  });

  async function addTeam(tenant: Tenant, name: string): Promise<void> {
    const captain = newUser('Captain');
    await seedBatch({
      organizationSlug: tenant.slug,
      accounts: [captain],
      teams: [team(name, captain)],
    });
  }

  test('the create form takes Maximum teams, refuses one out of range, and the new season shows it', async ({
    page,
  }, testInfo) => {
    const { tenant } = await asOrgAdmin(page);
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
      const { tenant } = await asOrgAdmin(page, fullSeason());
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

  function capSeason(): { waiting: TestUser; batch: SeedBatch } {
    const captains = [newUser('Captain'), newUser('Captain')];
    const players = [newUser('Player'), newUser('Player'), newUser('Player')];
    const waiting = newUser('Waiting');
    const slugs = { leagueSlug: LEAGUE_SLUG, seasonSlug: CAP };
    return {
      waiting,
      batch: {
        accounts: [...captains, ...players, waiting],
        seasons: [
          {
            leagueSlug: LEAGUE_SLUG,
            name: 'Roster Cap',
            slug: CAP,
            ...SEASON_DATES,
            maxRosterSize: 4,
          },
        ],
        teams: [
          {
            ...slugs,
            name: 'Block Party',
            captainEmail: captains[0].email,
            playerEmails: players.map((player) => player.email),
          },
          { ...slugs, name: 'Dig Deep', captainEmail: captains[1].email },
        ],
        freeAgents: [{ ...slugs, email: waiting.email }],
      },
    };
  }

  test('the create form takes Maximum roster size, refuses one below the minimum, and the new season shows it', async ({
    page,
  }, testInfo) => {
    const { tenant } = await asOrgAdmin(page);
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
    test('the limit is refused below the largest roster, naming the team, then raised and removed', async ({
      page,
    }, testInfo) => {
      const { tenant } = await asOrgAdmin(page, capSeason().batch);
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
    const { waiting, batch } = capSeason();
    const { tenant } = await asOrgAdmin(page, batch);
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
    await page.keyboard.press('ArrowDown');
    await expect(dialog.getByRole('radio', { name: 'Dig Deep' })).toBeFocused();
    await expect(dialog.getByRole('radio', { name: 'Dig Deep' })).toBeChecked();
    await page.keyboard.press('ArrowUp');
    await expect(dialog.getByRole('radio', { name: 'Dig Deep' })).toBeFocused();
    await expect(full).not.toBeChecked();
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    await screenshot(page, testInfo, '144-place-full-team');
  });
});

test.describe('Season management: placing a free agent, with no team chosen or offline', () => {
  async function openPlaceDialog(page: Page, browser: Browser) {
    const { tenant, waiting, waitingPage } = await placeAsOrgAdmin(page, browser);
    await waitingPage.context().close();
    await page.goto(seasonPath(tenant, SUMMER));
    await freeAgentRows(page)
      .filter({ hasText: waiting.name })
      .getByRole('button', { name: `Place on team: ${waiting.name}` })
      .click();
    return placeDialog(page);
  }

  test('pressing Place on team with no team chosen shows the field error, and the dialog stays accessible', async ({
    page,
    browser,
  }, testInfo) => {
    const dialog = await openPlaceDialog(page, browser);
    await dialog.getByRole('button', { name: 'Place on team' }).click();
    await expect(dialog.getByText('Choose a team.')).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Block Party' })).toBeFocused();
    await screenshot(page, testInfo, '135-place-unchosen');
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
  });

  test('Tab enters the Team group at the first team, arrow keys move and choose, and Tab leaves and re-enters at the chosen team', async ({
    page,
    browser,
  }) => {
    const dialog = await openPlaceDialog(page, browser);
    const blockParty = dialog.getByRole('radio', { name: 'Block Party' });
    const digDeep = dialog.getByRole('radio', { name: 'Dig Deep' });
    await expect(blockParty).toBeFocused();
    await expect(blockParty).not.toBeChecked();
    await page.keyboard.press('ArrowDown');
    await expect(digDeep).toBeFocused();
    await expect(digDeep).toBeChecked();
    await page.keyboard.press(tabKey(page));
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press(`Shift+${tabKey(page)}`);
    await expect(digDeep).toBeFocused();
  });

  test('offline, the confirm button looks disabled and a press shows the offline alert in the dialog, focused', async ({
    page,
    browser,
  }, testInfo) => {
    const dialog = await openPlaceDialog(page, browser);
    await dialog.getByRole('radio', { name: 'Dig Deep' }).check();
    await page.context().setOffline(true);
    try {
      const confirm = dialog.getByRole('button', { name: 'Place on team' });
      await expect(confirm).toHaveAttribute('aria-disabled', 'true');
      await confirm.click({ force: true });
      const alert = dialog.locator('[data-slot="alert"]');
      await expect(alert).toContainText("You're offline. Nothing was sent.");
      await expect(alert).toBeFocused();
      await screenshot(page, testInfo, '135-place-offline');
      expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    } finally {
      await page.context().setOffline(false);
    }
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
  });
});
