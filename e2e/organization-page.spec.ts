// Public organization page (#60): `/organizations/:orgSlug`, rendered on the server from
// `organizations:getPublicPage` and page 1 of the league and location lists (#100), with its sidebar
// in the app shell (#75) and live subscriptions after hydration. Each test that seeds its own tenant (ADR 0005) needs the local Convex backend
// and is skipped with E2E_BASE_URL set; the unknown-slug tests also run against a preview.
import type { Locator, Page, TestInfo } from '@playwright/test';
import { OFFLINE_SAVED_QUERIES } from '../src/app/core/data/convex/offline-saved-queries';
import { axeScan, describeViolations, expectAccessible, tabKey } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { rawGet } from './support/raw-get';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';
import {
  numberedLocations,
  seedTenant,
  SPORT_NAMES,
  tallLeagues,
  tallLocations,
  type Tenant,
} from './support/tenant';

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
 * Five leagues of all three sports and five locations, the most a list shows (#100). The
 * Locations panel starts below the fold at 360x800 (`tallLeagues`); the tests that use it assert
 * that.
 */
function tallTenant(): Promise<Tenant> {
  return seedTenant({ locations: tallLocations(), leagues: tallLeagues() });
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

/** The text of each link of the sidebar's HTML, tags removed and white space collapsed. */
const sidebarText = (nav: string) =>
  [...nav.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map(([, inner]) =>
    inner
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );

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

/**
 * The same-path jump of #95, now the sidebar's Locations item (#114). The page is loaded as
 * `<path>?utm_source=x`; `jump` follows the Locations link. The query string stays, the fragment is
 * set, the page does not reload, the panel is in view, history grows by one entry, and Back
 * returns to the URL before the click.
 */
async function expectQueryKeepingJump(
  page: Page,
  consoleGuard: { hydrated: boolean },
  tenant: Tenant,
  jump: () => Promise<void>,
): Promise<void> {
  const search = '?utm_source=x';
  const before = `${ORIGIN}${tenant.path}${search}`;
  const id = 'locations';
  await page.goto(`${tenant.path}${search}`);
  await hydrated(consoleGuard);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    (window as Window & { e2eNoReload?: boolean }).e2eNoReload = true;
  });
  await expect.poll(() => scrollY(page)).toBe(0);
  const lengthBefore = await page.evaluate(() => history.length);

  await jump();

  await expect(page, id).toHaveURL(`${before}#${id}`);
  expect(await page.evaluate(() => history.length), `${id} history.length`).toBe(lengthBefore + 1);
  const panel = page.locator(`main #${id}`);
  await expect
    .poll(
      async () => {
        const position = await rowPosition(panel);
        return position.top >= position.headerBottom && position.top < position.viewport;
      },
      { message: `${id} is scrolled into view` },
    )
    .toBe(true);
  expect(
    await page.evaluate(() => (window as Window & { e2eNoReload?: boolean }).e2eNoReload),
    `${id} no reload`,
  ).toBe(true);

  await page.goBack();
  await expect(page, `${id} Back`).toHaveURL(before);
  expect(
    await page.evaluate(() => (window as Window & { e2eNoReload?: boolean }).e2eNoReload),
    `${id} no reload after Back`,
  ).toBe(true);
}

test.describe('organization page: raw server HTML', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test(
    '200 with the public Cache-Control, content, meta, sidebar links, row ids, and tiles; a query string changes nothing',
    RAW_HTTP,
    async ({ request }) => {
      const tenant = await smallTenant();
      const canonical = `${ORIGIN}${tenant.path}`;

      for (const query of ['', '?ott=x', '?utm_source=x']) {
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
          expect(html, path).toMatch(new RegExp(`<h3\\b[^>]*>\\s*<a\\b[^>]*>${league.name}</a>`));
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

        // Sidebar (#114): Overview (current), one link per sport with leagues (beach volleyball
        // and soccer, not softball) and Locations, built from the slug, with no id inside and no
        // link to a league or a location.
        const nav = sidebarHtml(html, tenant.name);
        expect(nav, path).not.toMatch(/\sid="/);
        expect(nav, path).not.toContain('aria-labelledby');
        expect(hrefs(nav), path).toEqual([
          tenant.path,
          `${tenant.path}/sports/beach-volleyball`,
          `${tenant.path}/sports/soccer`,
          `${tenant.path}#locations`,
        ]);
        expect(nav, path).toMatch(/<a\b[^>]*aria-current="page"[^>]*>[\s\S]*?Overview<\/span>/);
        expect(nav.match(/aria-current=/g), path).toHaveLength(1);
        expect(sidebarText(nav), path).toEqual([
          'Overview',
          'Beach volleyball 1 league',
          'Soccer 1 league',
          'Locations 2 locations',
        ]);
        expect(nav, path).not.toContain('Softball');
        for (const league of tenant.leagues) expect(nav, path).not.toContain(league.name);
        for (const location of tenant.locations) expect(nav, path).not.toContain(location.name);
        // The panels' rows keep their ids and `#locations` names the panel.
        const content = html.split(nav).join('');
        for (const id of ['league-1', 'league-2', 'location-1', 'location-2', 'locations']) {
          expect(content, `${path} #${id}`).toMatch(new RegExp(`\\sid="${id}"`));
        }

        // Tiles: 2 leagues, 2 locations, 2 distinct sports.
        expect(
          [...html.matchAll(/<dd\b[^>]*>\s*(\d+)\s*<\/dd>/g)].map(([, n]) => n),
          path,
        ).toEqual(['2', '2', '2']);

        // The query string never reaches the cacheable HTML (PR #90).
        if (query) expect(html, path).not.toContain(query.slice(1));
      }
    },
  );
});

// #100: each list shows its first 5 rows by name, and the tiles show the totals.
test.describe('organization page: more than 5 rows per list', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test(
    'raw: 5 league rows, 5 location rows, totals in the tiles, a sidebar of sports and one Locations item',
    RAW_HTTP,
    async ({ request }) => {
      // 13 of each, in one call, with leagues of two sports. "League 01" to "League 05", the
      // leagues shown, are at "Location 13" to "Location 09", none of the locations shown.
      const locations = numberedLocations(13);
      const tenant = await seedTenant({
        locations,
        leagues: Array.from({ length: 13 }, (_, i) => ({
          name: `League ${String(i + 1).padStart(2, '0')}`,
          sport: i % 2 ? ('soccer' as const) : ('softball' as const),
          locations: [locations[12 - i].name],
        })),
      });
      const { status, headers, html } = await fetchRawHtml(request, `${tenant.path}?utm_source=x`);
      expect(status).toBe(200);
      // Netlify removes the spaces after the commas.
      expect(headers['cache-control']?.replace(/\s+/g, '')).toBe(
        PUBLIC_PAGE_CACHE.replace(/\s+/g, ''),
      );

      const nav = sidebarHtml(html, tenant.name);
      const content = html.split(nav).join('');
      const shownLeagues = tenant.leagues.slice(0, 5);
      const shownLocations = tenant.locations.slice(0, 5);
      // Exactly the first 5 of each list, in name order.
      expect(
        [...content.matchAll(/\sid="(league|location)-(\d+)"/g)].map(
          ([, kind, n]) => `${kind}-${n}`,
        ),
      ).toEqual([
        ...[1, 2, 3, 4, 5].map((n) => `league-${n}`),
        ...[1, 2, 3, 4, 5].map((n) => `location-${n}`),
      ]);
      expect(
        // A league's name is a link (#127); a location's is plain text.
        [...content.matchAll(/<h3\b[^>]*>\s*(?:<a\b[^>]*>)?([^<]*)/g)].map(([, name]) =>
          name.trim(),
        ),
      ).toEqual([
        ...shownLeagues.map((league) => league.name),
        ...shownLocations.map((location) => location.name),
      ]);
      for (const hidden of [tenant.leagues[5], tenant.locations[5]]) {
        expect(content).not.toContain(`>${hidden.name}</h3>`);
        expect(content).not.toContain(`>${hidden.name}</a>`);
      }
      // A league shows its location's name though that location is not among the 5 shown.
      expect(content).toContain(`${tenant.leagues[0].locations[0]}<`);

      // Tiles: the totals, not the rows shown.
      expect([...html.matchAll(/<dd\b[^>]*>\s*(\d+)\s*<\/dd>/g)].map(([, n]) => n)).toEqual([
        '13',
        '13',
        '2',
      ]);

      // Sidebar (#114): the sports with their league counts (soccer 6, softball 7, the leagues of
      // the whole organization, not the 5 shown) and one Locations item with the total; no link
      // to a row.
      expect(hrefs(nav)).toEqual([
        tenant.path,
        `${tenant.path}/sports/soccer`,
        `${tenant.path}/sports/softball`,
        `${tenant.path}#locations`,
      ]);
      expect(sidebarText(nav)).toEqual([
        'Overview',
        'Soccer 6 leagues',
        'Softball 7 leagues',
        'Locations 13 locations',
      ]);

      // The query string never reaches the cacheable HTML (PR #90).
      expect(html).not.toContain('utm_source');
    },
  );
});

