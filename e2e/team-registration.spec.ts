import type { Page } from '@playwright/test';
import { axeScan, describeViolations, expectAccessible, tabKey } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { convexRun } from './support/convex';
import { expect, test } from './support/fixtures';
import { holdMutations, type HeldMutations } from './support/hold-mutations';
import { otherUser, signUp } from './support/session';
import { fetchRawHtml } from './support/raw-html';
import { screenshot } from './support/screenshot';
import { dateFromToday, seedSeasons, seedTenant, type Tenant } from './support/tenant';
import { newUser, seedUser, type TestUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LEAGUE = 'Sunday Reverse Coed 4s';
const LEAGUE_SLUG = 'sunday-reverse-coed-4s';
const OPEN = 'summer-open';
const OTHER_OPEN = 'fall-open';
const CLOSED = 'closed-season';
const DRAFT = 'draft-season';

async function seed(): Promise<Tenant> {
  const tenant = await seedTenant({
    name: 'E2E Teams',
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
      slug: OPEN,
      startDate: dateFromToday(40),
      endDate: dateFromToday(100),
      registrationDeadline: dateFromToday(20),
    },
    {
      name: 'Fall Open',
      slug: OTHER_OPEN,
      startDate: dateFromToday(140),
      endDate: dateFromToday(200),
      registrationDeadline: dateFromToday(120),
    },
    {
      name: 'Closed Season',
      slug: CLOSED,
      startDate: dateFromToday(10),
      endDate: dateFromToday(70),
      registrationDeadline: dateFromToday(-5),
    },
    {
      name: 'Draft Season',
      slug: DRAFT,
      startDate: dateFromToday(40),
      endDate: dateFromToday(100),
      registrationDeadline: dateFromToday(20),
      status: 'draft',
    },
  ]);
  return tenant;
}

const registerPath = (tenant: Tenant, season: string, league = LEAGUE_SLUG) =>
  `/app/register/${tenant.slug}/${league}/${season}/team`;

async function seedTeam(tenant: Tenant, season: string, name: string, captain: TestUser) {
  return (await convexRun('testing:seedTeam', {
    organizationSlug: tenant.slug,
    leagueSlug: LEAGUE_SLUG,
    seasonSlug: season,
    name,
    captainEmail: captain.email,
  })) as { teamId: string };
}

const teamName = (page: Page) => page.locator('#team-name');
const registerButton = (page: Page) => page.getByRole('button', { name: 'Register team' });

async function openForm(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(teamName(page)).toBeVisible();
}

