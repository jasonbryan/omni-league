import { formatCalendarDate } from '../convex/lib/seasonInput';
import { axeScan, describeViolations, expectAccessible, tabKey } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import {
  breadcrumbLinksAndText,
  expectLinkHeights,
  footerAnchors,
  pointerOf,
  TOUCH_TABLET,
} from './support/link-heights';
import { rawGet } from './support/raw-get';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import {
  dateFromToday,
  numberedSeasons,
  seedSeasons,
  seedTenant,
  type SeasonSeed,
  type Tenant,
} from './support/tenant';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
/** Netlify removes the spaces after the commas. */
const noSpaces = (value: string | undefined) => value?.replace(/\s+/g, '');

const LEAGUE = 'Sunday Reverse Coed 4s';
const LEAGUE_SLUG = 'sunday-reverse-coed-4s';
const DRAFT_SEASON: SeasonSeed = {
  name: 'Draft Season',
  slug: 'draft-season',
  // Later than every published season, so a draft taking a place would show on page 1.
  startDate: '2030-01-01',
  endDate: '2030-03-01',
  status: 'draft',
};

const DIVISION = { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' } as const;

/** Dated from today, so each keeps its phase however long the suite runs. */
const OPEN_SEASON: SeasonSeed = {
  name: 'Open Season',
  slug: 'open-season',
  startDate: dateFromToday(30),
  endDate: dateFromToday(100),
  registrationDeadline: dateFromToday(10),
};
const CURRENT_SEASON: SeasonSeed = {
  name: 'Current Season',
  slug: 'current-season',
  startDate: dateFromToday(-20),
  endDate: dateFromToday(60),
  registrationDeadline: dateFromToday(-30),
};
const PAST_SEASON: SeasonSeed = {
  name: 'Past Season',
  slug: 'past-season',
  startDate: dateFromToday(-200),
  endDate: dateFromToday(-120),
  registrationDeadline: dateFromToday(-210),
};
const CLOSED_SEASON: SeasonSeed = {
  name: 'Closed Season',
  slug: 'closed-season',
  startDate: dateFromToday(10),
  endDate: dateFromToday(80),
  registrationDeadline: dateFromToday(-2),
};

interface SeededLeague {
  tenant: Tenant;
  path: string;
}

async function seed(): Promise<SeededLeague> {
  const tenant = await seedTenant({
    name: 'E2E League Page',
    locations: [
      { name: 'Beta Courts', address: '2 Beta Street, Corpus Christi, TX 78402' },
      { name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' },
    ],
    leagues: [
      { name: LEAGUE, sport: 'beachVolleyball', locations: ['Beta Courts', 'Alpha Field'] },
      {
        name: 'Zeta Open',
        sport: 'beachVolleyball',
        locations: ['Beta Courts'],
        division: DIVISION,
      },
      { name: 'Zeta Closed', sport: 'beachVolleyball', locations: ['Alpha Field'] },
      { name: 'Zeta Pages', sport: 'beachVolleyball', locations: ['Alpha Field'] },
      { name: 'Only Drafts', sport: 'beachVolleyball', locations: ['Alpha Field'] },
      { name: 'Quiet League', sport: 'beachVolleyball', locations: ['Alpha Field'] },
      {
        name: 'Draft League',
        sport: 'beachVolleyball',
        locations: ['Alpha Field'],
        status: 'draft',
      },
      { name: 'Five League', sport: 'beachVolleyball', locations: ['Alpha Field'] },
      { name: 'Six League', sport: 'beachVolleyball', locations: ['Alpha Field'] },
    ],
  });
  await Promise.all([
    seedSeasons(tenant, LEAGUE_SLUG, [...numberedSeasons(7), DRAFT_SEASON]),
    seedSeasons(tenant, 'only-drafts', [DRAFT_SEASON]),
    seedSeasons(tenant, 'five-league', numberedSeasons(5)),
    seedSeasons(tenant, 'six-league', numberedSeasons(6)),
    seedSeasons(tenant, 'zeta-open', [PAST_SEASON, CURRENT_SEASON, OPEN_SEASON]),
    seedSeasons(tenant, 'zeta-closed', [CLOSED_SEASON]),
    seedSeasons(tenant, 'zeta-pages', [...numberedSeasons(6), OPEN_SEASON]),
  ]);
  return { tenant, path: `${tenant.path}/leagues/${LEAGUE_SLUG}` };
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

function sectionById(html: string, id: string): string {
  return (
    new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</section>`).exec(html)?.[1] ?? ''
  );
}

/** The names in the Seasons section, which leaves out the open season card and the locations. */
function seasonNames(html: string): string[] {
  return [...sectionById(html, 'seasons').matchAll(/<h3\b[^>]*>\s*(?:<a\b[^>]*>)?([^<]*)/g)].map(
    ([, name]) => name.trim(),
  );
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rangeText(html: string): string | undefined {
  const nav = /<nav\b[^>]*aria-label="Seasons pages"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1];
  const text = /<p\b[^>]*>([\s\S]*?)<\/p>/.exec(nav ?? '')?.[1];
  return text
    ?.replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function hydrated(consoleGuard: { hydrated: boolean }): Promise<void> {
  await expect
    .poll(() => consoleGuard.hydrated, {
      message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
    })
    .toBe(true);
}

test.describe('public league page: raw server HTML', () => {
  test(
    '?page=2: seasons 6 and 7 by newest start date and no draft; the range, h1, breadcrumb, sport, locations, 200, the public Cache-Control, and the canonical with ?page=2',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, path } = await seed();
      for (const query of ['?page=2', '?page=2&utm_source=x']) {
        const { status, headers, html } = await fetchRawHtml(request, `${path}${query}`);
        expect(status, query).toBe(200);
        expect(noSpaces(headers['cache-control']), query).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(headers['content-type'], query).toContain('text/html');

        expect(seasonNames(html), query).toEqual(['Season 02', 'Season 01']);
        expect(html, query).not.toContain('Draft Season');
        expect(rangeText(html), query).toBe('6–7 of 7 seasons');

        expect(html.match(/<h1\b/g), query).toHaveLength(1);
        expect(html, query).toMatch(new RegExp(`<h1\\b[^>]*>\\s*${LEAGUE}\\s*</h1>`));
        const breadcrumb = /<nav\b[^>]*aria-label="Breadcrumb"[^>]*>[\s\S]*?<\/nav>/.exec(
          html,
        )?.[0];
        expect(breadcrumb, query).toBeDefined();
        expect(breadcrumb, query).toContain(`>${tenant.name}</a>`);
        expect(breadcrumb, query).toMatch(
          new RegExp(
            `<a\\b[^>]*href="[^"]*${tenant.path}/sports/beach-volleyball"[^>]*>Beach volleyball</a>`,
          ),
        );
        expect(html, query).toContain('Beach volleyball · Beta Courts, Alpha Field');
        expect(plainText(sectionById(html, 'where')), query).toContain(
          'Beta Courts 2 Beta Street, Corpus Christi, TX 78402 Alpha Field 1 Alpha Road, Corpus Christi, TX 78412',
        );

        expect(html, query).not.toContain('aria-label="Open navigation"');
        expect(html, query).not.toContain(`aria-label="${tenant.name}"`);

        const canonical = `${path}?page=2`;
        expect(html, query).toContain(`<title>${LEAGUE} | ${tenant.name} | Omni League</title>`);
        expect(canonicalHrefs(html), query).toHaveLength(1);
        expect(canonicalHrefs(html)[0].endsWith(canonical), query).toBe(true);
        expect(metaContent(html, 'og:url')?.endsWith(canonical), query).toBe(true);
        expect(metaContent(html, 'og:title'), query).toBe(LEAGUE);
        expect(metaContent(html, 'og:type'), query).toBe('website');
        if (query.includes('utm_source')) expect(html, query).not.toContain('utm_source');
      }
    },
  );

  test(
    'page 1: the five newest seasons, the control’s links, and the bare path as canonical',
    RAW_HTTP,
    async ({ request }) => {
      const { path } = await seed();
      const { status, html } = await fetchRawHtml(request, path);
      expect(status).toBe(200);
      expect(seasonNames(html)).toEqual([
        'Season 07',
        'Season 06',
        'Season 05',
        'Season 04',
        'Season 03',
      ]);
      expect(rangeText(html)).toBe('1–5 of 7 seasons');
      expect(html).not.toContain('Draft Season');
      expect(html).toContain(`href="${path}/seasons/season-07"`);
      const nav = /<nav\b[^>]*aria-label="Seasons pages"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1];
      expect(nav).toContain('aria-disabled="true"');
      expect(nav).toContain(`href="${path}?page=2#seasons"`);
      expect(nav).toMatch(/aria-current="page"[^>]*>\s*<span class="sr-only">Page <\/span>1</);
      expect(canonicalHrefs(html)[0].endsWith(path)).toBe(true);
      expect(canonicalHrefs(html)[0]).not.toContain('?');
    },
  );

  test(
    'the control renders for more than 5 seasons only: none for 5, two pages for 6',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant } = await seed();
      const five = await fetchRawHtml(request, `${tenant.path}/leagues/five-league`);
      expect(five.status).toBe(200);
      expect(seasonNames(five.html)).toHaveLength(5);
      expect(five.html).not.toContain('aria-label="Seasons pages"');
      const six = await fetchRawHtml(request, `${tenant.path}/leagues/six-league`);
      expect(six.status).toBe(200);
      expect(seasonNames(six.html)).toHaveLength(5);
      expect(rangeText(six.html)).toBe('1–5 of 6 seasons');
      const sixPage2 = await fetchRawHtml(request, `${tenant.path}/leagues/six-league?page=2`);
      expect(seasonNames(sixPage2.html)).toEqual(['Season 01']);
      expect(rangeText(sixPage2.html)).toBe('6–6 of 6 seasons');
    },
  );

  test(
    'an invalid or out-of-range page renders page 1 with 200, the public Cache-Control, no Location, and none of the raw value',
    RAW_HTTP,
    async ({ request }) => {
      const { path } = await seed();
      const canary = 'CANARY7f3a91c2';
      const samples: [string, string][] = [
        ['?page=0', 'page=0'],
        ['?page=9', 'page=9'],
        ['?page=41', 'page=41'],
        ['?page=abc', 'page=abc'],
        ['?page=2.5', 'page=2.5'],
        ['?page=02', 'page=02'],
        // The empty value has no text of its own to look for: only its link-free page 1 is checked.
        ['?page=', '\u0000'],
        ['?page=2&page=3', 'page=3'],
        [`?page=${canary}`, canary],
        [`?page=2&page=${canary}`, canary],
      ];
      for (const [query, raw] of samples) {
        const { status, headers, html } = await fetchRawHtml(request, `${path}${query}`);
        expect(status, query).toBe(200);
        expect(noSpaces(headers['cache-control']), query).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(headers['location'], query).toBeUndefined();
        expect(seasonNames(html), query).toEqual([
          'Season 07',
          'Season 06',
          'Season 05',
          'Season 04',
          'Season 03',
        ]);
        expect(canonicalHrefs(html)[0].endsWith(path), query).toBe(true);
        expect(canonicalHrefs(html)[0], query).not.toContain('?');
        expect(html, query).not.toContain(raw);
        expect(JSON.stringify(headers), query).not.toContain(canary);
      }
    },
  );

  // The router cannot decode these query strings; the page renders as if there were none.
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
        expect(seasonNames(response.body), query).toEqual([
          'Season 07',
          'Season 06',
          'Season 05',
          'Season 04',
          'Season 03',
        ]);
        expect(response.body, query).not.toContain('ref=%');
        expect(response.body, query).not.toContain('page=%');
      }
    },
  );

  test(
    'a published league with only draft seasons, and one with none, show the empty state and no control',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant } = await seed();
      for (const [slug, leagueName] of [
        ['only-drafts', 'Only Drafts'],
        ['quiet-league', 'Quiet League'],
      ]) {
        const { status, html } = await fetchRawHtml(request, `${tenant.path}/leagues/${slug}`);
        expect(status, slug).toBe(200);
        expect(html, slug).toContain('No seasons yet');
        const seasonsText = plainText(sectionById(html, 'seasons'));
        const intro = `Each season is one run of ${leagueName}, with its own dates, registration, teams, and schedule.`;
        expect(seasonsText, slug).toContain(intro);
        expect(seasonsText.indexOf(intro), slug).toBeLessThan(
          seasonsText.indexOf('No seasons yet'),
        );
        expect(plainText(html), slug).toContain(
          `When ${tenant.name} publishes a season, its dates and registration appear here.`,
        );
        expect(
          new RegExp(`<a\\b[^>]*href="${tenant.path}"[^>]*>See their other leagues`).exec(
            sectionById(html, 'seasons'),
          ),
          slug,
        ).not.toBeNull();
        expect(html, slug).not.toContain('Draft Season');
        expect(html, slug).not.toContain('id="registration-open"');
        expect(html, slug).not.toContain('aria-label="Seasons pages"');
        expect(seasonNames(html), slug).toEqual([]);
      }
    },
  );

  test(
    'an open season shows as a card first with its Register link, and every season as a row with its status, where it is played, and who runs it',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant } = await seed();
      const path = `${tenant.path}/leagues/zeta-open`;
      const { status, html } = await fetchRawHtml(request, path);
      expect(status).toBe(200);

      const breadcrumb = /<nav\b[^>]*aria-label="Breadcrumb"[^>]*>[\s\S]*?<\/nav>/.exec(html)?.[0];
      expect(breadcrumb).toContain(`href="${tenant.path}"`);
      expect(breadcrumb).toContain(`href="${tenant.path}/sports/beach-volleyball"`);
      expect(html).toMatch(/<h1\b[^>]*>\s*Zeta Open\s*<\/h1>/);
      expect(html).toContain('Coed · 4v4 · BB');

      const card = sectionById(html, 'registration-open');
      expect(plainText(card)).toContain('Registration open Open Season');
      expect(plainText(card)).toContain('Coed · 4v4 · BB, teams of at least 4');
      expect(plainText(card)).toContain(
        `Closes ${formatCalendarDate(OPEN_SEASON.registrationDeadline!)}`,
      );
      expect(card).toMatch(
        new RegExp(
          `<a\\b[^>]*data-slot="button"[^>]*href="${path}/seasons/open-season#registration"[^>]*>`,
        ),
      );
      expect(plainText(card)).toContain('Register for Open Season');
      expect(html.indexOf('id="registration-open"')).toBeLessThan(html.indexOf('id="seasons"'));

      expect(seasonNames(html)).toEqual(['Open Season', 'Current Season', 'Past Season']);
      const rows = [...sectionById(html, 'seasons').matchAll(/<li\b[\s\S]*?<\/li>/g)].map(([row]) =>
        plainText(row),
      );
      expect(rows[0]).toContain('Registration open');
      expect(rows[0]).toContain(`closes ${formatCalendarDate(OPEN_SEASON.registrationDeadline!)}`);
      expect(rows[1]).toContain('In progress');
      expect(rows[2]).toContain('Ended');
      expect(plainText(sectionById(html, 'seasons'))).toContain('3 seasons');
      expect(plainText(sectionById(html, 'seasons'))).toContain(
        'Each season is one run of Zeta Open, with its own dates, registration, teams, and schedule.',
      );
      expect(plainText(card)).toMatch(/^Registration open /);

      const where = plainText(sectionById(html, 'where'));
      expect(where).toContain(
        'Where it’s played Beta Courts 2 Beta Street, Corpus Christi, TX 78402',
      );
      expect(where).toContain(`Run by ${tenant.name}`);
    },
  );

  test(
    '?page=2#seasons on a league with 7 seasons whose newest is open still shows the card',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant } = await seed();
      const { status, html } = await fetchRawHtml(
        request,
        `${tenant.path}/leagues/zeta-pages?page=2`,
      );
      expect(status).toBe(200);
      expect(seasonNames(html)).toEqual(['Season 02', 'Season 01']);
      expect(plainText(sectionById(html, 'registration-open'))).toContain('Open Season');
    },
  );

  test(
    'a league with no open registration shows no card, and the closed season reads Registration closed',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant } = await seed();
      const { status, html } = await fetchRawHtml(request, `${tenant.path}/leagues/zeta-closed`);
      expect(status).toBe(200);
      expect(html).not.toContain('id="registration-open"');
      expect(seasonNames(html)).toEqual(['Closed Season']);
      expect(plainText(sectionById(html, 'seasons'))).toContain('Registration closed');
    },
  );

  test(
    'a draft league, an unknown league, and an unknown organization answer 404 with the not-found view',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant } = await seed();
      const other = await seedTenant({ name: 'E2E Other Org' });
      for (const path of [
        `${tenant.path}/leagues/draft-league`,
        `${tenant.path}/leagues/no-such-league`,
        `/organizations/no-such-org-${tenant.slug}/leagues/${LEAGUE_SLUG}`,
        `${other.path}/leagues/${LEAGUE_SLUG}`,
      ]) {
        const { status, headers, html } = await fetchRawHtml(request, path);
        expect(status, path).toBe(404);
        expect(noSpaces(headers['cache-control']), path).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(html, path).toMatch(/<h1\b[^>]*>\s*Page not found\s*<\/h1>/);
        expect(html.match(/<h1\b/g), path).toHaveLength(1);
        expect(html.match(/<nav\b/g), path).toHaveLength(1);
        expect(html, path).toContain('<nav aria-label="Footer"');
        expect(html, path).not.toMatch(/<link\b[^>]*rel="canonical"|property="og:/);
        expect(html, path).not.toContain('Draft League');
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
});

