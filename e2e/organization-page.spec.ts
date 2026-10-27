import type { Page, TestInfo } from '@playwright/test';
import { OFFLINE_SAVED_QUERIES } from '../src/app/core/data/convex/offline-saved-queries';
import { axeScan, describeViolations, expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { rawGet } from './support/raw-get';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';
import {
  dateFromToday,
  numberedLocations,
  seedSeasons,
  seedTenant,
  SPORT_NAMES,
  tallLocations,
  type Tenant,
} from './support/tenant';
import { holdQueries } from './support/hold-queries';
import { screenshot } from './support/screenshot';

const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
const ORIGIN = new URL(baseURL).origin;

const NO_SEED = 'E2E_BASE_URL is set: no local Convex backend to seed a tenant';

const isDesktop = (testInfo: TestInfo) => testInfo.project.name === 'chromium-desktop';

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

const GULF_COAST_LOCATIONS = [
  { name: 'Bayside Athletic Complex', address: '4410 Ocean Dr, Corpus Christi, TX 78412' },
  { name: 'Flour Bluff Softball Park', address: '2001 Waldron Rd, Corpus Christi, TX 78418' },
  { name: 'North Beach Sand Courts', address: '3500 Surfside Blvd, Corpus Christi, TX 78402' },
];

// Named like the demo organization, so its mark reads "GC".
function gulfCoastTenant(): Promise<Tenant> {
  return seedTenant({
    name: 'Gulf Coast Sport & Social',
    locations: GULF_COAST_LOCATIONS,
    leagues: [
      {
        name: "Men's Over-30 11v11",
        sport: 'soccer',
        locations: ['Bayside Athletic Complex'],
        division: { gender: 'mens', playersPerSide: 11, level: 'rec', ageGroup: 'over30' },
      },
      {
        name: 'Sunday Reverse Coed 4s',
        sport: 'beachVolleyball',
        locations: ['North Beach Sand Courts'],
        division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
      },
      {
        name: 'Wednesday Coed Slow-Pitch',
        sport: 'softball',
        locations: ['Flour Bluff Softball Park', 'Bayside Athletic Complex'],
      },
    ],
  });
}

const GULF_COAST_LINE = 'Beach volleyball, soccer, and softball · 3 leagues at 3 locations';

function tallTenant(): Promise<Tenant> {
  return seedTenant({
    locations: tallLocations(),
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

function metaName(html: string, name: string): string | undefined {
  const tag = new RegExp(`<meta\\b[^>]*\\bname="${name}"[^>]*>`).exec(html)?.[0];
  return tag ? /\bcontent="([^"]*)"/.exec(tag)?.[1] : undefined;
}

function canonicalHrefs(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*\brel="canonical"[^>]*>/g)].map(
    ([tag]) => /\bhref="([^"]*)"/.exec(tag)?.[1] ?? '',
  );
}

async function plantSavedCopyAndRecordH1s(page: Page, key: string, saved: string): Promise<void> {
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
}

async function hydrated(consoleGuard: { hydrated: boolean }): Promise<void> {
  await expect
    .poll(() => consoleGuard.hydrated, {
      message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
    })
    .toBe(true);
}