test.describe('organization page in the browser', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test('hydrates with no console error and passes the axe helper; the Locations item jumps to its panel (1280) or the menu button shows (360)', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const tenant = await tallTenant();
    await page.goto(tenant.path);
    await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible();
    await hydrated(consoleGuard);
    await expect(page).toHaveTitle(`${tenant.name} | Omni League`);

    // The league names in the content link to their public pages (#127), after the sidebar's links.
    const leagueLinks = tenant.leagues.map(
      (league) =>
        `main a[href="${tenant.path}/leagues/${league.name.toLowerCase().replaceAll(' ', '-')}"]`,
    );
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
          'header a[href^="/sign-in"]',
          // Each league's name links to its page (#127): the first focusable controls of the content.
          ...leagueLinks,
        ],
      });
      return;
    }

    // 1280: the sidebar column shows, 256px wide, with no menu button.
    await expect(nav).toBeVisible();
    await expect(menuButton).toBeHidden();
    expect((await sidebarColumn.boundingBox())?.width).toBe(256);
    // The sport and location icons are muted, as in the mockup: the colour utility on <ng-icon>
    // wins over ng-icon's own layer (src/styles.css). The eyebrow above the h1 is muted too.
    const muted = await page
      .getByRole('main')
      .getByText('Organization', { exact: true })
      .evaluate((el) => getComputedStyle(el).color);
    const sportIcon = nav.locator('ul[aria-label="Sports"] ng-icon').first();
    expect(await sportIcon.evaluate((el) => getComputedStyle(el).color)).toBe(muted);
    const locationsIcon = nav.locator(`a[href="${tenant.path}#locations"] ng-icon`);
    expect(await locationsIcon.evaluate((el) => getComputedStyle(el).color)).toBe(muted);

    await expectAccessible(page, {
      expectedOrder: [
        'a[href$="#main"]',
        'header a[href="/"]',
        'header a[href^="/sign-in"]',
        'nav a[aria-current="page"]',
        `nav a[href="${tenant.path}/sports/beach-volleyball"]`,
        `nav a[href="${tenant.path}/sports/soccer"]`,
        `nav a[href="${tenant.path}/sports/softball"]`,
        `nav a[href="${tenant.path}#locations"]`,
        ...leagueLinks,
      ],
    });

    // The sidebar's Locations item jumps to the Locations panel on this page, with no reload.
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      (window as Window & { e2eNoReload?: boolean }).e2eNoReload = true;
    });
    await expect.poll(() => scrollY(page)).toBe(0);

    await nav.locator(`a[href="${tenant.path}#locations"]`).click();

    await expect(page).toHaveURL(`${ORIGIN}${tenant.path}#locations`);
    const panel = await rowPosition(page.locator('main #locations'));
    expect(panel.top).toBeGreaterThanOrEqual(panel.headerBottom);
    expect(panel.top).toBeLessThan(panel.viewport);
    expect(
      await page.evaluate(() => (window as Window & { e2eNoReload?: boolean }).e2eNoReload),
    ).toBe(true);
  });

  // #95: the sidebar's Locations link keeps the visitor's query string. A plain click goes through
  // the router to the current path, the current search, and the link's hash, so there is no reload,
  // history grows by one entry, and Back returns to the URL before the click.
  test('1280: the Locations link on a page loaded with a query string keeps it, adds one history entry, and Back returns', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(!isDesktop(testInfo), 'the sidebar column shows at 1280px only');
    const tenant = await tallTenant();
    const nav = page.getByRole('navigation', { name: tenant.name });
    await expectQueryKeepingJump(page, consoleGuard, tenant, async () => {
      await nav.locator(`a[href="${tenant.path}#locations"]`).click();
    });
  });

  // #95: the same for the phone sheet, which closes before the link is followed (#75).
  test('phone sheet (360): its Locations link on a page loaded with a query string keeps it, adds one history entry, and Back returns', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(isDesktop(testInfo), 'the phone sheet runs at 360px only');
    const tenant = await tallTenant();
    const menuButton = page.getByRole('button', { name: 'Open navigation' });
    const dialog = page.getByRole('dialog', { name: 'Navigation' });
    await expectQueryKeepingJump(page, consoleGuard, tenant, async () => {
      await activate(page, menuButton);
      await expect(dialog.locator('[data-slot="sheet-content"]')).toBeVisible();
      await activate(page, dialog.locator(`a[href="${tenant.path}#locations"]`));
      await expect(dialog).toHaveCount(0);
      await expect(menuButton).toBeFocused();
    });
  });

  test('phone sheet (360): 288px, focus on Close, Tab trapped, closes without moving the page, and its Locations link jumps to the panel', async ({
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
      // The width is read once the slide-in has finished: mid-animation, WebKit reports a
      // fractional width (288.0000076) for the translated content.
      await sheet.evaluate((element) =>
        Promise.all(element.getAnimations().map((animation) => animation.finished)),
      );
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

    // The sheet's Locations link: the sheet closes, focus returns to the menu button, and the page
    // jumps to the panel, which the block scroll strategy must not undo (#75).
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await expect.poll(() => scrollY(page)).toBe(0);
    const row = page.locator('main #locations');
    const before = await rowPosition(row);
    expect(before.top).toBeGreaterThanOrEqual(before.viewport);
    const scrollBefore = await scrollY(page);

    await openSheet();
    await activate(page, dialog.locator(`a[href="${tenant.path}#locations"]`));
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

  // #94: the first press creates the sheet on the hydrated page. In a development build that
  // creation logged "no hydration info available for a given TNode" while the shell's template
  // held a view container; the console fixture fails the test on any warning. The phone-sheet
  // test above makes its first press at 360, so only 320 is added here.
  for (const width of [320]) {
    test(`phone sheet (${width}): the first press on the hydrated page opens it with no console warning`, async ({
      page,
      consoleGuard,
    }, testInfo) => {
      test.skip(isDesktop(testInfo), 'the phone sheet runs at phone widths only');
      await page.setViewportSize({ width, height: 800 });
      const tenant = await smallTenant();
      await page.goto(tenant.path);
      await hydrated(consoleGuard);
      const dialog = page.getByRole('dialog', { name: 'Navigation' });
      await activate(page, page.getByRole('button', { name: 'Open navigation' }));
      // The dialog container has no box of its own: the helm sheet content inside is fixed.
      await expect(dialog.locator('[data-slot="sheet-content"]')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Close navigation' })).toBeFocused();
      // The sheet's host element is not in the document: only the overlay holds its content.
      expect(await page.locator('app-shell-sheet').count()).toBe(0);
    });
  }

  // #94: the sheet is created outside the shell's template. A navigation that replaces the page
  // while the sheet is open leaves no dialog, scrim, or scroll block on the next page. That the
  // shell destroys the sheet's ComponentRef is asserted in shell.spec.ts.
  test('phone sheet (360): a navigation away while it is open leaves no overlay or scroll block', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(isDesktop(testInfo), 'the phone sheet runs at 360px only');
    // The tall tenant's page scrolls, so the open sheet blocks scrolling.
    const tenant = await tallTenant();
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    const dialog = page.getByRole('dialog', { name: 'Navigation' });
    await activate(page, page.getByRole('button', { name: 'Open navigation' }));
    await expect(dialog.locator('[data-slot="sheet-content"]')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains('cdk-global-scrollblock')),
      )
      .toBe(true);

    // The header's home link is under the scrim; a script click starts the client navigation.
    await page.evaluate(() => {
      document.querySelector<HTMLAnchorElement>('header a[href="/"]')?.click();
    });
    await expect(page).toHaveURL(`${ORIGIN}/`);
    await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.cdk-overlay-backdrop')).toHaveCount(0);
    await expect(page.locator('.cdk-overlay-pane')).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        document.documentElement.classList.contains('cdk-global-scrollblock'),
      ),
    ).toBe(false);
    expect(await page.locator('app-shell-sheet, hlm-sheet').count()).toBe(0);
  });

  // #94 with #88: the sheet opens and closes while the offline note shows. The sheet's chunk is
  // loaded by a first press while online, because `setOffline` blocks every request, the chunk's
  // included. The sheet is created outside the shell's template, so the note above it (a sibling
  // of the top bar) must stay where it is, and the sheet must still open at 288px with focus on
  // Close, close on Escape, and return focus to the menu button.
  test('phone sheet (360): opens and closes while the offline note shows, with no console warning', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(isDesktop(testInfo), 'the phone sheet runs at phone widths only');
    const tenant = await smallTenant();
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    const menuButton = page.getByRole('button', { name: 'Open navigation' });
    const dialog = page.getByRole('dialog', { name: 'Navigation' });
    const sheet = dialog.locator('[data-slot="sheet-content"]');
    const note = page.locator('header + [role="status"]').locator('[data-offline-note]');

    // Online: the first press loads the chunk and creates the sheet; close it again.
    await activate(page, menuButton);
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await context.setOffline(true);
    await expect(note).toBeVisible({ timeout: 2_000 });
    const noteBefore = await note.boundingBox();

    await activate(page, menuButton);
    await expect(sheet).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Close navigation' })).toBeFocused();
    await sheet.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );
    expect((await sheet.boundingBox())?.width).toBe(288);
    // The note is still shown, unmoved, under the scrim.
    await expect(note).toBeVisible();
    expect(await note.boundingBox()).toEqual(noteBefore);
    expect(await page.locator('app-shell-sheet').count()).toBe(0);
    // The tab walk of expectAccessible does not apply to an open modal: axe only.
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(menuButton).toBeFocused();
    await expect(note).toBeVisible();
    await expect(page.locator('.cdk-overlay-backdrop')).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        document.documentElement.classList.contains('cdk-global-scrollblock'),
      ),
    ).toBe(false);

    // And once more: the second open after the note appeared works as the first one did.
    await activate(page, menuButton);
    await expect(sheet).toBeVisible();
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

  test(
    'a league added after load appears without a reload in its panel, its sport in the sidebar, and the tile',
    VIEWPORT_AGNOSTIC,
    async ({ page, consoleGuard }) => {
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
      // The sidebar column is hidden at 360px, so not by role. The new sport joins the sports.
      await expect(
        page.locator(`nav[aria-label="${tenant.name}"] a[href="${tenant.path}/sports/softball"]`),
      ).toHaveText('Softball 1 league');
      await expect(main.locator('dl dd')).toHaveText(['3', '2', '3']);
      expect(
        await page.evaluate(() => (window as Window & { e2eNoReload?: boolean }).e2eNoReload),
      ).toBe(true);
    },
  );

  // #82: a saved copy never takes part in hydration. The server-rendered first load carries a
  // TransferState entry, which wins over the saved copy (ADR 0013 section 3), so the page hydrates
  // the server HTML unchanged, and the live result then replaces the saved copy in storage.
  test(
    'hydrates the transferred value over a saved copy with no console error, then saves the live result',
    VIEWPORT_AGNOSTIC,
    async ({ page, consoleGuard }) => {
      const tenant = await smallTenant();
      const key = `cvx-saved:organizations:getPublicPage:${JSON.stringify({ slug: tenant.slug })}`;
      const savedAt = Date.now() - 60_000;
      const saved = JSON.stringify({
        v: {
          name: 'Saved Copy Name',
          slug: tenant.slug,
          leagueCount: 0,
          locationCount: 0,
          sportCount: 0,
          sports: [],
        },
        savedAt,
        usedAt: savedAt,
        version: OFFLINE_SAVED_QUERIES[0].version,
      });
      // Before any app script: plant the saved copy and record every h1 text the page ever shows.
      await page.addInitScript(
        ([savedKey, savedValue]) => {
          localStorage.setItem(savedKey, savedValue);
          const seen: string[] = [];
          (window as Window & { e2eH1s?: string[] }).e2eH1s = seen;
          new MutationObserver(() => {
            for (const h1 of document.querySelectorAll('h1')) {
              const text = h1.textContent.trim();
              if (text && !seen.includes(text)) seen.push(text);
            }
          }).observe(document, { subtree: true, childList: true, characterData: true });
        },
        [key, saved] as const,
      );

      await page.goto(tenant.path);
      await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible();
      await hydrated(consoleGuard);
      await expect
        .poll(() =>
          page.evaluate(
            (savedKey) =>
              (JSON.parse(localStorage.getItem(savedKey) ?? 'null') as { v?: { name?: string } })?.v
                ?.name,
            key,
          ),
        )
        .toBe(tenant.name);
      expect(
        await page.evaluate(() => (window as Window & { e2eH1s?: string[] }).e2eH1s ?? []),
      ).not.toContain('Saved Copy Name');
      await expect(page.locator('[data-saved-copy-note]')).toHaveCount(0);
    },
  );

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
    await expect(nav.getByText('None yet', { exact: true })).toHaveCount(1);
    // Overview and Locations only; the Sports group lists nothing.
    await expect(nav.locator('a')).toHaveText(['Overview', 'Locations 0 locations']);
    await expectAccessible(page);
  });
});