test.describe('public league page in the browser', () => {
  test('hydrates with no console error and passes the axe helper: populated page 1, page 2, and the empty state', async ({
    page,
    consoleGuard,
  }) => {
    const { tenant, path } = await seed();
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: LEAGUE })).toBeVisible();
    await hydrated(consoleGuard);
    await expect(page).toHaveTitle(`${LEAGUE} | ${tenant.name} | Omni League`);
    await expect(page.locator('section#seasons > ul > li')).toHaveCount(5);
    await expectAccessible(page);

    await page.goto(`${path}?page=2`);
    await expect(page.locator('section#seasons > ul > li')).toHaveCount(2);
    await expectAccessible(page);

    await page.goto(`${tenant.path}/leagues/quiet-league`);
    await expect(page.getByText('No seasons yet')).toBeVisible();
    await expectAccessible(page);

    await page.goto(`${tenant.path}/leagues/zeta-open`);
    await expect(page.locator('section#registration-open')).toBeVisible();
    await expectAccessible(page);
  });

  test('the breadcrumb, the footer, and "See their other leagues" are 44px tall under a touch pointer and a line tall under a mouse', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const { tenant, path } = await seed();
    const pointer = pointerOf(testInfo);
    await page.goto(path);
    await hydrated(consoleGuard);
    await expectLinkHeights(page, breadcrumbLinksAndText(page), pointer);
    await expectLinkHeights(page, footerAnchors(page), pointer);

    await page.goto(`${tenant.path}/leagues/quiet-league`);
    await expect(page.getByText('No seasons yet')).toBeVisible();
    await expectLinkHeights(
      page,
      page.getByRole('link', { name: 'See their other leagues' }),
      pointer,
    );
  });

  test.describe('a touch tablet', () => {
    test.use(TOUCH_TABLET);

    test('the breadcrumb, the footer, and "See their other leagues" are 44px tall', async ({
      page,
      consoleGuard,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium-desktop', 'sets its own viewport and touch');
      const { tenant, path } = await seed();
      await page.goto(path);
      await hydrated(consoleGuard);
      await expectLinkHeights(page, breadcrumbLinksAndText(page), 'touch');
      await expectLinkHeights(page, footerAnchors(page), 'touch');

      await page.goto(`${tenant.path}/leagues/quiet-league`);
      await expect(page.getByText('No seasons yet')).toBeVisible();
      await expectLinkHeights(
        page,
        page.getByRole('link', { name: 'See their other leagues' }),
        'touch',
      );
    });
  });

  test('the open season card registers through the season page, and a row opens its season', async ({
    page,
    consoleGuard,
  }) => {
    const { tenant } = await seed();
    const path = `${tenant.path}/leagues/zeta-open`;
    await page.goto(path);
    await hydrated(consoleGuard);
    await page.getByRole('link', { name: 'Register for Open Season' }).click();
    await expect(page).toHaveURL(`${baseURL}${path}/seasons/open-season#registration`);
    await page.goBack();
    await page.getByRole('link', { name: 'Current Season' }).click();
    await expect(page).toHaveURL(`${baseURL}${path}/seasons/current-season`);
  });

  test.describe('first load', () => {
    test('never shows the skeleton, keeps the server-rendered h1 element, and leaves focus where it was', async ({
      page,
      consoleGuard,
    }) => {
      const { path } = await seed();
      await page.addInitScript(() => {
        const watch = window as Window & { e2eSkeletonSeen?: boolean; e2eFirstH1?: Element };
        watch.e2eSkeletonSeen = false;
        const check = () => {
          const first = document.querySelector('main h1');
          if (first && !watch.e2eFirstH1) watch.e2eFirstH1 = first;
          if (document.body.textContent.includes('Loading the league.')) {
            watch.e2eSkeletonSeen = true;
          }
        };
        new MutationObserver(check).observe(document, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: LEAGUE })).toBeVisible();
      await hydrated(consoleGuard);
      const watched = await page.evaluate(() => {
        const watch = window as Window & { e2eSkeletonSeen?: boolean; e2eFirstH1?: Element };
        return {
          skeletonSeen: watch.e2eSkeletonSeen,
          sameH1:
            watch.e2eFirstH1 !== undefined &&
            watch.e2eFirstH1 === document.querySelector('main h1'),
          mainFocused: document.activeElement === document.querySelector('main#main'),
        };
      });
      expect(watched).toEqual({ skeletonSeen: false, sameH1: true, mainFocused: false });
    });
  });

  test.describe('after an in-app navigation', () => {
    test('shows the skeleton with its status while the data is on its way, then the page with its h1 within 4px of the skeleton’s heading bar, and focus on main', async ({
      page,
      consoleGuard,
    }) => {
      const { tenant, path } = await seed();
      const held = await holdQueries(page, ['leagues:getPublicPage', 'seasons:listPublic']);
      await page.goto(tenant.path);
      await hydrated(consoleGuard);

      await page.locator(`main a[href="${path}"]`).click();
      await expect.poll(() => held.isHolding()).toBe(true);
      await expect(page).toHaveURL(`${baseURL}${path}`);

      const skeleton = page.getByTestId('league-skeleton');
      await expect(skeleton).toBeVisible();
      await expect(skeleton.getByRole('status')).toHaveText('Loading the league.');
      await expect(skeleton.getByRole('status')).toHaveClass(/sr-only/);
      await expect(page.locator('main').getByRole('heading')).toHaveCount(0);
      await expect(page.locator('main[id="main"]')).toBeFocused();
      const skeletonScan = await axeScan(page);
      expect(describeViolations(skeletonScan.violations)).toEqual([]);
      const bar = await skeleton.locator('span').nth(1).boundingBox();

      held.release();
      const h1 = page.getByRole('heading', { level: 1, name: LEAGUE });
      await expect(h1).toBeVisible();
      await expect(skeleton).toHaveCount(0);
      const heading = await h1.boundingBox();
      expect(Math.abs((heading?.y ?? Infinity) - (bar?.y ?? -Infinity))).toBeLessThanOrEqual(4);
      await expect(page.locator('main[id="main"]')).toBeFocused();
    });
  });

  test.describe('a draft league', () => {
    test.use({ expectedDocumentStatus: 404 });

    test(
      'its page is the not-found view with a 404, and hydrates with no console error',
      VIEWPORT_AGNOSTIC,
      async ({ page, consoleGuard }) => {
        const { tenant } = await seed();
        const response = await page.goto(`${tenant.path}/leagues/draft-league`);
        expect(response?.status()).toBe(404);
        await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
        await hydrated(consoleGuard);
        await expect(page.getByRole('navigation')).toHaveCount(1);
      },
    );
  });

  test.describe('keyboard', () => {
    test.skip(({ isMobile }) => isMobile, 'keyboard navigation is checked at 1280');

    test('a league row’s link on the organization page, followed with the keyboard, opens the league page with focus on main', async ({
      page,
      consoleGuard,
    }) => {
      const { tenant, path } = await seed();
      await page.goto(tenant.path);
      await hydrated(consoleGuard);
      const link = page.getByRole('main').getByRole('link', { name: LEAGUE, exact: true });
      await expect(link).toHaveAttribute('href', `${path}`);
      await link.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 1, name: LEAGUE })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(page.locator('main#main')).toBeFocused();
      await expect(page).toHaveTitle(`${LEAGUE} | ${tenant.name} | Omni League`);
    });

    test('Next, activated by keyboard, shows page 2 with focus on the Seasons heading and the URL ?page=2#seasons; Back restores page 1', async ({
      page,
      consoleGuard,
    }) => {
      const { path } = await seed();
      await page.goto(path);
      await hydrated(consoleGuard);
      await page.evaluate(() => {
        (window as Window & { e2eNoReload?: boolean }).e2eNoReload = true;
      });
      const rows = page.locator('section#seasons > ul > li h3');
      await expect(rows).toHaveText([
        'Season 07',
        'Season 06',
        'Season 05',
        'Season 04',
        'Season 03',
      ]);

      const next = page.getByRole('navigation', { name: 'Seasons pages' }).getByRole('link', {
        name: 'Next page',
      });
      await next.focus();
      await page.keyboard.press('Enter');
      await expect(rows).toHaveText(['Season 02', 'Season 01']);
      await expect(page.getByRole('heading', { level: 2, name: 'Seasons' })).toBeFocused();
      expect(new URL(page.url()).search + new URL(page.url()).hash).toBe('?page=2#seasons');
      await expect(page.getByRole('navigation', { name: 'Seasons pages' })).toContainText(
        '6–7 of 7 seasons',
      );
      await page.goBack();
      await expect(rows).toHaveText([
        'Season 07',
        'Season 06',
        'Season 05',
        'Season 04',
        'Season 03',
      ]);
      expect(new URL(page.url()).search).toBe('');
      expect(
        await page.evaluate(() => (window as Window & { e2eNoReload?: boolean }).e2eNoReload),
      ).toBe(true);
    });

    test('the first Tab on the league page reaches the skip link, then the top bar', async ({
      page,
      consoleGuard,
    }) => {
      const { path } = await seed();
      await page.goto(path);
      await hydrated(consoleGuard);
      await page.keyboard.press(tabKey(page));
      await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    });
  });

  test(
    'a season published after the page was opened appears in place, and the total follows',
    VIEWPORT_AGNOSTIC,
    async ({ page, consoleGuard }) => {
      const { tenant } = await seed();
      await page.goto(`${tenant.path}/leagues/six-league`);
      await hydrated(consoleGuard);
      const range = page.getByRole('navigation', { name: 'Seasons pages' });
      await expect(range).toContainText('1–5 of 6 seasons');
      await seedSeasons(tenant, 'six-league', [
        { name: 'Season 99', slug: 'season-99', startDate: '2040-01-01', endDate: '2040-03-01' },
      ]);
      await expect(range).toContainText('1–5 of 7 seasons');
      await expect(page.locator('section#seasons > ul > li h3').first()).toHaveText('Season 99');
    },
  );
});
