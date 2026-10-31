import type { Page, TestInfo } from '@playwright/test';
import { axeScan, describeViolations, expectAccessible } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { overlayPanes } from './support/overlay';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import {
  dateFromToday,
  numberedLocations,
  seedSeasons,
  seedTenant,
  type DivisionSeed,
  type Tenant,
} from './support/tenant';

const NO_SEED = 'E2E_BASE_URL is set: no local Convex backend to seed a tenant';
const ORIGIN = new URL(baseURL).origin;

const isDesktop = (testInfo: TestInfo) => testInfo.project.name === 'chromium-desktop';

const LOCATIONS = numberedLocations(6);

const beach = (
  name: string,
  gender: DivisionSeed['gender'],
  playersPerSide: number,
  level: DivisionSeed['level'],
) => ({
  name,
  sport: 'beachVolleyball' as const,
  locations: [LOCATIONS[0].name],
  division: { gender, playersPerSide, level, ageGroup: 'adult' as const },
});

const LEAGUES = [
  beach('Monday Coed 4s', 'coed', 4, 'bb'),
  beach('Wednesday Reverse Coed 4s', 'coed', 4, 'b'),
  beach('Saturday Coed 6s', 'coed', 6, 'rec'),
  beach('Friday Coed 6s', 'coed', 6, 'b'),
  beach("Sunday Women's 6s", 'womens', 6, 'a'),
  beach("Tuesday Women's 2s", 'womens', 2, 'a'),
  beach("Thursday Men's 4s", 'mens', 4, 'aa'),
];

const openSeason = (name: string) => ({
  name,
  slug: 'summer',
  startDate: dateFromToday(20),
  endDate: dateFromToday(80),
  registrationDeadline: dateFromToday(10),
});

/** The seven beach volleyball leagues, six locations so Locations has two pages, and two open seasons. */
async function filterTenant(): Promise<Tenant> {
  const tenant = await seedTenant({ name: 'E2E Filters', locations: LOCATIONS, leagues: LEAGUES });
  await Promise.all([
    seedSeasons(tenant, 'monday-coed-4s', [openSeason('Monday Summer')]),
    seedSeasons(tenant, 'saturday-coed-6s', [openSeason('Saturday Summer')]),
  ]);
  return tenant;
}

const plainText = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** From the end of the tag holding `start` to `end`. */
const between = (html: string, start: string, end: string): string => {
  const at = html.indexOf(start);
  if (at < 0) return '';
  const content = html.indexOf('>', at) + 1;
  return html.slice(content, html.indexOf(end, content));
};

const leagueRows = (html: string): string[] =>
  [...between(html, 'id="leagues"', '</section>').matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map(
    ([, inner]) => plainText(inner),
  );

const filterForm = (html: string) => between(html, 'aria-label="Filter leagues"', '</form>');

const countOf = (html: string): string => {
  const form = filterForm(html);
  const status = form.slice(form.indexOf('role="status"'));
  return plainText(status.slice(status.indexOf('>') + 1, status.indexOf('</p>')));
};

const hrefsIn = (html: string): string[] =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(([, href]) =>
    href.replaceAll('&amp;', '&').replace(ORIGIN, ''),
  );

function metaName(html: string, name: string): string | undefined {
  const tag = new RegExp(`<meta\\b[^>]*\\bname="${name}"[^>]*>`).exec(html)?.[0];
  return tag ? /\bcontent="([^"]*)"/.exec(tag)?.[1] : undefined;
}

const canonicalOf = (html: string): string | undefined =>
  /<link\b[^>]*\brel="canonical"[^>]*\bhref="([^"]*)"/.exec(html)?.[1];

