// Tests sign a user up and seed an organization, so they need the local Convex backend.
import type { BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { axeScan, describeViolations, expectAccessible } from './support/a11y';
import { TOKEN_PATH, tokensSettled } from './support/auth-tokens';
import { seedPublishedCamp } from './support/camp';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { failFirstAnswer } from './support/fail-first-answer';
import { expect, failedRequests, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { signUp } from './support/session';
import { screenshot } from './support/screenshot';
import { dateFromToday, seedSeasons, seedTenant, type Tenant } from './support/tenant';
import { newUser, seedUser, type TestUser } from './support/users';
import { HOME_HEADING, homeHeading } from './support/home';

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
        'Tournaments',
        'Camps',
        /^Locations\s*2$/,
        /^Staff\s*1$/,
        'Details',
        'View public page',
      ]);
      const [head, overview, , , , , , , publicPage] = await nav.getByRole('link').all();
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
      const targets: [string, string | RegExp][] = [
        [base, 'Overview'],
        ['/app', HOME_HEADING],
        ['/app/account', 'Account settings'],
        ['/app/organizations/new', 'Create an organization'],
      ];
      for (const [path, heading] of targets) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
        // The Tab walk snapshots the focusable elements once, so wait for the controls that render after the h1.
        await expect(
          page.locator('[role="status"]').filter({ hasText: /^\s*Loading/ }),
        ).toHaveCount(0);
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

  test.describe('on a shared device', () => {
    /** The phone top bar shows only initials and the name, so the email is checked in the sheet's account row. */
    async function expectAccountRowOf(page: Page, user: TestUser, isMobile: boolean) {
      await expect(accountLink(page, user)).toContainText(user.name);
      if (!isMobile) {
        await expect(accountLink(page, user)).toContainText(user.email);
        return;
      }
      await tap(page, menuButton(page));
      const sheetRow = dialogOf(page).getByRole('link', {
        name: new RegExp(`^Account settings: ${user.name}`),
      });
      await expect(sheetRow).toContainText(user.name);
      await expect(sheetRow).toContainText(user.email);
      await page.keyboard.press('Escape');
      await expect(dialogOf(page)).toHaveCount(0);
    }

    test("a second user who signs in right after sees their own name and email in the account row, never the first user's", async ({
      page,
      isMobile,
    }) => {
      const alice = newUser('Alice');
      const bob = await seedUser(newUser('Bob'));
      await signUp(page, alice);
      await expectAccountRowOf(page, alice, isMobile);

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

      await expectAccountRowOf(page, bob, isMobile);
      expect(
        await page.evaluate(() => (window as Window & { aliceShown?: boolean }).aliceShown),
      ).toBe(false);
    });

    test.describe('Sign out while the session check is still out', () => {
      const SESSION_PATH = '/api/auth/get-session';
      const SIGN_OUT_PATH = '/api/auth/sign-out';
      const PAGE_READS_ANSWER_MS = 100;
      const LATE_FLIP_MS = 1_500;

      type ReleasePoint = 'once sent' | 'while held' | 'after answered';

      const isPath = (path: string) => (url: URL) => url.pathname === path;

      async function keptSessionWithHeldCheck(
        page: Page,
        options: { signOutStatus: 200 | 500; holdSignOut: boolean; laterCheckStatus?: 503 },
      ) {
        const heldUntilOpened = () => {
          let release!: () => void;
          const opened = new Promise<void>((resolve) => (release = resolve));
          return { release, opened };
        };
        const check = heldUntilOpened();
        const signOut = heldUntilOpened();
        const checkFetched = heldUntilOpened();
        const signOutReached = heldUntilOpened();
        const signOutAnswered = heldUntilOpened();

        let checks = 0;
        await page.route(isPath(SESSION_PATH), async (route) => {
          checks += 1;
          if (checks > 1) {
            if (options.laterCheckStatus === undefined) {
              await route.continue();
              return;
            }
            await route.fulfill({
              response: await route.fetch(),
              status: options.laterCheckStatus,
              body: '',
            });
            return;
          }
          const answer = await route.fetch();
          checkFetched.release();
          await check.opened;
          await route.fulfill({ response: answer });
        });
        await page.route(isPath(SIGN_OUT_PATH), async (route) => {
          signOutReached.release();
          if (options.holdSignOut) await signOut.opened;
          if (options.signOutStatus === 200) {
            await route.continue();
          } else {
            await route.fulfill({
              status: 500,
              headers: {
                'access-control-allow-origin': new URL(baseURL).origin,
                'access-control-allow-credentials': 'true',
                'content-type': 'application/json',
              },
              body: '{"message":"boom"}',
            });
          }
          signOutAnswered.release();
        });

        await page.goto('/app/account');
        await checkFetched.opened;
        return {
          releaseCheck: check.release,
          releaseSignOut: signOut.release,
          signOutReached: signOutReached.opened,
          signOutAnswered: signOutAnswered.opened,
        };
      }

      async function expectSignedOutForGood(page: Page, tokenRequestsAfterSignOut: string[]) {
        await expect(page).toHaveURL(`${baseURL}/`);
        await page.waitForTimeout(LATE_FLIP_MS);
        expect(tokenRequestsAfterSignOut).toEqual([]);
        await expect(page.locator('header a[href^="/sign-in"]')).toBeVisible();
      }

      function tokenRequestsAfterSignOut(page: Page): string[] {
        const sent: string[] = [];
        let signOutSent = false;
        page.on('request', (request) => {
          const { pathname } = new URL(request.url());
          if (pathname === SIGN_OUT_PATH) signOutSent = true;
          else if (pathname === TOKEN_PATH && signOutSent) sent.push(request.url());
        });
        return sent;
      }

      async function signOutReleasing(
        page: Page,
        point: ReleasePoint,
        held: Awaited<ReturnType<typeof keptSessionWithHeldCheck>>,
      ) {
        await page.getByRole('button', { name: 'Sign out' }).click();
        await held.signOutReached;
        if (point === 'once sent') {
          held.releaseCheck();
        } else if (point === 'while held') {
          held.releaseCheck();
          await page.waitForTimeout(PAGE_READS_ANSWER_MS);
          held.releaseSignOut();
        } else {
          await held.signOutAnswered;
          held.releaseCheck();
        }
      }

      test('a check answered once /sign-out is sent leaves the user signed out with no token request', async ({
        page,
      }) => {
        await signUp(page, newUser('Once'));
        const tokens = tokenRequestsAfterSignOut(page);
        const held = await keptSessionWithHeldCheck(page, {
          signOutStatus: 200,
          holdSignOut: false,
        });
        await signOutReleasing(page, 'once sent', held);
        await expectSignedOutForGood(page, tokens);
      });

      test('a check answered while /sign-out is held, then 200, leaves the user signed out with no token request', async ({
        page,
      }) => {
        await signUp(page, newUser('Held'));
        const tokens = tokenRequestsAfterSignOut(page);
        const held = await keptSessionWithHeldCheck(page, {
          signOutStatus: 200,
          holdSignOut: true,
        });
        await signOutReleasing(page, 'while held', held);
        await expectSignedOutForGood(page, tokens);
      });

      test.describe('when /sign-out answers 500', () => {
        test.use({ expectedFailedRequests: [{ status: 500, path: SIGN_OUT_PATH }] });

        test('a check answered while /sign-out is held leaves the user signed out with no token request', async ({
          page,
        }) => {
          await signUp(page, newUser('Held500'));
          const tokens = tokenRequestsAfterSignOut(page);
          const held = await keptSessionWithHeldCheck(page, {
            signOutStatus: 500,
            holdSignOut: true,
          });
          await signOutReleasing(page, 'while held', held);
          await expectSignedOutForGood(page, tokens);
        });

        test('a check answered after /sign-out failed leaves the user signed out with no token request', async ({
          page,
        }) => {
          await signUp(page, newUser('After500'));
          const tokens = tokenRequestsAfterSignOut(page);
          const held = await keptSessionWithHeldCheck(page, {
            signOutStatus: 500,
            holdSignOut: false,
          });
          await signOutReleasing(page, 'after answered', held);
          await expectSignedOutForGood(page, tokens);
        });
      });

      test.describe('when /sign-out answers 500 and every later session check answers 503', () => {
        test.use({
          expectedFailedRequests: failedRequests(
            { status: 500, path: SIGN_OUT_PATH },
            { status: 503, path: SESSION_PATH },
          ),
        });

        test('a check answered while /sign-out is held leaves the user signed out with no token request', async ({
          page,
        }) => {
          await signUp(page, newUser('Outage'));
          const tokens = tokenRequestsAfterSignOut(page);
          const held = await keptSessionWithHeldCheck(page, {
            signOutStatus: 500,
            holdSignOut: true,
            laterCheckStatus: 503,
          });
          await signOutReleasing(page, 'while held', held);
          await expectSignedOutForGood(page, tokens);
        });
      });
    });
  });

  test.describe('loading and offline', () => {
    const CONVEX_SOCKET = /\/api\/[^/]+\/sync$/;
    const SEASON_SLUG = 'summer-open';
    const NOTE_Y_BELOW_SLIM_BAR = 56;
    const COLUMN_WIDTH = 256;

    async function adminWithSeason(page: Page) {
      const { tenant, base } = await member(page, 'orgAdmin');
      await seedSeasons(tenant, ASSIGNED, [
        {
          name: 'Summer Open',
          slug: SEASON_SLUG,
          startDate: dateFromToday(40),
          endDate: dateFromToday(100),
          registrationDeadline: dateFromToday(20),
        },
      ]);
      return base;
    }

    /** Playwright has no unroute for WebSocket routes, so the handler switches to passing sockets through. */
    async function refuseSocket(page: Page) {
      const socket = { refuse: true };
      await page.routeWebSocket(CONVEX_SOCKET, (ws) => {
        if (socket.refuse) void ws.close();
        else ws.connectToServer();
      });
      await page.clock.install();
      return socket;
    }

    async function reconnectLogged(consoleGuard: { logMessages: readonly string[] }) {
      await expect
        .poll(() =>
          consoleGuard.logMessages.some((message) => message.startsWith('Attempting reconnect')),
        )
        .toBe(true);
    }

    const note = (page: Page) => page.locator('app-offline-note');
    const column = (page: Page) => page.locator('div.w-64.bg-sidebar');

    async function expectNoteBox(page: Page, isMobile: boolean) {
      const width = page.viewportSize()!.width;
      await expect(note(page).locator('[data-offline-note]')).toBeVisible();
      expect(await note(page).boundingBox()).toMatchObject(
        isMobile
          ? { x: 0, y: NOTE_Y_BELOW_SLIM_BAR, width }
          : { x: COLUMN_WIDTH, y: 0, width: width - COLUMN_WIDTH },
      );
    }

    async function expectAxe(page: Page, label: string) {
      const results = await axeScan(page);
      expect(describeViolations(results.violations), `axe violations: ${label}`).toEqual([]);
    }

    async function expectSkeletonColumn(page: Page, isMobile: boolean) {
      if (isMobile) {
        await expect(column(page)).toBeHidden();
        return;
      }
      await expect(page.locator('.bg-sidebar:visible')).toHaveCount(1);
      expect(await column(page).boundingBox()).toMatchObject({ x: 0, width: COLUMN_WIDTH });
      await expect(column(page).locator('[data-slot="sidebar-mark-skeleton"]')).toBeVisible();
      await expect(column(page).locator('[data-slot="sidebar-text-skeleton"]')).toHaveCount(2);
      await expect(column(page).locator('[data-slot="sidebar-row-skeleton"]')).toHaveCount(4);
      await expect(column(page).getByText('Loading your account.')).toBeAttached();
      await expect(page.locator('main .bg-sidebar')).toHaveCount(0);
      const outsideColumn = await page
        .locator('main *:visible')
        .evaluateAll(
          (elements) =>
            elements.filter((element) => element.getBoundingClientRect().x < 256).length,
        );
      expect(outsideColumn).toBe(0);
    }

    async function walkStates(
      page: Page,
      context: BrowserContext,
      testInfo: TestInfo,
      {
        url,
        key,
        host,
        loadedHost,
        loadedHeading,
        headLink,
        consoleGuard,
        isMobile,
      }: {
        url: string;
        key: string;
        host?: string;
        loadedHost?: string;
        loadedHeading: string;
        headLink?: string;
        consoleGuard: { logMessages: readonly string[] };
        isMobile: boolean;
      },
    ) {
      const socket = await refuseSocket(page);
      await page.goto(url);
      await reconnectLogged(consoleGuard);
      await page.clock.fastForward(5_000);
      await expectNoteBox(page, isMobile);
      await expectSkeletonColumn(page, isMobile);
      // The column is hidden below 1024px, so its status is out of the accessibility tree until the sheet opens.
      await expect(page.getByRole('status').filter({ hasText: 'Loading navigation.' })).toHaveCount(
        isMobile ? 0 : 1,
      );
      const skeletonHead = isMobile
        ? null
        : await column(page).locator('[data-slot="sidebar-head-skeleton"]').boundingBox();
      const hostBox = host ? await page.locator(host).boundingBox() : null;
      await expectAxe(page, `${key} loading and offline`);
      await screenshot(page, testInfo, `shell-loading-offline-${key}`);

      socket.refuse = false;
      await page.clock.fastForward(10_000);
      await expect(page.getByRole('heading', { level: 1, name: loadedHeading })).toBeVisible();
      await expect(note(page).locator('[data-offline-note]')).toBeHidden();
      if (!isMobile && headLink) {
        const loadedHead = await page.locator(headLink).first().boundingBox();
        expect(Math.abs(loadedHead!.y - skeletonHead!.y)).toBeLessThanOrEqual(2);
        expect(Math.abs(loadedHead!.height - skeletonHead!.height)).toBeLessThanOrEqual(2);
      }
      if (hostBox && loadedHost) {
        const loadedBox = await page.locator(loadedHost).boundingBox();
        expect(Math.abs(loadedBox!.x - hostBox.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(loadedBox!.width - hostBox.width)).toBeLessThanOrEqual(1);
      }

      await context.setOffline(true);
      await expect(note(page).locator('[data-offline-note]')).toBeVisible({ timeout: 2_000 });
      await expectNoteBox(page, isMobile);
      if (isMobile) await expect(column(page)).toBeHidden();
      await expectAxe(page, `${key} loaded and offline`);
      await screenshot(page, testInfo, `shell-loaded-offline-${key}`);
      await context.setOffline(false);
    }

    test('the admin Overview shows one sidebar skeleton and the note where it sits once loaded', async ({
      page,
      context,
      consoleGuard,
      isMobile,
    }, testInfo) => {
      const base = await adminWithSeason(page);
      await walkStates(page, context, testInfo, {
        url: base,
        key: 'admin',
        host: 'app-admin-loading',
        loadedHost: 'app-admin-overview',
        loadedHeading: 'Overview',
        headLink: 'div.w-64.bg-sidebar nav a',
        consoleGuard,
        isMobile,
      });
    });

    test('the league management page shows one sidebar skeleton and the note where it sits once loaded', async ({
      page,
      context,
      consoleGuard,
      isMobile,
    }, testInfo) => {
      const base = await adminWithSeason(page);
      await walkStates(page, context, testInfo, {
        url: `${base}/leagues/${ASSIGNED}`,
        key: 'league',
        loadedHeading: 'Coed 7v7 Rec',
        headLink: 'div.w-64.bg-sidebar nav a',
        consoleGuard,
        isMobile,
      });
    });

    test('the season management page shows one sidebar skeleton and the note where it sits once loaded', async ({
      page,
      context,
      consoleGuard,
      isMobile,
    }, testInfo) => {
      const base = await adminWithSeason(page);
      await walkStates(page, context, testInfo, {
        url: `${base}/leagues/${ASSIGNED}/seasons/${SEASON_SLUG}`,
        key: 'season',
        loadedHeading: 'Summer Open',
        headLink: 'div.w-64.bg-sidebar nav a',
        consoleGuard,
        isMobile,
      });
    });

    test('the note on Home sits where it does on the other pages, loading and loaded', async ({
      page,
      context,
      consoleGuard,
      isMobile,
    }) => {
      await adminWithSeason(page);
      const socket = await refuseSocket(page);
      await page.goto('/app');
      await reconnectLogged(consoleGuard);
      await page.clock.fastForward(5_000);
      await expectNoteBox(page, isMobile);
      socket.refuse = false;
      await page.clock.fastForward(10_000);
      await expect(homeHeading(page)).toBeVisible();
      await context.setOffline(true);
      await expect(note(page).locator('[data-offline-note]')).toBeVisible({ timeout: 2_000 });
      await expectNoteBox(page, isMobile);
      await context.setOffline(false);
    });

    test('the phone sheet shows the same skeleton while the admin area loads offline', async ({
      page,
      consoleGuard,
      isMobile,
    }) => {
      test.skip(!isMobile, 'the phone sheet runs at phone widths only');
      const base = await adminWithSeason(page);
      await refuseSocket(page);
      await page.goto(base);
      await reconnectLogged(consoleGuard);
      await page.clock.fastForward(5_000);
      await expectNoteBox(page, isMobile);
      await tap(page, menuButton(page));
      const sheet = dialogOf(page);
      await expect(sheet.locator('[data-slot="sidebar-head-skeleton"]')).toBeVisible();
      await expect(sheet.locator('[data-slot="sidebar-mark-skeleton"]')).toBeVisible();
      await expect(sheet.locator('[data-slot="sidebar-row-skeleton"]')).toHaveCount(4);
      await expect(sheet.getByText('Loading your account.')).toBeAttached();
      await expect(
        sheet.getByRole('status').filter({ hasText: 'Loading navigation.' }),
      ).toHaveCount(1);
      await expectAxe(page, 'the phone sheet while loading and offline');
    });
  });
});