test.describe('organization page: raw server HTML', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test(
    'the description tags end with the City, state when the organization has one, and are as before without',
    RAW_HTTP,
    async ({ request }) => {
      const withCity = await seedTenant({ cityState: 'Corpus Christi, TX' });
      const without = await seedTenant();
      const { html } = await fetchRawHtml(request, withCity.path);
      const expected = `Leagues and locations of ${withCity.name} on Omni League in Corpus Christi, TX.`;
      expect(metaContent(html, 'og:description')).toBe(expected);
      expect(metaName(html, 'description')).toBe(expected);

      const { html: plain } = await fetchRawHtml(request, without.path);
      const plainExpected = `Leagues and locations of ${without.name} on Omni League.`;
      expect(metaContent(plain, 'og:description')).toBe(plainExpected);
      expect(metaName(plain, 'description')).toBe(plainExpected);
    },
  );

  test(
    '200 with the public Cache-Control, content, meta, row ids, and tiles; a query string changes nothing',
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

        expect(html.match(/<h1\b/g), path).toHaveLength(1);
        expect(html, path).toMatch(new RegExp(`<h1\\b[^>]*>\\s*${tenant.name}\\s*</h1>`));
        for (const location of tenant.locations) {
          expect(html, path).toContain(`>${location.name}</h3>`);
          expect(html, path).toMatch(new RegExp(`>\\s*${location.address}\\s*<`));
        }
        for (const league of tenant.leagues) {
          expect(html, path).toMatch(new RegExp(`<h3\\b[^>]*>\\s*<a\\b[^>]*>${league.name}</a>`));
          expect(html, path).toMatch(
            new RegExp(`>\\s*${SPORT_NAMES[league.sport]} · [^<]*\\s*</p>`),
          );
        }

        expect(html, path).toContain(`<title>${tenant.name} | Omni League</title>`);
        expect(metaContent(html, 'og:title'), path).toBe(tenant.name);
        expect(metaContent(html, 'og:description'), path).toBe(
          `Leagues and locations of ${tenant.name} on Omni League.`,
        );
        expect(metaContent(html, 'og:type'), path).toBe('website');
        expect(metaContent(html, 'og:url'), path).toBe(canonical);
        expect(canonicalHrefs(html), path).toEqual([canonical]);

        expect(html, path).not.toContain(`aria-label="${tenant.name}"`);
        for (const id of ['league-1', 'league-2', 'location-1', 'location-2']) {
          expect(html, `${path} #${id}`).toMatch(new RegExp(`\\sid="${id}"`));
        }

        expect(html, path).toMatch(
          />\s*Beach volleyball and soccer · 2 leagues at 2 locations\s*</,
        );
        expect(html, path).not.toContain('<dl');

        if (query) expect(html, path).not.toContain(query.slice(1));
      }
    },
  );
});

test.describe('organization page: more than 5 rows per list', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test(
    'raw: 5 league rows, 5 location rows, and the totals in the hero line and the Leagues heading',
    RAW_HTTP,
    async ({ request }) => {
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

      const content = html;
      const shownLeagues = tenant.leagues.slice(0, 5);
      const shownLocations = tenant.locations.slice(0, 5);
      expect(
        [...content.matchAll(/\sid="(league|location)-(\d+)"/g)].map(
          ([, kind, n]) => `${kind}-${n}`,
        ),
      ).toEqual([
        ...[1, 2, 3, 4, 5].map((n) => `league-${n}`),
        ...[1, 2, 3, 4, 5].map((n) => `location-${n}`),
      ]);
      expect(
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
      expect(content).toMatch(new RegExp(`${tenant.leagues[0].locations[0]}\\s*<`));

      expect(html).toMatch(/>\s*Soccer and softball · 13 leagues at 13 locations\s*</);
      expect(html).toMatch(/>\s*13 leagues\s*</);

      expect(html).not.toContain('utm_source');
    },
  );
});