test.describe('organization filters: raw server HTML', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test(
    'coed 4v4 lists two leagues with pills, the count, Clear all, noindex, and the unfiltered canonical',
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const tenant = await filterTenant();
      const { status, html } = await fetchRawHtml(request, `${tenant.path}?gender=coed&format=4v4`);
      expect(status).toBe(200);
      expect(leagueRows(html)).toEqual(['Monday Coed 4s', 'Wednesday Reverse Coed 4s']);
      const pills = between(html, 'aria-label="Active filters"', '</ul>');
      expect(plainText(pills)).toBe(
        'Gender: Coed : remove the gender filter 4v4 : remove the format filter',
      );
      expect(hrefsIn(pills)).toEqual([`${tenant.path}?format=4v4`, `${tenant.path}?gender=coed`]);
      expect(countOf(html)).toBe('2 of 7 leagues');
      expect(plainText(filterForm(html))).toContain('Clear all');
      expect(metaName(html, 'robots')).toBe('noindex');
      expect(canonicalOf(html)).toBe(`${ORIGIN}${tenant.path}`);
    },
  );

  test(
    "4v4 or 6v6 reads 6 of 7 over two pages that keep both formats, and Tuesday Women's 2s is on neither",
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const tenant = await filterTenant();
      const first = (await fetchRawHtml(request, `${tenant.path}?format=4v4&format=6v6`)).html;
      const second = (await fetchRawHtml(request, `${tenant.path}?format=4v4&format=6v6&leagues=2`))
        .html;
      expect(countOf(first)).toBe('6 of 7 leagues');
      expect(leagueRows(first)).toHaveLength(5);
      expect(leagueRows(second)).toEqual(['Wednesday Reverse Coed 4s']);
      expect([...leagueRows(first), ...leagueRows(second)]).not.toContain("Tuesday Women's 2s");
      const pageLinks = hrefsIn(between(second, 'aria-label="Leagues pages"', '</nav>'));
      expect(pageLinks).toContain(`${tenant.path}?format=4v4&format=6v6#leagues`);
      for (const href of hrefsIn(between(second, 'aria-label="Active filters"', '</ul>'))) {
        expect(href).not.toContain('leagues=');
      }
    },
  );

  test(
    'girls U10 shows only the U10 league of a soccer organization',
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const division = (ageGroup: DivisionSeed['ageGroup']) => ({
        gender: 'womens' as const,
        playersPerSide: 7,
        level: 'rec' as const,
        ageGroup,
      });
      const tenant = await seedTenant({
        name: 'E2E Youth Filters',
        locations: [LOCATIONS[0]],
        leagues: [
          {
            name: 'U10 Girls',
            sport: 'soccer',
            locations: [LOCATIONS[0].name],
            division: division('u10'),
          },
          {
            name: "Women's Rec",
            sport: 'soccer',
            locations: [LOCATIONS[0].name],
            division: division('adult'),
          },
        ],
      });
      const { html } = await fetchRawHtml(request, `${tenant.path}?gender=girls&age=u10`);
      expect(leagueRows(html)).toEqual(['U10 Girls']);
      expect(countOf(html)).toBe('1 of 2 leagues');
      expect(plainText(between(html, 'aria-label="Active filters"', '</ul>'))).toContain(
        'Gender: Girls',
      );
    },
  );

  test(
    'an unknown value or a canary is ignored and appears nowhere in the body or headers',
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const tenant = await filterTenant();
      const canary = `ott${Date.now()}canary`;
      for (const query of ['gender=nope', 'format=4x4', `format=${canary}`, `gender=${canary}`]) {
        const { status, headers, html } = await fetchRawHtml(request, `${tenant.path}?${query}`);
        const value = query.split('=')[1];
        expect(status, query).toBe(200);
        expect(html, query).not.toContain(value);
        expect(JSON.stringify(headers), query).not.toContain(value);
        expect(countOf(html), query).toBe('7 leagues');
      }
    },
  );

  test(
    'Registration open follows the filters, and a view with no match has no open section or Register link',
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const tenant = await filterTenant();
      const fours = (await fetchRawHtml(request, `${tenant.path}?format=4v4`)).html;
      const open = between(fours, 'id="registration-open"', '</section>');
      expect(
        [...open.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map(([, h]) => plainText(h)),
      ).toEqual(['Monday Coed 4s']);
      const none = (await fetchRawHtml(request, `${tenant.path}?gender=mens&format=6v6`)).html;
      expect(none).not.toContain('id="registration-open"');
      expect(plainText(none)).not.toContain('Register for a season');
      const leagues = plainText(between(none, 'id="leagues"', '</section>'));
      expect(leagues).toContain('No leagues match these filters');
      expect(leagues).toContain('Clear all');
      expect(countOf(none)).toBe('0 of 7 leagues');
    },
  );
});

