// Public organization page (#60): `/organizations/:orgSlug`, rendered on the server from
// `organizations:getPublicPage`, with its sidebar in the app shell (#75) and a live subscription
// after hydration. Each test that seeds its own tenant (ADR 0005) needs the local Convex backend
// and is skipped with E2E_BASE_URL set; the unknown-slug tests also run against a preview.
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expectAccessible, tabKey } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { rawGet } from './support/raw-get';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { numberedLocations, seedTenant, SPORT_NAMES, type Tenant } from './support/tenant';

const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
const ORIGIN = new URL(baseURL).origin;

const NO_SEED = 'E2E_BASE_URL is set: no local Convex backend to seed a tenant';

const isDesktop = (testInfo: TestInfo) => testInfo.project.name === 'chromium-desktop';
const isWebKit = (page: Page) => page.context().browser()?.browserType().name() === 'webkit';

/** The two-location, two-league tenant of the raw-HTML criteria, with two different sports. */
function smallTenant(): Promise<Tenant> {
  return seedTenant({
    locations: [
      { name: 'Beta Courts', address: '2 Beta Street, Corpus Christi, TX 78402' },
      { name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' },
    ],
    leagues: [
      { name: 'Beta League', sport: 'beachVolleyball', locations: ['Beta Courts', 'Alpha Field'] },
      { name: 'Alpha League', sport: 'soccer', locations: ['Alpha Field'] },
    ],
  });
}

/**
 * Two leagues and ten locations: the last location's row starts below the fold at 1280x720 and at
 * 360x800 (asserted by the tests that use it).
 */
function tallTenant(): Promise<Tenant> {
  return seedTenant({
    locations: numberedLocations(10),
    leagues: [
      { name: 'Alpha League', sport: 'soccer', locations: ['Location 01'] },
      { name: 'Beta League', sport: 'softball', locations: ['Location 02', 'Location 03'] },
    ],
  });
}

function metaContent(html: string, property: string): string | undefined {
  const tag = new RegExp(`<meta\\b[^>]*\\bproperty="${property}"[^>]*>`).exec(html)?.[0];
  return tag ? /\bcontent="([^"]*)"/.exec(tag)?.[1] : undefined;
}

function canonicalHrefs(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*\brel="canonical"[^>]*>/g)].map(
    ([tag]) => /\bhref="([^"]*)"/.exec(tag)?.[1] ?? '',
  );
}

/** The sidebar `<nav>` element's HTML, from its start tag to its end tag. */
function sidebarHtml(html: string, name: string): string {
  const start = new RegExp(`<nav\\b[^>]*\\baria-label="${name}"[^>]*>`).exec(html);
  expect(start, `<nav aria-label="${name}">`).not.toBeNull();
  const from = start?.index ?? 0;
  return html.slice(from, html.indexOf('</nav>', from) + '</nav>'.length);
}

const hrefs = (html: string) => [...html.matchAll(/\bhref="([^"]*)"/g)].map(([, href]) => href);

/** Waits for the dev-mode hydration log, so the live subscription is open. */
async function hydrated(consoleGuard: { hydrated: boolean }): Promise<void> {
  await expect
    .poll(() => consoleGuard.hydrated, {
      message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
    })
    .toBe(true);
}

/** Top of `row` relative to the viewport, the header's bottom edge, and the viewport height. */
function rowPosition(row: Locator) {
  return row.evaluate((el) => ({
    top: el.getBoundingClientRect().top,
    headerBottom: document.querySelector('header')?.getBoundingClientRect().bottom ?? 0,
    viewport: window.innerHeight,
  }));
}

const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

/**
 * Activates a control the way a phone user does: a tap at its coordinates in Chromium, and the
 * keyboard in WebKit, where a tap does not focus a button (#78's tester note).
 */
