import type { Locator, Page } from '@playwright/test';
import { axeScan, describeViolations, expectAccessible } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { screenshot } from './support/screenshot';
import {
  dateFromToday,
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
const SUMMER: SeasonSeed = {
  name: 'Summer 2027',
  slug: 'summer-2027',
  startDate: '2027-06-06',
  endDate: '2027-08-29',
};
/** Dates that read as the day before when a date-only string is parsed as UTC west of UTC. */
const NEW_YEAR: SeasonSeed = {
  name: 'New Year 2027',
  slug: 'new-year-2027',
  startDate: '2027-01-01',
  endDate: '2027-03-01',
};
const CROSS_YEAR: SeasonSeed = {
  name: 'Winter 2027-28',
  slug: 'winter-2027-28',
  startDate: '2027-12-01',
  endDate: '2028-02-20',
};
const ONE_DAY: SeasonSeed = {
  name: 'One Day Cup',
  slug: 'one-day-cup',
  startDate: '2027-09-04',
  endDate: '2027-09-04',
};
/** Dates counted from the test's clock, so the season stays open however long the suite has run. */
const OPEN_SEASON: SeasonSeed = {
  name: 'Fall Open',
  slug: 'fall-open',
  startDate: dateFromToday(40),
  endDate: dateFromToday(100),
  registrationDeadline: dateFromToday(20),
};
const DRAFT_SEASON: SeasonSeed = {
  name: 'Draft Season',
  slug: 'draft-season',
  startDate: '2028-01-01',
  endDate: '2028-03-01',
  status: 'draft',
};

interface SeededSeason {
  tenant: Tenant;
  path: string;
}

async function seed(): Promise<SeededSeason> {
  const tenant = await seedTenant({
    name: 'E2E Season Page',
    locations: [
      { name: 'Beta Courts', address: '2 Beta Street, Corpus Christi, TX 78402' },
      { name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' },
    ],
    leagues: [
      {
        name: LEAGUE,
        sport: 'beachVolleyball',
        locations: ['Beta Courts', 'Alpha Field'],
        division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
      },
      {
        name: 'Draft League',
        sport: 'beachVolleyball',
        locations: ['Alpha Field'],
        status: 'draft',
      },
      { name: 'Other League', sport: 'beachVolleyball', locations: ['Alpha Field'] },
    ],
  });
  await Promise.all([
    seedSeasons(tenant, LEAGUE_SLUG, [
      SUMMER,
      NEW_YEAR,
      CROSS_YEAR,
      ONE_DAY,
      OPEN_SEASON,
      DRAFT_SEASON,
    ]),
    seedSeasons(tenant, 'draft-league', [SUMMER]),
    seedSeasons(tenant, 'other-league', [
      {
        name: 'Other Season',
        slug: 'other-season',
        startDate: '2027-02-01',
        endDate: '2027-04-01',
      },
    ]),
  ]);
  return { tenant, path: `${tenant.path}/leagues/${LEAGUE_SLUG}/seasons/summer-2027` };
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

function textOf(fragment: string | undefined): string {
  return (fragment ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&ndash;/g, '–')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A space where each tag was keeps a label and its value apart. */
function detailRow(html: string, term: string): string | undefined {
  const rows = [...html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>([\s\S]*?)(?=<dt\b|<\/dl>)/g)];
  const row = rows.find(([, dt]) => textOf(dt) === term);
  return row ? spacedText(row[2]) : undefined;
}

function spacedText(fragment: string | undefined): string {
  return (fragment ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function registrationCard(html: string): string | undefined {
  return /<section\b[^>]*id="registration"[^>]*>[\s\S]*?<\/section>/.exec(html)?.[0];
}

function definition(html: string, term: string): string | undefined {
  const rows = [...html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/g)];
  return rows.find(([, dt]) => textOf(dt) === term)?.[2];
}

async function hydrated(consoleGuard: { hydrated: boolean }): Promise<void> {
  await expect
    .poll(() => consoleGuard.hydrated, {
      message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
    })
    .toBe(true);
}

test.describe('public season page: raw server HTML', () => {
  test(
    'a published season of a published league: 200, the public Cache-Control, h1, breadcrumb, both dates as stored, format, team size, locations, canonical, and og:description',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, path } = await seed();
      for (const query of ['', '?ott=SECRETtoken&page=2']) {
        const { status, headers, html } = await fetchRawHtml(request, `${path}${query}`);
        expect(status, query).toBe(200);
        expect(noSpaces(headers['cache-control']), query).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(headers['content-type'], query).toContain('text/html');
        expect(headers['netlify-vary'], query).toBe('query');

        expect(html.match(/<h1\b/g), query).toHaveLength(1);
        expect(textOf(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]), query).toBe(
          `${LEAGUE} · Summer 2027`,
        );
        const breadcrumb = /<nav\b[^>]*aria-label="Breadcrumb"[^>]*>[\s\S]*?<\/nav>/.exec(
          html,
        )?.[0];
        expect(breadcrumb, query).toBeDefined();
        expect(breadcrumb, query).toContain(`href="${tenant.path}"`);
        expect(breadcrumb, query).toContain(`>${tenant.name}</a>`);
        expect(breadcrumb, query).toContain(`href="${tenant.path}/leagues/${LEAGUE_SLUG}"`);
        expect(breadcrumb, query).toContain(`>${LEAGUE}</a>`);
        expect(breadcrumb, query).toMatch(
          new RegExp(`<a\\b[^>]*aria-current="page"[^>]*>Summer 2027</a>`),
        );

        const dates = definition(html, 'Dates');
        expect(dates, query).toContain('datetime="2027-06-06"');
        expect(dates, query).toContain('datetime="2027-08-29"');
        expect(textOf(dates), query).toBe('Jun 6 – Aug 29, 2027');
        expect(html, query).not.toContain('4 v 4');

        expect(html, query).not.toContain('/sports/');
        expect(html, query).not.toContain('aria-label="Open navigation"');
        expect(html, query).not.toContain(`aria-label="${tenant.name}"`);

        expect(html, query).not.toMatch(/\$\d/);

        expect(html, query).toContain(
          `<title>${LEAGUE} · Summer 2027 | ${tenant.name} | Omni League</title>`,
        );
        expect(canonicalHrefs(html), query).toHaveLength(1);
        expect(canonicalHrefs(html)[0].endsWith(path), query).toBe(true);
        expect(canonicalHrefs(html)[0], query).not.toContain('?');
        expect(metaContent(html, 'og:url')?.endsWith(path), query).toBe(true);
        expect(metaContent(html, 'og:title'), query).toBe(
          `${LEAGUE} · Summer 2027 | ${tenant.name} | Omni League`,
        );
        expect(metaContent(html, 'og:type'), query).toBe('website');
        expect(metaContent(html, 'og:description'), query).toBe(
          'Jun 6 – Aug 29, 2027. 4v4, teams need at least 4 players.',
        );
        expect(html, query).not.toContain('SECRETtoken');
        expect(html, query).not.toContain('Draft Season');
      }
    },
  );

  test(
    'a draft season, a published season of a draft league, an unknown season, a season slug of another league, an unknown league, and an unknown organization answer 404 with the not-found view',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant } = await seed();
      const other = await seedTenant({ name: 'E2E Other Org' });
      const league = `${tenant.path}/leagues/${LEAGUE_SLUG}`;
      for (const path of [
        `${league}/seasons/draft-season`,
        `${tenant.path}/leagues/draft-league/seasons/summer-2027`,
        `${league}/seasons/no-such-season`,
        `${league}/seasons/other-season`,
        `${tenant.path}/leagues/other-league/seasons/summer-2027`,
        `${tenant.path}/leagues/no-such-league/seasons/summer-2027`,
        `/organizations/no-such-org-${tenant.slug}/leagues/${LEAGUE_SLUG}/seasons/summer-2027`,
        `${other.path}/leagues/${LEAGUE_SLUG}/seasons/summer-2027`,
      ]) {
        const { status, headers, html } = await fetchRawHtml(request, path);
        expect(status, path).toBe(404);
        expect(noSpaces(headers['cache-control']), path).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(html, path).toMatch(/<h1\b[^>]*>\s*Page not found\s*<\/h1>/);
        expect(html.match(/<h1\b/g), path).toHaveLength(1);
        expect(html.match(/<nav\b/g), path).toHaveLength(1);
        expect(html, path).toContain('<nav aria-label="Footer"');
        expect(html, path).not.toMatch(/<link\b[^>]*rel="canonical"|property="og:/);
        expect(html, path).not.toContain('Draft Season');
        expect(html, path).not.toContain('Other Season');
      }
    },
  );
});