test.describe('organization filters on the sport view: raw server HTML', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test(
    'a filtered page 2 is noindex, names the sport view as its canonical, and writes its links in canonical order',
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const tenant = await filterTenant();
      const sportPath = `${tenant.path}/sports/beach-volleyball`;
      const { status, html } = await fetchRawHtml(
        request,
        `${sportPath}?page=2&format=6v6&format=4v4&format=4v4`,
      );
      expect(status).toBe(200);
      expect(metaName(html, 'robots')).toBe('noindex');
      expect(canonicalOf(html)).toBe(`${ORIGIN}${sportPath}`);
      expect(countOf(html)).toBe('6 of 7 leagues');
      expect(leagueRows(html)).toHaveLength(1);
      const pageLinks = hrefsIn(between(html, 'aria-label="Leagues pages"', '</nav>'));
      expect(pageLinks).toContain(`${sportPath}?format=4v4&format=6v6#leagues`);
      for (const href of hrefsIn(between(html, 'aria-label="Active filters"', '</ul>'))) {
        expect(href).not.toContain('page=');
      }
    },
  );

  test(
    'an unfiltered page 2 stays indexed with its own page as the canonical',
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const tenant = await filterTenant();
      const { html } = await fetchRawHtml(request, `${tenant.path}?leagues=2&gender=nope`);
      expect(metaName(html, 'robots')).toBeUndefined();
      expect(canonicalOf(html)).toBe(`${ORIGIN}${tenant.path}?leagues=2`);
      expect(countOf(html)).toBe('7 leagues');
    },
  );
});