test.describe('organization page in the browser', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test('hydrates with no console error and passes the axe helper; no sidebar and no menu button', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await tallTenant();
    await page.goto(tenant.path);
    await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible();
    await hydrated(consoleGuard);
    await expect(page).toHaveTitle(`${tenant.name} | Omni League`);

    await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(2);
    await expectAccessible(page, {
      expectedOrder: [
        'a[href$="#main"]',
        'header a[href="/"]',
        'header a[href^="/sign-in"]',
        'nav[aria-label="Sports"] li:nth-child(1) a',
        'nav[aria-label="Sports"] li:nth-child(2) a',
        'nav[aria-label="Sports"] li:nth-child(3) a',
        ...tenant.leagues.map(
          (league) =>
            `main a[href="${tenant.path}/leagues/${league.name.toLowerCase().replaceAll(' ', '-')}"]`,
        ),
        'footer a[href="/"]',
        'footer a[href="/app"]',
        'footer a[href="/app/organizations/new"]',
        'footer a[href^="/sign-in"]',
      ],
    });
  });

  test.describe('with JavaScript disabled', () => {
    test.use({ javaScriptEnabled: false });

    test('360: every league and location is in the page content, with no menu button', async ({
      page,
    }, testInfo) => {
      test.skip(isDesktop(testInfo), 'the phone layout runs at 360px only');
      const tenant = await smallTenant();
      await page.goto(tenant.path);
      await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveCount(0);
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
    'a league added after load appears without a reload in its list and the hero line',
    VIEWPORT_AGNOSTIC,
    async ({ page, consoleGuard }) => {
      const tenant = await smallTenant();
      await page.goto(tenant.path);
      await hydrated(consoleGuard);
      await page.evaluate(() => {
        (window as Window & { e2eNoReload?: boolean }).e2eNoReload = true;
      });
      const main = page.getByRole('main');
      await expect(main.getByText('· 2 leagues at 2 locations')).toBeVisible();

      await convexRun('testing:addLeague', {
        organizationSlug: tenant.slug,
        name: 'Zulu League',
        sport: 'softball',
        locations: ['Beta Courts'],
      });

      await expect(main.locator('#league-3 h3')).toHaveText('Zulu League');
      await expect(main.locator('#league-3')).toContainText('Softball');
      await expect(main.locator('#league-3')).toContainText('Beta Courts');
      await expect(main.getByText('· 3 leagues at 2 locations')).toBeVisible();
      expect(
        await page.evaluate(() => (window as Window & { e2eNoReload?: boolean }).e2eNoReload),
      ).toBe(true);
    },
  );

  // A saved copy never takes part in hydration. The server-rendered first load carries a
  // TransferState entry, which wins over the saved copy, so the page hydrates the server HTML
  // unchanged, and the live result then replaces the saved copy in storage.
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
      await plantSavedCopyAndRecordH1s(page, key, saved);

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

  test('an organization with no leagues shows the empty state and no Leagues or Locations section', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await seedTenant({ name: 'E2E Empty Org' });
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText(tenant.name);
    await expect(main.getByText('No leagues published yet')).toBeVisible();
    await expect(main.getByRole('heading', { level: 2, name: 'No leagues yet' })).toBeVisible();
    await expect(
      main.getByText(
        'Leagues this organization runs will be listed here, with their seasons and how to register.',
      ),
    ).toBeVisible();
    await expect(main.getByRole('heading', { name: /^(Leagues|Locations)$/ })).toHaveCount(0);
    await expect(main.locator('li')).toHaveCount(0);
    await expectAccessible(page);
  });
});