test.describe('register a team', () => {
  test('signed out: Register a team on the season page, sign up, submit, and land on the team page', async ({
    page,
  }, testInfo) => {
    const tenant = await seed();
    const path = registerPath(tenant, OPEN);
    await page.goto(`${tenant.path}/leagues/${LEAGUE_SLUG}/seasons/${OPEN}`);
    await screenshot(page, testInfo, '129-season-open');
    await page.locator('#registration').getByRole('link', { name: 'Register a team' }).click();
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
      page.getByRole('heading', { level: 1, name: `${LEAGUE}, Summer Open` }),
    ).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '129-register-form');

    await registerButton(page).click();
    await expect(page.locator('#team-name-error')).toHaveText('Enter a team name.');
    await expect(teamName(page)).toBeFocused();
    await screenshot(page, testInfo, '129-register-empty');

    await teamName(page).fill('Sand Sharks');
    await registerButton(page).click();
    await expect(page).toHaveURL(new RegExp(`^${baseURL}/app/teams/[^/]+$`), { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Sand Sharks' })).toBeVisible();
    const main = page.locator('main');
    await expect(main.getByTestId('roster-count')).toHaveText('1 of 4 players');
    await expect(main.getByTestId('roster-note')).toContainText('3 more needed');
    const roster = main.locator('section[aria-labelledby="roster-heading"] ul > li');
    await expect(roster).toHaveCount(1);
    await expect(roster).toContainText(user.name);
    await expect(roster).toContainText('Captain');
    await expect(main.getByRole('status').filter({ hasText: 'is registered for' })).toBeFocused();
    await expectAccessible(page);
    await screenshot(page, testInfo, '129-team-registered');
  });

  test('closed: the register route shows the deadline and no form', async ({ page }, testInfo) => {
    const tenant = await seed();
    await signUp(page, newUser('Late'));
    await page.goto(registerPath(tenant, CLOSED));
    const card = page.locator('main [data-slot="alert"]');
    await expect(card).toContainText('Registration for this season is closed.');
    await expect(card).toContainText(`It closed on`);
    await expect(teamName(page)).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '129-register-closed');
  });

  test('already on a team: says so with a link and no form, also after the deadline', async ({
    page,
  }, testInfo) => {
    const tenant = await seed();
    const captain = newUser('OnTeam');
    await signUp(page, captain);
    const { teamId } = await seedTeam(tenant, OPEN, 'Team A', captain);
    await seedTeam(tenant, CLOSED, 'Team B', captain);

    for (const [season, team, id] of [
      [OPEN, 'Team A', teamId],
      [CLOSED, 'Team B', undefined],
    ] as const) {
      await page.goto(registerPath(tenant, season));
      await expect(page.locator('main [data-slot="alert"]')).toContainText(
        `You’re on ${team} in this season.`,
      );
      await expect(teamName(page)).toHaveCount(0);
      await expect(page.locator('main')).not.toContainText(
        'Registration for this season is closed.',
      );
      const link = page.getByRole('link', { name: `Go to ${team}` });
      if (id !== undefined) await expect(link).toHaveAttribute('href', `/app/teams/${id}`);
      else await expect(link).toHaveAttribute('href', /^\/app\/teams\/[^/]+$/);
    }
    await page.goto(registerPath(tenant, OPEN));
    await expect(page.getByRole('link', { name: 'Go to Team A' })).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '129-register-on-team');
  });

  test('a waiting free agent: says so with a link to the free-agent route and no form', async ({
    page,
  }, testInfo) => {
    const tenant = await seed();
    const waiting = newUser('Waiting');
    await signUp(page, waiting);
    await convexRun('testing:seedFreeAgent', {
      organizationSlug: tenant.slug,
      leagueSlug: LEAGUE_SLUG,
      seasonSlug: OPEN,
      email: waiting.email,
    });
    await page.goto(registerPath(tenant, OPEN));
    await expect(page.locator('main [data-slot="alert"]')).toContainText(
      'You’re waiting to be placed on a team.',
    );
    await expect(teamName(page)).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'View your free-agent registration' }),
    ).toHaveAttribute('href', `/app/register/${tenant.slug}/${LEAGUE_SLUG}/${OPEN}/free-agent`);
    await expectAccessible(page);
    await screenshot(page, testInfo, '133-team-route-waiting');
  });

  test('not found: an unknown slug, a draft season, and another league’s path show the not-found view and no form', async ({
    page,
  }, testInfo) => {
    const tenant = await seed();
    for (const path of [
      registerPath(tenant, 'no-such-season'),
      registerPath(tenant, DRAFT),
      registerPath(tenant, OPEN, 'no-such-league'),
      `/app/register/no-such-org/${LEAGUE_SLUG}/${OPEN}/team`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
      await expect(teamName(page)).toHaveCount(0);
      await expect(page).toHaveURL(`${baseURL}${path}`);
    }
    await expectAccessible(page);
    await screenshot(page, testInfo, '129-register-not-found');
  });
});

test.describe('register a team: a refused name', () => {
  test.use({ expectedConvexErrors: ['teams:register'] });

  test('a taken name shows its message; the same name registers in another season', async ({
    page,
    browser,
  }, testInfo) => {
    const tenant = await seed();
    const rival = newUser('Rival');
    const rivalPage = await otherUser(browser, rival);
    await rivalPage.context().close();
    await seedTeam(tenant, OPEN, 'sand sharks', rival);

    await signUp(page, newUser('Second'));
    await openForm(page, registerPath(tenant, OPEN));
    await teamName(page).fill('Sand  Sharks');
    await registerButton(page).click();
    await expect(page.locator('#team-name-error')).toHaveText(
      'sand sharks is already registered in this season. Choose another name.',
    );
    await expect(teamName(page)).toHaveValue('Sand  Sharks');
    await expectAccessible(page);
    await screenshot(page, testInfo, '129-register-taken');

    await openForm(page, registerPath(tenant, OTHER_OPEN));
    await teamName(page).fill('Sand  Sharks');
    await registerButton(page).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sand Sharks' })).toBeVisible({
      timeout: 20_000,
    });
  });
});

