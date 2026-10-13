// Sport view (#114): `/organizations/:orgSlug/sports/:sport`, rendered on the server from
// `organizations:getPublicPage` and `organizations:listPublicLeagues` with the sport, with the
// numbered control under the leagues (`?page=N#leagues`). It is opened from the sidebar's Sports
// group, which lists the sports the organization has leagues in. Each test seeds its own tenant
// (ADR 0005) and needs the local Convex backend, so the file is skipped with E2E_BASE_URL set; the
// preview samples are in `cache-key.spec.ts`.
import type { Locator, Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { rawGet } from './support/raw-get';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { seedTenant, type Tenant } from './support/tenant';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
/** Netlify removes the spaces after the commas. */
const noSpaces = (value: string | undefined) => value?.replace(/\s+/g, '');

const BEACH = 'beach-volleyball';

const beachName = (n: number) => `Beach League ${String(n).padStart(2, '0')}`;
const beachNames = (...numbers: number[]) => numbers.map(beachName);

interface SeededSport {
  tenant: Tenant;
  /** `/organizations/<org>/sports/beach-volleyball`. */
  path: string;
}

/**
 * An organization with 12 published beach volleyball leagues at 3 locations ("Beach League 01" to
 * "12", sorted as numbered), a draft beach volleyball league, 2 soccer leagues, and no softball
 * league.
 */
async function seed(): Promise<SeededSport> {
  const locations = [
    { name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' },
    { name: 'Beta Courts', address: '2 Beta Street, Corpus Christi, TX 78402' },
    { name: 'Gamma Sands', address: '3 Gamma Lane, Corpus Christi, TX 78404' },
  ];
  const tenant = await seedTenant({
    name: 'E2E Sport View',
    locations,
    leagues: [
      ...Array.from({ length: 12 }, (_, i) => ({
        name: beachName(i + 1),
        sport: 'beachVolleyball' as const,
        locations: [locations[i % 3].name],
      })),
      {
        name: 'Beach League 99 Draft',
        sport: 'beachVolleyball' as const,
        locations: ['Alpha Field'],
        status: 'draft' as const,
      },
      { name: 'Soccer League A', sport: 'soccer' as const, locations: ['Alpha Field'] },
      { name: 'Soccer League B', sport: 'soccer' as const, locations: ['Alpha Field'] },
    ],
  });
  return { tenant, path: `${tenant.path}/sports/${BEACH}` };
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

/** The text of each `<h3>` in the Leagues panel, in order (a league's name is a link inside it). */
function leagueNames(html: string): string[] {
  return [...html.matchAll(/<h3\b[^>]*>\s*(?:<a\b[^>]*>)?([^<]*)/g)].map(([, name]) => name.trim());
}

/** The control's range text, for example `6–10 of 12 leagues`. */
function rangeText(html: string): string | undefined {
  const nav = /<nav\b[^>]*aria-label="Leagues pages"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1];
  const text = /<p\b[^>]*>([\s\S]*?)<\/p>/.exec(nav ?? '')?.[1];
  return text
    ?.replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The sidebar `<nav>` element's HTML, from its start tag to its end tag. */
function sidebarHtml(html: string, name: string): string {
  const start = new RegExp(`<nav\\b[^>]*\\baria-label="${name}"[^>]*>`).exec(html);
  expect(start, `<nav aria-label="${name}">`).not.toBeNull();
  const from = start?.index ?? 0;
  return html.slice(from, html.indexOf('</nav>', from) + '</nav>'.length);
}

/** The text of each link of an HTML fragment, tags removed and white space collapsed. */
const linkTexts = (fragment: string) =>
  [...fragment.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map(([, inner]) =>
    inner
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );

/** The `href` of each link of an HTML fragment that is the current page (`aria-current="page"`). */
const currentHrefs = (fragment: string) =>
  [...fragment.matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g)].map(
    ([tag]) => /\bhref="([^"]*)"/.exec(tag)?.[1],
  );

async function hydrated(consoleGuard: { hydrated: boolean }): Promise<void> {
  await expect
    .poll(() => consoleGuard.hydrated, {
      message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
    })
    .toBe(true);
}

/**
 * Activates a control the way a phone user does: a tap at its coordinates in Chromium, and the
 * keyboard in WebKit, where a tap does not focus a button (#78's tester note).
 */
async function activate(page: Page, control: Locator): Promise<void> {
  if (page.context().browser()?.browserType().name() === 'webkit') {
    await control.focus();
    await page.keyboard.press('Enter');
    return;
  }
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  if (!box) throw new Error('control has no box');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('sport view: raw server HTML', () => {
  test(
    '?page=2: leagues 6 to 10 of the sport and no draft or other sport; the range, h1, counts, breadcrumb, sidebar, title, 200, the public Cache-Control, and the canonical with ?page=2',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, path } = await seed();
      for (const query of ['?page=2', '?page=2&utm_source=x']) {
        const { status, headers, html } = await fetchRawHtml(request, `${path}${query}`);
        expect(status, query).toBe(200);
        expect(noSpaces(headers['cache-control']), query).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(headers['content-type'], query).toContain('text/html');

        // Leagues 6 to 10 of the sport, by name, and no other sport's league or draft.
        expect(leagueNames(html), query).toEqual(beachNames(6, 7, 8, 9, 10));
        expect(html, query).not.toContain('Soccer League');
        expect(html, query).not.toContain('Draft');
        expect(rangeText(html), query).toBe('6–10 of 12 leagues');
        // The sport badge is dropped: the title already says the sport.
        expect(html, query).not.toContain('data-slot="badge"');

        expect(html.match(/<h1\b/g), query).toHaveLength(1);
        expect(html, query).toMatch(/<h1\b[^>]*>\s*Beach volleyball\s*<\/h1>/);
        expect(html, query).toMatch(/<p\b[^>]*>\s*12 leagues at 3 locations\s*<\/p>/);
        const breadcrumb = /<nav\b[^>]*aria-label="Breadcrumb"[^>]*>[\s\S]*?<\/nav>/.exec(
          html,
        )?.[0];
        expect(breadcrumb, query).toBeDefined();
        expect(breadcrumb, query).toContain(`>${tenant.name}</a>`);
        expect(breadcrumb, query).toMatch(
          /<a\b[^>]*aria-current="page"[^>]*>Beach volleyball<\/a>/,
        );

        // The sidebar lists the sports (softball has no league) and marks this one.
        const nav = sidebarHtml(html, tenant.name);
        expect(linkTexts(nav), query).toEqual([
          'Overview',
          'Beach volleyball 12 leagues',
          'Soccer 2 leagues',
          'Locations 3 locations',
        ]);
        expect(currentHrefs(nav), query).toEqual([`${tenant.path}/sports/${BEACH}`]);

        // Meta, from the query result: the canonical and og:url hold ?page=2, and nothing else.
        const canonical = `${path}?page=2`;
        expect(html, query).toContain(
          `<title>Beach volleyball | ${tenant.name} | Omni League</title>`,
        );
        expect(canonicalHrefs(html), query).toHaveLength(1);
        expect(canonicalHrefs(html)[0].endsWith(canonical), query).toBe(true);
        expect(metaContent(html, 'og:url')?.endsWith(canonical), query).toBe(true);
        expect(metaContent(html, 'og:title'), query).toBe('Beach volleyball');
        expect(metaContent(html, 'og:type'), query).toBe('website');
        if (query.includes('utm_source')) expect(html, query).not.toContain('utm_source');
      }
    },
  );

  test(
    'page 1: the first five leagues, the control’s links, and the bare path as canonical',
    RAW_HTTP,
    async ({ request }) => {
      const { path } = await seed();
      const { status, html } = await fetchRawHtml(request, path);
      expect(status).toBe(200);
      expect(leagueNames(html)).toEqual(beachNames(1, 2, 3, 4, 5));
      expect(rangeText(html)).toBe('1–5 of 12 leagues');
      // Each league links to its public page (#127), and shows its location.
      expect(html).toContain(
        `href="${path.replace(`/sports/${BEACH}`, '')}/leagues/beach-league-01"`,
      );
      expect(html).toMatch(/Location: <\/span>\s*Alpha Field/);
      // Previous is not a link on the first page; Next and page 2 go to ?page=2#leagues.
      const nav = /<nav\b[^>]*aria-label="Leagues pages"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1];
      expect(nav).toContain('aria-disabled="true"');
      expect(nav).toContain(`href="${path}?page=2#leagues"`);
      expect(nav).toContain(`href="${path}?page=3#leagues"`);
      expect(canonicalHrefs(html)[0].endsWith(path)).toBe(true);
      expect(canonicalHrefs(html)[0]).not.toContain('?');
    },
  );

  test(
    'an invalid or out-of-range page renders page 1 with 200, the public Cache-Control, no Location, and none of the raw value',
    RAW_HTTP,
    async ({ request }) => {
      const { path } = await seed();
      const canary = 'CANARY7f3a91c2';
      const samples: [string, string[]][] = [
        ['?page=0', ['page=0']],
        ['?page=4', ['page=4']],
        ['?page=41', ['page=41']],
        ['?page=abc', ['page=abc']],
        ['?page=2.5', ['page=2.5']],
        ['?page=02', ['page=02']],
        // The empty value has no text of its own to look for: only its link-free page 1 is checked.
        ['?page=', ['\u0000']],
        // The control links page 3 of 3 on purpose: only the raw repeated parameter must be absent.
        ['?page=2&page=3', ['page=2&page=3', 'page=2&amp;page=3']],
        [`?page=${canary}`, [canary]],
        [`?page=2&page=${canary}`, [canary]],
      ];
      for (const [query, raws] of samples) {
        const { status, headers, html } = await fetchRawHtml(request, `${path}${query}`);
        expect(status, query).toBe(200);
        expect(noSpaces(headers['cache-control']), query).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(headers['location'], query).toBeUndefined();
        expect(leagueNames(html), query).toEqual(beachNames(1, 2, 3, 4, 5));
        expect(canonicalHrefs(html)[0].endsWith(path), query).toBe(true);
        expect(canonicalHrefs(html)[0], query).not.toContain('?');
        for (const raw of raws) expect(html, `${query} ${raw}`).not.toContain(raw);
        expect(JSON.stringify(headers), query).not.toContain(canary);
      }
    },
  );

  // The router cannot decode these query strings; the page renders as if there were none (#91).
  test(
    'a query string the router cannot decode renders page 1 with 200, the public Cache-Control, and no query string in the HTML',
    RAW_HTTP,
    async () => {
      const { path } = await seed();
      for (const query of ['?page=%', '?ref=%', '?page=%E0%A4%A', '?page=2&ref=%']) {
        const response = await rawGet(`${path}${query}`);
        expect(response.status, query).toBe(200);
        expect(noSpaces(response.headers['cache-control']), query).toBe(
          noSpaces(PUBLIC_PAGE_CACHE),
        );
        expect(response.headers.location, query).toBeUndefined();
        expect(leagueNames(response.body), query).toEqual(beachNames(1, 2, 3, 4, 5));
        expect(response.body, query).not.toContain('ref=%');
        expect(response.body, query).not.toContain('page=%');
      }
    },
  );

  test(
    'an unknown sport segment, a sport with no league, and an unknown organization answer 404 with the not-found view',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant } = await seed();
      for (const path of [
        `${tenant.path}/sports/curling`,
        `${tenant.path}/sports/beachVolleyball`,
        `${tenant.path}/sports/Soccer`,
        // A sport the organization has no published league in.
        `${tenant.path}/sports/softball`,
        `/organizations/no-such-org-${tenant.slug}/sports/${BEACH}`,
      ]) {
        const { status, headers, html } = await fetchRawHtml(request, path);
        expect(status, path).toBe(404);
        expect(noSpaces(headers['cache-control']), path).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(html, path).toMatch(/<h1\b[^>]*>\s*Page not found\s*<\/h1>/);
        expect(html.match(/<h1\b/g), path).toHaveLength(1);
        expect(html, path).not.toMatch(/<nav\b/);
        expect(html, path).not.toMatch(/<link\b[^>]*rel="canonical"|property="og:/);
      }
    },
  );

  test(
    'the query string never reaches the HTML, and the response varies by query',
    RAW_HTTP,
    async () => {
      const { path } = await seed();
      const response = await rawGet(`${path}?page=2&ott=SECRETtoken&q=x`);
      expect(response.status).toBe(200);
      expect(response.body).not.toContain('SECRETtoken');
      expect(response.headers['netlify-vary']).toBe('query');
    },
  );

  test(
    'the organization page lists the sports in its sidebar, softball not among them, and no league or location link',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant } = await seed();
      const { status, html } = await fetchRawHtml(request, tenant.path);
      expect(status).toBe(200);
      const nav = sidebarHtml(html, tenant.name);
      expect(linkTexts(nav)).toEqual([
        'Overview',
        'Beach volleyball 12 leagues',
        'Soccer 2 leagues',
        'Locations 3 locations',
      ]);
      expect(nav).toMatch(/<a\b[^>]*aria-current="page"[^>]*>[\s\S]*?Overview<\/span>/);
      expect(nav).toContain(`href="${tenant.path}#locations"`);
      expect(nav).not.toContain('Softball');
      expect(nav).not.toMatch(/href="[^"]*#(league|location)-/);
    },
  );
});