test.describe('organization page: hero, divisions, and sports', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test(
    'raw: the hidden initials mark, the h1, the hero line, each league with its division, and each location with its sports',
    RAW_HTTP,
    async ({ request }) => {
      const tenant = await gulfCoastTenant();
      const { status, html: rendered } = await fetchRawHtml(request, tenant.path);
      expect(status).toBe(200);
      const html = rendered.replaceAll('&#39;', "'");

      expect(html).toMatch(
        /<app-organization-mark\b[^>]*\baria-hidden="true"[^>]*>\s*GC\s*<\/app-organization-mark>\s*<h1\b/,
      );
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html).toMatch(
        new RegExp(`<h1\\b[^>]*>\\s*${tenant.name.replace('&', '&amp;')}\\s*</h1>`),
      );
      expect(html).toMatch(new RegExp(`>\\s*${GULF_COAST_LINE}\\s*<`));

      expect(html).toMatch(
        />\s*Men's · 11v11 · Rec · 30\+\s*<\/p>\s*(?:<!--[^>]*-->\s*)*<p[^>]*>\s*Soccer · Bayside/,
      );
      expect(html).toMatch(
        />\s*Coed · 4v4 · BB\s*<\/p>\s*(?:<!--[^>]*-->\s*)*<p[^>]*>\s*Beach volleyball · North/,
      );
      expect(html).toMatch(
        />\s*Softball · Flour Bluff Softball Park, Bayside Athletic Complex\s*<\/p>/,
      );

      expect(html).toMatch(
        /<h3\b[^>]*>\s*Bayside Athletic Complex\s*<\/h3>[\s\S]*?>\s*Soccer, softball\s*<\/p>/,
      );
      expect(html).toMatch(
        /<h3\b[^>]*>\s*North Beach Sand Courts\s*<\/h3>[\s\S]*?>\s*Beach volleyball\s*<\/p>/,
      );
      expect(html).not.toContain('Loading the organization.');
    },
  );

  test('browser: the mark is 32px on a phone and 48px from 768px, on the h1 line', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await gulfCoastTenant();
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    const mark = page.locator('app-organization-mark');
    const h1 = page.getByRole('heading', { level: 1 });
    const size = (page.viewportSize()?.width ?? 0) >= 768 ? 48 : 32;
    const markBox = await mark.boundingBox();
    const h1Box = await h1.boundingBox();
    expect(markBox?.width).toBe(size);
    expect(markBox?.height).toBe(size);
    const markMiddle = (markBox?.y ?? 0) + size / 2;
    expect(markMiddle).toBeGreaterThan(h1Box?.y ?? Infinity);
    expect(markMiddle).toBeLessThan((h1Box?.y ?? 0) + (h1Box?.height ?? 0));
    expect(markBox?.x).toBeLessThan(h1Box?.x ?? 0);
    await expect(mark).toHaveAttribute('aria-hidden', 'true');
    await expectAccessible(page);
  });

  test('browser: the leagues sit beside the locations from 1024px and above them below', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await gulfCoastTenant();
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    const leagues = await page.locator('#leagues').boundingBox();
    const locations = await page.locator('#locations').boundingBox();
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      expect(locations?.x).toBeGreaterThan((leagues?.x ?? 0) + (leagues?.width ?? 0) - 1);
      expect(locations?.y).toBeLessThan((leagues?.y ?? 0) + 100);
    } else {
      expect(locations?.y).toBeGreaterThan((leagues?.y ?? 0) + (leagues?.height ?? 0) - 1);
    }
  });

  test('browser: nothing scrolls sideways at 320px', async ({ page, consoleGuard }) => {
    const tenant = await gulfCoastTenant();
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    await page.setViewportSize({ width: 320, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });
});

test.describe('organization page: first load', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test('never shows the skeleton, keeps the server-rendered h1 element, and leaves focus where it was', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await smallTenant();
    await page.addInitScript(() => {
      const watch = window as Window & { e2eSkeletonSeen?: boolean; e2eFirstH1?: Element };
      watch.e2eSkeletonSeen = false;
      const check = () => {
        const first = document.querySelector('main h1');
        if (first && !watch.e2eFirstH1) watch.e2eFirstH1 = first;
        if (document.body.textContent.includes('Loading the organization.')) {
          watch.e2eSkeletonSeen = true;
        }
      };
      new MutationObserver(check).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });
    await page.goto(tenant.path);
    await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible();
    await hydrated(consoleGuard);
    const watched = await page.evaluate(() => {
      const watch = window as Window & { e2eSkeletonSeen?: boolean; e2eFirstH1?: Element };
      return {
        skeletonSeen: watch.e2eSkeletonSeen,
        sameH1:
          watch.e2eFirstH1 !== undefined && watch.e2eFirstH1 === document.querySelector('main h1'),
        mainFocused: document.activeElement === document.querySelector('main#main'),
      };
    });
    expect(watched).toEqual({ skeletonSeen: false, sameH1: true, mainFocused: false });
  });
});

