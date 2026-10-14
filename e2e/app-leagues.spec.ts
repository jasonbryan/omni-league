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
import { signUp } from './support/session';
import { seedTenant, type Tenant, type TenantSeed } from './support/tenant';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';
import { newUser, type TestUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LOCATIONS = [{ name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX' }];

const league = (
  name: string,
  status: 'draft' | 'published' = 'published',
): NonNullable<TenantSeed['leagues']>[number] => ({
  name,
  sport: 'soccer',
  locations: ['Redfish Flats Fields'],
  status,
});

const FRIDAY = 'Friday Night Coed 6s';
const SUNDAY = 'Sunday Reverse Coed 4s';
const THURSDAY = 'Thursday Night Coed 2s';
const slugOf = (name: string) => name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');

const GULF_COAST = 'Gulf Coast Sport & Social';
const MUSTANG = 'Mustang Island Beach Volleyball';
const RIVERBEND = 'Riverbend Softball Association';

function organization(name: string, leagues: string[], draft?: string) {
  return seedTenant({
    name,
    locations: LOCATIONS,
    leagues: leagues.map((leagueName) =>
      league(leagueName, leagueName === draft ? 'draft' : 'published'),
    ),
  });
}

const assign = (user: TestUser, tenant: Tenant, assigned: string[]) =>
  convexRun('testing:addLeagueOrganizer', {
    organizationSlug: tenant.slug,
    email: user.email,
    leagueSlugs: assigned.map(slugOf),
  });

const makeAdmin = (user: TestUser, tenant: Tenant) =>
  convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });

async function signedUp(
  page: Page,
  seed: (user: TestUser) => Promise<unknown>,
  label = 'Organizer',
) {
  const user = newUser(label);
  await signUp(page, user);
  await seed(user);
  await page.goto('/app');
  await expect(page.locator('#organizations-heading')).toBeVisible();
  return user;
}

const rowOf = (page: Page, tenant: Tenant) =>
  page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: tenant.name }) });

const leagueLinks = (page: Page, tenant: Tenant) =>
  rowOf(page, tenant).getByRole('list', { name: 'Your leagues' }).getByRole('link');

test.describe('/app: a league organizer reaches their assigned leagues', () => {
  test(
    'links the assigned leagues, a draft included, sorted by name, and not an unassigned one',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      let tenant!: Tenant;
      await signedUp(page, async (user) => {
        tenant = await organization(GULF_COAST, [THURSDAY, SUNDAY, FRIDAY], FRIDAY);
        await assign(user, tenant, [SUNDAY, FRIDAY]);
      });
      const links = leagueLinks(page, tenant);
      await expect(links).toHaveText([FRIDAY, SUNDAY]);
      await expect(links.nth(0)).toHaveAttribute(
        'href',
        `/app/organizations/${tenant.slug}/leagues/${slugOf(FRIDAY)}`,
      );
      await expect(links.nth(1)).toHaveAttribute(
        'href',
        `/app/organizations/${tenant.slug}/leagues/${slugOf(SUNDAY)}`,
      );
      await expect(page.getByRole('link', { name: THURSDAY })).toHaveCount(0);
      await expect(rowOf(page, tenant).getByRole('link', { name: /^Manage/ })).toHaveCount(0);
      await expect(rowOf(page, tenant).getByRole('link', { name: /^Public page/ })).toHaveCount(1);
    },
  );

  test('a link opens the management page of its league', VIEWPORT_AGNOSTIC, async ({ page }) => {
    let tenant!: Tenant;
    await signedUp(page, async (user) => {
      tenant = await organization(GULF_COAST, [SUNDAY, FRIDAY], FRIDAY);
      await assign(user, tenant, [SUNDAY, FRIDAY]);
    });
    await leagueLinks(page, tenant).filter({ hasText: SUNDAY }).click();
    await expect(page).toHaveURL(
      `${baseURL}/app/organizations/${tenant.slug}/leagues/${slugOf(SUNDAY)}`,
    );
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(SUNDAY);
  });

  test('the keyboard reaches a league link and Enter opens its management page', async ({
    page,
  }) => {
    let tenant!: Tenant;
    await signedUp(page, async (user) => {
      tenant = await organization(GULF_COAST, [SUNDAY, FRIDAY], FRIDAY);
      await assign(user, tenant, [SUNDAY, FRIDAY]);
    });
    const link = leagueLinks(page, tenant).filter({ hasText: SUNDAY });
    await page.locator('body').click({ position: { x: 0, y: 0 } });
    for (let step = 0; step < 20; step++) {
      await page.keyboard.press('Tab');
      if (await link.evaluate((element) => element === document.activeElement)) break;
    }
    await expect(link).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(
      `${baseURL}/app/organizations/${tenant.slug}/leagues/${slugOf(SUNDAY)}`,
    );
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(SUNDAY);
  });

  test(
    'a league of another organization in the assignment is dropped: the row says none are assigned',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      let tenant!: Tenant;
      let other!: Tenant;
      await signedUp(page, async (user) => {
        [tenant, other] = await Promise.all([
          organization(GULF_COAST, [SUNDAY]),
          organization(RIVERBEND, ['Wednesday Coed Slow-Pitch']),
        ]);
        await assign(user, tenant, []);
        await convexRun('testing:assignForeignLeague', {
          organizationSlug: tenant.slug,
          email: user.email,
          leagueOrganizationSlug: other.slug,
          leagueSlug: slugOf('Wednesday Coed Slow-Pitch'),
        });
      });
      const row = rowOf(page, tenant);
      await expect(row).toContainText(
        `No leagues are assigned to you here. Ask an org admin of ${tenant.name} to assign one.`,
      );
      await expect(row.getByRole('list')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Wednesday Coed Slow-Pitch' })).toHaveCount(0);
      await expect(row.getByRole('link')).toHaveText([`Public page: ${tenant.name}`]);
    },
  );

  test(
    'an org admin row has no league list, while the same user has one on a league organizer row',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      let admin!: Tenant;
      let organizer!: Tenant;
      await signedUp(page, async (user) => {
        [admin, organizer] = await Promise.all([
          organization(MUSTANG, [SUNDAY]),
          organization(GULF_COAST, [FRIDAY]),
        ]);
        await makeAdmin(user, admin);
        await assign(user, organizer, [FRIDAY]);
      });
      await expect(rowOf(page, admin).getByRole('list')).toHaveCount(0);
      await expect(rowOf(page, admin)).not.toContainText('Your leagues');
      await expect(leagueLinks(page, organizer)).toHaveText([FRIDAY]);
    },
  );
});

