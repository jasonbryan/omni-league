// The Leagues page against the approved mockup design/mockups/66-69-organization-leagues.html
// (#66, tester): at 375px and 1280px, each state of the page shows the same text, in the same
// order, as the mockup's frame of that state (without #69's Publish buttons), and passes axe.
// Local runs only: the tests seed a tenant and sign up a user. They run in one project and set
// both widths themselves.
import type { Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { AXE_TAGS, axeScan, describeViolations, expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { seedTenant, type TenantSeed } from './support/tenant';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');
test.beforeEach(({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name !== 'chromium-desktop', 'both widths are set inside each test');
});

const MOCKUP = pathToFileURL(
  join(process.cwd(), 'design', 'mockups', '66-69-organization-leagues.html'),
).href;
const WIDTHS = [375, 1280] as const;
const MOCKUP_ORGANIZATIONS = ['Coastal Bend Rec Club', 'Mustang Island Beach Volleyball'];

const LOCATIONS = [
  {
    name: 'Pelican Shoals Sand Courts',
    address: '2150 Pelican Shoals Dr, Corpus Christi, TX 78418',
  },
  { name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX 78382' },
  { name: 'Tern Point Softball Complex', address: '45 Tern Point Rd, Aransas Pass, TX 78336' },
];

type SeedLeague = NonNullable<TenantSeed['leagues']>[number];

const COED_7V7: SeedLeague = {
  name: 'Coed 7v7 Rec',
  sport: 'soccer' as const,
  locations: ['Redfish Flats Fields'],
};
const THURSDAY: SeedLeague = {
  name: 'Thursday Night Coed 2s',
  sport: 'beachVolleyball' as const,
  locations: ['Pelican Shoals Sand Courts'],
};
const WEDNESDAY: SeedLeague = {
  name: 'Wednesday Coed Slow-Pitch',
  sport: 'softball' as const,
  locations: ['Tern Point Softball Complex', 'Redfish Flats Fields'],
  status: 'draft',
};
const SUNDAY: SeedLeague = {
  name: 'Sunday Reverse Coed 4s',
  sport: 'beachVolleyball' as const,
  locations: ['Pelican Shoals Sand Courts'],
  status: 'draft',
};

const LEAGUES = { leagues: [COED_7V7, THURSDAY, WEDNESDAY] } satisfies Pick<TenantSeed, 'leagues'>;

/** The text of a mockup frame's main area, without the Publish buttons (#69). */
async function mockupText(page: Page, state: string, width: number): Promise<string> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${MOCKUP}?state=${state}`);
  const text = await page.locator('main#main').first().innerText();
  return normalize(text, MOCKUP_ORGANIZATIONS);
}

/** Lines of text with the organization name and the Publish buttons removed. */
function normalize(text: string, organizations: string[]): string {
  let result = text;
  for (const name of organizations) result = result.replaceAll(name, 'ORG');
  const lines = result
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    // "Publish" plus the league's name that names the button for assistive technology.
    if (lines[i] === 'Publish') {
      i++;
      continue;
    }
    kept.push(lines[i]);
  }
  return kept.join('\n');
}

async function signedInAdmin(page: Page, seed: TenantSeed) {
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenant({ name: 'Coastal Bend Rec Club', ...seed });
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });
  return tenant;
}

const submit = (page: Page) =>
  page.locator('#create-league form').getByRole('button', { name: /^Create draft league/ });

async function appText(page: Page, organization: string): Promise<string> {
  const text = await page.getByRole('main').innerText();
  return normalize(text, [organization]);
}

async function fill(page: Page, league: { name: string }) {
  await page.locator('#name').fill(league.name);
  await page.getByRole('radio', { name: 'Beach volleyball' }).check();
  await page.getByRole('checkbox', { name: 'Pelican Shoals Sand Courts' }).click();
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
  await screenshot(page, testInfo, `66-mockup-${state}`);
  if (scan === 'full') {
    await expectAccessible(page);
  } else {
    // The saving state's spinner animates without end, which the reflow check waits on: axe only.
    const results = await axeScan(page);
    expect(describeViolations(results.violations), `axe (${AXE_TAGS.join(', ')})`).toEqual([]);
  }
}

for (const width of WIDTHS) {
  test.describe(`Leagues against the mockup at ${width}px`, () => {
    test('no locations', async ({ page, browser }, testInfo) => {
      const tenant = await signedInAdmin(page, { name: 'Mustang Island Beach Volleyball' });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues`);
      await expect(page.getByText('Add a location first')).toBeVisible();
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'no-locations', width, testInfo);
    });

    test('none yet, one location', async ({ page, browser }, testInfo) => {
      const tenant = await signedInAdmin(page, {
        name: 'Mustang Island Beach Volleyball',
        locations: [
          { name: 'Dune Ridge Beach Courts', address: '1 Dune Ridge Rd, Port Aransas, TX' },
        ],
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues`);
      await expect(page.getByText('No leagues yet')).toBeVisible();
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'empty', width, testInfo);
    });

    test('drafts and published', async ({ page, browser }, testInfo) => {
      const tenant = await signedInAdmin(page, {
        locations: LOCATIONS,
        leagues: [COED_7V7, SUNDAY, THURSDAY, WEDNESDAY],
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues`);
      await expect(page.locator('#leagues-list > li')).toHaveCount(4);
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'populated', width, testInfo);
    });

    test('create, filled', async ({ page, browser }, testInfo) => {
      const tenant = await signedInAdmin(page, { locations: LOCATIONS, ...LEAGUES });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues`);
      await fill(page, SUNDAY);
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'filled', width, testInfo);
    });

    test('create, submitted empty', async ({ page, browser }, testInfo) => {
      const tenant = await signedInAdmin(page, { locations: LOCATIONS, ...LEAGUES });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues`);
      await submit(page).click();
      await expect(page.locator('#name-error')).toBeVisible();
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'errors-required', width, testInfo);
    });

    test.describe('slug used', () => {
      // The rejected mutation logs one console error, as in organization-leagues.spec.ts.
      test.use({ expectedConvexErrors: ['leagues:create'] });

      test('create, slug used', async ({ page, browser }, testInfo) => {
        const tenant = await signedInAdmin(page, {
          locations: LOCATIONS,
          leagues: [COED_7V7, SUNDAY, THURSDAY, WEDNESDAY],
        });
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/app/organizations/${tenant.slug}/leagues`);
        await fill(page, SUNDAY);
        await page.locator('#slug').fill('sunday-reverse-coed-4s');
        await submit(page).click();
        await expect(page.locator('#slug-error')).toBeVisible();
        const mockup = await (await browser.newContext()).newPage();
        await mockupMatches(page, mockup, tenant.name, 'errors-slug', width, testInfo);
      });
    });

    test('create, done: a draft', async ({ page, browser }, testInfo) => {
      const tenant = await signedInAdmin(page, { locations: LOCATIONS, ...LEAGUES });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/app/organizations/${tenant.slug}/leagues`);
      await fill(page, SUNDAY);
      await submit(page).click();
      await expect(
        page.getByRole('status').filter({ hasText: 'created as a draft' }),
      ).toBeVisible();
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'created', width, testInfo);
    });

    test('create, saving', async ({ page, browser }, testInfo) => {
      const tenant = await signedInAdmin(page, { locations: LOCATIONS, ...LEAGUES });
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
      await page.goto(`/app/organizations/${tenant.slug}/leagues`);
      await fill(page, SUNDAY);
      await submit(page).click();
      await expect(page.getByText('Creating league…')).toBeVisible();
      const mockup = await (await browser.newContext()).newPage();
      await mockupMatches(page, mockup, tenant.name, 'creating', width, testInfo, 'axe');
      release();
    });
  });
}
