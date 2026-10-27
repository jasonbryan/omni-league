// Cost: the 2-vCPU CI runner ran past the 30 s test timeout with a sign-up, a tenant, and up to six
// `convex run` processes per test. Sign-up is not under test here, so each worker signs up its two
// users once and every test starts from their saved session. Tests that only read share the tenants
// the worker seeded once; the tests that create or publish seed their own.
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AXE_TAGS, axeScan, describeViolations, expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test as base } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { seedTenant, type LeagueSeed, type Tenant } from './support/tenant';
import { newUser, type TestUser } from './support/users';

type Role = 'orgAdmin' | 'leagueOrganizer';
type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

interface Account {
  user: TestUser;
  state: StorageState;
}

interface World {
  accounts: Record<Role, Account>;
  shared: Tenant;
  notAssigned: Tenant;
}

const PROJECT = 'chromium-desktop';

const test = base.extend<{ role: Role }, { world: World | undefined }>({
  world: [
    async ({ browser }, use, workerInfo) => {
      if (workerInfo.project.name !== PROJECT || remoteBaseUrl !== undefined) {
        await use(undefined);
        return;
      }
      // The mockup read (11 loads of a 1.9 MB page per width) is slow on a busy machine, so it
      // happens here, outside the first test's 30 s.
      for (const width of WIDTHS) await mockupTextsAt(browser, width);
      const orgAdmin = await signedUp(browser, newUser('Admin'));
      const leagueOrganizer = await signedUp(browser, newUser('Organizer'));
      const [shared, notAssigned] = await Promise.all([
        seed(
          [
            { user: orgAdmin.user, role: 'orgAdmin' },
            {
              user: leagueOrganizer.user,
              role: 'leagueOrganizer',
              assigned: [SUNDAY, THURSDAY, COED, FRIDAY],
            },
          ],
          {
            [COED]: COED_SEASONS,
            [SUNDAY]: SUNDAY_SEASONS,
            [SLOW_PITCH]: SLOW_PITCH_SEASONS,
            [FRIDAY]: FRIDAY_SEASONS,
          },
        ),
        seed([{ user: leagueOrganizer.user, role: 'leagueOrganizer', assigned: [THURSDAY] }]),
      ]);
      await use({ accounts: { orgAdmin, leagueOrganizer }, shared, notAssigned });
    },
    { scope: 'worker', timeout: 180_000 },
  ],
  role: ['orgAdmin', { option: true }],
  storageState: async ({ world, role }, use) => {
    await use(world?.accounts[role].state);
  },
});

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');
test.beforeEach(({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name !== PROJECT, 'both widths are set inside each test');
});

async function signedUp(browser: Browser, user: TestUser): Promise<Account> {
  const context = await browser.newContext({ baseURL });
  try {
    await signUp(await context.newPage(), user);
    return { user, state: await context.storageState() };
  } finally {
    await context.close();
  }
}

const MOCKUP_FILE = join(process.cwd(), 'design', 'mockups', '125-126-seasons.html');
const WIDTHS = [360, 1280] as const;
const MOCKUP_ORGANIZATION = 'Gulf Coast Sport & Social';