const GULF = 'Gulf Coast Sport & Social';
const SUNDAY = 'Sunday Reverse Coed 4s';
const SUNDAY_SLUG = 'sunday-reverse-coed-4s';
const SUMMER = 'Summer 2027';
const SUMMER_SLUG = 'summer-2027';
// Words, so that the page's own text wraps at 320px; only the bar truncates.
const LONG_SEASON = 'Sunset '.repeat(15).slice(0, 100);
const LONG_SEASON_SLUG = 'long-season';
const LONG_TEAM = 'Sunset '.repeat(9).slice(0, 60);
const LONG_SESSION = 'Sunset '.repeat(15).slice(0, 100);
const BEACH = 'Alpha Beach';
const CAMP = 'Adult Beach Skills Camp';
const CAMP_SLUG = 'adult-beach-skills-camp';
const OPEN = 'Gulf Coast Beach Open';
const OPEN_SLUG = 'gulf-coast-beach-open';
const SITE = 'Omni League';

interface BarWorld {
  tenant: Tenant;
  base: string;
  sessionIds: Record<string, string>;
}

/** One tenant for every test of a worker: the bar tests only read it. */
const barTest = test.extend<object, { world: BarWorld }>({
  world: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const tenant = await seedTenant({
        name: GULF,
        locations: [{ name: BEACH, address: '1 Alpha Road, Corpus Christi, TX 78412' }],
        leagues: [
          {
            name: SUNDAY,
            sport: 'beachVolleyball',
            locations: [BEACH],
            division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
          },
        ],
        tournaments: [
          {
            name: OPEN,
            slug: OPEN_SLUG,
            locations: [BEACH],
            startDate: dateFromToday(40),
            endDate: dateFromToday(42),
            registrationDeadline: dateFromToday(20),
          },
        ],
      });
      const season = (name: string, slug: string) => ({
        name,
        slug,
        startDate: dateFromToday(40),
        endDate: dateFromToday(100),
        registrationDeadline: dateFromToday(20),
      });
      await seedSeasons(tenant, SUNDAY_SLUG, [
        season(SUMMER, SUMMER_SLUG),
        season(LONG_SEASON, LONG_SEASON_SLUG),
      ]);
      const week = (name: string) => ({
        name,
        startDate: dateFromToday(30),
        endDate: dateFromToday(34),
        registrationDeadline: dateFromToday(23),
      });
      await seedPublishedCamp(tenant, {
        name: CAMP,
        slug: CAMP_SLUG,
        locations: [BEACH],
        minimumAge: 18,
        maximumAge: 99,
        sessions: [week('Week 1'), week(LONG_SESSION)],
      });
      const camp = (await convexRun('camps:getPublicPage', {
        orgSlug: tenant.slug,
        campSlug: CAMP_SLUG,
      })) as { sessions: { name: string; sessionId: string }[] };
      await use({
        tenant,
        base: `/app/organizations/${tenant.slug}`,
        sessionIds: Object.fromEntries(camp.sessions.map((s) => [s.name, s.sessionId])),
      });
    },
    { scope: 'worker', timeout: 180_000 },
  ],
});