test.describe('organization page: after an in-app navigation', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test('shows the skeleton with its status while the data is on its way, then the page within 4px of it, with focus on main', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await smallTenant();
    const leaguePath = `${tenant.path}/leagues/alpha-league`;
    const held = await holdQueries(page, [
      'organizations:getPublicPage',
      'organizations:listPublicLeagues',
      'organizations:listPublicLocations',
    ]);
    await page.goto(leaguePath);
    await expect(page.getByRole('heading', { level: 1, name: 'Alpha League' })).toBeVisible();
    await hydrated(consoleGuard);

    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: tenant.name })
      .click();
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(page).toHaveURL(`${baseURL}${tenant.path}`);

    const skeleton = page.getByTestId('organization-skeleton');
    await expect(skeleton).toBeVisible();
    await expect(skeleton.getByRole('status')).toHaveText('Loading the organization.');
    await expect(skeleton.getByRole('status')).toHaveClass(/sr-only/);
    await expect(page.locator('main').getByRole('heading')).toHaveCount(0);
    await expect(page.locator('main[id="main"]')).toBeFocused();
    const skeletonScan = await axeScan(page);
    expect(describeViolations(skeletonScan.violations)).toEqual([]);
    const bar = await skeleton.locator('span').nth(1).boundingBox();
    const markBar = await skeleton.locator('span').first().boundingBox();

    held.release();
    const h1 = page.getByRole('heading', { level: 1, name: tenant.name });
    await expect(h1).toBeVisible();
    await expect(skeleton).toHaveCount(0);
    const heading = await h1.boundingBox();
    expect(Math.abs((heading?.y ?? Infinity) - (bar?.y ?? -Infinity))).toBeLessThanOrEqual(4);
    const mark = await page.locator('app-organization-mark').boundingBox();
    expect(Math.abs((mark?.y ?? Infinity) - (markBar?.y ?? -Infinity))).toBeLessThanOrEqual(4);
    expect(mark?.width).toBe(markBar?.width);
    await expect(page.locator('main[id="main"]')).toBeFocused();
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
      expect(html.match(/<nav\b[^>]*>/g)).toHaveLength(1);
      expect(html).toContain('aria-label="Footer"');
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
      await expect(page.getByRole('navigation')).toHaveCount(1);
      await expect(page.getByRole('button')).toHaveCount(0);
      await expect(page).toHaveTitle('Page not found | Omni League');
    },
  );
});

// A query string the router cannot decode (`?ref=%`, a truncated tracking link) renders the page as
// if there were none. Not a redirect: Netlify copies the query string into a Location without one,
// so it would loop. Against a preview it uses the demo organization.
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
  // it warns NG04018 and navigates to `/`, so the visitor ends on the home page.
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
// is. The server never sees a fragment, so only the browser's router can send the visitor to `/`
// (NG04018). The test collects the console messages itself: the console fixture fails only on
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
    });
  }
});

const plainText = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const sectionOf = (html: string): string => {
  const at = html.indexOf('id="registration-open"');
  return html.slice(html.lastIndexOf('<section', at), html.indexOf('</section>', at));
};