test.describe('organization page: unknown slug', () => {
  test.use({ expectedDocumentStatus: 404 });

  test(
    'raw: 404 with the public Cache-Control and the not-found view, top bar only',
    RAW_HTTP,
    async ({ request }) => {
      const { status, headers, html } = await fetchRawHtml(
        request,
        '/organizations/does-not-exist',
      );
      expect(status).toBe(404);
      expect(headers['cache-control']?.replace(/\s+/g, '')).toBe(
        PUBLIC_PAGE_CACHE.replace(/\s+/g, ''),
      );
      expect(html).toMatch(/<h1\b[^>]*>\s*Page not found\s*<\/h1>/);
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html).not.toMatch(/<nav\b/);
      expect(html).not.toContain('aria-label="Open navigation"');
      expect(html).not.toMatch(/<link\b[^>]*rel="canonical"|property="og:/);
    },
  );

  test(
    'browser: the same view, with no console error',
    VIEWPORT_AGNOSTIC,
    async ({ page, consoleGuard }) => {
      const response = await page.goto('/organizations/does-not-exist');
      expect(response?.status()).toBe(404);
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
      if (!remoteBaseUrl) await hydrated(consoleGuard);
      await expect(page.getByRole('navigation')).toHaveCount(0);
      await expect(page.getByRole('button')).toHaveCount(0);
      await expect(page).toHaveTitle('Page not found | Omni League');
    },
  );
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

  // The browser's router parses the same URL after hydration. If it cannot decode the query string
  // it warns NG04018 and navigates to `/`, so the visitor ends on the home page (PR #105, tester).
  test(
    'browser: the organization page stays after hydration, at the same path',
    VIEWPORT_AGNOSTIC,
    async ({ page, consoleGuard }) => {
      const { path, name } = remoteBaseUrl
        ? { path: '/organizations/gulf-coast-sport-social', name: 'Gulf Coast Sport & Social' }
        : await smallTenant();

      const response = await page.goto(`${path}?ref=%`);
      expect(response?.status()).toBe(200);
      if (remoteBaseUrl) await page.waitForLoadState('networkidle');
      else await hydrated(consoleGuard);
      await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
      await expect(page).toHaveTitle(`${name} | Omni League`);
      expect(new URL(page.url()).pathname).toBe(path);
    },
  );
});

