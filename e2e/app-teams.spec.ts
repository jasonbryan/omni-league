import type { Browser, Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { otherUser, signUp } from './support/session';
import { seedSeasons, seedTenant, type Tenant } from './support/tenant';
import { newUser, type TestUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const GULF_COAST = 'Gulf Coast Sport & Social';
const SUNDAY = 'Sunday Reverse Coed 4s';
const THURSDAY = 'Thursday Night Coed 2s';
const slugOf = (name: string) => name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');

const SUMMER = { name: 'Summer 2027', slug: 'summer-2027', startDate: '2027-06-01' };
const SPRING = { name: 'Spring 2027', slug: 'spring-2027', startDate: '2027-03-01' };

async function gulfCoast(): Promise<Tenant> {
  const tenant = await seedTenant({
    name: GULF_COAST,
    locations: [{ name: 'Alpha Beach', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
    leagues: [SUNDAY, THURSDAY].map((name) => ({
      name,
      sport: 'beachVolleyball' as const,
      locations: ['Alpha Beach'],
    })),
  });
  await Promise.all(
    [SUNDAY, THURSDAY].map((league) =>
      seedSeasons(
        tenant,
        slugOf(league),
        [SUMMER, SPRING].map((season) => ({
          ...season,
          endDate: season.startDate.replace(/-01$/, '-28'),
        })),
      ),
    ),
  );
  return tenant;
}

async function seedTeam(
  tenant: Tenant,
  league: string,
  season: { slug: string },
  name: string,
  captain: TestUser,
): Promise<string> {
  const { teamId } = (await convexRun('testing:seedTeam', {
    organizationSlug: tenant.slug,
    leagueSlug: slugOf(league),
    seasonSlug: season.slug,
    name,
    captainEmail: captain.email,
  })) as { teamId: string };
  return teamId;
}

async function openApp(page: Page, seed?: (user: TestUser) => Promise<void>) {
  const user = newUser('Player');
  await signUp(page, user);
  await seed?.(user);
  await page.goto('/app');
  await expect(page.locator('#teams-heading')).toBeVisible();
  return user;
}

const teams = (page: Page) => page.getByRole('region', { name: 'Your teams' });
const rowOf = (page: Page, team: string) =>
  teams(page)
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: team }) });

async function captainAndPlayer(browser: Browser, user: TestUser) {
  const tenant = await gulfCoast();
  const captain = newUser('Captain');
  await (await otherUser(browser, captain)).context().close();
  const sharks = await seedTeam(tenant, SUNDAY, SUMMER, 'Sand Sharks', user);
  const aces = await seedTeam(tenant, THURSDAY, SPRING, 'Pair of Aces', captain);
  await convexRun('testing:addToTeam', { teamId: aces, email: user.email });
  return { tenant, sharks, aces };
}