/** Two open seasons (deadlines in 5 and 15 days), one closed 3 days ago, and a softball league with none. */
async function openSeasonsTenant(): Promise<Tenant> {
  const tenant = await seedTenant({
    name: 'E2E Open Seasons',
    locations: [
      { name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' },
      { name: 'Beta Diamond', address: '2 Beta Road, Corpus Christi, TX 78412' },
    ],
    leagues: [
      {
        name: 'Open League',
        sport: 'soccer',
        locations: ['Alpha Field'],
        division: { gender: 'coed', playersPerSide: 7, level: 'rec', ageGroup: 'adult' },
      },
      { name: 'Diamond League', sport: 'softball', locations: ['Beta Diamond'] },
    ],
  });
  await seedSeasons(tenant, 'open-league', [
    {
      name: 'Later Season',
      slug: 'later-season',
      startDate: dateFromToday(40),
      endDate: dateFromToday(100),
      registrationDeadline: dateFromToday(15),
    },
    {
      name: 'Sooner Season',
      slug: 'sooner-season',
      startDate: dateFromToday(30),
      endDate: dateFromToday(90),
      registrationDeadline: dateFromToday(5),
    },
    {
      name: 'Closed Season',
      slug: 'closed-season',
      startDate: dateFromToday(10),
      endDate: dateFromToday(70),
      registrationDeadline: dateFromToday(-3),
    },
  ]);
  return tenant;
}

test.describe('organization page: Registration open', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test(
    'raw: the open seasons are cards, soonest deadline first, each with its Register link; the hero jumps to them',
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const tenant = await openSeasonsTenant();
      const { html } = await fetchRawHtml(request, tenant.path);
      const section = sectionOf(html);

      expect(plainText(section)).toContain(
        'Registration open Register a team, or register as a free agent and an organizer places you on one.',
      );
      const sooner = section.indexOf('Sooner Season');
      const later = section.indexOf('Later Season');
      expect(sooner).toBeGreaterThan(-1);
      expect(later).toBeGreaterThan(sooner);
      expect(section).not.toContain('Closed Season');
      expect(section.match(/<h3\b/g)).toHaveLength(2);
      expect(plainText(section)).toContain('Coed · 7v7 · Rec, teams of at least 4');
      expect(plainText(section)).toContain('Alpha Field');

      for (const season of ['sooner-season', 'later-season']) {
        const href = `${tenant.path}/leagues/open-league/seasons/${season}`;
        expect(section, season).toMatch(new RegExp(`<a\\b[^>]*href="[^"]*${href}"[^>]*>Register`));
      }
      expect(plainText(section)).toContain('Register for Open League, Sooner Season');
      expect(html).toMatch(
        new RegExp(`<a\\b[^>]*href="${tenant.path}#registration-open"[^>]*>Register for a season`),
      );
    },
  );

  test(
    'raw: each league row names its next season: closed, or none',
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const tenant = await openSeasonsTenant();
      const { html } = await fetchRawHtml(request, tenant.path);
      const rows = html.slice(html.indexOf('id="leagues"'));
      const row = (n: number) =>
        plainText(
          rows.slice(rows.indexOf(`id="league-${n}"`), rows.indexOf(`id="league-${n + 1}"`)),
        );
      expect(row(1)).toContain('Softball · Beta Diamond No upcoming season');
      expect(row(2)).toContain('Soccer · Alpha Field Registration closed Closed Season');
    },
  );

  test(
    'raw: with no open season the section says so and the hero has no Register button; the softball view names softball',
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const tenant = await smallTenant();
      const { html } = await fetchRawHtml(request, tenant.path);
      expect(plainText(sectionOf(html))).toBe(
        'Registration open No season is open for registration right now. Each league below shows its next season once it is published.',
      );
      expect(html).not.toContain('#registration-open"');

      const withOpen = await openSeasonsTenant();
      const softball = await fetchRawHtml(request, `${withOpen.path}/sports/softball`);
      expect(plainText(sectionOf(softball.html))).toBe(
        'Registration open No softball season is open for registration right now. Each league below shows its next season once it is published.',
      );
      expect(softball.html).not.toContain('#registration-open"');
      const soccer = await fetchRawHtml(request, `${withOpen.path}/sports/soccer`);
      expect(soccer.html).toContain('Sooner Season');
      expect(soccer.html).toContain(`href="${withOpen.path}/sports/soccer#registration-open"`);
    },
  );

  test('browser: Register for a season jumps to the section, and the page passes the axe helper', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const tenant = await openSeasonsTenant();
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    const section = page.locator('#registration-open');
    await expect(
      section.getByRole('heading', { level: 2, name: 'Registration open' }),
    ).toBeVisible();
    await expect(section.locator(':scope > ul > li')).toHaveCount(2);
    await page.getByRole('link', { name: 'Register for a season' }).click();
    await expect(page).toHaveURL(`${tenant.path}#registration-open`);
    await expect(section).toBeInViewport();
    await screenshot(page, testInfo, '243-registration-open');
    await expectAccessible(page);
  });

  test('browser: a Register link opens the season page', async ({ page, consoleGuard }) => {
    const tenant = await openSeasonsTenant();
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    await page.getByRole('link', { name: 'Register for Open League, Sooner Season' }).click();
    await expect(page).toHaveURL(`${tenant.path}/leagues/open-league/seasons/sooner-season`);
    await expect(page.getByRole('heading', { level: 1, name: 'Sooner Season' })).toBeVisible();
  });
});
