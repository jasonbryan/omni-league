import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { fetchRawHtml } from './support/raw-html';
import { rawGet } from './support/raw-get';
import { RAW_HTTP } from './support/raw-http';
import { seedTenant, type LeagueSeed, type Tenant } from './support/tenant';

const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
const ORIGIN = new URL(baseURL).origin;
const NO_SEED = 'E2E_BASE_URL is set: no local Convex backend to seed a tenant';

const BAYSIDE = {
  name: 'Bayside Athletic Complex',
  address: '4410 Gullwing Commons Dr, Corpus Christi, TX 78412',
};
const FLOUR_BLUFF = {
  name: 'Flour Bluff Softball Park',
  address: '2001 Bluff Diamond Rd, Corpus Christi, TX 78418',
};
const NORTH_BEACH = {
  name: 'North Beach Sand Courts',
  address: '3500 Sandcourt Ln, Corpus Christi, TX 78402',
};

const GULF_COAST_LEAGUES: LeagueSeed[] = [
  { name: 'Coed 7v7 Rec', sport: 'soccer', locations: [BAYSIDE.name] },
  { name: "Men's Over-30 11v11", sport: 'soccer', locations: [BAYSIDE.name] },
  { name: 'Sunday Reverse Coed 4s', sport: 'beachVolleyball', locations: [NORTH_BEACH.name] },
  { name: 'Thursday Night Coed 2s', sport: 'beachVolleyball', locations: [NORTH_BEACH.name] },
  {
    name: 'Wednesday Coed Slow-Pitch',
    sport: 'softball',
    locations: [FLOUR_BLUFF.name, BAYSIDE.name],
  },
];

interface Target {
  name: string;
  path: string;
}

/**
 * The demo organization on a preview, and on a local run a tenant with the same five leagues in three sports, so the
 * expected chips are the same in both.
 */
async function threeSports(): Promise<Target> {
  if (remoteBaseUrl !== undefined) {
    return { name: 'Gulf Coast Sport & Social', path: '/organizations/gulf-coast-sport-social' };
  }
  const tenant = await seedTenant({
    name: 'E2E Sport View',
    locations: [BAYSIDE, FLOUR_BLUFF, NORTH_BEACH],
    leagues: GULF_COAST_LEAGUES,
  });
  return { name: tenant.name, path: tenant.path };
}

async function oneSport(): Promise<Target> {
  if (remoteBaseUrl !== undefined) {
    return { name: 'Lakeshore Sand League', path: '/organizations/lakeshore-sand-league' };
  }
  const tenant = await seedTenant({
    name: 'E2E One Sport',
    locations: [NORTH_BEACH],
    leagues: [
      { name: 'Tuesday Women’s 2s', sport: 'beachVolleyball', locations: [NORTH_BEACH.name] },
      { name: 'Saturday Coed 6s', sport: 'beachVolleyball', locations: [NORTH_BEACH.name] },
    ],
  });
  return { name: tenant.name, path: tenant.path };
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

const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

function chipsOf(html: string): { text: string; href: string | undefined; current: boolean }[] {
  const nav = /<nav\b[^>]*aria-label="Sports"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  return [...nav.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, inner]) => ({
    text: textOf(inner),
    href: /\bhref="(?:https?:\/\/[^/"]+)?([^"]*)"/.exec(attrs)?.[1],
    current: /\baria-current="page"/.test(attrs),
  }));
}