async function activate(page: Page, control: Locator): Promise<void> {
  if (isWebKit(page)) {
    await control.focus();
    await page.keyboard.press('Enter');
    return;
  }
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  if (!box) throw new Error('control has no box');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('organization page: raw server HTML', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test('200 with the public Cache-Control, content, meta, sidebar links, row ids, and tiles; ?ott= changes nothing', async ({
    request,
  }) => {
    const tenant = await smallTenant();
    const canonical = `${ORIGIN}${tenant.path}`;

    for (const query of ['', '?ott=x']) {
      const path = `${tenant.path}${query}`;
      const { status, headers, html } = await fetchRawHtml(request, path);
      expect(status, path).toBe(200);
      // Netlify removes the spaces after the commas.
      expect(headers['cache-control']?.replace(/\s+/g, ''), path).toBe(
        PUBLIC_PAGE_CACHE.replace(/\s+/g, ''),
      );
      expect(headers['content-type'], path).toContain('text/html');

      // Content: the h1, both locations with addresses, both leagues with sport display names.
      expect(html.match(/<h1\b/g), path).toHaveLength(1);
      expect(html, path).toMatch(new RegExp(`<h1\\b[^>]*>\\s*${tenant.name}\\s*</h1>`));
      for (const location of tenant.locations) {
        expect(html, path).toContain(`>${location.name}</h3>`);
        expect(html, path).toMatch(new RegExp(`>\\s*${location.address}\\s*<`));
      }
      for (const league of tenant.leagues) {
        expect(html, path).toContain(`>${league.name}</h3>`);
        expect(html, path).toMatch(new RegExp(`>\\s*${SPORT_NAMES[league.sport]}\\s*</span>`));
      }

      // Meta, from the query result; og:url and the canonical carry no query string.
      expect(html, path).toContain(`<title>${tenant.name} | Omni League</title>`);
      expect(metaContent(html, 'og:title'), path).toBe(tenant.name);
      expect(metaContent(html, 'og:description'), path).toBe(
        `Leagues and locations of ${tenant.name} on Omni League.`,
      );
      expect(metaContent(html, 'og:type'), path).toBe('website');
      expect(metaContent(html, 'og:url'), path).toBe(canonical);
      expect(canonicalHrefs(html), path).toEqual([canonical]);

      // Sidebar: one link per league and location, built from the slug, and no id inside.
      const nav = sidebarHtml(html, tenant.name);
      expect(nav, path).not.toMatch(/\sid="/);
      expect(nav, path).not.toContain('aria-labelledby');
      expect(hrefs(nav), path).toEqual([
        tenant.path,
        `${tenant.path}#league-1`,
        `${tenant.path}#league-2`,
        `${tenant.path}#location-1`,
        `${tenant.path}#location-2`,
      ]);
      for (const id of ['league-1', 'league-2', 'location-1', 'location-2']) {
        expect(html.split(nav).join(''), `${path} #${id}`).toMatch(new RegExp(`\\sid="${id}"`));
      }

      // Tiles: 2 leagues, 2 locations, 2 distinct sports.
      expect(
        [...html.matchAll(/<dd\b[^>]*>\s*(\d+)\s*<\/dd>/g)].map(([, n]) => n),
        path,
      ).toEqual(['2', '2', '2']);

      // The query string never reaches the cacheable HTML (PR #90).
      expect(html, path).not.toContain('ott');
    }
  });
});

test.describe('organization page in the browser', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test('hydrates with no console error and passes the axe helper; the sidebar link jumps to its row (1280) or the menu button shows (360)', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const tenant = await tallTenant();
    await page.goto(tenant.path);
    await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible();
    await hydrated(consoleGuard);
    await expect(page).toHaveTitle(`${tenant.name} | Omni League`);

    const sidebarColumn = page.locator('main').locator('xpath=preceding-sibling::div[1]');
    const menuButton = page.getByRole('button', { name: 'Open navigation' });
    const nav = page.getByRole('navigation', { name: tenant.name });

    if (!isDesktop(testInfo)) {
      // 360: the column is hidden, the menu button shows, and the Tab order follows the DOM.
      await expect(sidebarColumn).toBeHidden();
      await expect(menuButton).toBeVisible();
      await expectAccessible(page, {
        expectedOrder: [
          'a[href$="#main"]',
          'header button[aria-label="Open navigation"]',
          'header a[href="/"]',
        ],
      });
      return;
    }

    // 1280: the sidebar column shows, 256px wide, with no menu button.
    await expect(nav).toBeVisible();
    await expect(menuButton).toBeHidden();
    expect((await sidebarColumn.boundingBox())?.width).toBe(256);
    // The league and location icons are muted, as in the mockup: the colour utility on <ng-icon>
    // wins over ng-icon's own layer (src/styles.css). The eyebrow above the h1 is muted too.
    const muted = await page
      .getByRole('main')
      .getByText('Organization', { exact: true })
      .evaluate((el) => getComputedStyle(el).color);
    for (const group of ['Leagues', 'Locations']) {
      const icon = nav.locator(`ul[aria-label="${group}"] ng-icon`).first();
      expect(await icon.evaluate((el) => getComputedStyle(el).color), group).toBe(muted);
    }

    await expectAccessible(page, {
      expectedOrder: [
        'a[href$="#main"]',
        'header a[href="/"]',
        'nav a[aria-current="page"]',
        ...tenant.leagues.map((_, i) => `nav a[href="${tenant.path}#league-${i + 1}"]`),
        ...tenant.locations.map((_, i) => `nav a[href="${tenant.path}#location-${i + 1}"]`),
      ],
    });

    // The last location's row starts below the fold; its sidebar link jumps to it on this page.
    const last = tenant.locations.length;
    const row = page.locator(`main #location-${last}`);
    await expect(row.locator('h3')).toHaveText(tenant.locations[last - 1].name);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      (window as Window & { e2eNoReload?: boolean }).e2eNoReload = true;
    });
    await expect.poll(() => scrollY(page)).toBe(0);
    const before = await rowPosition(row);
    expect(before.top).toBeGreaterThanOrEqual(before.viewport);
    const scrollBefore = await scrollY(page);

    await nav.locator(`a[href="${tenant.path}#location-${last}"]`).click();

    await expect.poll(() => scrollY(page)).toBeGreaterThan(scrollBefore);
    const after = await rowPosition(row);
    expect(after.top).toBeGreaterThanOrEqual(after.headerBottom);
    expect(after.top).toBeLessThan(after.viewport);
    expect(new URL(page.url()).pathname).toBe(tenant.path);
    expect(new URL(page.url()).hash).toBe(`#location-${last}`);
    expect(
      await page.evaluate(() => (window as Window & { e2eNoReload?: boolean }).e2eNoReload),
    ).toBe(true);
  });

  test('phone sheet (360): 288px, focus on Close, Tab trapped, closes without moving the page, and its link jumps to the row', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(isDesktop(testInfo), 'the phone sheet runs at 360px only');
    const tenant = await tallTenant();
    await page.goto(tenant.path);
    await hydrated(consoleGuard);

    const menuButton = page.getByRole('button', { name: 'Open navigation' });
    const dialog = page.getByRole('dialog', { name: 'Navigation' });
    // The dialog container has no box of its own: the helm sheet content inside is fixed.
    const sheet = dialog.locator('[data-slot="sheet-content"]');
    const close = dialog.getByRole('button', { name: 'Close navigation' });
    const tab = tabKey(page);

    async function openSheet(): Promise<void> {
      await activate(page, menuButton);
      await expect(sheet).toBeVisible();
      await expect(close).toBeFocused();
    }

    // Closing by Escape, Close, or the scrim leaves the scrolled page where it was, with focus
    // back on the menu button (#78's top bar scroll margin).
    await page.evaluate(() => {
      window.scrollTo(0, 300);
    });
    await expect.poll(() => scrollY(page)).toBe(300);
    const closers: [string, () => Promise<void>][] = [
      ['Escape', () => page.keyboard.press('Escape')],
      ['Close', () => activate(page, close)],
      ['the scrim', () => page.touchscreen.tap(340, 400)],
    ];
    for (const [how, closeSheet] of closers) {
      await openSheet();
      expect((await sheet.boundingBox())?.width, how).toBe(288);
      await closeSheet();
      await expect(dialog, how).toHaveCount(0);
      await expect(menuButton, how).toBeFocused();
      expect(await scrollY(page), how).toBe(300);
    }

    // Tab and Shift+Tab stay inside the open sheet.
    await openSheet();
    const insideDialog = () =>
      page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    const stops = (await dialog.locator('a[href], button').count()) + 2;
    for (const key of [tab, `Shift+${tab}`]) {
      for (let i = 0; i < stops; i++) {
        await page.keyboard.press(key);
        expect(await insideDialog(), `${key} #${i + 1}`).toBe(true);
      }
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // The sheet's link to the last location: the sheet closes, focus returns to the menu button,
    // and the page jumps to the row, which the block scroll strategy must not undo (#75).
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await expect.poll(() => scrollY(page)).toBe(0);
    const last = tenant.locations.length;
    const row = page.locator(`main #location-${last}`);
    const before = await rowPosition(row);
    expect(before.top).toBeGreaterThanOrEqual(before.viewport);
    const scrollBefore = await scrollY(page);

    await openSheet();
    await activate(page, dialog.locator(`a[href="${tenant.path}#location-${last}"]`));
    await expect(dialog).toHaveCount(0);
    await expect(menuButton).toBeFocused();
    await expect.poll(() => scrollY(page)).toBeGreaterThan(scrollBefore);
    const after = await rowPosition(row);
    expect(after.top).toBeGreaterThanOrEqual(after.headerBottom);
    expect(after.top).toBeLessThan(after.viewport);
    expect(new URL(page.url()).pathname).toBe(tenant.path);

    // At 320px the sheet is capped at the viewport minus 48px (#75).
    await page.setViewportSize({ width: 320, height: 800 });
    await openSheet();
    expect((await sheet.boundingBox())?.width).toBe(272);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test.describe('with JavaScript disabled', () => {
    test.use({ javaScriptEnabled: false });

    test('360: the menu button is present and every league and location is in the page content', async ({
      page,
    }, testInfo) => {
      test.skip(isDesktop(testInfo), 'the phone layout runs at 360px only');
      const tenant = await smallTenant();
      await page.goto(tenant.path);
      await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 3 })).toHaveText([
        ...tenant.leagues.map((league) => league.name),
        ...tenant.locations.map((location) => location.name),
      ]);
      for (const location of tenant.locations) {
        await expect(main.getByText(location.address)).toBeVisible();
      }
    });
  });

  test('a league added after load appears without a reload in its panel, sidebar group, and tile', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await smallTenant();
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    await page.evaluate(() => {
      (window as Window & { e2eNoReload?: boolean }).e2eNoReload = true;
    });
    const main = page.getByRole('main');
    await expect(main.locator('dl dd').first()).toHaveText('2');

    await convexRun('testing:addLeague', {
      organizationSlug: tenant.slug,
      name: 'Zulu League',
      sport: 'softball',
      locations: ['Beta Courts'],
    });

    await expect(main.locator('#league-3 h3')).toHaveText('Zulu League');
    await expect(main.locator('#league-3')).toContainText('Softball');
    await expect(main.locator('#league-3')).toContainText('Beta Courts');
    // The sidebar column is hidden at 360px, so not by role.
    await expect(
      page.locator(`nav[aria-label="${tenant.name}"] a[href="${tenant.path}#league-3"]`),
    ).toHaveText('Zulu League');
    await expect(main.locator('dl dd')).toHaveText(['3', '2', '3']);
    expect(
      await page.evaluate(() => (window as Window & { e2eNoReload?: boolean }).e2eNoReload),
    ).toBe(true);
  });

  test('an organization with no leagues and no locations shows the empty states, "None yet", and 0, 0, 0', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await seedTenant({ name: 'E2E Empty Org' });
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText(tenant.name);
    await expect(main.locator('dl dd')).toHaveText(['0', '0', '0']);
    await expect(main.locator('li')).toHaveCount(0);
    await expect(main.getByText('No leagues yet')).toBeVisible();
    await expect(
      main.getByText('Leagues this organization runs will be listed here.'),
    ).toBeVisible();
    await expect(main.getByText('No locations yet')).toBeVisible();
    await expect(
      main.getByText('Places where this organization plays will be listed here.'),
    ).toBeVisible();
    const nav = page.locator(`nav[aria-label="${tenant.name}"]`);
    await expect(nav.getByText('None yet', { exact: true })).toHaveCount(2);
    await expect(nav.locator('a')).toHaveCount(1); // Overview only
    await expectAccessible(page);
  });
});