test.describe('/app: Your teams', () => {
  test('lists a captain’s team and a player’s team with their roles, newest season first, each linking to its team page', async ({
    page,
    browser,
  }) => {
    let seeded!: Awaited<ReturnType<typeof captainAndPlayer>>;
    await openApp(page, async (user) => {
      seeded = await captainAndPlayer(browser, user);
    });
    await expect(teams(page).getByRole('heading', { level: 3 })).toHaveText([
      'Sand Sharks',
      'Pair of Aces',
    ]);
    await expect(rowOf(page, 'Sand Sharks')).toContainText(`${SUMMER.name} · ${SUNDAY}`);
    await expect(rowOf(page, 'Sand Sharks')).toContainText(seeded.tenant.name);
    await expect(rowOf(page, 'Sand Sharks').locator('[data-slot="badge"]')).toHaveText('Captain');
    await expect(rowOf(page, 'Pair of Aces').locator('[data-slot="badge"]')).toHaveText('Player');
    await expect(
      rowOf(page, 'Sand Sharks').getByRole('link', { name: 'Team page: Sand Sharks' }),
    ).toHaveAttribute('href', `/app/teams/${seeded.sharks}`);
    await expect(
      rowOf(page, 'Pair of Aces').getByRole('link', { name: 'Team page: Pair of Aces' }),
    ).toHaveAttribute('href', `/app/teams/${seeded.aces}`);

    await rowOf(page, 'Pair of Aces')
      .getByRole('link', { name: 'Team page: Pair of Aces' })
      .click();
    await expect(page).toHaveURL(`${baseURL}/app/teams/${seeded.aces}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Pair of Aces' })).toBeVisible();
  });

  test('a team the user was removed from is not listed', async ({ page, browser }) => {
    await openApp(page, async (user) => {
      const { aces } = await captainAndPlayer(browser, user);
      await convexRun('testing:removeFromTeam', { teamId: aces, email: user.email });
    });
    await expect(teams(page).getByRole('heading', { level: 3 })).toHaveText(['Sand Sharks']);
  });
});

const STATES = ['none', 'one'] as const;
type State = (typeof STATES)[number];

const MOCKUP_FILE = join(process.cwd(), 'design', 'mockups', '130-app-teams.html');
const mockupTexts = new Map<number, Promise<Map<State, string>>>();

function mockupTextsAt(browser: Browser, width: number): Promise<Map<State, string>> {
  let texts = mockupTexts.get(width);
  if (!texts) {
    texts = readMockup(browser, width);
    mockupTexts.set(width, texts);
  }
  return texts;
}

async function readMockup(browser: Browser, width: number): Promise<Map<State, string>> {
  // The overview page loads every state in iframes that each load it again; the states are its
  // <template>s, so the read uses a copy without the frames.
  const html = (await readFile(MOCKUP_FILE, 'utf8')).replace(/<iframe\b[\s\S]*?<\/iframe>/g, '');
  const directory = await mkdtemp(join(tmpdir(), 'mockup-130-'));
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  try {
    const file = join(directory, 'app-teams.html');
    await writeFile(file, html);
    const page = await context.newPage();
    const texts = new Map<State, string>();
    for (const state of STATES) {
      await page.goto(`${pathToFileURL(file).href}?state=${state}`);
      texts.set(state, teamsText(await page.locator('main#main').first().innerText()));
    }
    return texts;
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
}

// Stops at "Your organizations": the mockup's user has organizations and the test's user has none.
function teamsText(text: string, tenant?: Tenant) {
  const result = tenant ? text.replaceAll(tenant.name, GULF_COAST) : text;
  const lines = result
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const start = lines.indexOf('Your teams');
  const end = lines.indexOf('Your organizations', start);
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

async function matchesMockup(
  page: Page,
  browser: Browser,
  state: State,
  testInfo: Parameters<typeof screenshot>[1],
  tenant?: Tenant,
) {
  const width = page.viewportSize()?.width ?? 0;
  const expected = (await mockupTextsAt(browser, width)).get(state);
  await expect
    .poll(async () => teamsText(await page.getByRole('main').innerText(), tenant), {
      message: `${state} at ${width}px`,
    })
    .toBe(expected);
  await screenshot(page, testInfo, `130-app-teams-${state}`);
  await expectAccessible(page);
}

test.describe('/app: "Your teams" against the mockup', () => {
  test('state 2: a user with no teams gets the empty state', async ({
    page,
    browser,
  }, testInfo) => {
    await openApp(page);
    await expect(teams(page)).toContainText('No teams yet');
    await matchesMockup(page, browser, 'none', testInfo);
  });

  test('state 3: one team, as its captain', async ({ page, browser }, testInfo) => {
    let tenant!: Tenant;
    await openApp(page, async (user) => {
      tenant = await gulfCoast();
      await seedTeam(tenant, SUNDAY, SUMMER, 'Sand Sharks', user);
    });
    await matchesMockup(page, browser, 'one', testInfo, tenant);
  });

  test('state 4: several teams, captain and player', async ({ page, browser }, testInfo) => {
    await openApp(page, async (user) => {
      await captainAndPlayer(browser, user);
    });
    await expect(teams(page).getByRole('listitem')).toHaveCount(2);
    await screenshot(page, testInfo, '130-app-teams-several');
    await expectAccessible(page);
  });
});