async function signUpAs(page: Page, world: BarWorld, role: Role | null): Promise<TestUser> {
  const user = newUser('Admin');
  await signUp(page, user);
  if (role) {
    await convexRun('testing:addMembership', {
      organizationSlug: world.tenant.slug,
      email: user.email,
      role,
    });
  }
  return user;
}

interface BarTeam {
  teamId: string;
  name: string;
}

/** The world is shared by the tests of a worker, and a team name is taken once per season. */
const sharks = () => `Sand Sharks ${randomBytes(3).toString('hex')}`;

async function seedBarTeam(
  world: BarWorld,
  user: TestUser,
  name: string,
  season: string,
): Promise<BarTeam> {
  const { teamId } = (await convexRun('testing:seedTeam', {
    organizationSlug: world.tenant.slug,
    leagueSlug: SUNDAY_SLUG,
    seasonSlug: season,
    name,
    captainEmail: user.email,
  })) as { teamId: string };
  return { teamId, name };
}

interface BarPage {
  name: string;
  path: string;
  loading: string;
  loaded: string;
  tab: string;
  held?: string[];
  unknown?: string;
  noAccessBar?: string;
  failingQuery?: string;
}

function barPages(world: BarWorld, team: BarTeam): BarPage[] {
  const { base, tenant } = world;
  const ORG = tenant.name;
  const registerSeason = `/app/register/${tenant.slug}/${SUNDAY_SLUG}/${SUMMER_SLUG}`;
  const ADMIN_QUERY = 'organizations:getAdminContext';
  const section = (name: string, path: string): BarPage => ({
    name: `admin ${name}`,
    path: `${base}/${path}`,
    loading: name,
    loaded: name,
    tab: `${name} | ${ORG} | ${SITE}`,
    held: [ADMIN_QUERY],
    unknown: `/app/organizations/no-such-org/${path}`,
    noAccessBar: 'You can’t manage this organization',
    failingQuery: ADMIN_QUERY,
  });
  return [
    {
      name: 'Home',
      path: '/app',
      loading: 'Home',
      loaded: 'Home',
      tab: `Home | ${SITE}`,
      held: ['teams:listMine'],
    },
    {
      name: 'Account settings',
      path: '/app/account',
      loading: 'Account settings',
      loaded: 'Account settings',
      tab: `Account settings | ${SITE}`,
      held: ['users:me'],
    },
    {
      name: 'Notifications',
      path: '/app/notifications',
      loading: 'Notifications',
      loaded: 'Notifications',
      tab: `Notifications | ${SITE}`,
    },
    {
      name: 'Create an organization',
      path: '/app/organizations/new',
      loading: 'Create an organization',
      loaded: 'Create an organization',
      tab: `Create an organization | ${SITE}`,
    },
    section('Leagues', 'leagues'),
    section('Tournaments', 'tournaments'),
    section('Camps', 'camps'),
    section('Locations', 'locations'),
    section('Staff', 'staff'),
    section('Details', 'details'),
    {
      name: 'league',
      path: `${base}/leagues/${SUNDAY_SLUG}`,
      loading: 'League',
      loaded: SUNDAY,
      tab: `${SUNDAY} | ${ORG} | ${SITE}`,
      held: ['leagues:getOrganizerContext'],
      unknown: `${base}/leagues/no-such-league`,
      noAccessBar: 'No access',
      failingQuery: 'leagues:getOrganizerContext',
    },
    {
      name: 'season',
      path: `${base}/leagues/${SUNDAY_SLUG}/seasons/${SUMMER_SLUG}`,
      loading: 'Season',
      loaded: SUMMER,
      tab: `${SUMMER} | ${SUNDAY} | ${SITE}`,
      held: ['seasons:getOrganizerView'],
      unknown: `${base}/leagues/${SUNDAY_SLUG}/seasons/no-such-season`,
      noAccessBar: 'No access',
      failingQuery: 'seasons:getOrganizerView',
    },
    {
      name: 'camp',
      path: `${base}/camps/${CAMP_SLUG}`,
      loading: 'Camp',
      loaded: CAMP,
      tab: `${CAMP} | ${ORG} | ${SITE}`,
      held: ['camps:getForManagement'],
      unknown: `${base}/camps/no-such-camp`,
      noAccessBar: 'No access',
      failingQuery: 'camps:getForManagement',
    },
    {
      name: 'tournament',
      path: `${base}/tournaments/${OPEN_SLUG}`,
      loading: 'Tournament',
      loaded: OPEN,
      tab: `${OPEN} | ${ORG} | ${SITE}`,
      held: ['tournaments:getForManagement'],
      unknown: `${base}/tournaments/no-such-tournament`,
      noAccessBar: 'No access',
      failingQuery: 'tournaments:getForManagement',
    },
    {
      name: 'team',
      path: `/app/teams/${team.teamId}`,
      loading: 'Team',
      loaded: team.name,
      tab: `${team.name} | ${SITE}`,
      held: ['teams:getForMember'],
      unknown: '/app/teams/no-such-team',
      noAccessBar: 'No access',
      failingQuery: 'teams:getForMember',
    },
    {
      name: 'register a team (season)',
      path: `${registerSeason}/team`,
      loading: 'Register a team',
      loaded: 'Register a team',
      tab: `Register a team | ${SUMMER} | ${SITE}`,
      held: ['seasons:getForRegistration'],
      unknown: `/app/register/${tenant.slug}/${SUNDAY_SLUG}/no-such-season/team`,
      failingQuery: 'seasons:getForRegistration',
    },
    {
      name: 'register as a free agent',
      path: `${registerSeason}/free-agent`,
      loading: 'Register as a free agent',
      loaded: 'Register as a free agent',
      tab: `Register as a free agent | ${SUMMER} | ${SITE}`,
      held: ['seasons:getForRegistration'],
      unknown: `/app/register/${tenant.slug}/${SUNDAY_SLUG}/no-such-season/free-agent`,
      failingQuery: 'seasons:getForRegistration',
    },
    {
      name: 'register a team (tournament)',
      path: `${base}/tournaments/${OPEN_SLUG}/register`,
      loading: 'Register a team',
      loaded: 'Register a team',
      tab: `Register a team | ${OPEN} | ${SITE}`,
      held: ['tournaments:getForRegistration'],
      unknown: `${base}/tournaments/no-such-tournament/register`,
      failingQuery: 'tournaments:getForRegistration',
    },
    {
      name: 'register for a camp session',
      path: `${base}/camps/${CAMP_SLUG}/register?session=${world.sessionIds['Week 1']}`,
      loading: 'Register for a camp session',
      loaded: 'Register for Week 1',
      tab: `Register for Week 1 | ${CAMP} | ${SITE}`,
      held: ['campRegistrations:getForRegistration'],
      unknown: `${base}/camps/no-such-camp/register?session=${world.sessionIds['Week 1']}`,
      failingQuery: 'campRegistrations:getForRegistration',
    },
    {
      name: '/app not-found',
      path: '/app/nothing-here',
      loading: 'Page not found',
      loaded: 'Page not found',
      tab: `Page not found | ${SITE}`,
    },
  ];
}