test.describe('organization page: unknown slug', () => {
  test.use({ expectedDocumentStatus: 404 });

  test('raw: 404 with the public Cache-Control and the not-found view, top bar only', async ({
    request,
  }) => {
    const { status, headers, html } = await fetchRawHtml(request, '/organizations/does-not-exist');
    expect(status).toBe(404);
    expect(headers['cache-control']?.replace(/\s+/g, '')).toBe(
      PUBLIC_PAGE_CACHE.replace(/\s+/g, ''),
    );
    expect(html).toMatch(/<h1\b[^>]*>\s*Page not found\s*<\/h1>/);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<nav\b/);
    expect(html).not.toContain('aria-label="Open navigation"');
    expect(html).not.toMatch(/<link\b[^>]*rel="canonical"|property="og:/);
  });

  test('browser: the same view, with no console error', async ({ page, consoleGuard }) => {
    const response = await page.goto('/organizations/does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    if (!remoteBaseUrl) await hydrated(consoleGuard);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByRole('button')).toHaveCount(0);
    await expect(page).toHaveTitle('Page not found | Omni League');
  });
});

// A query string the router cannot decode (`?ref=%`, a truncated tracking link) renders the page
// as if there were none (#91). Not a redirect: Netlify copies the query string into a Location
// without one, so it would loop (PR #105). Against a preview it uses the demo organization.
test.describe('organization page: undecodable query string', () => {
  test('raw: the same page, cacheable, with no query string in the HTML', RAW_HTTP, async () => {
    const path = remoteBaseUrl
      ? '/organizations/gulf-coast-sport-social'
      : (await smallTenant()).path;
    const h1 = (html: string) => /<h1\b[^>]*>[^<]*<\/h1>/.exec(html)?.[0];
    const bare = await rawGet(path);
    expect(bare.status).toBe(200);
    expect(h1(bare.body)).not.toMatch(/Omni League|Page not found/);

    for (const query of ['?ref=%', '?q=%E0%A4%A', '?utm_source=x&ref=%']) {
      const response = await rawGet(`${path}${query}`);
      expect(response.status, query).toBe(200);
      expect(response.location, query).toBeUndefined();
      // Netlify removes the spaces after the commas.
      expect(response.headers['cache-control']?.replace(/\s+/g, ''), query).toBe(
        PUBLIC_PAGE_CACHE.replace(/\s+/g, ''),
      );
      expect(response.headers['netlify-vary'], query).toBe('query');
      expect(h1(response.body), query).toBe(h1(bare.body));
      for (const echo of ['ref=%', 'utm_source', '%E0%A4%A']) {
        expect(response.body, query).not.toContain(echo);
      }
    }
  });
});

// ADR 0005: each test seeds its own tenant and sees only its own data, whatever else the shared
// backend holds (other tests' tenants run in parallel).
test.describe('tenant isolation', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  for (const label of ['first', 'second']) {
    test(`the ${label} tenant's page shows only its own leagues and locations`, async ({
      page,
    }) => {
      const tenant = await seedTenant({
        name: `E2E Isolation ${label}`,
        locations: [{ name: `Field ${label}`, address: `1 ${label} Road` }],
        leagues: [{ name: `League ${label}`, sport: 'soccer', locations: [`Field ${label}`] }],
      });
      await page.goto(tenant.path);
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 1 })).toHaveText(tenant.name);
      await expect(main.getByRole('heading', { level: 3 })).toHaveText([
        `League ${label}`,
        `Field ${label}`,
      ]);
      // The sidebar column is hidden at 360px, so not by role.
      await expect(page.locator(`nav[aria-label="${tenant.name}"] a`)).toHaveText([
        'Overview',
        `League ${label}`,
        `Field ${label}`,
      ]);
    });
  }
});