const STATES = ['one', 'several', 'none', 'org-admin'] as const;
type State = (typeof STATES)[number];

const MOCKUP_FILE = join(process.cwd(), 'design', 'mockups', '141-app-leagues.html');
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
  const directory = await mkdtemp(join(tmpdir(), 'mockup-141-'));
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  try {
    const file = join(directory, 'app-leagues.html');
    await writeFile(file, html);
    const page = await context.newPage();
    const texts = new Map<State, string>();
    for (const state of STATES) {
      await page.goto(`${pathToFileURL(file).href}?state=${state}`);
      texts.set(state, organizationsText(await page.locator('main#main').first().innerText(), []));
    }
    return texts;
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * The lines from "Your organizations" down: the account card above it names the test's own user.
 */
function organizationsText(text: string, tenants: { tenant: Tenant; mockupName: string }[]) {
  let result = text;
  for (const { tenant, mockupName } of tenants) result = result.replaceAll(tenant.name, mockupName);
  const lines = result
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  return lines.slice(lines.indexOf('Your organizations')).join('\n');
}

async function matchesMockup(
  page: Page,
  browser: Browser,
  state: State,
  tenants: { tenant: Tenant; mockupName: string }[],
  testInfo: Parameters<typeof screenshot>[1],
) {
  const width = page.viewportSize()?.width ?? 0;
  const expected = (await mockupTextsAt(browser, width)).get(state);
  await expect
    .poll(async () => organizationsText(await page.getByRole('main').innerText(), tenants), {
      message: `${state} at ${width}px`,
    })
    .toBe(expected);
  await screenshot(page, testInfo, `141-app-${state}`);
  await expectAccessible(page);
}

test.describe('/app: "Your organizations" against the mockup', () => {
  test('state 1: a league organizer with one league', async ({ page, browser }, testInfo) => {
    let tenant!: Tenant;
    await signedUp(page, async (user) => {
      tenant = await organization(GULF_COAST, [FRIDAY, SUNDAY, THURSDAY]);
      await assign(user, tenant, [SUNDAY]);
    });
    await matchesMockup(page, browser, 'one', [{ tenant, mockupName: GULF_COAST }], testInfo);
  });

  test('state 2: several leagues (a draft included) and an org admin row', async ({
    page,
    browser,
  }, testInfo) => {
    let gulf!: Tenant;
    let mustang!: Tenant;
    await signedUp(page, async (user) => {
      [gulf, mustang] = await Promise.all([
        organization(GULF_COAST, [FRIDAY, SUNDAY, THURSDAY], FRIDAY),
        organization(MUSTANG, [SUNDAY]),
      ]);
      await assign(user, gulf, [THURSDAY, FRIDAY, SUNDAY]);
      await makeAdmin(user, mustang);
    });
    await matchesMockup(
      page,
      browser,
      'several',
      [
        { tenant: gulf, mockupName: GULF_COAST },
        { tenant: mustang, mockupName: MUSTANG },
      ],
      testInfo,
    );
  });

  test('state 3: a league organizer with no leagues keeps the row and gets the line', async ({
    page,
    browser,
  }, testInfo) => {
    let gulf!: Tenant;
    let riverbend!: Tenant;
    await signedUp(page, async (user) => {
      [gulf, riverbend] = await Promise.all([
        organization(GULF_COAST, [SUNDAY]),
        organization(RIVERBEND, ['Wednesday Coed Slow-Pitch']),
      ]);
      await assign(user, gulf, []);
      await convexRun('testing:assignForeignLeague', {
        organizationSlug: gulf.slug,
        email: user.email,
        leagueOrganizationSlug: riverbend.slug,
        leagueSlug: slugOf('Wednesday Coed Slow-Pitch'),
      });
      await assign(user, riverbend, ['Wednesday Coed Slow-Pitch']);
    });
    await matchesMockup(
      page,
      browser,
      'none',
      [
        { tenant: gulf, mockupName: GULF_COAST },
        { tenant: riverbend, mockupName: RIVERBEND },
      ],
      testInfo,
    );
  });

  test('state 4: an org admin only, unchanged', async ({ page, browser }, testInfo) => {
    let gulf!: Tenant;
    let mustang!: Tenant;
    await signedUp(
      page,
      async (user) => {
        [gulf, mustang] = await Promise.all([
          organization(GULF_COAST, [SUNDAY]),
          organization(MUSTANG, [SUNDAY]),
        ]);
        await makeAdmin(user, gulf);
        await makeAdmin(user, mustang);
      },
      'Admin',
    );
    await matchesMockup(
      page,
      browser,
      'org-admin',
      [
        { tenant: gulf, mockupName: GULF_COAST },
        { tenant: mustang, mockupName: MUSTANG },
      ],
      testInfo,
    );
  });
});
