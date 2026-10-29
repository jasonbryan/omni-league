import type { Page } from '@playwright/test';
import { PAGE_LOAD_WAIT_MS } from '../src/app/public-layout/page-load-wait-ms';
import { tabWalk } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { signUp } from './support/session';
import { dateFromToday, seedSeasons, seedTenant, type Tenant } from './support/tenant';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const GOOD_CLS = 0.1;
const SETTLE_AFTER_IDLE_MS = 1_000;
const SKELETONS = ['organization-skeleton', 'league-skeleton', 'season-skeleton'];

const footer = (page: Page) => page.getByRole('contentinfo');

interface Watch {
  e2eShift?: number;
  e2eSkeletonsAfterContent?: string[];
}

test.describe('a hard load of a public page', () => {
  test.beforeEach(({ browserName }) => {
    test.skip(browserName !== 'chromium', 'WebKit records no layout-shift entries');
  });

  async function watchLayout(page: Page): Promise<void> {
    await page.addInitScript((skeletons: string[]) => {
      const watch = window as Window & Watch;
      watch.e2eShift = 0;
      watch.e2eSkeletonsAfterContent = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        })[]) {
          if (!entry.hadRecentInput) watch.e2eShift = (watch.e2eShift ?? 0) + entry.value;
        }
      }).observe({ type: 'layout-shift', buffered: true });
      // Only a skeleton element counts, so another status region on the page cannot fail the test.
      const selector = skeletons.map((id) => `[data-testid="${id}"]`).join(',');
      new MutationObserver((records) => {
        const content = document.querySelector('main h1');
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (!(node instanceof Element) || !content) continue;
            const found = node.matches(selector) ? node : node.querySelector(selector);
            if (found)
              watch.e2eSkeletonsAfterContent?.push(found.getAttribute('data-testid') ?? '');
          }
        }
      }).observe(document, { subtree: true, childList: true });
    }, SKELETONS);
  }

  /**
   * A returning visitor's service worker answers every navigation with the client shell, so the
   * page renders in the browser with no server-rendered content to keep.
   */
  async function answerWithClientShell(page: Page, path: string): Promise<void> {
    // The fulfilled document has no address space, so Chromium would block its socket to the local backend.
    await page.context().grantPermissions(['local-network-access']);
    await page.route(`${baseURL}${path}`, async (route) => {
      if (!route.request().isNavigationRequest()) return route.fallback();
      const shell = await route.fetch({ url: `${baseURL}/index.csr.html` });
      return route.fulfill({ response: shell });
    });
  }

  async function loadAndMeasure(page: Page, path: string): Promise<number> {
    await page.goto(path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(SETTLE_AFTER_IDLE_MS);
    return page.evaluate(() => (window as Window & Watch).e2eShift ?? 0);
  }

  const skeletonsAdded = (page: Page) =>
    page.evaluate(() => (window as Window & Watch).e2eSkeletonsAfterContent ?? []);

  async function tenantWithSeason(): Promise<Tenant> {
    const tenant = await seedTenant({
      name: 'E2E Shift',
      locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
      leagues: [{ name: 'Alpha League', sport: 'soccer', locations: ['Alpha Field'] }],
    });
    await seedSeasons(tenant, 'alpha-league', [
      {
        name: 'Open Season',
        slug: 'open-season',
        startDate: dateFromToday(30),
        endDate: dateFromToday(90),
        registrationDeadline: dateFromToday(10),
      },
    ]);
    return tenant;
  }

  for (const [label, signedIn] of [
    ['signed in', true],
    ['signed out', false],
  ] as const) {
    test(`of an organization with no leagues has a layout shift below 0.1 when ${label}`, async ({
      page,
    }) => {
      const tenant = await seedTenant({ name: 'E2E Empty' });
      if (signedIn) await signUp(page, newUser());
      await watchLayout(page);
      const shift = await loadAndMeasure(page, tenant.path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(shift).toBeLessThan(GOOD_CLS);
    });

    test(`of an organization with no leagues, answered with the client shell, has a layout shift below 0.1 when ${label}`, async ({
      page,
    }) => {
      const tenant = await seedTenant({ name: 'E2E Empty' });
      if (signedIn) await signUp(page, newUser());
      await answerWithClientShell(page, tenant.path);
      await watchLayout(page);
      const shift = await loadAndMeasure(page, tenant.path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByTestId('organization-skeleton')).toHaveCount(0);
      expect(shift).toBeLessThan(GOOD_CLS);
    });
  }

  test('of the organization, league, and season pages never inserts a skeleton when signed in', async ({
    page,
  }) => {
    const tenant = await tenantWithSeason();
    await signUp(page, newUser());
    await watchLayout(page);
    const pages = [
      tenant.path,
      `${tenant.path}/leagues/alpha-league`,
      `${tenant.path}/leagues/alpha-league/seasons/open-season`,
    ];
    for (const path of pages) {
      await loadAndMeasure(page, path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await skeletonsAdded(page), path).toEqual([]);
    }
  });

  test('answered with the client shell keeps the footer out until the page has loaded', async ({
    page,
  }) => {
    const tenant = await seedTenant({ name: 'E2E Empty' });
    const held = await holdQueries(page, ['organizations:getPublicPage']);
    await answerWithClientShell(page, tenant.path);
    await page.goto(tenant.path);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(page.getByTestId('organization-skeleton')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeHidden();

    held.release();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
  });

  test('answered with the client shell shows the unavailable view and the footer after the wait for a held league query, then the page when the answer arrives', async ({
    page,
  }) => {
    const tenant = await tenantWithSeason();
    const path = `${tenant.path}/leagues/alpha-league`;
    const held = await holdQueries(page, ['leagues:getPublicPage']);
    await page.clock.install();
    await answerWithClientShell(page, path);
    await page.goto(path);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(page.getByTestId('league-skeleton')).toBeVisible();
    await expect(footer(page)).toBeHidden();
    const announcement = page.locator('main app-page-load-status [role="status"]');
    await expect(announcement).toHaveText('');

    await page.clock.fastForward(PAGE_LOAD_WAIT_MS);
    await expect(
      page.getByRole('heading', { level: 1, name: 'This page is temporarily unavailable' }),
    ).toBeVisible();
    await expect(page.getByTestId('league-skeleton')).toHaveCount(0);
    await expect(page.locator('[data-page-loading]')).toHaveCount(0);
    await expect(footer(page)).toBeVisible();
    await expect(announcement).toHaveText('This page is temporarily unavailable.');
    await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', path);

    held.release();
    await expect(page.getByRole('heading', { level: 1, name: /Alpha League/ })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: /temporarily unavailable/ }),
    ).toHaveCount(0);
    await expect(footer(page)).toBeVisible();
    await expect(announcement).toHaveText('');
  });

  test('by client-side navigation still shows the loading state when signed in', async ({
    page,
  }) => {
    const tenant = await tenantWithSeason();
    await signUp(page, newUser());
    const held = await holdQueries(page, ['leagues:getPublicPage', 'seasons:listPublic']);
    await page.goto(tenant.path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.locator(`main a[href="${tenant.path}/leagues/alpha-league"]`).click();
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(page).toHaveURL(`${baseURL}${tenant.path}/leagues/alpha-league`);
    await expect(page.getByTestId('league-skeleton')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeHidden();

    held.release();
    await expect(page.getByRole('heading', { level: 1, name: /Alpha League/ })).toBeVisible();
    await expect(page.getByTestId('league-skeleton')).toHaveCount(0);
    await expect(page.getByRole('contentinfo')).toBeVisible();
  });

  async function failQueries(page: Page, udfPaths: readonly string[]): Promise<void> {
    await page.routeWebSocket(/\/api\/[^/]+\/sync$/, (ws) => {
      const server = ws.connectToServer();
      const failing = new Set<number>();
      ws.onMessage((message) => {
        const sent = JSON.parse(String(message)) as {
          modifications?: { type: string; queryId: number; udfPath?: string }[];
        };
        for (const change of sent.modifications ?? []) {
          if (change.type === 'Add' && change.udfPath && udfPaths.includes(change.udfPath)) {
            failing.add(change.queryId);
          }
        }
        server.send(message);
      });
      server.onMessage((message) => {
        const received = JSON.parse(String(message)) as {
          modifications?: { type: string; queryId: number }[];
        };
        for (const change of received.modifications ?? []) {
          if (change.type === 'QueryUpdated' && failing.has(change.queryId)) {
            Object.assign(change, {
              type: 'QueryFailed',
              errorMessage: 'forced failure',
              logLines: [],
            });
          }
        }
        ws.send(JSON.stringify(received));
      });
    });
  }

  // A skeleton that never leaves would hide the footer for good, so each state that replaces it must show the footer.
  test.describe('a page that is not a skeleton', () => {
    test('answered with the client shell shows the footer with the not-found view', async ({
      page,
    }) => {
      const path = '/organizations/e2e-no-such-organization';
      await answerWithClientShell(page, path);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
      await expect(page.locator('[data-page-loading]')).toHaveCount(0);
      await expect(footer(page)).toBeVisible();
    });

    test.describe('when a query fails', () => {
      test('answered with the client shell shows the footer with the server-error view', async ({
        page,
      }) => {
        const tenant = await seedTenant({ name: 'E2E Failing' });
        await failQueries(page, ['organizations:getPublicPage']);
        await answerWithClientShell(page, tenant.path);
        await page.goto(tenant.path);
        await expect(
          page.getByRole('heading', { level: 1, name: 'This page is temporarily unavailable' }),
        ).toBeVisible();
        await expect(page.locator('[data-page-loading]')).toHaveCount(0);
        await expect(footer(page)).toBeVisible();
      });
    });

    test('answered with the client shell while offline with no saved copy shows the footer with the not-saved view', async ({
      page,
    }) => {
      const tenant = await seedTenant({ name: 'E2E Not Saved' });
      await page.addInitScript(() => {
        Object.defineProperty(window.navigator, 'onLine', { get: () => false });
      });
      await page.routeWebSocket(/\/api\/[^/]+\/sync$/, (ws) => void ws.close());
      await answerWithClientShell(page, tenant.path);
      await page.goto(tenant.path);
      await expect(page.locator('app-not-saved-view')).toBeVisible();
      await expect(page.locator('[data-page-loading]')).toHaveCount(0);
      await expect(footer(page)).toBeVisible();
    });

    test('a page with no skeleton shows the footer on a hard load', async ({ page }) => {
      await page.goto('/leagues');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(footer(page)).toBeVisible();
    });
  });

  test('answered with the client shell leaves the footer out of the accessibility tree while loading and reachable by keyboard once loaded', async ({
    page,
  }) => {
    const tenant = await seedTenant({ name: 'E2E Keyboard' });
    const held = await holdQueries(page, ['organizations:getPublicPage']);
    await answerWithClientShell(page, tenant.path);
    await page.goto(tenant.path);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(footer(page)).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Footer' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Find a league' })).toHaveCount(0);

    held.release();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(footer(page)).toBeVisible();
    const footerLinks = page.getByRole('navigation', { name: 'Footer' }).getByRole('link');
    await expect(footerLinks).toHaveText([
      'Find a league',
      'Your account',
      'Create an organization',
      'Sign in to manage',
    ]);
    const walk = await tabWalk(page);
    expect(walk.failures).toEqual([]);
    for (const name of ['Find a league', 'Your account', 'Create an organization']) {
      expect(
        walk.order.some((step) => step.includes(`"${name}"`)),
        name,
      ).toBe(true);
    }
    expect(walk.order.some((step) => step.includes('"Sign in to manage"'))).toBe(true);
  });
});