test.describe('sport view in the browser', () => {
  test('hydrates with no console error and passes the axe helper: the organization page and the sport view, pages 1 and 2', async ({
    page,
    consoleGuard,
  }) => {
    const { tenant, path } = await seed();
    await page.goto(tenant.path);
    await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible();
    await hydrated(consoleGuard);
    await expectAccessible(page);

    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'Beach volleyball' })).toBeVisible();
    await expect(page).toHaveTitle(`Beach volleyball | ${tenant.name} | Omni League`);
    await expect(page.locator('section#leagues > ul > li')).toHaveCount(5);
    await expectAccessible(page);

    await page.goto(`${path}?page=3`);
    await expect(page.locator('section#leagues > ul > li')).toHaveCount(2);
    await expectAccessible(page);
  });

  test.describe('an unknown sport', () => {
    test.use({ expectedDocumentStatus: 404 });

    test(
      'is the not-found view with a 404, and hydrates with no console error',
      VIEWPORT_AGNOSTIC,
      async ({ page, consoleGuard }) => {
        const { tenant } = await seed();
        const response = await page.goto(`${tenant.path}/sports/curling`);
        expect(response?.status()).toBe(404);
        await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
        await hydrated(consoleGuard);
        await expect(page.getByRole('navigation')).toHaveCount(0);
      },
    );
  });

  test.describe('keyboard', () => {
    test.skip(({ isMobile }) => isMobile, 'keyboard navigation is checked at 1280');

    test('a sport in the sidebar, selected with the keyboard, shows its view with the title changed and focus on main; Next shows page 2 with focus on the Leagues heading; Back restores page 1', async ({
      page,
      consoleGuard,
    }) => {
      const { tenant, path } = await seed();
      await page.goto(tenant.path);
      await hydrated(consoleGuard);
      await page.evaluate(() => {
        (window as Window & { e2eNoReload?: boolean }).e2eNoReload = true;
      });
      await expect(page).toHaveTitle(`${tenant.name} | Omni League`);

      const sport = page
        .getByRole('navigation', { name: tenant.name })
        .getByRole('link', { name: 'Beach volleyball 12 leagues' });
      await sport.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 1, name: 'Beach volleyball' })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page).toHaveTitle(`Beach volleyball | ${tenant.name} | Omni League`);
      await expect(page.locator('main#main')).toBeFocused();
      await expect(sport).toHaveAttribute('aria-current', 'page');

      const rows = page.locator('section#leagues > ul > li h3');
      await expect(rows).toHaveText(beachNames(1, 2, 3, 4, 5));
      const next = page.getByRole('navigation', { name: 'Leagues pages' }).getByRole('link', {
        name: 'Next page',
      });
      await next.focus();
      await page.keyboard.press('Enter');
      await expect(rows).toHaveText(beachNames(6, 7, 8, 9, 10));
      await expect(page.getByRole('heading', { level: 2, name: 'Leagues' })).toBeFocused();
      expect(new URL(page.url()).search + new URL(page.url()).hash).toBe('?page=2#leagues');
      await expect(page.getByRole('navigation', { name: 'Leagues pages' })).toContainText(
        '6–10 of 12 leagues',
      );
      await page.goBack();
      await expect(rows).toHaveText(beachNames(1, 2, 3, 4, 5));
      expect(new URL(page.url()).search).toBe('');
      expect(
        await page.evaluate(() => (window as Window & { e2eNoReload?: boolean }).e2eNoReload),
      ).toBe(true);
    });
  });

  test.describe('phone sheet', () => {
    test.skip(({ isMobile }) => !isMobile, 'the phone sheet runs at 360px only');

    test('a sport entry closes the sheet and shows the sport view without a page load', async ({
      page,
      consoleGuard,
    }) => {
      const { tenant, path } = await seed();
      await page.goto(tenant.path);
      await hydrated(consoleGuard);
      await page.evaluate(() => {
        (window as Window & { e2eNoReload?: boolean }).e2eNoReload = true;
      });
      const menuButton = page.getByRole('button', { name: 'Open navigation' });
      const dialog = page.getByRole('dialog', { name: 'Navigation' });
      await activate(page, menuButton);
      await expect(dialog.locator('[data-slot="sheet-content"]')).toBeVisible();

      // The entry's accessible name holds the count, and the Sports group has a name.
      await expect(dialog.getByRole('list', { name: 'Sports' })).toBeVisible();
      await activate(page, dialog.getByRole('link', { name: 'Beach volleyball 12 leagues' }));

      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1, name: 'Beach volleyball' })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page).toHaveTitle(`Beach volleyball | ${tenant.name} | Omni League`);
      expect(
        await page.evaluate(() => (window as Window & { e2eNoReload?: boolean }).e2eNoReload),
      ).toBe(true);

      // The sheet on the sport view marks the sport as the current page.
      await activate(page, menuButton);
      await expect(dialog.locator('[data-slot="sheet-content"]')).toBeVisible();
      await expect(dialog.locator('a[aria-current="page"]')).toHaveText(
        'Beach volleyball 12 leagues',
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });
  });

  test(
    'a league published after the page was opened appears in place, with the counts and the control',
    VIEWPORT_AGNOSTIC,
    async ({ page, consoleGuard }) => {
      const { tenant, path } = await seed();
      await page.goto(path);
      await hydrated(consoleGuard);
      await page.evaluate(() => {
        (window as Window & { e2eNoReload?: boolean }).e2eNoReload = true;
      });
      const range = page.getByRole('navigation', { name: 'Leagues pages' });
      await expect(range).toContainText('1–5 of 12 leagues');
      await expect(page.getByText('12 leagues at 3 locations')).toBeVisible();

      // Sorts before "Beach League 01".
      await convexRun('testing:addLeague', {
        organizationSlug: tenant.slug,
        name: 'Aardvark Beach League',
        sport: 'beachVolleyball',
        locations: ['Alpha Field'],
      });

      await expect(range).toContainText('1–5 of 13 leagues');
      await expect(page.getByText('13 leagues at 3 locations')).toBeVisible();
      await expect(page.locator('section#leagues > ul > li h3').first()).toHaveText(
        'Aardvark Beach League',
      );
      expect(
        await page.evaluate(() => (window as Window & { e2eNoReload?: boolean }).e2eNoReload),
      ).toBe(true);
    },
  );
});