function sectionOf(html: string, id: string): string {
  return (
    new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</section>`).exec(html)?.[1] ?? ''
  );
}

function namesIn(section: string): string[] {
  return [...section.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map(([, inner]) => textOf(inner));
}

async function hydrated(consoleGuard: { hydrated: boolean }): Promise<void> {
  await expect
    .poll(() => consoleGuard.hydrated, {
      message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
    })
    .toBe(true);
}

const THREE_SPORT_CHIPS = [
  'All sports 5 leagues',
  'Beach volleyball 2 leagues',
  'Soccer 2 leagues',
  'Softball 1 league',
];

test.describe('sport chips and the sport view: raw server HTML', () => {
  test(
    'the organization page has four chip links with counts and All sports current; one sport has none',
    RAW_HTTP,
    async ({ request }) => {
      const target = await threeSports();
      const { status, html } = await fetchRawHtml(request, target.path);
      expect(status).toBe(200);
      const chips = chipsOf(html);
      expect(chips.map((chip) => chip.text)).toEqual(THREE_SPORT_CHIPS);
      expect(chips.map((chip) => chip.href)).toEqual([
        target.path,
        `${target.path}/sports/beach-volleyball`,
        `${target.path}/sports/soccer`,
        `${target.path}/sports/softball`,
      ]);
      expect(chips.map((chip) => chip.current)).toEqual([true, false, false, false]);
      expect(html).toMatch(/<h2\b[^>]*>\s*Leagues\s*<\/h2>/);

      const single = await oneSport();
      const alone = await fetchRawHtml(request, single.path);
      expect(alone.status).toBe(200);
      expect(alone.html).not.toContain('aria-label="Sports"');
    },
  );

  test(
    '/sports/soccer: 200, the public Cache-Control, the Soccer chip current, only soccer leagues, only Bayside under Locations, title and canonical',
    RAW_HTTP,
    async ({ request }) => {
      const target = await threeSports();
      const path = `${target.path}/sports/soccer`;
      for (const query of ['', '?ott=x', '?utm_source=x']) {
        const { status, headers, html } = await fetchRawHtml(request, `${path}${query}`);
        expect(status, query).toBe(200);
        expect(headers['cache-control']?.replace(/\s+/g, ''), query).toBe(
          PUBLIC_PAGE_CACHE.replace(/\s+/g, ''),
        );
        expect(headers['netlify-vary'], query).toBe('query');
        expect(headers['location'], query).toBeUndefined();

        expect(chipsOf(html).map((chip) => [chip.text, chip.current])).toEqual([
          [THREE_SPORT_CHIPS[0], false],
          [THREE_SPORT_CHIPS[1], false],
          [THREE_SPORT_CHIPS[2], true],
          [THREE_SPORT_CHIPS[3], false],
        ]);
        expect(html.match(/<h1\b/g), query).toHaveLength(1);
        expect(html, query).toMatch(new RegExp(`<h1\\b[^>]*>\\s*${target.name}\\s*</h1>`));
        const leagues = sectionOf(html, 'leagues');
        expect(textOf(/<h2\b[^>]*>([\s\S]*?)<\/h2>/.exec(leagues)?.[1] ?? ''), query).toBe(
          'Soccer leagues',
        );
        expect(namesIn(leagues), query).toEqual(['Coed 7v7 Rec', "Men's Over-30 11v11"]);
        expect(namesIn(sectionOf(html, 'locations')), query).toEqual([BAYSIDE.name]);

        expect(html, query).toContain(`<title>Soccer | ${target.name} | Omni League</title>`);
        const canonical = `${ORIGIN}${path}`;
        expect(canonicalHrefs(html), query).toEqual([canonical]);
        expect(metaContent(html, 'og:url'), query).toBe(canonical);
        if (query) expect(html, query).not.toContain(query.slice(1));
      }
    },
  );

  test('a sport with locations at two sites lists them by name', RAW_HTTP, async ({ request }) => {
    const target = await threeSports();
    const { html } = await fetchRawHtml(request, `${target.path}/sports/softball`);
    expect(namesIn(sectionOf(html, 'leagues'))).toEqual(['Wednesday Coed Slow-Pitch']);
    expect(namesIn(sectionOf(html, 'locations'))).toEqual([BAYSIDE.name, FLOUR_BLUFF.name]);
  });
});

test.describe('the sport view: unknown targets', () => {
  test.use({ expectedDocumentStatus: 404 });

  test(
    'an unknown segment, the camel-case key, and an unknown organization answer 404 with the not-found view',
    RAW_HTTP,
    async ({ request }) => {
      const target = await threeSports();
      for (const path of [
        `${target.path}/sports/curling`,
        `${target.path}/sports/beachVolleyball`,
        '/organizations/does-not-exist/sports/soccer',
      ]) {
        const { status, headers, html } = await fetchRawHtml(request, path);
        expect(status, path).toBe(404);
        expect(headers['cache-control']?.replace(/\s+/g, ''), path).toBe(
          PUBLIC_PAGE_CACHE.replace(/\s+/g, ''),
        );
        expect(html, path).toMatch(/<h1\b[^>]*>\s*Page not found\s*<\/h1>/);
        expect(html, path).not.toContain('aria-label="Sports"');
        expect(html, path).not.toMatch(/<link\b[^>]*rel="canonical"|property="og:/);
      }
    },
  );

  test(
    'a sport the organization has no published league in answers 404',
    RAW_HTTP,
    async ({ request }) => {
      test.skip(remoteBaseUrl !== undefined, NO_SEED);
      const tenant = await seedTenant({
        name: 'E2E No Softball',
        locations: [BAYSIDE],
        leagues: [
          { name: 'Soccer One', sport: 'soccer', locations: [BAYSIDE.name] },
          { name: 'Draft Softball', sport: 'softball', locations: [BAYSIDE.name], status: 'draft' },
        ],
      });
      const { status, html } = await fetchRawHtml(request, `${tenant.path}/sports/softball`);
      expect(status).toBe(404);
      expect(html).toMatch(/<h1\b[^>]*>\s*Page not found\s*<\/h1>/);
    },
  );
});

test.describe('the sport view: pages', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  async function sevenSoccer(): Promise<Tenant> {
    return seedTenant({
      name: 'E2E Seven Soccer',
      locations: [BAYSIDE],
      leagues: Array.from({ length: 7 }, (_, i) => ({
        name: `Soccer League ${i + 1}`,
        sport: 'soccer' as const,
        locations: [BAYSIDE.name],
      })),
    });
  }

  test(
    '?page=0, ?page=abc, and ?page=2&page=3 render page 1 with 200 and no Location; a canary appears nowhere',
    RAW_HTTP,
    async () => {
      const tenant = await sevenSoccer();
      const path = `${tenant.path}/sports/soccer`;
      const first = await rawGet(path);
      const firstNames = namesIn(sectionOf(first.body, 'leagues'));
      expect(firstNames).toHaveLength(5);
      for (const sample of ['?page=0', '?page=abc', '?page=2&page=3']) {
        const response = await rawGet(`${path}${sample}`);
        expect(response.status, sample).toBe(200);
        expect(response.headers.location, sample).toBeUndefined();
        expect(namesIn(sectionOf(response.body, 'leagues')), sample).toEqual(firstNames);
        expect(response.body, sample).not.toContain('abc');
        expect(response.body, sample).not.toContain('page=3');
      }
      const token = `ott${randomUUID().replaceAll('-', '')}`;
      for (const sample of [`?page=${token}`, `?page=2&page=${token}`, `?q=${token}`]) {
        const response = await rawGet(`${path}${sample}`);
        expect(response.status, sample).toBe(200);
        expect(response.body, sample).not.toContain(token);
        expect(JSON.stringify(response.headers), sample).not.toContain(token);
        expect(response.headers.location, sample).toBeUndefined();
      }
    },
  );

  test(
    '?page=2 shows leagues 6 and 7, with the page in the canonical',
    RAW_HTTP,
    async ({ request }) => {
      const tenant = await sevenSoccer();
      const path = `${tenant.path}/sports/soccer`;
      const { status, html } = await fetchRawHtml(request, `${path}?page=2`);
      expect(status).toBe(200);
      expect(namesIn(sectionOf(html, 'leagues'))).toEqual(['Soccer League 6', 'Soccer League 7']);
      expect(canonicalHrefs(html)).toEqual([`${ORIGIN}${path}?page=2`]);
      expect(html).toContain('Leagues pages');
    },
  );
});

test.describe('the sport view in the browser', () => {
  test('activating the Soccer chip by keyboard changes the URL and title and focuses main; Back returns to All sports', async ({
    page,
    consoleGuard,
  }) => {
    const target = await threeSports();
    await page.goto(target.path);
    await expect(page.getByRole('heading', { level: 1, name: target.name })).toBeVisible();
    if (!remoteBaseUrl) await hydrated(consoleGuard);
    const title = await page.title();

    const chips = page.getByRole('navigation', { name: 'Sports' });
    await expect(chips.getByRole('link', { name: /^All sports/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await chips.getByRole('link', { name: /^Soccer/ }).focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(`${baseURL}${target.path}/sports/soccer`);
    await expect(page).toHaveTitle(`Soccer | ${target.name} | Omni League`);
    await expect(page.getByRole('heading', { level: 2, name: 'Soccer leagues' })).toBeVisible();
    await expect(page.locator('main[id="main"]')).toBeFocused();
    await expect(chips.getByRole('link', { name: /^Soccer/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('#locations h3')).toHaveText([BAYSIDE.name]);

    await page.goBack();
    await expect(page).toHaveURL(`${baseURL}${target.path}`);
    await expect(page).toHaveTitle(title);
    await expect(chips.getByRole('link', { name: /^All sports/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(
      page.getByRole('heading', { level: 2, name: 'Leagues', exact: true }),
    ).toBeVisible();
  });

  async function chipHeights(
    page: Page,
  ): Promise<{ coarse: boolean; heights: (number | undefined)[] }> {
    const target = await threeSports();
    await page.goto(target.path);
    const links = page.getByRole('navigation', { name: 'Sports' }).getByRole('link');
    await expect(links).toHaveCount(4);
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    const heights = (await links.all()).map(async (link) => (await link.boundingBox())?.height);
    return { coarse, heights: await Promise.all(heights) };
  }

  test('every chip is 44px tall with a coarse pointer and 36px with a mouse', async ({ page }) => {
    const { coarse, heights } = await chipHeights(page);
    expect(heights).toEqual(Array<number>(4).fill(coarse ? 44 : 36));
  });

  test.describe('on a wide touch screen', () => {
    test.use({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true });

    test('every chip is still 44px tall', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium-desktop', 'one project covers the wide screen');
      const { coarse, heights } = await chipHeights(page);
      expect(coarse).toBe(true);
      expect(heights).toEqual([44, 44, 44, 44]);
    });
  });

  test('the chips wrap on a phone and nothing scrolls sideways', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'chromium-desktop', 'the phone layout runs at 360px only');
    const target = await threeSports();
    await page.goto(target.path);
    const boxes = await page
      .getByRole('navigation', { name: 'Sports' })
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().top));
    expect(new Set(boxes).size).toBeGreaterThan(1);
    await expectNoSidewaysScroll(page);
  });

  test('passes the axe helper on the sport view', async ({ page, consoleGuard }) => {
    const target = await threeSports();
    await page.goto(`${target.path}/sports/soccer`);
    await expect(page.getByRole('heading', { level: 2, name: 'Soccer leagues' })).toBeVisible();
    if (!remoteBaseUrl) await hydrated(consoleGuard);
    await expectAccessible(page);
  });

  test.describe('with JavaScript disabled', () => {
    test.use({ javaScriptEnabled: false });

    test('the chips are links to the sport views and the sport view lists only its leagues', async ({
      page,
    }) => {
      const target = await threeSports();
      await page.goto(target.path);
      await page
        .getByRole('navigation', { name: 'Sports' })
        .getByRole('link', { name: /^Soccer/ })
        .click();
      await expect(page).toHaveURL(`${baseURL}${target.path}/sports/soccer`);
      await expect(page.locator('#leagues h3')).toHaveText(['Coed 7v7 Rec', "Men's Over-30 11v11"]);
    });
  });
});

test.describe('the league page breadcrumb', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test('links the sport to its sport view', async ({ page }) => {
    const target = await threeSports();
    await page.goto(`${target.path}/leagues/coed-7v7-rec`);
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await crumbs.getByRole('link', { name: 'Soccer' }).click();
    await expect(page).toHaveURL(`${baseURL}${target.path}/sports/soccer`);
    await expect(page.getByRole('heading', { level: 2, name: 'Soccer leagues' })).toBeVisible();
  });
});

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}