test.describe('public season page: registration card and details in the raw server HTML', () => {
  test(
    'an open season: the registration card follows the h1 and precedes the details, with its deadline and the steps',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant } = await seed();
      const { html } = await fetchRawHtml(
        request,
        `${tenant.path}/leagues/${LEAGUE_SLUG}/seasons/fall-open`,
      );
      const order = ['<h1', 'id="registration"', 'id="details-heading"', 'id="how-heading"'].map(
        (marker) => html.indexOf(marker),
      );
      expect(order.every((position) => position > 0)).toBe(true);
      expect(order).toEqual([...order].sort((a, b) => a - b));

      const card = spacedText(registrationCard(html));
      expect(card).toContain('Registration open');
      const closes = formatDate(OPEN_SEASON.registrationDeadline ?? '');
      expect(card).toContain(`Registration open · closes ${closes}`);
      expect(card).toContain('Captains register a team, then invite their players.');
      expect(spacedText(html.slice(html.indexOf('id="how-heading"')))).toContain(
        'Teams need at least 4 players before registration closes. 3 Play Games start',
      );
    },
  );

  test(
    'a closed season links to the league’s open season, and a league with none shows no link',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, path } = await seed();
      const closed = await fetchRawHtml(request, path);
      const card = registrationCard(closed.html);
      expect(spacedText(card)).toContain('Registration closed');
      expect(spacedText(card)).toContain('Registration is open for Fall Open.');
      expect(card).toContain(`href="${tenant.path}/leagues/${LEAGUE_SLUG}/seasons/fall-open"`);
      expect(closed.html).not.toContain('id="how-heading"');
      expect(spacedText(card)).not.toContain('Captains register a team');

      const none = await fetchRawHtml(
        request,
        `${tenant.path}/leagues/other-league/seasons/other-season`,
      );
      const noneCard = registrationCard(none.html);
      expect(spacedText(noneCard)).toContain('Registration closed');
      expect(noneCard).not.toContain('<a');
    },
  );

  test(
    'the details hold the dates, division, deadline, and each location with its address, and no weeks line',
    RAW_HTTP,
    async ({ request }) => {
      const { path } = await seed();
      const { html } = await fetchRawHtml(request, path);
      expect(detailRow(html, 'Dates')).toBe('Jun 6 – Aug 29, 2027');
      expect(detailRow(html, 'Division')).toBe(
        'Coed · 4v4 · BB From the league · teams need at least 4 players',
      );
      expect(detailRow(html, 'Registration closes')).toBe('Dec 1, 2025');
      expect(detailRow(html, 'Locations')).toBe(
        'Beta Courts 2 Beta Street, Corpus Christi, TX 78402 Alpha Field 1 Alpha Road, Corpus Christi, TX 78412',
      );
      expect(spacedText(html)).not.toMatch(/\bweeks?\b/i);
    },
  );
});

