import type { Locator, Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { LIST_PAGE_SIZE } from '../src/app/core/list-page';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { signUp } from './support/session';
import {
  numberedLocations,
  numberedSeasons,
  seedSeasons,
  seedTenant,
  type Tenant,
  type TenantSeed,
} from './support/tenant';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const TARGET = 44;
const DESKTOP_PROJECT = 'chromium-desktop';
const COARSE_POINTER = '(pointer: coarse)';

const ROWS = LIST_PAGE_SIZE + 1;
const LOCATIONS = numberedLocations(ROWS);
const LEAGUE_NAMES = Array.from(
  { length: ROWS },
  (_, i) => `League ${String(i + 1).padStart(2, '0')} Sand 2s`,
);
const LEAGUES: NonNullable<TenantSeed['leagues']> = LEAGUE_NAMES.map((name) => ({
  name,
  sport: 'beachVolleyball',
  locations: [LOCATIONS[0].name],
  status: 'published',
}));
const FIRST_LEAGUE = 'league-01-sand-2s';
const SEASONS = numberedSeasons(ROWS);

interface Measured {
  undersized: string[];
  count: number;
}

/**
 * Left out of the measure:
 * - inline links in running text (WCAG 2.5.8 exempts them); a link that is the whole of its block,
 *   such as a list row's title, is measured;
 * - breadcrumb links, which meet WCAG 2.5.8 (24 px) and are outside the touch-target scope;
 * - check boxes and radio buttons, whose hit area is the label row (`checkableRows`).
 */
async function undersizedControls(scope: Locator): Promise<Measured> {
  return scope.evaluate((root, target): Measured => {
    const SELECTOR =
      'a[href], button, input, select, textarea, summary, [role="button"], [data-slot="button"]';
    const undersized: string[] = [];
    let count = 0;
    const nodes = [...root.querySelectorAll<HTMLElement>(SELECTOR)];
    if (root.matches(SELECTOR)) nodes.unshift(root as HTMLElement);
    for (const el of nodes) {
      if (!el.checkVisibility({ visibilityProperty: true })) continue;
      if (el instanceof HTMLInputElement && ['hidden', 'radio', 'checkbox'].includes(el.type)) {
        continue;
      }
      if (el.getAttribute('role') === 'checkbox') continue;
      const parentText = (el.parentElement?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const wholeBlock = parentText === (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (getComputedStyle(el).display === 'inline' && !wholeBlock) continue;
      if (el.closest('nav[aria-label="Breadcrumb"]')) continue;
      const stretched = getComputedStyle(el, '::after').position === 'absolute';
      const hitArea = stretched ? (el.offsetParent ?? el) : el;
      const box = hitArea.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      count++;
      if (box.width + 0.01 < target || box.height + 0.01 < target) {
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 30);
        undersized.push(
          `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${name}" ` +
            `${Math.round(box.width * 10) / 10}x${Math.round(box.height * 10) / 10}`,
        );
      }
    }
    return { undersized, count };
  }, TARGET);
}

const checkableRows = (page: Page) =>
  page.locator('[data-slot="field"][data-orientation="horizontal"]').filter({
    has: page.locator('[role="checkbox"], input[type="radio"]'),
  });

async function expectTargets(page: Page, scope: Locator = page.locator('body')): Promise<number> {
  const { undersized, count } = await undersizedControls(scope);
  expect.soft(undersized, `controls under ${TARGET}x${TARGET} CSS px`).toEqual([]);
  return count;
}

async function expectRows(page: Page): Promise<number> {
  const rows = checkableRows(page);
  const count = await rows.count();
  // Last row first: choosing a staff role shows or hides the league rows after it.
  for (let i = count - 1; i >= 0; i--) {
    const row = rows.nth(i);
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    expect(box?.height ?? 0, `row ${i} height`).toBeGreaterThanOrEqual(TARGET);
    const control = row.locator('[role="checkbox"], input[type="radio"]');
    const isOn = () =>
      control.evaluate((el) =>
        el instanceof HTMLInputElement ? el.checked : el.getAttribute('aria-checked') === 'true',
      );
    const before = await isOn();
    const isRadio = await control.evaluate((el) => el instanceof HTMLInputElement);
    const rightEnd = { x: (box?.width ?? 0) - 4, y: (box?.height ?? 0) / 2 };
    await row.tap({ position: rightEnd });
    // Tapping a radio button can only turn it on.
    await expect
      .poll(isOn, { message: `tap on the right end of row ${i}` })
      .toBe(isRadio ? true : !before);
  }
  return count;
}

async function openSheet(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Navigation' });
  await expect(dialog.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  return dialog;
}

async function visit(page: Page, path: string, heading: string | RegExp): Promise<void> {
  await page.goto(path);
  await expect(
    page.getByRole('main').getByRole('heading', { level: 1, name: heading }),
  ).toBeVisible();
}

async function seedPublicTenant(): Promise<Tenant> {
  const tenant = await seedTenant({ name: 'E2E Touch', locations: LOCATIONS, leagues: LEAGUES });
  await seedSeasons(tenant, FIRST_LEAGUE, SEASONS);
  return tenant;
}

test.describe('touch screens: every control is at least 44 by 44 CSS px', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === DESKTOP_PROJECT, 'the touch projects measure touch sizes');
    await page.goto('/sign-in');
    // First, so a project that stops emulating touch fails here and not on sizes.
    expect(await page.evaluate((q) => matchMedia(q).matches, COARSE_POINTER)).toBe(true);
  });

  test('sign-up, sign-in, and the public organization, league, and season pages', async ({
    page,
  }) => {
    const tenant = await seedPublicTenant();
    const seasonPath = `${tenant.path}/leagues/${FIRST_LEAGUE}/seasons/${SEASONS[0].slug}`;
    const routes: [string, string | RegExp][] = [
      ['/sign-up', /Create your account/],
      ['/sign-in', /Sign in/],
      [`${tenant.path}`, tenant.name],
      [`${tenant.path}/leagues/${FIRST_LEAGUE}`, LEAGUE_NAMES[0]],
      [`${tenant.path}/leagues/${FIRST_LEAGUE}?page=2`, LEAGUE_NAMES[0]],
      [seasonPath, SEASONS[0].name],
    ];
    for (const [path, heading] of routes) {
      await test.step(path, async () => {
        await visit(page, path, heading);
        expect(await expectTargets(page)).toBeGreaterThan(0);
        await expectAccessible(page);
      });
    }
    await visit(page, '/sign-up', /Create your account/);
    expect(await expectRows(page)).toBe(1);

    const linkIsHit = await page.evaluate(() => {
      const description = document.querySelector(
        '[data-slot="field-description"]#adult-description',
      );
      const link = document.createElement('a');
      link.href = '#probe';
      link.textContent = 'probe link';
      description?.append(link);
      link.scrollIntoView();
      const box = link.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === link;
    });
    expect(linkIsHit, 'a link in a check box row description is not covered by the row').toBe(true);
  });

  test('the app: Your organizations, create organization, the admin pages, the league page, and the menu sheet', async ({
    page,
  }) => {
    const user = newUser('Admin');
    await signUp(page, user);
    const tenant = await seedPublicTenant();
    await convexRun('testing:addMembership', {
      organizationSlug: tenant.slug,
      email: user.email,
      role: 'orgAdmin',
    });
    // A second organization gives /app a league organizer row with its league links, and an
    // empty one shows the Overview's next-step links.
    const organizing = await seedTenant({
      name: 'E2E Touch Organizing',
      locations: LOCATIONS,
      leagues: LEAGUES,
    });
    await convexRun('testing:addLeagueOrganizer', {
      organizationSlug: organizing.slug,
      email: user.email,
      leagueSlugs: [FIRST_LEAGUE],
    });
    const empty = await seedTenant({ name: 'E2E Touch Empty' });
    await convexRun('testing:addMembership', {
      organizationSlug: empty.slug,
      email: user.email,
      role: 'orgAdmin',
    });
    const base = `/app/organizations/${tenant.slug}`;
    const routes: [string, string | RegExp][] = [
      ['/app', 'Your account'],
      [`/app/organizations/${empty.slug}`, 'Overview'],
      ['/app/organizations/new', /Create an organization/],
      [base, 'Overview'],
      [`${base}/locations`, 'Locations'],
      [`${base}/leagues`, 'Leagues'],
      [`${base}/staff`, 'Staff'],
      [`${base}/leagues/${FIRST_LEAGUE}`, LEAGUE_NAMES[0]],
    ];
    for (const [path, heading] of routes) {
      await test.step(path, async () => {
        await visit(page, path, heading);
        expect(await expectTargets(page)).toBeGreaterThan(0);
        await expectAccessible(page);
      });
    }

    await test.step('rows of check boxes and radio buttons', async () => {
      await visit(page, `${base}/leagues`, 'Leagues');
      expect(await expectRows(page)).toBeGreaterThan(0);
      await visit(page, `${base}/staff`, 'Staff');
      expect(await expectRows(page)).toBeGreaterThan(0);
      await visit(page, `${base}/leagues/${FIRST_LEAGUE}`, LEAGUE_NAMES[0]);
      expect(await expectRows(page)).toBeGreaterThan(0);
    });

    await test.step('the menu sheet', async () => {
      await visit(page, base, 'Overview');
      const sheet = await openSheet(page);
      expect(await expectTargets(page, sheet)).toBeGreaterThan(0);
      await page.keyboard.press('Escape');
      await visit(page, `${base}/leagues/${FIRST_LEAGUE}`, LEAGUE_NAMES[0]);
      const leagueSheet = await openSheet(page);
      expect(await expectTargets(page, leagueSheet)).toBeGreaterThan(0);
    });
  });

  test('the accept-invite page', async ({ page }) => {
    const tenant = await seedTenant({
      name: 'E2E Touch Invite',
      locations: LOCATIONS.slice(0, 1),
      leagues: LEAGUES.slice(0, 1),
    });
    const user = newUser('Invitee');
    const token = 'touch-targets-invite-token-0123456789abcdefghij';
    await convexRun('testing:addInvite', {
      organizationSlug: tenant.slug,
      email: user.email,
      role: 'leagueOrganizer',
      leagueNames: [LEAGUE_NAMES[0]],
      expiresAt: Date.now() + 12 * 24 * 60 * 60 * 1000,
      token,
    });
    await page.goto(`/invites/accept#${token}`);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(
      `Join ${tenant.name}`,
    );
    expect(await expectTargets(page)).toBeGreaterThan(0);
    await expectAccessible(page);

    await signUp(page, user);
    await page.goto(`/invites/accept#${token}`);
    await expect(page.getByRole('button', { name: 'Accept invite' })).toBeVisible();
    expect(await expectTargets(page)).toBeGreaterThan(0);
    await expectAccessible(page);
  });
});

