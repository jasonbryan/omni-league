// Public organization page (#60): `/organizations/:orgSlug`, rendered on the server from
// `organizations:getPublicPage` and page 1 of the league and location lists, in the public
// layout (top bar and footer, no sidebar) with live subscriptions after hydration. Each test
// that seeds its own tenant needs the local Convex backend and is skipped with
// E2E_BASE_URL set; the unknown-slug tests also run against a preview. The layout's own checks
// are in e2e/public-layout.spec.ts.
import type { TestInfo } from '@playwright/test';
import { OFFLINE_SAVED_QUERIES } from '../src/app/core/data/convex/offline-saved-queries';
import { expectAccessible } from './support/a11y';
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
  tallLocations,
  type Tenant,
} from './support/tenant';

const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
const ORIGIN = new URL(baseURL).origin;

const NO_SEED = 'E2E_BASE_URL is set: no local Convex backend to seed a tenant';

const isDesktop = (testInfo: TestInfo) => testInfo.project.name === 'chromium-desktop';

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
 * Two leagues and five locations, the most a list shows (#100): the last location's row starts
 * below the fold at 1280x720 and at 360x800 (asserted by the tests that use it).
 */
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

function canonicalHrefs(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*\brel="canonical"[^>]*>/g)].map(
    ([tag]) => /\bhref="([^"]*)"/.exec(tag)?.[1] ?? '',
  );
}

/** Waits for the dev-mode hydration log, so the live subscription is open. */
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

        // No sidebar; the rows keep their ids.
        expect(html, path).not.toContain(`aria-label="${tenant.name}"`);
        for (const id of ['league-1', 'league-2', 'location-1', 'location-2']) {
          expect(html, `${path} #${id}`).toMatch(new RegExp(`\\sid="${id}"`));
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
    'raw: 5 league rows, 5 location rows, and totals in the tiles',
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

      const content = html;
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

      // The query string never reaches the cacheable HTML (PR #90).
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

    // The public layout: no menu button, and the only navigation is the footer's.
    await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(1);
    // The Tab order follows the DOM: skip link, top bar, each league's name, then the
    // footer's links.
    await expectAccessible(page, {
      expectedOrder: [
        'a[href$="#main"]',
        'header a[href="/"]',
        'header a[href^="/sign-in"]',
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
    'a league added after load appears without a reload in its panel and tile',
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

  test('an organization with no leagues and no locations shows the empty states and 0, 0, 0', async ({
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
    await expectAccessible(page);
  });
});

test.describe('organization page: unknown slug', () => {
  test.use({ expectedDocumentStatus: 404 });

  test(
    'raw: 404 with the public Cache-Control and the not-found view in the public layout',
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
      // The public layout: the footer's navigation only, no sidebar and no menu button.
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
      await expect(page.getByRole('navigation')).toHaveCount(1); // the footer's
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
    });
  }
});