test.describe('public season page: dates and locations in the raw server HTML', () => {
  test(
    'a season across two years writes both years, a season of one day writes one date, and one location reads "Location"',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant } = await seed();
      const league = `${tenant.path}/leagues/${LEAGUE_SLUG}/seasons`;

      const cross = await fetchRawHtml(request, `${league}/winter-2027-28`);
      expect(cross.status).toBe(200);
      const crossDates = definition(cross.html, 'Dates');
      expect(textOf(crossDates)).toBe('Dec 1, 2027 – Feb 20, 2028');
      expect(crossDates).toContain('<time datetime="2027-12-01">Dec 1, 2027</time>');
      expect(crossDates).toContain('<time datetime="2028-02-20">Feb 20, 2028</time>');
      expect(metaContent(cross.html, 'og:description')).toBe(
        'Dec 1, 2027 – Feb 20, 2028. 4v4, teams need at least 4 players.',
      );

      const one = await fetchRawHtml(request, `${league}/one-day-cup`);
      expect(one.status).toBe(200);
      const oneDates = definition(one.html, 'Dates');
      expect(textOf(oneDates)).toBe('Sep 4, 2027');
      expect(oneDates?.match(/<time\b/g)).toHaveLength(1);
      expect(oneDates).not.toContain('–');
      expect(metaContent(one.html, 'og:description')).toBe(
        'Sep 4, 2027. 4v4, teams need at least 4 players.',
      );

      const single = await fetchRawHtml(
        request,
        `${tenant.path}/leagues/other-league/seasons/other-season`,
      );
      expect(single.status).toBe(200);
      expect(detailRow(single.html, 'Location')).toBe(
        'Alpha Field 1 Alpha Road, Corpus Christi, TX 78412',
      );
      expect(definition(single.html, 'Locations')).toBeUndefined();
    },
  );
});

