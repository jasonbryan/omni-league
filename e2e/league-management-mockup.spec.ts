// The league management page against the approved mockup design/mockups/125-126-seasons.html
// (#125): at 375px and 1280px, each state of the page shows the same text, in the same order, as the
// mockup's frame of that state (without #126's Publish buttons and #143's and #144's Limits
// fieldset), and passes axe. Local runs only: the tests seed a tenant and sign up a user. They run
// in one project and set both widths themselves.
import type { Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { AXE_TAGS, axeScan, describeViolations, expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { seedTenant } from './support/tenant';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');
test.beforeEach(({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name !== 'chromium-desktop', 'both widths are set inside each test');
});

const MOCKUP = pathToFileURL(join(process.cwd(), 'design', 'mockups', '125-126-seasons.html')).href;
const WIDTHS = [375, 1280] as const;
const MOCKUP_ORGANIZATION = 'Gulf Coast Sport & Social';

const LOCATIONS = [
  { name: 'Bayside Athletic Complex', address: '4410 Ocean Dr, Corpus Christi, TX 78412' },
  { name: 'North Beach Sand Courts', address: '3500 Surfside Blvd, Corpus Christi, TX 78402' },
];
const LEAGUES = [
  { name: 'Coed 7v7 Rec', sport: 'soccer' as const, locations: ['Bayside Athletic Complex'] },
  {
    name: "Men's Over-30 11v11",
    sport: 'soccer' as const,
    locations: ['Bayside Athletic Complex'],
  },
  {
    name: 'Sunday Reverse Coed 4s',
    sport: 'beachVolleyball' as const,
    locations: ['North Beach Sand Courts'],
  },
  {
    name: 'Thursday Night Coed 2s',
    sport: 'beachVolleyball' as const,
    locations: ['North Beach Sand Courts'],
  },
];
const COED = 'coed-7v7-rec';
const MENS = 'men-s-over-30-11v11';
const SUNDAY = 'sunday-reverse-coed-4s';
const THURSDAY = 'thursday-night-coed-2s';

interface SeasonSeed {
  name: string;
  slug: string;
  startDate: string;
  endDate: string;
  registrationDeadline: string;
  format: '4v4' | '7v7';
  minimumRosterSize: number;
  status: 'draft' | 'published';
}

/** The mockup's "Coed 7v7 Rec" seasons (states 3 to 9), newest start date first. */
const COED_SEASONS: SeasonSeed[] = [
  {
    name: 'Fall 2027',
    slug: 'fall-2027',
    startDate: '2027-09-08',
    endDate: '2027-11-10',
    registrationDeadline: '2027-08-25',
    format: '7v7',
    minimumRosterSize: 9,
    status: 'draft',
  },
  {
    name: 'Summer 2027',
    slug: 'summer-2027',
    startDate: '2027-06-02',
    endDate: '2027-08-25',
    registrationDeadline: '2027-05-19',
    format: '7v7',
    minimumRosterSize: 7,
    status: 'published',
  },
  {
    name: 'Spring 2027',
    slug: 'spring-2027',
    startDate: '2027-03-03',
    endDate: '2027-05-12',
    registrationDeadline: '2027-02-17',
    format: '7v7',
    minimumRosterSize: 7,
    status: 'published',
  },
  {
    name: 'Fall 2026',
    slug: 'fall-2026',
    startDate: '2026-09-09',
    endDate: '2026-11-18',
    registrationDeadline: '2026-08-26',
    format: '7v7',
    minimumRosterSize: 7,
    status: 'published',
  },
];

/** The mockup's league organizer's seasons (states 12 and 13). */
const SUNDAY_SEASONS: SeasonSeed[] = [
  {
    name: 'Fall 2027',
    slug: 'fall-2027',
    startDate: '2027-09-12',
    endDate: '2027-11-14',
    registrationDeadline: '2027-08-29',
    format: '4v4',
    minimumRosterSize: 4,
    status: 'draft',
  },
  {
    name: 'Summer 2027',
    slug: 'summer-2027',
    startDate: '2027-06-06',
    endDate: '2027-08-29',
    registrationDeadline: '2027-05-23',
    format: '4v4',
    minimumRosterSize: 4,
    status: 'published',
  },
  {
    name: 'Fall 2026',
    slug: 'fall-2026',
    startDate: '2026-09-13',
    endDate: '2026-11-15',
    registrationDeadline: '2026-08-30',
    format: '4v4',
    minimumRosterSize: 4,
    status: 'published',
  },
];

/** The mockup's "Create, filled" values. */
const SPRING_2028 = {
  name: 'Spring 2028',
  startDate: '2028-03-01',
  endDate: '2028-05-10',
  registrationDeadline: '2028-02-15',
};

/** The text of a mockup frame's main area, without #126's and #143's and #144's parts. */
async function mockupText(page: Page, state: string, width: number): Promise<string> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${MOCKUP}?state=${state}`);
  const text = await page.locator('main#main').first().innerText();
  return normalize(text, MOCKUP_ORGANIZATION);
}

/**
 * Lines of text with the organization name replaced, the Publish buttons removed (#126), and the
 * Limits fieldset removed (#143, #144): from "Limits" up to the submit button.
 */
function normalize(text: string, organization: string): string {
  const lines = text
    .replaceAll(organization, 'ORG')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const kept: string[] = [];
  let inLimits = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // "Publish" plus the season's name that names the button for assistive technology.
    if (line === 'Publish') {
      i++;
      continue;
    }
    if (line === 'Limits') inLimits = true;
    if (inLimits && /^Creat(e draft|ing) season/.test(line)) inLimits = false;
    if (!inLimits) kept.push(line);
  }
  return kept.join('\n');
}

async function appText(page: Page, organization: string): Promise<string> {
  return normalize(await page.getByRole('main').innerText(), organization);
}

type Role = 'orgAdmin' | 'leagueOrganizer' | null;

async function signedIn(page: Page, role: Role, assigned: string[] = []) {
  const user = newUser(role === 'orgAdmin' ? 'Admin' : 'Organizer');
  await signUp(page, user);
  const tenant = await seedTenant({
    name: MOCKUP_ORGANIZATION,
    locations: LOCATIONS,
    leagues: LEAGUES,
  });
  if (role === 'orgAdmin') {
    await convexRun('testing:addMembership', {
      organizationSlug: tenant.slug,
      email: user.email,
      role,
    });
  } else if (role === 'leagueOrganizer') {
    await convexRun('testing:addLeagueOrganizer', {
      organizationSlug: tenant.slug,
      email: user.email,
      leagueSlugs: assigned,
    });
  }
  return tenant;
}

async function seedSeasons(organizationSlug: string, leagueSlug: string, seasons: SeasonSeed[]) {
  // Oldest first, so the rows are inserted in the order a reader would create them.
  for (const season of [...seasons].reverse()) {
    await convexRun('testing:seedSeason', { organizationSlug, leagueSlug, ...season });
  }
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
  await page.getByRole('radio', { name: '7 v 7' }).check();
}

async function mockupMatches(
  page: Page,
  mockup: Page,
  organization: string,
  state: string,
  width: number,
  testInfo: Parameters<typeof screenshot>[1],
  scan: 'full' | 'axe' = 'full',
) {
  const expected = await mockupText(mockup, state, width);
  expect(await appText(page, organization), `${state} at ${width}px`).toBe(expected);
  await screenshot(page, testInfo, `125-mockup-${state}`);
  if (scan === 'full') {
    await expectAccessible(page);
  } else {
    // The saving state's spinner animates without end, which the reflow check waits on: axe only.
    const results = await axeScan(page);
    expect(describeViolations(results.violations), `axe (${AXE_TAGS.join(', ')})`).toEqual([]);
  }
}

for (const width of WIDTHS) {
  test.describe(`League management against the mockup at ${width}px`, () => {
    test('no seasons yet', async ({ page, browser }, testInfo) => {
      const tenant = await signedIn(page, 'orgAdmin');
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues/${MENS}`);
      await expect(page.getByText('No seasons yet')).toBeVisible();
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'empty', width, testInfo);
    });

    test('drafts and published', async ({ page, browser }, testInfo) => {
      const tenant = await signedIn(page, 'orgAdmin');
      await seedSeasons(tenant.slug, COED, COED_SEASONS);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues/${COED}`);
      await expect(page.locator('#seasons-list > li')).toHaveCount(4);
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'populated', width, testInfo);
    });

    test('create, filled', async ({ page, browser }, testInfo) => {
      const tenant = await signedIn(page, 'orgAdmin');
      await seedSeasons(tenant.slug, COED, COED_SEASONS);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues/${COED}`);
      await expect(page.locator('#seasons-list > li')).toHaveCount(4);
      await fill(page, SPRING_2028);
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'filled', width, testInfo);
    });

    test('create, submitted empty', async ({ page, browser }, testInfo) => {
      const tenant = await signedIn(page, 'orgAdmin');
      await seedSeasons(tenant.slug, COED, COED_SEASONS);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues/${COED}`);
      await expect(page.locator('#seasons-list > li')).toHaveCount(4);
      await submit(page).click();
      await expect(page.locator('#name-error')).toBeVisible();
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'errors-required', width, testInfo);
    });

    test('create, refused values', async ({ page, browser }, testInfo) => {
      const tenant = await signedIn(page, 'orgAdmin');
      await seedSeasons(tenant.slug, COED, COED_SEASONS);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues/${COED}`);
      await expect(page.locator('#seasons-list > li')).toHaveCount(4);
      await fill(page, {
        name: 'Spring 2028',
        startDate: '2028-03-01',
        endDate: '2028-02-23',
        registrationDeadline: '2028-03-01',
      });
      await page.locator('#minimum-roster-size').fill('6');
      await submit(page).click();
      await expect(page.locator('#end-date-error')).toBeVisible();
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'errors-rules', width, testInfo);
    });

    test.describe('slug used', () => {
      // The rejected mutation logs one console error, as in league-management.spec.ts.
      test.use({ expectedConvexErrors: ['seasons:create'] });

      test('create, slug used', async ({ page, browser }, testInfo) => {
        const tenant = await signedIn(page, 'orgAdmin');
        await seedSeasons(tenant.slug, COED, COED_SEASONS);
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/app/organizations/${tenant.slug}/leagues/${COED}`);
        await expect(page.locator('#seasons-list > li')).toHaveCount(4);
        await fill(page, {
          name: 'Spring 2027',
          startDate: '2027-03-03',
          endDate: '2027-05-12',
          registrationDeadline: '2027-02-17',
        });
        await submit(page).click();
        await expect(page.locator('#slug-error')).toBeVisible();
        const mockup = await (await browser.newContext()).newPage();
        await mockupMatches(page, mockup, tenant.name, 'errors-slug', width, testInfo);
      });
    });

    test('create, done: a draft', async ({ page, browser }, testInfo) => {
      const tenant = await signedIn(page, 'orgAdmin');
      await seedSeasons(tenant.slug, COED, COED_SEASONS);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues/${COED}`);
      await expect(page.locator('#seasons-list > li')).toHaveCount(4);
      await fill(page, SPRING_2028);
      await submit(page).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'created as a draft' }),
      ).toBeVisible();
      await expect(page.locator('#seasons-list > li')).toHaveCount(5);
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'created', width, testInfo);
    });

    test('create, saving', async ({ page, browser }, testInfo) => {
      const tenant = await signedIn(page, 'orgAdmin');
      await seedSeasons(tenant.slug, COED, COED_SEASONS);
      await page.setViewportSize({ width, height: 900 });
      // Holds every mutation the page sends until released, so the saving state can be read.
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
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'creating', width, testInfo, 'axe');
      release();
    });

    test('as a league organizer', async ({ page, browser }, testInfo) => {
      const tenant = await signedIn(page, 'leagueOrganizer', [SUNDAY, THURSDAY, COED]);
      await seedSeasons(tenant.slug, SUNDAY, SUNDAY_SEASONS);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues/${SUNDAY}`);
      await expect(page.locator('#seasons-list > li')).toHaveCount(3);
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'organizer', width, testInfo);
    });

    test('no access', async ({ page, browser }, testInfo) => {
      const tenant = await signedIn(page, 'leagueOrganizer', [THURSDAY]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues/${COED}`);
      await expect(
        page.getByRole('heading', { name: 'You can’t manage this league' }),
      ).toBeVisible();
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'no-access', width, testInfo);
    });

    test('unknown league: not found', async ({ page, browser }, testInfo) => {
      const tenant = await signedIn(page, 'orgAdmin');
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues/does-not-exist`);
      await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'not-found', width, testInfo);
    });
  });
}