test.describe('team page', () => {
  test('/app/teams/not-an-id shows the not-found view', VIEWPORT_AGNOSTIC, async ({ page }) => {
    await signUp(page, newUser('Lost'));
    await page.goto('/app/teams/not-an-id');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  });

  test('another user gets the no-access view', async ({ page }, testInfo) => {
    const tenant = await seed();
    const captain = newUser('Owner');
    const captainPage = await otherUser(page.context().browser()!, captain);
    await captainPage.context().close();
    const { teamId } = await seedTeam(tenant, OPEN, 'Private Team', captain);

    await signUp(page, newUser('Stranger'));
    await page.goto(`/app/teams/${teamId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'You can’t open this team page' }),
    ).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '129-team-no-access');
  });
});

const rosterRows = (page: Page) => page.locator('section[aria-labelledby="roster-heading"] li');
const removeFor = (page: Page, name: string, team: string) =>
  page.getByRole('button', { name: `Remove ${name} from ${team}` });
const removeDialog = (page: Page) => page.getByRole('alertdialog');
const rosterStatus = (page: Page) =>
  page.locator('section[aria-labelledby="roster-heading"] [role="status"]');

/** The viewer is the captain unless `organizer` is set; `firstPlayerPage` is a signed-in page for the first player, whose context the caller closes. */
async function rosterOfThree(
  page: Page,
  {
    organizer = false,
    firstPlayerSignedIn = false,
    beforeOpen,
  }: { organizer?: boolean; firstPlayerSignedIn?: boolean; beforeOpen?: () => Promise<void> } = {},
) {
  const tenant = await seed();
  const captain = newUser('Captain');
  const viewer = organizer ? newUser('Organizer') : captain;
  await signUp(page, viewer);
  if (organizer) await seedUser(captain);
  const marcus = newUser('Marcus');
  const firstPlayerPage = firstPlayerSignedIn
    ? await otherUser(page.context().browser()!, marcus)
    : (await seedUser(marcus), null);
  const players = [marcus, await seedUser(newUser('Elena'))];
  const { teamId } = await seedTeam(tenant, OPEN, 'Sand Sharks', captain);
  for (const player of players) {
    await convexRun('testing:addToTeam', { teamId, email: player.email });
  }
  if (organizer) {
    await convexRun('testing:addLeagueOrganizer', {
      organizationSlug: tenant.slug,
      email: viewer.email,
      leagueSlugs: [LEAGUE_SLUG],
    });
  }
  await beforeOpen?.();
  await page.goto(`/app/teams/${teamId}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Sand Sharks' })).toBeVisible();
  await expect(rosterRows(page)).toHaveCount(3);
  return { teamId, captain, players, firstPlayerPage };
}

test.describe('team page: removing a player', () => {
  test('the captain removes a player after confirming: the row leaves, the count falls by 1, and the status takes focus; the player loses the page', async ({
    page,
  }, testInfo) => {
    const { teamId, captain, players, firstPlayerPage } = await rosterOfThree(page, {
      firstPlayerSignedIn: true,
    });
    const marcusPage = firstPlayerPage!;
    const [marcus] = players;
    await expect(page.getByTestId('roster-count')).toHaveText('3 of 4 players');
    await expect(
      rosterRows(page).filter({ hasText: captain.name }).getByRole('button'),
    ).toHaveCount(0);
    await expect(removeFor(page, marcus.name, 'Sand Sharks')).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    );
    await screenshot(page, testInfo, '137-remove-captain-row');
    await expectAccessible(page);

    await removeFor(page, marcus.name, 'Sand Sharks').click();
    const dialog = removeDialog(page);
    await expect(
      dialog.getByRole('heading', { name: `Remove ${marcus.name} from Sand Sharks?` }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      'They’ll lose access to the team page. You can invite them again later.',
    );
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    // The modal holds focus, so the page-wide Tab walk (which expects to leave the page) does not
    // apply: axe, and a Tab that cycles inside the dialog.
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    await page.keyboard.press(tabKey(page));
    await expect(dialog.getByRole('button', { name: 'Remove player' })).toBeFocused();
    await page.keyboard.press(`Shift+${tabKey(page)}`);
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await screenshot(page, testInfo, '137-remove-confirm');

    await dialog.getByRole('button', { name: 'Remove player' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(rosterStatus(page)).toContainText(`${marcus.name} was removed from Sand Sharks.`);
    await expect(rosterStatus(page)).toContainText(
      'They can no longer open this page. You can invite them again.',
    );
    await expect(rosterStatus(page)).toBeFocused();
    await expect(rosterRows(page)).toHaveCount(2);
    await expect(rosterRows(page).filter({ hasText: marcus.name })).toHaveCount(0);
    await expect(page.getByTestId('roster-count')).toHaveText('2 of 4 players');
    await expect(page.getByTestId('roster-note')).toHaveText(
      '2 more needed to reach the minimum of 4 players.',
    );
    await screenshot(page, testInfo, '137-remove-removed');
    await expectAccessible(page);

    try {
      await marcusPage.goto(`/app/teams/${teamId}`);
      await expect(
        marcusPage.getByRole('heading', { level: 1, name: 'You can’t open this team page' }),
      ).toBeVisible();
    } finally {
      await marcusPage.context().close();
    }
  });

  test('Cancel and Escape write nothing and return focus to that row’s Remove', async ({
    page,
  }) => {
    const { players } = await rosterOfThree(page);
    const elena = removeFor(page, players[1].name, 'Sand Sharks');

    await elena.click();
    await removeDialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(removeDialog(page)).toHaveCount(0);
    await expect(elena).toBeFocused();

    await elena.click();
    await expect(removeDialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(removeDialog(page)).toHaveCount(0);
    await expect(elena).toBeFocused();

    await expect(rosterRows(page)).toHaveCount(3);
    await expect(page.getByTestId('roster-count')).toHaveText('3 of 4 players');
    await expect(rosterStatus(page)).toHaveCount(0);
  });

  test('an organizer of the league removes a player on the team page', async ({
    page,
  }, testInfo) => {
    const { players } = await rosterOfThree(page, { organizer: true });
    await expect(
      page.getByText(`You’re an organizer of ${LEAGUE}, so you can manage this team’s roster.`),
    ).toBeVisible();
    await removeFor(page, players[0].name, 'Sand Sharks').click();
    await removeDialog(page).getByRole('button', { name: 'Remove player' }).click();
    await expect(rosterStatus(page)).toBeFocused();
    await expect(rosterRows(page)).toHaveCount(2);
    await expect(page.getByTestId('roster-count')).toHaveText('2 of 4 players');
    await screenshot(page, testInfo, '137-remove-organizer');
    await expectAccessible(page);
  });
});

test.describe('team page: removing a player, while the removal is held', () => {
  test('the Removing… button is disabled and the dialog stays accessible', async ({
    page,
  }, testInfo) => {
    let held: HeldMutations | undefined;
    const { players } = await rosterOfThree(page, {
      beforeOpen: async () => {
        held = await holdMutations(page);
      },
    });
    await removeFor(page, players[0].name, 'Sand Sharks').click();
    const dialog = removeDialog(page);
    held!.hold();
    await dialog.getByRole('button', { name: 'Remove player' }).click();
    const removing = dialog.getByRole('button', { name: 'Removing…' });
    await expect(removing).toHaveAttribute('aria-disabled', 'true');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    await screenshot(page, testInfo, '137-remove-removing');
    held!.release();
    await expect(dialog).toHaveCount(0);
    await expect(rosterRows(page)).toHaveCount(2);
  });
});

test.describe('team page: removing a player someone else removed', () => {
  test.use({ expectedConvexErrors: ['rosterEntries:remove'] });

  test('the dialog says so with focus on the alert, and Cancel returns focus to the next Remove', async ({
    page,
  }, testInfo) => {
    const { teamId, players } = await rosterOfThree(page);
    const [marcus, elena] = players;
    await removeFor(page, marcus.name, 'Sand Sharks').click();
    const dialog = removeDialog(page);
    await convexRun('testing:removeFromTeam', { teamId, email: marcus.email });
    await expect(page.getByTestId('roster-count')).toHaveText('2 of 4 players');

    await dialog.getByRole('button', { name: 'Remove player' }).click();
    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText(`${marcus.name} could not be removed.`);
    await expect(alert).toContainText('They’re no longer on the team.');
    await expect(alert).toBeFocused();
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    await screenshot(page, testInfo, '137-remove-error');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(removeFor(page, elena.name, 'Sand Sharks')).toBeFocused();
    await expect(rosterStatus(page)).toHaveCount(0);
  });
});

test.describe('a full season', () => {
  const FULL = 'full-season';
  const FULL_CLOSED = 'full-closed';

  async function seedFull(tenant: Tenant, slug: string, deadlineFromToday: number) {
    await convexRun('testing:seedSeason', {
      organizationSlug: tenant.slug,
      leagueSlug: LEAGUE_SLUG,
      name: slug === FULL ? 'Full Season' : 'Full Closed',
      slug,
      startDate: dateFromToday(40),
      endDate: dateFromToday(100),
      registrationDeadline: dateFromToday(deadlineFromToday),
      minimumRosterSize: 4,
      maxTeams: 2,
      status: 'published',
    });
    for (const name of ['Pair of Aces', 'Two Tall']) {
      await seedTeam(tenant, slug, name, await seedUser(newUser('Captain')));
    }
  }

  const seasonPagePath = (tenant: Tenant, season: string) =>
    `${tenant.path}/leagues/${LEAGUE_SLUG}/seasons/${season}`;

  test('the season page says the season is full and offers the waitlist and the free-agent route', async ({
    page,
    request,
  }, testInfo) => {
    const tenant = await seed();
    await seedFull(tenant, FULL, 20);
    const path = seasonPagePath(tenant, FULL);
    if (testInfo.project.name === 'chromium-desktop') {
      const { html } = await fetchRawHtml(request, path);
      expect(html).toContain('This season is full');
      expect(html).toContain(`href="${registerPath(tenant, FULL)}"`);
      expect(html).toContain(
        `href="/app/register/${tenant.slug}/${LEAGUE_SLUG}/${FULL}/free-agent"`,
      );
    }
    await page.goto(path);
    const card = page.locator('#registration');
    await expect(card).toContainText('This season is full');
    await expect(card).toContainText(
      'Join the waitlist and an organizer offers you a place if one opens. Registration closes',
    );
    await expect(card.getByRole('link', { name: 'Register a team' })).toHaveCount(0);
    await expect(card.getByRole('link', { name: 'Join the waitlist' })).toHaveAttribute(
      'href',
      registerPath(tenant, FULL),
    );
    await expect(card.getByRole('link', { name: 'Register as a free agent' })).toBeVisible();
    await expect(page.getByTestId('season-phase')).toHaveText('Full');
    await expectAccessible(page);
    await screenshot(page, testInfo, '145-season-full-waitlist');
  });

  test('the register route offers the waitlist form, and sends nothing until it is submitted', async ({
    page,
  }, testInfo) => {
    const tenant = await seed();
    await seedFull(tenant, FULL, 20);
    await signUp(page, newUser('Late'));
    const sent: string[] = [];
    page.on('websocket', (socket) => {
      socket.on('framesent', (frame) => sent.push(String(frame.payload)));
    });
    await page.goto(registerPath(tenant, FULL));
    const note = page.locator('main form [data-slot="alert"]');
    await expect(note).toContainText('This season is full, so your team joins the waitlist.');
    await expect(teamName(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join the waitlist' })).toBeVisible();
    await expect(registerButton(page)).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '145-register-join-waitlist');
    expect(sent.filter((frame) => frame.includes('teams:register'))).toEqual([]);
  });

  test('a full season whose registration closed shows the closed state on the page and the route', async ({
    page,
  }) => {
    const tenant = await seed();
    await seedFull(tenant, FULL_CLOSED, -5);
    await page.goto(seasonPagePath(tenant, FULL_CLOSED));
    const card = page.locator('#registration');
    await expect(card).toContainText('Registration closed on');
    await expect(card).not.toContainText('This season is full');

    await signUp(page, newUser('Closed'));
    await page.goto(registerPath(tenant, FULL_CLOSED));
    const alert = page.locator('main [data-slot="alert"]');
    await expect(alert).toContainText('Registration for this season is closed.');
    await expect(alert).not.toContainText('This season is full.');
  });
});

test.describe('team page: removing a player, offline', () => {
  test('the confirm button looks disabled and a press shows the offline alert in the dialog, focused', async ({
    page,
  }, testInfo) => {
    const { players } = await rosterOfThree(page);
    await removeFor(page, players[0].name, 'Sand Sharks').click();
    const dialog = removeDialog(page);
    await expect(dialog).toBeVisible();
    await page.context().setOffline(true);
    try {
      const confirm = dialog.getByRole('button', { name: 'Remove player' });
      await expect(confirm).toHaveAttribute('aria-disabled', 'true');
      await confirm.click({ force: true });
      const alert = dialog.locator('[data-slot="alert"]');
      await expect(alert).toContainText("You're offline. Nothing was sent.");
      await expect(alert).toContainText(`${players[0].name} is still on the team.`);
      await expect(alert).toBeFocused();
      await screenshot(page, testInfo, '137-remove-offline');
      expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    } finally {
      await page.context().setOffline(false);
    }
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(rosterRows(page)).toHaveCount(3);
  });
});