test.describe('public season page in the browser', () => {
  test('hydrates with no console error and passes the axe helper', async ({
    page,
    consoleGuard,
  }) => {
    const { tenant, path } = await seed();
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'Summer 2027' })).toBeVisible();
    await hydrated(consoleGuard);
    await expect(page).toHaveTitle(`${LEAGUE} · Summer 2027 | ${tenant.name} | Omni League`);
    await expect(page.getByRole('heading', { level: 2, name: 'Season details' })).toBeVisible();
    await expect(page.locator('main dl')).toContainText('Jun 6 – Aug 29, 2027');
    await expect(page.locator('main dl')).toContainText('teams need at least 4 players');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expectAccessible(page);
  });

  test('the open season passes the axe helper, with nothing fixed over a focused element', async ({
    page,
    consoleGuard,
  }) => {
    const { tenant } = await seed();
    await page.goto(`${tenant.path}/leagues/${LEAGUE_SLUG}/seasons/fall-open`);
    await expect(page.getByRole('heading', { level: 1, name: 'Fall Open' })).toBeVisible();
    await hydrated(consoleGuard);
    await expectAccessible(page);
  });

  test('the card comes before the details on a phone and sits in a sticky right column from 1024px', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const { tenant } = await seed();
    await page.goto(`${tenant.path}/leagues/${LEAGUE_SLUG}/seasons/fall-open`);
    await hydrated(consoleGuard);
    const card = page.locator('#registration > div');
    const details = page.locator('section[aria-labelledby="details-heading"]');
    const cardBox = (await card.boundingBox())!;
    const detailsBox = (await details.boundingBox())!;
    const width = page.viewportSize()!.width;
    if (width < 1024) {
      expect(cardBox.y).toBeLessThan(detailsBox.y);
      expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(detailsBox.y);
      expect(cardBox.y).toBeLessThan(page.viewportSize()!.height);
    } else {
      expect(cardBox.x).toBeGreaterThan(detailsBox.x + detailsBox.width - 1);
      const startY = detailsBox.y;
      await page.mouse.wheel(0, 400);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
      const scrolledDetails = (await details.boundingBox())!;
      expect(scrolledDetails.y).toBeLessThan(startY);
      const stuck = (await card.boundingBox())!;
      expect(stuck.y).toBeGreaterThanOrEqual(0);
      expect(stuck.y + stuck.height).toBeLessThanOrEqual(page.viewportSize()!.height);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
    await screenshot(page, testInfo, 'season-open');
  });

  test('a closed season shows the closed card with its link, and passes the axe helper', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const { path } = await seed();
    await page.goto(path);
    await hydrated(consoleGuard);
    const card = page.locator('#registration');
    await expect(card).toContainText('Registration closed');
    await expect(card.getByRole('link', { name: 'See Fall Open' })).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, 'season-closed');
  });

  test.describe('a draft season', () => {
    test.use({ expectedDocumentStatus: 404 });

    test(
      'its page is the not-found view with a 404, and hydrates with no console error',
      VIEWPORT_AGNOSTIC,
      async ({ page, consoleGuard }) => {
        const { tenant } = await seed();
        const response = await page.goto(
          `${tenant.path}/leagues/${LEAGUE_SLUG}/seasons/draft-season`,
        );
        expect(response?.status()).toBe(404);
        await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
        await hydrated(consoleGuard);
        await expect(page.getByRole('navigation')).toHaveCount(1);
      },
    );
  });

  test.describe('in America/Los_Angeles', () => {
    test.use({ timezoneId: 'America/Los_Angeles' });

    test(
      'the dates read the same on the server (UTC) and after hydration',
      VIEWPORT_AGNOSTIC,
      async ({ page, request, consoleGuard }) => {
        const { tenant } = await seed();
        const path = `${tenant.path}/leagues/${LEAGUE_SLUG}/seasons/new-year-2027`;
        // The server writes the stored 2027-01-01, not the 31 December a UTC midnight reads as west
        // of UTC.
        const raw = await fetchRawHtml(request, path);
        expect(raw.status).toBe(200);
        expect(textOf(definition(raw.html, 'Dates'))).toBe('Jan 1 – Mar 1, 2027');

        await page.goto(path);
        await hydrated(consoleGuard);
        const dates = page.locator('main dl > div').filter({ hasText: 'Dates' }).locator('dd');
        await expect(dates).toHaveText('Jan 1 – Mar 1, 2027');
        await expect(dates.locator('time')).toHaveText(['Jan 1', 'Mar 1, 2027']);
        await expect(dates.locator('time').first()).toHaveAttribute('datetime', '2027-01-01');
        expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
          'America/Los_Angeles',
        );
      },
    );
  });

  test('a season row on the league page opens the season page, with focus on main', async ({
    page,
    consoleGuard,
  }) => {
    const { tenant, path } = await seed();
    await page.goto(`${tenant.path}/leagues/${LEAGUE_SLUG}`);
    await hydrated(consoleGuard);
    const link = page.getByRole('main').getByRole('link', { name: 'Summer 2027', exact: true });
    await expect(link).toHaveAttribute('href', path);
    await link.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Summer 2027' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.locator('main#main')).toBeFocused();
    await expect(page).toHaveTitle(`${LEAGUE} · Summer 2027 | ${tenant.name} | Omni League`);
    await expect(page.locator('main dl')).toContainText('Jun 6 – Aug 29, 2027');

    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: LEAGUE })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: LEAGUE })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`${tenant.path}/leagues/${LEAGUE_SLUG}`);
  });
});