test.describe('organization filters in the browser', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  const count = (page: Page) =>
    page.getByRole('search', { name: 'Filter leagues' }).getByRole('status');
  const pills = (page: Page) =>
    page.getByRole('list', { name: 'Active filters' }).getByRole('link');
  const filtersButton = (page: Page) =>
    page.getByRole('search', { name: 'Filter leagues' }).getByRole('button', { name: /^Filters/ });
  const dimensionButton = (page: Page, name: string) =>
    page.getByRole('search', { name: 'Filter leagues' }).getByRole('button', { name, exact: true });
  const sheet = (page: Page) => page.getByRole('dialog', { name: 'Filters' });
  // The dialog element is the CDK container, which has no box of its own; the sheet is its content.
  const sheetContent = (page: Page) => sheet(page).locator('[data-slot="sheet-content"]');
  const levelPanel = (page: Page) => page.getByRole('dialog', { name: 'Level' });
  const genderPanel = (page: Page) => page.getByRole('dialog', { name: 'Gender' });

  test('a pill and Clear all change the URL without a page load and move focus to the count', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await filterTenant();
    await page.goto(`${tenant.path}?gender=coed&format=4v4`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await page.evaluate(() => ((window as Window & { e2eMarker?: number }).e2eMarker = 1));

    await pills(page).filter({ hasText: 'Gender: Coed' }).click();
    await expect(page).toHaveURL(`${baseURL}${tenant.path}?format=4v4`);
    await expect(count(page)).toHaveText('3 of 7 leagues');
    await expect(count(page)).toBeFocused();

    await page
      .getByRole('search', { name: 'Filter leagues' })
      .getByRole('link', { name: 'Clear all' })
      .click();
    await expect(page).toHaveURL(`${baseURL}${tenant.path}`);
    await expect(count(page)).toHaveText('7 leagues');
    await expect(count(page)).toBeFocused();
    expect(await page.evaluate(() => (window as Window & { e2eMarker?: number }).e2eMarker)).toBe(
      1,
    );
  });

  test('a pill pressed while the new page loads holds the rows busy and the count never reads the previous result', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await filterTenant();
    const held = await holdQueries(page, ['organizations:listPublicLeagues'], {
      holdFromStart: false,
    });
    await page.goto(`${tenant.path}?gender=coed&format=4v4`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(count(page)).toHaveText('2 of 7 leagues');
    held.holdNextAnswer();
    await pills(page).filter({ hasText: 'Gender: Coed' }).click();
    await expect(page).toHaveURL(`${baseURL}${tenant.path}?format=4v4`);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(page.locator('#leagues ul[aria-busy="true"]')).toHaveCount(1);
    await expect(count(page)).toBeFocused();
    await expect(count(page)).not.toHaveText('2 of 7 leagues');
    held.release();
    await expect(count(page)).toHaveText('3 of 7 leagues');
    await expect(page.locator('#leagues [aria-busy="true"]')).toHaveCount(0);
  });

  test('from page 2, the keyboard opens the filters, checks Coed, and Show loads page 1 of the result with focus back on the button', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const tenant = await filterTenant();
    await page.goto(`${tenant.path}?format=4v4&format=6v6&leagues=2`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const opener = isDesktop(testInfo) ? dimensionButton(page, 'Gender') : filtersButton(page);
    await opener.focus();
    await page.keyboard.press('Enter');
    const overlay = isDesktop(testInfo) ? genderPanel(page) : sheet(page);
    if (!isDesktop(testInfo)) {
      await expect(overlay.getByRole('button', { name: 'Close filters' })).toBeFocused();
      await page.keyboard.press('Tab');
    }
    const coed = overlay.getByRole('checkbox', { name: 'Coed' });
    await expect(coed).toBeFocused();
    await page.keyboard.press('Space');
    await expect(coed).toBeChecked();
    const show = overlay.getByRole('button', { name: 'Show 4 leagues' });
    for (let presses = 0; presses < 20; presses++) {
      if (await show.evaluate((button) => button === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(show).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${baseURL}${tenant.path}?gender=coed&format=4v4&format=6v6`);
    await expect(count(page)).toHaveText('4 of 7 leagues');
    await expect(
      isDesktop(testInfo) ? dimensionButton(page, 'Gender: Coed') : filtersButton(page),
    ).toBeFocused();
  });

  test('the Locations page links keep gender=coed, and a filter change keeps locations=2', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await filterTenant();
    await page.goto(`${tenant.path}?gender=coed&locations=2`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const locationPages = page
      .getByRole('navigation', { name: 'Locations pages' })
      .getByRole('link');
    await expect(locationPages.first()).toHaveAttribute(
      'href',
      `${tenant.path}?gender=coed#locations`,
    );
    await pills(page).first().click();
    await expect(page).toHaveURL(`${baseURL}${tenant.path}?locations=2`);
  });

  test('after the page-load wait, Try again keeps the filters and the page', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await filterTenant();
    const held = await holdQueries(page, ['organizations:listPublicLeagues'], {
      holdFromStart: false,
    });
    await page.clock.install();
    await page.goto(`${tenant.path}?format=4v4&format=6v6`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    held.holdNextAnswer();
    await page
      .getByRole('navigation', { name: 'Leagues pages' })
      .getByRole('link', { name: 'Next page' })
      .click();
    await expect.poll(() => held.isHolding()).toBe(true);
    await page.clock.fastForward('00:11');
    await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      `${tenant.path}?format=4v4&format=6v6&leagues=2`,
    );
    held.release();
  });

  test('the filtered page with its filter buttons passes the axe helper', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await filterTenant();
    await page.goto(`${tenant.path}?gender=coed&format=4v4`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(page.locator('[data-filter-buttons]')).toBeVisible();
    await expectAccessible(page);
  });

  test("the Leagues heading's top is the same before and after hydration", async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await filterTenant();
    let releaseScripts!: () => void;
    const scriptsHeld = new Promise<void>((resolve) => {
      releaseScripts = resolve;
    });
    await page.route(/\.js(\?|$)/, async (route) => {
      await scriptsHeld;
      await route.fallback();
    });
    const heading = page.locator('#leagues-heading');
    await page.goto(`${tenant.path}?gender=coed&format=4v4`, { waitUntil: 'commit' });
    await expect(page.locator('main details summary')).toBeVisible();
    const before = (await heading.boundingBox())?.y;
    releaseScripts();
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(page.locator('[data-filter-buttons]')).toBeVisible();
    await expect(page.locator('main details')).toHaveCount(0);
    expect(before).toBeDefined();
    expect((await heading.boundingBox())?.y).toBe(before);
  });

  test('the page makes no request for the overlay chunk until a filter button is pressed', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const tenant = await filterTenant();
    const scripts: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'script' && !request.serviceWorker()) {
        scripts.push(request.url());
      }
    });
    await page.goto(tenant.path, { waitUntil: 'networkidle' });
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const beforePress = [...scripts];
    if (isDesktop(testInfo)) {
      await dimensionButton(page, 'Level').click();
      await expect(levelPanel(page)).toBeVisible();
    } else {
      await filtersButton(page).click();
      await expect(sheetContent(page)).toBeVisible();
    }
    const loadedByPress = scripts.slice(beforePress.length);
    expect(loadedByPress.length).toBeGreaterThan(0);
    for (const url of loadedByPress) expect(beforePress).not.toContain(url);
  });

  test('an open overlay and its unapplied draft leave the URL, canonical link, and saved copies unchanged', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const tenant = await filterTenant();
    await page.goto(`${tenant.path}?gender=coed&locations=2`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(count(page)).toHaveText('4 of 7 leagues');
    const pageState = () =>
      page.evaluate(() => ({
        url: location.href,
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href'),
        savedCopies: Object.keys(localStorage)
          .filter((key) => key.startsWith('cvx-saved:'))
          .sort(),
      }));
    // One saved copy for each of the page's five queries.
    await expect.poll(async () => (await pageState()).savedCopies.length).toBe(5);
    const before = await pageState();

    const overlay = isDesktop(testInfo)
      ? page.getByRole('dialog', { name: 'Format' })
      : sheet(page);
    await (isDesktop(testInfo) ? dimensionButton(page, 'Format') : filtersButton(page)).click();
    await overlay.getByText('6v6', { exact: true }).click();
    await expect(overlay.getByRole('button', { name: 'Show 2 leagues' })).toBeVisible();
    expect(await pageState()).toEqual(before);

    await page.keyboard.press('Escape');
    await expect(overlay).toHaveCount(0);
    expect(await pageState()).toEqual(before);
  });

  test.describe('the phone sheet', () => {
    test.skip(({ isMobile }) => !isMobile, 'the sheet runs at phone widths only');

    test('a modal Filters dialog whose live count applies Coed and 4v4 without a page load, with focus back on Filters', async ({
      page,
      consoleGuard,
    }) => {
      const tenant = await filterTenant();
      await page.goto(tenant.path);
      await expect.poll(() => consoleGuard.hydrated).toBe(true);
      await page.evaluate(() => ((window as Window & { e2eMarker?: number }).e2eMarker = 1));
      const filters = filtersButton(page);
      await expect(filters).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(filters).toHaveAttribute('aria-expanded', 'false');

      await filters.click();
      await expect(sheetContent(page)).toBeVisible();
      // The modal hides the page from the accessibility tree, so the button is found by its markup.
      await expect(
        page.locator('[data-filter-buttons] button[aria-haspopup="dialog"]'),
      ).toHaveAttribute('aria-expanded', 'true');
      await expect(sheet(page)).toHaveAttribute('aria-modal', 'true');
      await expect(sheet(page).getByRole('button', { name: 'Close filters' })).toBeFocused();
      await expect(page.locator('app-root')).toHaveAttribute('aria-hidden', 'true');
      expect(await overlayPanes(page)).toEqual([{ inContainer: true, inPopover: false }]);

      await sheet(page).getByText('Coed', { exact: true }).click();
      await sheet(page).getByText('4v4', { exact: true }).click();
      const show = sheet(page).getByRole('button', { name: 'Show 2 leagues' });
      await expect(show).toBeVisible();
      await expect(page).toHaveURL(`${baseURL}${tenant.path}`);
      await show.click();
      await expect(page).toHaveURL(`${baseURL}${tenant.path}?gender=coed&format=4v4`);
      await expect(sheet(page)).toHaveCount(0);
      await expect(filters).toBeFocused();
      await expect(filters).toHaveAttribute('aria-expanded', 'false');
      await expect(count(page)).toHaveText('2 of 7 leagues');
      expect(await page.evaluate(() => (window as Window & { e2eMarker?: number }).e2eMarker)).toBe(
        1,
      );
    });

    test('at 360 by 640 with every dimension offered, Show is in view without scrolling the sheet', async ({
      page,
      consoleGuard,
    }) => {
      await page.setViewportSize({ width: 360, height: 640 });
      const tenant = await filterTenant();
      await page.goto(tenant.path);
      await expect.poll(() => consoleGuard.hydrated).toBe(true);
      await filtersButton(page).click();
      await expect(sheet(page).getByRole('group')).toHaveCount(4);
      const show = sheet(page).getByRole('button', { name: 'Show 7 leagues' });
      await expect(show).toBeInViewport({ ratio: 1 });
      await expect(sheet(page).getByRole('link', { name: 'Clear all' })).toBeInViewport({
        ratio: 1,
      });
    });

    test('Escape closes it with focus back on Filters, and Clear all clears without a page load and focuses the count', async ({
      page,
      consoleGuard,
    }) => {
      const tenant = await filterTenant();
      await page.goto(`${tenant.path}?gender=coed&format=4v4`);
      await expect.poll(() => consoleGuard.hydrated).toBe(true);
      await page.evaluate(() => ((window as Window & { e2eMarker?: number }).e2eMarker = 1));
      const filters = filtersButton(page);
      await filters.click();
      await expect(sheetContent(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(sheet(page)).toHaveCount(0);
      await expect(filters).toBeFocused();

      await filters.click();
      await sheet(page).getByRole('link', { name: 'Clear all' }).click();
      await expect(page).toHaveURL(`${baseURL}${tenant.path}`);
      await expect(sheet(page)).toHaveCount(0);
      await expect(count(page)).toHaveText('7 leagues');
      await expect(count(page)).toBeFocused();
      expect(await page.evaluate(() => (window as Window & { e2eMarker?: number }).e2eMarker)).toBe(
        1,
      );
    });

    test('the open sheet passes axe, with 44px chips and buttons', async ({
      page,
      consoleGuard,
    }) => {
      const tenant = await filterTenant();
      await page.goto(`${tenant.path}?gender=coed&format=4v4`);
      await expect.poll(() => consoleGuard.hydrated).toBe(true);
      await filtersButton(page).click();
      await expect(sheet(page).getByRole('button', { name: 'Close filters' })).toBeFocused();
      await sheet(page).evaluate((element) =>
        Promise.all(element.getAnimations({ subtree: true }).map((a) => a.finished)),
      );
      expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
      const controls = sheet(page).locator('label span, button, a');
      for (const box of await controls.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().height),
      )) {
        expect(box).toBeGreaterThanOrEqual(44);
      }
    });

    test('Tab and Shift+Tab never leave the open sheet for the page behind', async ({
      page,
      consoleGuard,
    }) => {
      const tenant = await filterTenant();
      await page.goto(`${tenant.path}?gender=coed`);
      await expect.poll(() => consoleGuard.hydrated).toBe(true);
      await filtersButton(page).click();
      await expect(sheet(page).getByRole('button', { name: 'Close filters' })).toBeFocused();
      const focusInSheet = () =>
        page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
      const tabStops = await sheet(page).locator('button, a, input').count();
      for (const key of ['Tab', 'Shift+Tab']) {
        for (let press = 0; press <= tabStops; press++) {
          await page.keyboard.press(key);
          expect(await focusInSheet(), `${key} press ${String(press + 1)}`).toBe(true);
        }
      }
    });

    test("the sheet's fieldsets sit 24px apart, as the approved mockup draws them", async ({
      page,
      consoleGuard,
    }) => {
      const tenant = await filterTenant();
      await page.goto(tenant.path);
      await expect.poll(() => consoleGuard.hydrated).toBe(true);
      await filtersButton(page).click();
      await expect(sheet(page).getByRole('group')).toHaveCount(4);
      const gaps = await sheet(page)
        .getByRole('group')
        .evaluateAll((fieldsets) =>
          fieldsets
            .slice(1)
            .map((fieldset, i) =>
              Math.round(
                fieldset.getBoundingClientRect().top - fieldsets[i].getBoundingClientRect().bottom,
              ),
            ),
        );
      expect(gaps).toEqual([24, 24, 24]);
    });
  });

  test.describe('the desktop popovers', () => {
    test.skip(({ isMobile }) => isMobile, 'the popovers run from 768px');

    test('the Level popover sits in the overlay container, and Escape and a click outside each close it with focus back on Level', async ({
      page,
      consoleGuard,
    }) => {
      const tenant = await filterTenant();
      await page.goto(tenant.path);
      await expect.poll(() => consoleGuard.hydrated).toBe(true);
      const level = dimensionButton(page, 'Level');
      await expect(level).toHaveAttribute('aria-expanded', 'false');

      await level.click();
      await expect(levelPanel(page)).toBeVisible();
      await expect(level).toHaveAttribute('aria-expanded', 'true');
      await expect(level).toHaveAttribute('aria-controls', 'filter-level');
      expect(await overlayPanes(page)).toEqual([{ inContainer: true, inPopover: false }]);
      await page.keyboard.press('Escape');
      await expect(levelPanel(page)).toHaveCount(0);
      await expect(level).toHaveAttribute('aria-expanded', 'false');
      await expect(level).toBeFocused();

      await level.click();
      await expect(levelPanel(page)).toBeVisible();
      await page.mouse.click(1200, 680);
      await expect(levelPanel(page)).toHaveCount(0);
      await expect(level).toHaveAttribute('aria-expanded', 'false');
      await expect(level).toBeFocused();
    });

    test('Show in the Level popover applies the whole draft, keeps locations, and drops the leagues page', async ({
      page,
      consoleGuard,
    }) => {
      const tenant = await filterTenant();
      await page.goto(`${tenant.path}?gender=coed&locations=2&leagues=2`);
      await expect.poll(() => consoleGuard.hydrated).toBe(true);
      const level = dimensionButton(page, 'Level');
      await level.click();
      await levelPanel(page).getByText('BB', { exact: true }).click();
      await levelPanel(page).getByRole('button', { name: 'Show 1 league' }).click();
      await expect(page).toHaveURL(`${baseURL}${tenant.path}?gender=coed&level=bb&locations=2`);
      await expect(levelPanel(page)).toHaveCount(0);
      await expect(dimensionButton(page, 'Level: BB')).toBeFocused();
    });

    test('Clear gender in the Gender popover removes gender without a page load and focuses the count', async ({
      page,
      consoleGuard,
    }) => {
      const tenant = await filterTenant();
      await page.goto(`${tenant.path}?gender=coed&format=4v4`);
      await expect.poll(() => consoleGuard.hydrated).toBe(true);
      await page.evaluate(() => ((window as Window & { e2eMarker?: number }).e2eMarker = 1));
      await dimensionButton(page, 'Gender: Coed').click();
      await genderPanel(page).getByRole('link', { name: 'Clear gender' }).click();
      await expect(page).toHaveURL(`${baseURL}${tenant.path}?format=4v4`);
      await expect(genderPanel(page)).toHaveCount(0);
      await expect(count(page)).toHaveText('3 of 7 leagues');
      await expect(count(page)).toBeFocused();
      expect(await page.evaluate(() => (window as Window & { e2eMarker?: number }).e2eMarker)).toBe(
        1,
      );
    });

    test('the open popover passes axe', async ({ page, consoleGuard }) => {
      const tenant = await filterTenant();
      await page.goto(`${tenant.path}?gender=coed&format=4v4`);
      await expect.poll(() => consoleGuard.hydrated).toBe(true);
      await dimensionButton(page, 'Level').click();
      await expect(levelPanel(page)).toBeVisible();
      await levelPanel(page).evaluate((element) =>
        Promise.all(element.getAnimations({ subtree: true }).map((a) => a.finished)),
      );
      expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    });

    test('Tab past either end of the open Level popover keeps it next to Level in the focus order', async ({
      page,
      consoleGuard,
    }) => {
      const tenant = await filterTenant();
      await page.goto(`${tenant.path}?gender=coed`);
      await expect.poll(() => consoleGuard.hydrated).toBe(true);
      const focusState = () =>
        page.evaluate(() => {
          const active = document.activeElement;
          return {
            inPopover: !!active?.closest('[data-slot="popover-content"]'),
            popoverOpen: document.querySelector('[data-slot="popover-content"]') !== null,
            focused: (active?.textContent ?? '').trim(),
          };
        });
      const adjacent = (state: Awaited<ReturnType<typeof focusState>>, neighbour: string) =>
        state.inPopover || (!state.popoverOpen && state.focused === neighbour);

      await dimensionButton(page, 'Level').click();
      await levelPanel(page).getByRole('button', { name: 'Show 4 leagues' }).focus();
      await page.keyboard.press('Tab');
      const afterLast = await focusState();
      expect(adjacent(afterLast, 'Age group'), JSON.stringify(afterLast)).toBe(true);

      await page.keyboard.press('Escape');
      await dimensionButton(page, 'Level').click();
      await levelPanel(page).getByRole('checkbox', { name: 'Rec' }).focus();
      await page.keyboard.press('Shift+Tab');
      const beforeFirst = await focusState();
      expect(adjacent(beforeFirst, 'Level'), JSON.stringify(beforeFirst)).toBe(true);
    });
  });

  test.describe('with JavaScript disabled', () => {
    test.use({ javaScriptEnabled: false });

    test('opening Filters, checking a value, and Show leagues loads the filtered URL', async ({
      page,
    }) => {
      const tenant = await filterTenant();
      await page.goto(tenant.path);
      const form = page.getByRole('search', { name: 'Filter leagues' });
      await form.getByText('Filters').click();
      await form.getByText("Men's", { exact: true }).click();
      await form.getByRole('button', { name: 'Show leagues' }).click();
      await expect(page).toHaveURL(`${baseURL}${tenant.path}?gender=mens`);
      await expect(page.locator('#leagues').getByRole('heading', { level: 3 })).toHaveText([
        "Thursday Men's 4s",
      ]);
      await expect(count(page)).toHaveText('1 of 7 leagues');
    });
  });
});