test.describe('desktop: controls keep their sizes', () => {
  test.skip(({ hasTouch }) => hasTouch, 'only the desktop project has a mouse');

  test('buttons, fields, links, and the page control are not enlarged', async ({ page }) => {
    await page.goto('/sign-in');
    expect(await page.evaluate((q) => matchMedia(q).matches, COARSE_POINTER)).toBe(false);
    const heightOf = async (locator: Locator) => (await locator.boundingBox())?.height;
    await expect(page.locator('#email')).toBeVisible();
    expect(await heightOf(page.locator('#email'))).toBe(36);
    expect(await heightOf(page.getByRole('button', { name: 'Sign in' }))).toBe(36);

    const user = newUser('Admin');
    await signUp(page, user);
    const tenant = await seedPublicTenant();
    await convexRun('testing:addMembership', {
      organizationSlug: tenant.slug,
      email: user.email,
      role: 'orgAdmin',
    });
    const base = `/app/organizations/${tenant.slug}`;
    await visit(page, `${base}/locations`, 'Locations');
    const nav = page.getByRole('navigation', { name: `${tenant.name} admin` });
    expect(await heightOf(nav.getByRole('link', { name: 'Locations' }))).toBe(32);
    expect(await heightOf(page.getByRole('button', { name: /^Add location/ }))).toBe(36);
    await visit(page, `${tenant.path}/leagues/${FIRST_LEAGUE}`, LEAGUE_NAMES[0]);
    expect(
      await heightOf(page.locator('app-page-control').getByRole('link', { name: 'Page 2' })),
    ).toBe(32);
    await visit(page, '/app', 'Your account');
    expect(await heightOf(page.getByRole('link', { name: `Manage ${tenant.name}` }))).toBeLessThan(
      TARGET,
    );
  });
});