const slimBar = (page: Page) => page.locator('header');
const barText = (page: Page) => slimBar(page).locator('p');
const firstPart = (title: string) => title.split(' | ')[0];

async function expectBarToMatchTab(page: Page, expected: string, label: string): Promise<void> {
  await expect(barText(page), label).toHaveText(expected);
  expect(firstPart(await page.title()), label).toBe(expected);
}

barTest.describe('the slim bar names the page', () => {
  barTest.describe('at 360px on a touch screen', () => {
    barTest.skip(({ isMobile }) => !isMobile, 'the slim bar runs at phone widths only');
    barTest.slow();

    barTest('each loaded page shows the first part of its tab title', async ({ page, world }) => {
      const user = await signUpAs(page, world, 'orgAdmin');
      const team = await seedBarTeam(world, user, sharks(), SUMMER_SLUG);
      for (const row of barPages(world, team)) {
        await page.goto(row.path);
        await expect(page, row.name).toHaveTitle(row.tab);
        await expect(slimBar(page), row.name).toBeVisible();
        await expectBarToMatchTab(page, row.loaded, row.name);
      }
    });

    barTest(
      'the admin Overview shows the organization and keeps "Overview" in the tab',
      async ({ page, world }) => {
        await signUpAs(page, world, 'orgAdmin');
        await page.goto(world.base);
        await expect(page).toHaveTitle(`Overview | ${world.tenant.name} | ${SITE}`);
        await expect(barText(page)).toHaveText(world.tenant.name);
      },
    );

    barTest(
      'each page shows its route title while its query is held, and nothing moves when it answers',
      async ({ page, world }) => {
        const user = await signUpAs(page, world, 'orgAdmin');
        const team = await seedBarTeam(world, user, sharks(), SUMMER_SLUG);
        const rows = [
          ...barPages(world, team).filter((row) => row.held),
          {
            name: 'admin Overview',
            path: world.base,
            loading: 'Overview',
            loaded: world.tenant.name,
            tab: `Overview | ${world.tenant.name} | ${SITE}`,
            held: ['organizations:getAdminContext'],
          },
        ];
        for (const row of rows) {
          const held = await page.context().newPage();
          const query = await holdQueries(held, row.held ?? []);
          await held.goto(row.path);
          await expect.poll(() => query.isHolding(), row.name).toBe(true);
          await expectBarToMatchTab(held, row.loading, row.name);
          const before = {
            bar: (await slimBar(held).boundingBox())!,
            main: (await held.getByRole('main').boundingBox())!,
          };

          query.release();
          await expect(held, row.name).toHaveTitle(row.tab);
          await expect(barText(held), row.name).toHaveText(row.loaded);
          const after = {
            bar: (await slimBar(held).boundingBox())!,
            main: (await held.getByRole('main').boundingBox())!,
          };
          expect(after.bar.height, row.name).toBe(56);
          expect(before.bar.height, row.name).toBe(56);
          expect(after.main.y, row.name).toBe(before.main.y);
          await held.close();
        }
      },
    );

    barTest(
      'an unknown address shows "Page not found" in the bar, on every page that has the view',
      async ({ page, world }) => {
        await signUpAs(page, world, 'orgAdmin');
        for (const row of barPages(world, { teamId: 'unused', name: '' }).filter(
          (r) => r.unknown,
        )) {
          await page.goto(row.unknown!);
          await expect(
            page.getByRole('heading', { level: 1, name: 'Page not found' }),
            row.name,
          ).toBeVisible();
          await expectBarToMatchTab(page, 'Page not found', row.name);
        }
      },
    );

    barTest(
      'a signed-in person with no access sees the no-access text in the bar',
      async ({ page, world }) => {
        await signUpAs(page, world, null);
        const captain = await seedUser(newUser('Captain'));
        const team = await seedBarTeam(world, captain, sharks(), SUMMER_SLUG);
        for (const row of barPages(world, team).filter((r) => r.noAccessBar)) {
          await page.goto(row.path);
          await expect(page, row.name).toHaveTitle(`${row.noAccessBar} | ${SITE}`);
          await expectBarToMatchTab(page, row.noAccessBar!, row.name);
        }
      },
    );

    barTest(
      'a failed query shows "Temporarily unavailable" in the bar',
      async ({ page, world }) => {
        const user = await signUpAs(page, world, 'orgAdmin');
        const team = await seedBarTeam(world, user, sharks(), SUMMER_SLUG);
        for (const row of barPages(world, team).filter((r) => r.failingQuery)) {
          const failing = await page.context().newPage();
          await failFirstAnswer(failing, row.failingQuery!);
          await failing.goto(row.path);
          await expect(failing, row.name).toHaveTitle(`Temporarily unavailable | ${SITE}`);
          await expectBarToMatchTab(failing, 'Temporarily unavailable', row.name);
          await failing.close();
        }
      },
    );

    barTest(
      'a loaded league page that goes offline keeps the league name and shows the offline note under it',
      async ({ page, context, world }) => {
        await signUpAs(page, world, 'orgAdmin');
        await page.goto(`${world.base}/leagues/${SUNDAY_SLUG}`);
        await expect(barText(page)).toHaveText(SUNDAY);
        await context.setOffline(true);
        const note = page.locator('app-offline-note [data-offline-note]');
        await expect(note).toBeVisible({ timeout: 10_000 });
        await expect(barText(page)).toHaveText(SUNDAY);
        const noteBox = (await note.boundingBox())!;
        expect(noteBox.y).toBeGreaterThanOrEqual((await slimBar(page).boundingBox())!.height);
        await context.setOffline(false);
      },
    );

    barTest(
      'names that reach the length limits stay on one line in a 56px bar, and the page does not scroll sideways at 320px',
      async ({ page, world }) => {
        const user = await signUpAs(page, world, 'orgAdmin');
        const longTeam = await seedBarTeam(world, user, LONG_TEAM, LONG_SEASON_SLUG);
        const longs: [string, string][] = [
          [`${world.base}/leagues/${SUNDAY_SLUG}/seasons/${LONG_SEASON_SLUG}`, LONG_SEASON],
          [`/app/teams/${longTeam.teamId}`, LONG_TEAM],
          [
            `${world.base}/camps/${CAMP_SLUG}/register?session=${world.sessionIds[LONG_SESSION]}`,
            `Register for ${LONG_SESSION}`,
          ],
        ];
        for (const [path, text] of longs) {
          await page.goto(path);
          await expect(barText(page), path).toHaveText(text);
          const bar = await barText(page).evaluate((element) => ({
            height: element.getBoundingClientRect().height,
            lineHeight: parseFloat(getComputedStyle(element).lineHeight),
            overflow: getComputedStyle(element).textOverflow,
            clipped: element.scrollWidth > element.clientWidth,
          }));
          expect(bar.height, path).toBeLessThanOrEqual(bar.lineHeight);
          expect(bar.overflow, path).toBe('ellipsis');
          expect(bar.clipped, path).toBe(true);
          expect((await slimBar(page).boundingBox())!.height, path).toBe(56);
          await expectAccessible(page);
        }
      },
    );

    barTest('reads the text the mockups draw at 360px', async ({ page, world }) => {
      const barTextsOf = async (file: string, id: string): Promise<string[]> => {
        const html = await readFile(join(process.cwd(), 'design', 'mockups', file), 'utf8');
        const start = html.indexOf(`<section id="${id}"`);
        const end = html.indexOf('\n      <section id="', start + 1);
        const section = html.slice(start, end === -1 ? undefined : end);
        return [
          ...section.matchAll(
            /<p class="min-w-0 flex-1 truncate text-sm font-semibold">([^<]*)<\/p>/g,
          ),
        ].map((match) => match[1].replaceAll('&amp;', '&'));
      };
      await signUpAs(page, world, 'orgAdmin');
      const drawn: [file: string, id: string, path: string, text: string][] = [
        ['300-public-site-league-form.html', 'create', `${world.base}/leagues`, 'Leagues'],
        [
          '300-public-site-league-form.html',
          'edit',
          `${world.base}/leagues/${SUNDAY_SLUG}`,
          SUNDAY,
        ],
        ['300-public-site-dashboard.html', 'home-after', '/app', 'Home'],
        ['300-public-site-dashboard.html', 'admin-after', world.base, GULF],
      ];
      for (const [file, id, path, text] of drawn) {
        expect(await barTextsOf(file, id), `${file} ${id}`).toContain(text);
        await page.goto(path);
        // The seeded organization's name carries a suffix that keeps its address unique.
        const shown = barText(page);
        if (text === GULF) await expect(shown, `${file} ${id}`).toContainText(text);
        else await expect(shown, `${file} ${id}`).toHaveText(text);
      }
    });
  });

  barTest.describe('at 1280px with a mouse', () => {
    barTest.skip(({ isMobile }) => isMobile, 'the desktop run has no touch screen');
    barTest.slow();

    barTest(
      'the slim bar is hidden and the tab title is as drawn on every page',
      async ({ page, world }) => {
        const user = await signUpAs(page, world, 'orgAdmin');
        const team = await seedBarTeam(world, user, sharks(), SUMMER_SLUG);
        for (const row of barPages(world, team)) {
          await page.goto(row.path);
          await expect(page, row.name).toHaveTitle(row.tab);
          await expect(slimBar(page), row.name).toBeHidden();
          await expect(slimBar(page), row.name).toHaveClass(/lg:hidden/);
        }
        await page.goto(world.base);
        await expect(page).toHaveTitle(`Overview | ${world.tenant.name} | ${SITE}`);
      },
    );
  });
});