const LOCATIONS = [
  { name: 'Bayside Athletic Complex', address: '4410 Ocean Dr, Corpus Christi, TX 78412' },
  { name: 'Flour Bluff Softball Park', address: '2001 Waldron Rd, Corpus Christi, TX 78418' },
  { name: 'North Beach Sand Courts', address: '3500 Surfside Blvd, Corpus Christi, TX 78402' },
];
const LEAGUES: LeagueSeed[] = [
  {
    name: 'Coed 7v7 Rec',
    sport: 'soccer' as const,
    locations: ['Bayside Athletic Complex'],
    division: { gender: 'coed', playersPerSide: 7, level: 'rec', ageGroup: 'adult' },
  },
  {
    name: "Men's Over-30 11v11",
    sport: 'soccer' as const,
    locations: ['Bayside Athletic Complex'],
    division: { gender: 'mens', playersPerSide: 11, level: 'rec', ageGroup: 'over30' },
  },
  {
    name: 'Sunday Reverse Coed 4s',
    sport: 'beachVolleyball' as const,
    locations: ['North Beach Sand Courts'],
    division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
  },
  {
    name: 'Thursday Night Coed 2s',
    sport: 'beachVolleyball' as const,
    locations: ['North Beach Sand Courts'],
    division: { gender: 'coed', playersPerSide: 2, level: 'b', ageGroup: 'adult' },
  },
  {
    name: 'Tuesday Coed Slow-Pitch',
    sport: 'softball' as const,
    locations: ['Flour Bluff Softball Park'],
    status: 'draft' as const,
    division: { gender: 'coed', playersPerSide: 10, level: 'rec', ageGroup: 'adult' },
  },
  {
    name: 'Friday Night Coed 6s',
    sport: 'beachVolleyball' as const,
    locations: ['North Beach Sand Courts'],
    status: 'draft' as const,
    division: { gender: 'coed', playersPerSide: 6, level: 'bb', ageGroup: 'adult' },
  },
];
const COED = 'coed-7v7-rec';
const MENS = 'men-s-over-30-11v11';
const SUNDAY = 'sunday-reverse-coed-4s';
const THURSDAY = 'thursday-night-coed-2s';
const SLOW_PITCH = 'tuesday-coed-slow-pitch';
const FRIDAY = 'friday-night-coed-6s';

interface SeasonSeed {
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  playersPerSide: number;
  minimumRosterSize: number;
  status: 'draft' | 'published';
}

const COED_SEASONS: SeasonSeed[] = [
  {
    name: 'Fall 2027',
    slug: 'fall-2027',
    startDate: '2027-09-08',
    endDate: '2027-11-10',
    registrationDeadline: '2027-08-25',
    playersPerSide: 7,
    minimumRosterSize: 9,
    status: 'draft',
  },
  {
    name: 'Summer 2027',
    slug: 'summer-2027',
    startDate: '2027-06-02',
    endDate: '2027-08-25',
    registrationDeadline: '2027-05-19',
    playersPerSide: 7,
    minimumRosterSize: 7,
    status: 'published',
  },
  {
    name: 'Spring 2027',
    slug: 'spring-2027',
    startDate: '2027-03-03',
    endDate: '2027-05-12',
    registrationDeadline: '2027-02-17',
    playersPerSide: 7,
    minimumRosterSize: 7,
    status: 'published',
  },
  {
    name: 'Fall 2026',
    slug: 'fall-2026',
    startDate: '2026-09-09',
    endDate: '2026-11-18',
    registrationDeadline: '2026-08-26',
    playersPerSide: 7,
    minimumRosterSize: 7,
    status: 'published',
  },
];

const SUNDAY_SEASONS: SeasonSeed[] = [
  {
    name: 'Fall 2027',
    slug: 'fall-2027',
    startDate: '2027-09-12',
    endDate: '2027-11-14',
    registrationDeadline: '2027-08-29',
    playersPerSide: 4,
    minimumRosterSize: 4,
    status: 'draft',
  },
  {
    name: 'Summer 2027',
    slug: 'summer-2027',
    startDate: '2027-06-06',
    endDate: '2027-08-29',
    registrationDeadline: '2027-05-23',
    playersPerSide: 4,
    minimumRosterSize: 4,
    status: 'published',
  },
  {
    name: 'Fall 2026',
    slug: 'fall-2026',
    startDate: '2026-09-13',
    endDate: '2026-11-15',
    registrationDeadline: '2026-08-30',
    playersPerSide: 4,
    minimumRosterSize: 4,
    status: 'published',
  },
];

const SLOW_PITCH_SEASONS: SeasonSeed[] = [
  {
    name: 'Spring 2027',
    slug: 'spring-2027',
    startDate: '2027-03-02',
    endDate: '2027-05-18',
    registrationDeadline: '2027-02-16',
    playersPerSide: 10,
    minimumRosterSize: 12,
    status: 'draft',
  },
];
const FRIDAY_SEASONS: SeasonSeed[] = [
  {
    name: 'Spring 2027',
    slug: 'spring-2027',
    startDate: '2027-03-05',
    endDate: '2027-05-14',
    registrationDeadline: '2027-02-19',
    playersPerSide: 6,
    minimumRosterSize: 6,
    status: 'draft',
  },
];