test.describe('public season page offline', () => {
  test('offline: a viewed season opens offline from its saved copy with the note; a season never viewed shows the not-saved view', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    const tenant = await seedTenant({
      name: 'E2E Season Offline',
      locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
      leagues: [{ name: 'Offline League', sport: 'beachVolleyball', locations: ['Alpha Field'] }],
    });
    await seedSeasons(tenant, 'offline-league', [
      {
        name: 'Winter 2027-28',
        slug: 'winter-2027-28',
        startDate: '2027-12-01',
        endDate: '2028-02-20',
      },
      { name: 'Spring 2028', slug: 'spring-2028', startDate: '2028-03-01', endDate: '2028-05-30' },
    ]);
    const leaguePath = `${tenant.path}/leagues/offline-league`;
    const winterPath = `${leaguePath}/seasons/winter-2027-28`;
    const springPath = `${leaguePath}/seasons/spring-2028`;
    const h1 = page.locator('main h1');
    const note = page.locator('app-saved-copy-note');
    const dates = page.locator('main dl > div').filter({ hasText: 'Dates' }).locator('dd');
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });

    await page.goto(leaguePath);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await page.getByRole('main').getByRole('link', { name: 'Winter 2027-28', exact: true }).click();
    await expect(h1).toHaveText('Offline League · Winter 2027-28');
    await expect(dates).toHaveText('Dec 1, 2027 – Feb 20, 2028');
    await expect(note).toHaveCount(0);
    await crumbs.getByRole('link', { name: 'Offline League' }).click();
    await expect(h1).toHaveText('Offline League');

    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await page.getByRole('main').getByRole('link', { name: 'Winter 2027-28', exact: true }).click();
    await expect(h1).toHaveText('Offline League · Winter 2027-28');
    await expect(dates).toHaveText('Dec 1, 2027 – Feb 20, 2028');
    await expect(dates.locator('time')).toHaveText(['Dec 1, 2027', 'Feb 20, 2028']);
    await expect(note).toBeVisible();
    await expect(page.locator('app-not-saved-view')).toHaveCount(0);

    await crumbs.getByRole('link', { name: 'Offline League' }).click();
    await expect(h1).toHaveText('Offline League');
    await page.getByRole('main').getByRole('link', { name: 'Spring 2028', exact: true }).click();
    await expect(page.locator('app-not-saved-view')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('main dl')).toHaveCount(0);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.locator('app-not-saved-view a')).toHaveAttribute('href', springPath);

    await context.setOffline(false);
    await page.goto(winterPath);
    await expect(h1).toHaveText('Offline League · Winter 2027-28');
    await expect(note).toHaveCount(0);
  });
});