// A fragment the router cannot decode (`#%`) is read as no fragment, as an undecodable query string
// is (#116). The server never sees a fragment, so only the browser's router can send the visitor
// to `/` (NG04018). The test collects the console messages itself: the console fixture fails only on
// NG05xx warnings. Against a preview it uses the demo organization.
test.describe('organization page: undecodable fragment', () => {
  test(
    'browser: the organization page stays after the first navigation, with no NG04018',
    VIEWPORT_AGNOSTIC,
    async ({ page, consoleGuard }) => {
      const { path, name } = remoteBaseUrl
        ? { path: '/organizations/gulf-coast-sport-social', name: 'Gulf Coast Sport & Social' }
        : await smallTenant();
      const messages: string[] = [];
      page.on('console', (message) => messages.push(`${message.type()}: ${message.text()}`));

      const response = await page.goto(`${path}#%`);
      expect(response?.status()).toBe(200);
      // The server-rendered HTML shows the page whatever the router does next, so wait until the
      // client router's first navigation has finished: the app is stable once it has hydrated.
      if (remoteBaseUrl) await page.waitForLoadState('networkidle');
      else await hydrated(consoleGuard);

      expect(messages.filter((message) => message.includes('NG04018'))).toEqual([]);
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
    },
  );
});

// ADR 0005: each test seeds its own tenant and sees only its own data, whatever else the shared
// backend holds (other tests' tenants run in parallel).
test.describe('tenant isolation', VIEWPORT_AGNOSTIC, () => {
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
        'Soccer 1 league',
        'Locations 1 location',
      ]);
    });
  }
});