const SPRING_2028 = {
  name: 'Spring 2028',
  startDate: '2028-03-01',
  endDate: '2028-05-10',
  registrationDeadline: '2028-02-15',
};

const STATES = [
  'empty',
  'populated',
  'filled',
  'errors-required',
  'errors-rules',
  'errors-slug',
  'created',
  'creating',
  'organizer',
  'no-access',
  'not-found',
  'publish-confirm',
  'publishing',
  'published',
  'publish-error',
  'publish-offline',
  'draft-league-admin',
  'draft-league-organizer',
] as const;
type State = (typeof STATES)[number];

interface Frame {
  main: string;
  dialog: string | null;
}

const mockupTexts = new Map<number, Promise<Map<State, Frame>>>();

function mockupTextsAt(browser: Browser, width: number): Promise<Map<State, Frame>> {
  let texts = mockupTexts.get(width);
  if (!texts) {
    texts = readMockup(browser, width);
    mockupTexts.set(width, texts);
  }
  return texts;
}

async function readMockup(browser: Browser, width: number): Promise<Map<State, Frame>> {
  // The overview page lists every state in 48 frames, and each frame loads the page again. Four
  // browsers doing that at once made single loads take over 30 s. The states are the page's
  // <template>s, so the read uses a copy without the frames.
  const html = (await readFile(MOCKUP_FILE, 'utf8')).replace(/<iframe\b[\s\S]*?<\/iframe>/g, '');
  const directory = await mkdtemp(join(tmpdir(), 'mockup-125-'));
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  try {
    const file = join(directory, 'seasons.html');
    await writeFile(file, html);
    const page = await context.newPage();
    const texts = new Map<State, Frame>();
    for (const state of STATES) {
      await page.goto(`${pathToFileURL(file).href}?state=${state}`);
      const text = await page.locator('main#main').first().innerText();
      const dialog = page.locator('[role="alertdialog"]');
      texts.set(state, {
        main: normalize(text, MOCKUP_ORGANIZATION),
        dialog:
          (await dialog.count()) > 0 ? normalizeDialog(await dialog.first().innerText()) : null,
      });
    }
    return texts;
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function normalize(text: string, organization: string): string {
  const lines = text
    .replaceAll(organization, 'ORG')
    .replaceAll(' View public page', '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    // The mockup asks for a format and a minimum roster size, which the league now sets.
    if (line === 'Limits' || line === 'Format') skipping = true;
    if (skipping && /^Creat(e draft|ing) season/.test(line)) skipping = false;
    if (!skipping) kept.push(line);
  }
  return kept.join('\n');
}

async function appText(page: Page, organization: string): Promise<string> {
  // Not `getByRole('main')`: the page behind a dialog is inert, which the role query may skip. The
  // league details are outside this mockup (league-management-details.spec.ts covers them), so
  // they are hidden while the text is read.
  const text = await page.locator('main#main').evaluate((main: HTMLElement) => {
    const apart = [
      ...main.querySelectorAll<HTMLElement>(
        '#details, [data-slot="league-division"], a[href$="#details"], section[aria-labelledby="from-league-heading"]',
      ),
    ];
    const displays = apart.map((element) => element.style.display);
    for (const element of apart) element.style.display = 'none';
    const read = main.innerText;
    apart.forEach((element, index) => (element.style.display = displays[index]!));
    return read;
  });
  return normalize(text, organization);
}

/**
 * The app writes the offline copy with a straight apostrophe, as every offline message does, and
 * the mockup with a curly one.
 */
function normalizeDialog(text: string): string {
  return text
    .replaceAll("'", '’')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}

interface Member {
  user: TestUser;
  role: Role;
  assigned?: string[];
}

async function seed(members: Member[], seasons: Record<string, SeasonSeed[]> = {}) {
  const tenant = await seedTenant({
    name: MOCKUP_ORGANIZATION,
    locations: LOCATIONS,
    leagues: LEAGUES,
  });
  const memberships = members.map(({ user: { email }, role, assigned = [] }) =>
    role === 'orgAdmin'
      ? convexRun('testing:addMembership', { organizationSlug: tenant.slug, email, role })
      : convexRun('testing:addLeagueOrganizer', {
          organizationSlug: tenant.slug,
          email,
          leagueSlugs: assigned,
        }),
  );
  // One mutation per league: concurrent `testing:seedSeason` calls for one league all write its
  // `publishedSeasonCount` and conflict on a slow runner. The list orders seasons by start date, so
  // the insert order does not matter.
  const rows = Object.entries(seasons).map(([leagueSlug, list]) =>
    convexRun('testing:seedSeasons', { organizationSlug: tenant.slug, leagueSlug, seasons: list }),
  );
  await Promise.all([...memberships, ...rows]);
  return tenant;
}

function seeded(world: World | undefined): World {
  if (!world) throw new Error('The worker seeded nothing: not the project that runs these tests');
  return world;
}

function ownTenant(world: World | undefined) {
  return seed([{ user: seeded(world).accounts.orgAdmin.user, role: 'orgAdmin' }], {
    [COED]: COED_SEASONS,
  });
}

const publishButton = (page: Page, season: string) =>
  page.getByRole('button', { name: `Publish ${season}` });
const dialog = (page: Page) => page.getByRole('alertdialog');

async function openConfirmation(page: Page) {
  await expect(page.locator('#seasons-list > li')).toHaveCount(4);
  await publishButton(page, 'Fall 2027').click();
  await expect(dialog(page)).toBeVisible();
}

async function failPublish(page: Page) {
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      if (typeof message === 'string' && message.includes('"seasons:publish"')) {
        const { requestId } = JSON.parse(message) as { requestId: number };
        ws.send(
          JSON.stringify({
            type: 'MutationResponse',
            requestId,
            success: false,
            result: 'Server Error',
            logLines: [],
          }),
        );
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });
}

const submit = (page: Page) =>
  page.locator('#create-season form').getByRole('button', { name: /^Create draft season/ });

async function fill(
  page: Page,
  values: { name: string; startDate: string; endDate: string; registrationDeadline: string },
) {
  await page.locator('#name').fill(values.name);
  await page.locator('#start-date').fill(values.startDate);
  await page.locator('#end-date').fill(values.endDate);
  await page.locator('#registration-deadline').fill(values.registrationDeadline);
}

async function mockupMatches(
  page: Page,
  browser: Browser,
  organization: string,
  state: State,
  width: number,
  testInfo: Parameters<typeof screenshot>[1],
  scan: 'full' | 'axe' = 'full',
) {
  const expected = (await mockupTextsAt(browser, width)).get(state)!;
  // Polled: the page's text follows the last input in a later render.
  await expect
    .poll(() => appText(page, organization), { message: `${state} at ${width}px` })
    .toBe(expected.main);
  if (expected.dialog !== null) {
    await expect
      .poll(async () => normalizeDialog(await page.getByRole('alertdialog').innerText()), {
        message: `${state} dialog at ${width}px`,
      })
      .toBe(expected.dialog);
  }
  await screenshot(page, testInfo, `125-mockup-${state}`);
  if (scan === 'full' && expected.dialog === null) {
    await expectAccessible(page);
  } else {
    // The saving state's spinner animates without end, which the reflow check waits on: axe only. A
    // modal holds focus, so the page-wide Tab walk (which expects to leave the page) does not apply
    // to a state with a dialog either.
    const results = await axeScan(page);
    expect(describeViolations(results.violations), `axe (${AXE_TAGS.join(', ')})`).toEqual([]);
  }
}

for (const width of WIDTHS) {
  test.describe(`League management against the mockup at ${width}px`, () => {
    test('no seasons yet', async ({ page, browser, world }, testInfo) => {
      const { shared } = seeded(world);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${shared.slug}/leagues/${MENS}`);
      await expect(page.getByText('No seasons yet')).toBeVisible();
      await mockupMatches(page, browser, shared.name, 'empty', width, testInfo);
    });

    test('drafts and published', async ({ page, browser, world }, testInfo) => {
      const { shared } = seeded(world);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${shared.slug}/leagues/${COED}`);
      await expect(page.locator('#seasons-list > li')).toHaveCount(4);
      await mockupMatches(page, browser, shared.name, 'populated', width, testInfo);
    });

    test('create, filled', async ({ page, browser, world }, testInfo) => {
      const { shared } = seeded(world);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${shared.slug}/leagues/${COED}`);
      await expect(page.locator('#seasons-list > li')).toHaveCount(4);
      await fill(page, SPRING_2028);
      await mockupMatches(page, browser, shared.name, 'filled', width, testInfo);
    });

    test('create, submitted empty', async ({ page, browser, world }, testInfo) => {
      const { shared } = seeded(world);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${shared.slug}/leagues/${COED}`);
      await expect(page.locator('#seasons-list > li')).toHaveCount(4);
      await submit(page).click();
      await expect(page.locator('#name-error')).toBeVisible();
      await mockupMatches(page, browser, shared.name, 'errors-required', width, testInfo);
    });

    test('create, refused values', async ({ page, browser, world }, testInfo) => {
      const { shared } = seeded(world);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${shared.slug}/leagues/${COED}`);
      await expect(page.locator('#seasons-list > li')).toHaveCount(4);
      await fill(page, {
        name: 'Spring 2028',
        startDate: '2028-03-01',
        endDate: '2028-02-23',
        registrationDeadline: '2028-03-01',
      });
      await submit(page).click();
      await expect(page.locator('#end-date-error')).toBeVisible();
      await mockupMatches(page, browser, shared.name, 'errors-rules', width, testInfo);
    });

    test.describe('slug used', () => {
      test.use({ expectedConvexErrors: ['seasons:create'] });

      test('create, slug used', async ({ page, browser, world }, testInfo) => {
        const { shared } = seeded(world);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/app/organizations/${shared.slug}/leagues/${COED}`);
        await expect(page.locator('#seasons-list > li')).toHaveCount(4);
        await fill(page, {
          name: 'Spring 2027',
          startDate: '2027-03-03',
          endDate: '2027-05-12',
          registrationDeadline: '2027-02-17',
        });
        await submit(page).click();
        await expect(page.locator('#slug-error')).toBeVisible();
        await mockupMatches(page, browser, shared.name, 'errors-slug', width, testInfo);
      });
    });

    test('create, done: a draft', async ({ page, browser, world }, testInfo) => {
      const tenant = await ownTenant(world);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues/${COED}`);
      await expect(page.locator('#seasons-list > li')).toHaveCount(4);
      await fill(page, SPRING_2028);
      await submit(page).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'created as a draft' }),
      ).toBeVisible();
      await expect(page.locator('#seasons-list > li')).toHaveCount(5);
      await mockupMatches(page, browser, tenant.name, 'created', width, testInfo);
    });

    test('create, saving', async ({ page, browser, world }, testInfo) => {
      const tenant = await ownTenant(world);
      await page.setViewportSize({ width, height: 900 });
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
      await page.goto(`/app/organizations/${tenant.slug}/leagues/${COED}`);
      await expect(page.locator('#seasons-list > li')).toHaveCount(4);
      await fill(page, SPRING_2028);
      await submit(page).click();
      await expect(page.getByText('Creating season…')).toBeVisible();
      await mockupMatches(page, browser, tenant.name, 'creating', width, testInfo, 'axe');
      release();
    });

    // The confirmation, its failure, and its offline state write nothing, so they read the shared
    // worker tenant: the failed publish is answered by the test and never sent, and offline sends
    // nothing. If either wrote, the alert the test waits for would not appear.
    test('publish, confirm', async ({ page, browser, world }, testInfo) => {
      const { shared } = seeded(world);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${shared.slug}/leagues/${COED}`);
      await openConfirmation(page);
      await mockupMatches(page, browser, shared.name, 'publish-confirm', width, testInfo);
    });

    test.describe('publish, failed', () => {
      test.use({ expectedConvexErrors: ['seasons:publish'] });

      test('publish, failed', async ({ page, browser, world }, testInfo) => {
        const { shared } = seeded(world);
        await page.setViewportSize({ width, height: 900 });
        await failPublish(page);
        await page.goto(`/app/organizations/${shared.slug}/leagues/${COED}`);
        await openConfirmation(page);
        await dialog(page).getByRole('button', { name: 'Publish season' }).click();
        await expect(dialog(page).getByRole('alert')).toBeVisible();
        await mockupMatches(page, browser, shared.name, 'publish-error', width, testInfo);
      });
    });

    test('publish, offline', async ({ page, browser, world }, testInfo) => {
      const { shared } = seeded(world);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${shared.slug}/leagues/${COED}`);
      await openConfirmation(page);
      await page.context().setOffline(true);
      try {
        await dialog(page).getByRole('button', { name: 'Publish season' }).click({ force: true });
        await expect(dialog(page).locator('[data-slot="alert"]')).toBeVisible();
        await mockupMatches(page, browser, shared.name, 'publish-offline', width, testInfo);
      } finally {
        await page.context().setOffline(false);
      }
    });

    test('publish, publishing', async ({ page, browser, world }, testInfo) => {
      const tenant = await ownTenant(world);
      await page.setViewportSize({ width, height: 900 });
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
      await page.goto(`/app/organizations/${tenant.slug}/leagues/${COED}`);
      await openConfirmation(page);
      await dialog(page).getByRole('button', { name: 'Publish season' }).click();
      await expect(dialog(page).getByRole('button', { name: 'Publishing…' })).toBeVisible();
      await mockupMatches(page, browser, tenant.name, 'publishing', width, testInfo, 'axe');
      release();
    });

    test('publish, done: published', async ({ page, browser, world }, testInfo) => {
      const tenant = await ownTenant(world);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues/${COED}`);
      await openConfirmation(page);
      await dialog(page).getByRole('button', { name: 'Publish season' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: 'is published' })).toBeVisible();
      await mockupMatches(page, browser, tenant.name, 'published', width, testInfo);
    });

    test('a draft league: an org admin', async ({ page, browser, world }, testInfo) => {
      const { shared } = seeded(world);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${shared.slug}/leagues/${SLOW_PITCH}`);
      await expect(page.locator('#seasons-list > li')).toHaveCount(1);
      await expect(page.locator('[data-slot="season-minimum"]')).toHaveText(
        '10 players, set by the 10v10 format',
      );
      await mockupMatches(page, browser, shared.name, 'draft-league-admin', width, testInfo);
    });

    test.describe('a league organizer', () => {
      test.use({ role: 'leagueOrganizer' });

      test('a draft league: a league organizer', async ({ page, browser, world }, testInfo) => {
        const { shared } = seeded(world);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/app/organizations/${shared.slug}/leagues/${FRIDAY}`);
        await expect(page.locator('#seasons-list > li')).toHaveCount(1);
        await mockupMatches(page, browser, shared.name, 'draft-league-organizer', width, testInfo);
      });

      test('as a league organizer', async ({ page, browser, world }, testInfo) => {
        const { shared } = seeded(world);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/app/organizations/${shared.slug}/leagues/${SUNDAY}`);
        await expect(page.locator('#seasons-list > li')).toHaveCount(3);
        await mockupMatches(page, browser, shared.name, 'organizer', width, testInfo);
      });

      test('no access', async ({ page, browser, world }, testInfo) => {
        const { notAssigned } = seeded(world);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/app/organizations/${notAssigned.slug}/leagues/${COED}`);
        await expect(
          page.getByRole('heading', { name: 'You can’t manage this league' }),
        ).toBeVisible();
        await mockupMatches(page, browser, notAssigned.name, 'no-access', width, testInfo);
      });
    });

    test('unknown league: not found', async ({ page, browser, world }, testInfo) => {
      const { shared } = seeded(world);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${shared.slug}/leagues/does-not-exist`);
      await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
      await mockupMatches(page, browser, shared.name, 'not-found', width, testInfo);
    });
  });
}
