// Tests sign a user up and seed an organization, so they need the local Convex backend.
import type { Locator, Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { tokensSettled } from './support/auth-tokens';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { signUp } from './support/session';
import { screenshot } from './support/screenshot';
import { seedTenant } from './support/tenant';
import { newUser, seedUser, type TestUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LOCATIONS = [
  { name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX 78382' },
  {
    name: 'Pelican Shoals Sand Courts',
    address: '2150 Pelican Shoals Dr, Corpus Christi, TX 78418',
  },
];
const LEAGUES = [
  { name: 'Coed 7v7 Rec', sport: 'soccer' as const, locations: ['Redfish Flats Fields'] },
  {
    name: 'Draft Softball',
    sport: 'softball' as const,
    locations: ['Redfish Flats Fields'],
    status: 'draft' as const,
  },
];
const ASSIGNED = 'coed-7v7-rec';

type Role = 'orgAdmin' | 'leagueOrganizer';

async function member(page: Page, role: Role) {
  const user = newUser(role === 'orgAdmin' ? 'Admin' : 'Organizer');
  await signUp(page, user);
  const tenant = await seedTenant({ name: 'E2E Shell', locations: LOCATIONS, leagues: LEAGUES });
  if (role === 'orgAdmin') {
    await convexRun('testing:addMembership', {
      organizationSlug: tenant.slug,
      email: user.email,
      role,
    });
  } else {
    await convexRun('testing:addLeagueOrganizer', {
      organizationSlug: tenant.slug,
      email: user.email,
      leagueSlugs: [ASSIGNED],
    });
  }
  return { user, tenant, base: `/app/organizations/${tenant.slug}` };
}

const accountLink = (page: Page, user: TestUser) =>
  page.getByRole('link', { name: new RegExp(`^Account settings: ${user.name}`) });
const menuButton = (page: Page) => page.getByRole('button', { name: 'Open navigation' });
const dialogOf = (page: Page) => page.getByRole('dialog', { name: 'Navigation' });

async function isAfterInDocument(earlier: Locator, later: Locator): Promise<boolean> {
  const handle = await later.elementHandle();
  return earlier.evaluate(
    (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING),
    handle,
  );
}

async function tap(page: Page, control: Locator): Promise<void> {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  if (!box) throw new Error('control has no box');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('the app shell', () => {
  test.describe('from 1024px', () => {
    test.skip(({ isMobile }) => isMobile, 'the desktop sidebar runs at desktop width only');

    test('an org admin on Overview has no top bar, the admin sidebar in order, and the account at its foot', async ({
      page,
    }, testInfo) => {
      const { user, tenant, base } = await member(page, 'orgAdmin');
      await page.goto(base);
      await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

      await expect(page.locator('header')).toBeHidden();
      await expect(page.getByRole('banner')).toHaveCount(0);

      const nav = page.getByRole('navigation', { name: `${tenant.name} admin` });
      await expect(nav.getByRole('link')).toHaveText([
        /Switch organization/,
        'Overview',
        /^Leagues\s*2$/,
        /^Locations\s*2$/,
        /^Staff\s*1$/,
        'Details',
        'View public page',
      ]);
      const [head, overview, , , , , publicPage] = await nav.getByRole('link').all();
      await expect(head).toHaveAttribute('href', '/app');
      await expect(head).toContainText(tenant.name);
      await expect(overview).toHaveAttribute('aria-current', 'page');
      await expect(publicPage).toHaveAttribute('href', tenant.path);
      await expect(nav.locator('[aria-current]')).toHaveCount(1);

      const row = accountLink(page, user);
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('href', '/app/account');
      await expect(row).toContainText(user.name);
      await expect(row).toContainText(user.email);
      expect(await isAfterInDocument(nav, row)).toBe(true);
      await screenshot(page, testInfo, 'app-shell-admin');
    });

    test('a league organizer sees their own sidebar and none of the admin area', async ({
      page,
    }, testInfo) => {
      const { user, tenant, base } = await member(page, 'leagueOrganizer');
      await page.goto(`${base}/leagues/${ASSIGNED}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Coed 7v7 Rec' })).toBeVisible();
      await expect(page.locator('header')).toBeHidden();

      const nav = page.getByRole('navigation', { name: `${tenant.name} leagues` });
      const head = nav.getByRole('link').first();
      await expect(head).toHaveAttribute('href', '/app');
      await expect(head).toContainText(tenant.name);
      await expect(head).toContainText('League organizer');
      await expect(nav.getByRole('list', { name: 'Your leagues' }).getByRole('link')).toHaveText([
        'Coed 7v7 Rec',
      ]);
      await expect(nav.getByRole('link', { name: 'Public page' })).toHaveAttribute(
        'href',
        tenant.path,
      );
      for (const absent of ['Overview', 'Leagues', 'Locations', 'Staff', 'Details']) {
        await expect(nav.getByRole('link', { name: absent, exact: true })).toHaveCount(0);
      }
      await expect(nav.getByRole('link', { name: 'View public page' })).toHaveCount(0);
      await expect(
        nav.getByRole('link', { name: /^(Leagues|Locations|Staff)\s*\d+$/ }),
      ).toHaveCount(0);

      const row = accountLink(page, user);
      await expect(row).toBeVisible();
      await expect(row).toContainText(user.email);
      await screenshot(page, testInfo, 'app-shell-organizer');
    });

    test('/app lists the organization an org admin manages under Home, and a user with none has no group', async ({
      page,
      browser,
    }, testInfo) => {
      const { user, tenant } = await member(page, 'orgAdmin');
      await page.goto('/app');
      const nav = page.getByRole('navigation', { name: 'Your account' });
      await expect(nav.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
      await expect(
        nav.getByRole('list', { name: 'Your organizations' }).getByRole('link'),
      ).toHaveText([tenant.name]);
      await expect(nav.locator('[aria-current]')).toHaveCount(1);
      await expect(accountLink(page, user)).toBeVisible();
      await screenshot(page, testInfo, 'app-shell-home');

      const context = await browser.newContext({ baseURL });
      try {
        const lone = await context.newPage();
        await signUp(lone, newUser('Lone'));
        await expect(
          lone
            .getByRole('navigation', { name: 'Your account' })
            .getByRole('link', { name: 'Home' }),
        ).toBeVisible();
        await expect(lone.getByRole('list', { name: 'Your organizations' })).toHaveCount(0);
        await expect(lone.getByRole('navigation', { name: 'Your account' })).not.toContainText(
          'Your organizations',
        );
      } finally {
        await context.close();
      }
    });

    for (const path of ['/app/organizations/new', '/app/no/such/page']) {
      test(`${path} shows the home sidebar with the account row, and no item is current`, async ({
        page,
      }) => {
        const user = newUser('Plain');
        await signUp(page, user);
        await page.goto(path);
        const nav = page.getByRole('navigation', { name: 'Your account' });
        await expect(nav).toBeVisible();
        await expect(nav.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
        await expect(page.locator('[aria-current]')).toHaveCount(0);
        await expect(accountLink(page, user)).toBeVisible();
        await expect(page.locator('header')).toBeHidden();
      });
    }

    test('the account row is the current item on /app/account', async ({ page }) => {
      const user = newUser('Current');
      await signUp(page, user);
      await page.goto('/app/account');
      await expect(accountLink(page, user)).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('[aria-current]:visible')).toHaveCount(1);
    });
  });

  test.describe('below 1024px', () => {
    test.skip(({ isMobile }) => !isMobile, 'the slim bar and the sheet run at phone widths only');

    test('360: the slim bar names the organization and links to Account settings by name', async ({
      page,
    }, testInfo) => {
      const { user, tenant, base } = await member(page, 'orgAdmin');
      await page.goto(base);
      await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

      const bar = page.locator('header');
      await expect(bar).toBeVisible();
      await expect(menuButton(page)).toBeVisible();
      await expect(bar).toContainText(tenant.name);
      const initials = bar.getByRole('link', { name: `Account settings: ${user.name}` });
      await expect(initials).toHaveAttribute('href', '/app/account');
      await expect(initials).toHaveAccessibleName(`Account settings: ${user.name}`);
      await expect(page.getByRole('navigation', { name: `${tenant.name} admin` })).toBeHidden();
      await screenshot(page, testInfo, 'app-shell-slim-bar');
    });

    test('the sheet focuses Close, holds the page behind, and gives focus back to the menu button on Escape and on Close', async ({
      page,
    }) => {
      const { user, tenant, base } = await member(page, 'orgAdmin');
      await page.goto(base);
      await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

      await tap(page, menuButton(page));
      const close = dialogOf(page).getByRole('button', { name: 'Close navigation' });
      await expect(close).toBeFocused();
      await expect(page.getByRole('main')).toHaveCount(0);
      const nav = dialogOf(page).getByRole('navigation', { name: `${tenant.name} admin` });
      await expect(nav).toBeVisible();
      await expect(accountLink(page, user)).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(dialogOf(page)).toHaveCount(0);
      await expect(menuButton(page)).toBeFocused();

      await tap(page, menuButton(page));
      await expect(close).toBeFocused();
      await tap(page, close);
      await expect(dialogOf(page)).toHaveCount(0);
      await expect(menuButton(page)).toBeFocused();
    });

    test('Tab and Shift+Tab never leave the open sheet for the page behind', async ({ page }) => {
      const { base } = await member(page, 'orgAdmin');
      await page.goto(base);
      await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

      await tap(page, menuButton(page));
      await expect(dialogOf(page).getByRole('button', { name: 'Close navigation' })).toBeFocused();

      const focusInsideDialog = () =>
        page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
      for (const key of ['Tab', 'Shift+Tab']) {
        for (let press = 0; press < 14; press++) {
          await page.keyboard.press(key);
          expect(await focusInsideDialog(), `${key} press ${String(press + 1)}`).toBe(true);
        }
      }
    });
  });

  test.describe('on every /app page', () => {
    test('passes the accessibility checks at the viewport width, with 44px rows on touch screens and no scroll at 320px', async ({
      page,
    }) => {
      const { base } = await member(page, 'orgAdmin');
      const targets: [string, string][] = [
        [base, 'Overview'],
        ['/app', 'Home'],
        ['/app/account', 'Account settings'],
        ['/app/organizations/new', 'Create an organization'],
      ];
      for (const [path, heading] of targets) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
        await expectAccessible(page);

        const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
        if (coarse) {
          await tap(page, menuButton(page));
          const links = dialogOf(page).locator('nav a');
          for (const link of await links.all()) {
            expect((await link.boundingBox())?.height ?? 0, path).toBeGreaterThanOrEqual(44);
          }
          await page.keyboard.press('Escape');
        }
      }
    });
  });

  test.describe('on a shared device', VIEWPORT_AGNOSTIC, () => {
    test("a second user who signs in right after sees their own name and email in the account row, never the first user's", async ({
      page,
    }) => {
      const alice = newUser('Alice');
      const bob = await seedUser(newUser('Bob'));
      await signUp(page, alice);
      await expect(accountLink(page, alice)).toContainText(alice.email);

      await page.goto('/app/account');
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect(page).toHaveURL(`${baseURL}/`);

      // Client-side navigation from here keeps this document, so the observer sees every state the page shows.
      await page.evaluate(
        ([name, email]) => {
          const win = window as Window & { aliceShown?: boolean };
          win.aliceShown = false;
          new MutationObserver(() => {
            const text = document.body.textContent ?? '';
            if (text.includes(name) || text.includes(email)) win.aliceShown = true;
          }).observe(document.body, { childList: true, subtree: true, characterData: true });
        },
        [alice.name, alice.email],
      );

      await page.locator('header a[href^="/sign-in"]').click();
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
      const tokens = tokensSettled(page);
      await page.locator('#email').fill(bob.email);
      await page.locator('#password').fill(bob.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(`${baseURL}/app`);
      await tokens;

      const row = accountLink(page, bob);
      await expect(row).toContainText(bob.name);
      await expect(row).toContainText(bob.email);
      expect(
        await page.evaluate(() => (window as Window & { aliceShown?: boolean }).aliceShown),
      ).toBe(false);
    });
  });
});