test.describe('organization filters on the sport view in the browser', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test('6v6 in the Format popover reads Show 3 leagues, and Show loads the sport view with no page', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(!isDesktop(testInfo), 'the popovers run from 768px');
    const tenant = await filterTenant();
    const sportPath = `${tenant.path}/sports/beach-volleyball`;
    await page.goto(`${sportPath}?page=2`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await page
      .getByRole('search', { name: 'Filter leagues' })
      .getByRole('button', { name: 'Format', exact: true })
      .click();
    const panel = page.getByRole('dialog', { name: 'Format' });
    await panel.getByText('6v6', { exact: true }).click();
    await panel.getByRole('button', { name: 'Show 3 leagues' }).click();
    await expect(page).toHaveURL(`${baseURL}${sportPath}?format=6v6`);
    await expect(
      page.getByRole('search', { name: 'Filter leagues' }).getByRole('status'),
    ).toHaveText('3 of 7 leagues');
  });
});

test.describe('organization filters offline', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test('a filtered view seen online shows from its saved copy offline, with its filters offered', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    const tenant = await filterTenant();
    await page.goto(`${tenant.path}?gender=coed`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const form = page.getByRole('search', { name: 'Filter leagues' });
    const filters = form.getByRole('button', { name: /^Filters/ });
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    const sheetContent = sheet.locator('[data-slot="sheet-content"]');
    await expect(count(page)).toHaveText('4 of 7 leagues');
    // The first press loads the sheet's chunk while online: the e2e build has no service worker to serve it offline.
    await filters.click();
    await expect(sheetContent).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await form.getByRole('link', { name: 'Clear all' }).click();
    await expect(count(page)).toHaveText('7 leagues');

    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(`${baseURL}${tenant.path}?gender=coed`);
    await expect(page.locator('app-saved-copy-note')).toBeVisible();
    await expect(count(page)).toHaveText('4 of 7 leagues');
    await filters.click();
    await expect(sheet.getByRole('group', { name: 'Gender' })).toBeVisible();
    await expect(sheet.getByRole('checkbox', { name: 'Coed' })).toBeChecked();
    await expect(sheet.getByRole('button', { name: 'Show 4 leagues' })).toBeVisible();
    await context.setOffline(false);
  });

  test('offline, a filter never seen shows the not-saved view, whose Try again keeps the filters', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    const tenant = await filterTenant();
    await page.goto(`${tenant.path}?gender=coed&format=4v4`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(count(page)).toHaveText('2 of 7 leagues');

    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await page
      .getByRole('list', { name: 'Active filters' })
      .getByRole('link')
      .filter({ hasText: 'Gender: Coed' })
      .click();
    await expect(page).toHaveURL(`${baseURL}${tenant.path}?format=4v4`);
    await expect(
      page.getByRole('heading', { name: "This page isn't saved on this device" }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      `${tenant.path}?format=4v4`,
    );
    await context.setOffline(false);
  });

  function count(page: Page) {
    return page.getByRole('search', { name: 'Filter leagues' }).getByRole('status');
  }
});