const NO_SEED = 'E2E_BASE_URL is set: no local Convex backend to seed';

function formatDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[month - 1]} ${day}, ${year}`;
}

interface Watched {
  skeletonSeen: boolean;
  sameH1: boolean;
}

async function watchSkeleton(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const watch = window as Window & { e2eSkeletonSeen?: boolean; e2eFirstH1?: Element };
    watch.e2eSkeletonSeen = false;
    const check = () => {
      const first = document.querySelector('main h1');
      if (first && !watch.e2eFirstH1) watch.e2eFirstH1 = first;
      if (document.body.textContent.includes('Loading the season.')) watch.e2eSkeletonSeen = true;
    };
    new MutationObserver(check).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
}

test.describe('public season page: loading', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test('on a first load the status never appears and the server-rendered h1 is never replaced', async ({
    page,
    consoleGuard,
  }) => {
    const { path } = await seed();
    await watchSkeleton(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'Summer 2027' })).toBeVisible();
    await hydrated(consoleGuard);
    const watched = await page.evaluate((): Watched => {
      const watch = window as Window & { e2eSkeletonSeen?: boolean; e2eFirstH1?: Element };
      return {
        skeletonSeen: watch.e2eSkeletonSeen === true,
        sameH1:
          watch.e2eFirstH1 !== undefined && watch.e2eFirstH1 === document.querySelector('main h1'),
      };
    });
    expect(watched).toEqual({ skeletonSeen: false, sameH1: true });
  });

  test('after an in-app navigation the skeleton shows with its status, then the heading, the card, and the details land within 4px of their bars', async ({
    page,
    consoleGuard,
  }) => {
    const { tenant, path } = await seed();
    const held = await holdQueries(page, ['seasons:getPublicPage']);
    await page.goto(`${tenant.path}/leagues/${LEAGUE_SLUG}`);
    await expect(page.getByRole('heading', { level: 1, name: LEAGUE })).toBeVisible();
    await hydrated(consoleGuard);

    await page.getByRole('main').getByRole('link', { name: 'Summer 2027', exact: true }).click();
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(page).toHaveURL(`${baseURL}${path}`);

    const skeleton = page.getByTestId('season-skeleton');
    await expect(skeleton).toBeVisible();
    await expect(skeleton.getByRole('status')).toHaveText('Loading the season.');
    await expect(skeleton.getByRole('status')).toHaveClass(/sr-only/);
    await expect(page.locator('main').getByRole('heading')).toHaveCount(0);
    await expect(page.locator('main[id="main"]')).toBeFocused();
    const scan = await axeScan(page);
    expect(describeViolations(scan.violations)).toEqual([]);
    const top = async (locator: Locator) => (await locator.boundingBox())!.y;
    const barTops = {
      heading: await top(page.getByTestId('season-skeleton-heading')),
      card: await top(page.getByTestId('season-skeleton-card')),
      details: await top(page.getByTestId('season-skeleton-details')),
    };

    held.release();
    const h1 = page.getByRole('heading', { level: 1, name: 'Summer 2027' });
    await expect(h1).toBeVisible();
    await expect(skeleton).toHaveCount(0);
    const landed = {
      heading: await top(h1),
      card: await top(page.locator('#registration > div')),
      details: await top(page.locator('section[aria-labelledby="details-heading"]')),
    };
    for (const part of ['heading', 'card', 'details'] as const) {
      expect(
        Math.abs(landed[part] - barTops[part]),
        `${part}: the bar is at ${barTops[part]}, the page at ${landed[part]}`,
      ).toBeLessThanOrEqual(4);
    }
    await expect(page.locator('main[id="main"]')).toBeFocused();
  });
});
