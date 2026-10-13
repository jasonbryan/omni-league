// Public season page (#128): `/organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug`,
// rendered on the server from `seasons:getPublicPage` and the organization's header. Each test
// seeds its own tenant (ADR 0005) and needs the local Convex backend, so the file is skipped with
// E2E_BASE_URL set; the preview sample is in `cache-key.spec.ts`.
import { expectAccessible } from './support/a11y';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { seedSeasons, seedTenant, type SeasonSeed, type Tenant } from './support/tenant';
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
/** A season across two years: both dates carry their year. */
const CROSS_YEAR: SeasonSeed = {
  name: 'Winter 2027-28',
  slug: 'winter-2027-28',
  startDate: '2027-12-01',
  endDate: '2028-02-20',
};
/** A season of one day: one date, no end. */
const ONE_DAY: SeasonSeed = {
  name: 'One Day Cup',
  slug: 'one-day-cup',
  startDate: '2027-09-04',
  endDate: '2027-09-04',
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
  /** `/organizations/<org>/leagues/sunday-reverse-coed-4s/seasons/summer-2027`. */
  path: string;
}

/**
 * An organization with a published beach volleyball league at two locations with the published
 * seasons "Summer 2027" and "New Year 2027" and one draft season, a draft league with a published
 * season `summer-2027`, and a second published league with the season `other-season`.
 */
async function seed(): Promise<SeededSeason> {
  const tenant = await seedTenant({
    name: 'E2E Season Page',
    locations: [
      { name: 'Beta Courts', address: '2 Beta Street, Corpus Christi, TX 78402' },
      { name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' },
    ],
    leagues: [
      { name: LEAGUE, sport: 'beachVolleyball', locations: ['Beta Courts', 'Alpha Field'] },
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
    seedSeasons(tenant, LEAGUE_SLUG, [SUMMER, NEW_YEAR, CROSS_YEAR, ONE_DAY, DRAFT_SEASON]),
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

/** Visible text of an HTML fragment: tags and comments removed, whitespace collapsed. */
function textOf(fragment: string | undefined): string {
  return (fragment ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&ndash;/g, '–')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The `<dd>` after the `<dt>` whose text is `term`. */
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
        expect(html, query).toMatch(/<h1\b[^>]*>\s*Summer 2027\s*<\/h1>/);
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

        // Both dates as stored, and the text the mockup shows.
        const dates = definition(html, 'Dates');
        expect(dates, query).toContain('datetime="2027-06-06"');
        expect(dates, query).toContain('datetime="2027-08-29"');
        expect(textOf(dates), query).toBe('Jun 6 – Aug 29, 2027');
        expect(textOf(definition(html, 'Format')), query).toBe('4 v 4');
        expect(textOf(definition(html, 'Team size')), query).toBe('Teams need at least 4 players');
        // The league's locations, in its own order.
        expect(textOf(definition(html, 'Locations')), query).toBe('Beta Courts, Alpha Field');

        // The sidebar marks the league's sport and links every sport to its view (#114).
        const currentSport = [...html.matchAll(/<a\b[^>]*aria-current="true"[^>]*>/g)].map(
          ([tag]) => /\bhref="([^"]*)"/.exec(tag)?.[1],
        );
        expect(currentSport, query).toEqual([`${tenant.path}/sports/beach-volleyball`]);
        // The organization has leagues of this sport only, so it is the one sport listed.
        expect(
          [...html.matchAll(/href="([^"]*\/sports\/[^"]*)"/g)].map(([, href]) => href),
          query,
        ).toEqual([`${tenant.path}/sports/beach-volleyball`]);

        // No price and no registration action (#129, #133, #143 add theirs).
        expect(html, query).not.toMatch(/Register|\$\d/);
        expect(html, query).not.toContain('registration-heading');

        // Meta, from the query result: built from the slugs, with nothing of the query string.
        expect(html, query).toContain(`<title>Summer 2027 | ${LEAGUE} | Omni League</title>`);
        expect(canonicalHrefs(html), query).toHaveLength(1);
        expect(canonicalHrefs(html)[0].endsWith(path), query).toBe(true);
        expect(canonicalHrefs(html)[0], query).not.toContain('?');
        expect(metaContent(html, 'og:url')?.endsWith(path), query).toBe(true);
        expect(metaContent(html, 'og:title'), query).toBe('Summer 2027');
        expect(metaContent(html, 'og:type'), query).toBe('website');
        expect(metaContent(html, 'og:description'), query).toBe(
          'Jun 6 – Aug 29, 2027. 4 v 4, teams need at least 4 players.',
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
        // A season slug of another league is unknown here.
        `${league}/seasons/other-season`,
        `${tenant.path}/leagues/other-league/seasons/summer-2027`,
        `${tenant.path}/leagues/no-such-league/seasons/summer-2027`,
        `/organizations/no-such-org-${tenant.slug}/leagues/${LEAGUE_SLUG}/seasons/summer-2027`,
        // A league slug of another organization is unknown here.
        `${other.path}/leagues/${LEAGUE_SLUG}/seasons/summer-2027`,
      ]) {
        const { status, headers, html } = await fetchRawHtml(request, path);
        expect(status, path).toBe(404);
        expect(noSpaces(headers['cache-control']), path).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(html, path).toMatch(/<h1\b[^>]*>\s*Page not found\s*<\/h1>/);
        expect(html.match(/<h1\b/g), path).toHaveLength(1);
        expect(html, path).not.toMatch(/<nav\b/);
        expect(html, path).not.toMatch(/<link\b[^>]*rel="canonical"|property="og:/);
        expect(html, path).not.toContain('Draft Season');
        expect(html, path).not.toContain('Other Season');
      }
    },
  );
});

test.describe('public season page: dates and locations in the raw server HTML', () => {
  test(
    'a season across two years writes both years, a season of one day writes one date, and one location reads "Location" (tester probe)',
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
        'Dec 1, 2027 – Feb 20, 2028. 4 v 4, teams need at least 4 players.',
      );

      const one = await fetchRawHtml(request, `${league}/one-day-cup`);
      expect(one.status).toBe(200);
      const oneDates = definition(one.html, 'Dates');
      expect(textOf(oneDates)).toBe('Sep 4, 2027');
      expect(oneDates?.match(/<time\b/g)).toHaveLength(1);
      expect(oneDates).not.toContain('–');
      expect(metaContent(one.html, 'og:description')).toBe(
        'Sep 4, 2027. 4 v 4, teams need at least 4 players.',
      );

      // A league with one location: the label is singular.
      const single = await fetchRawHtml(
        request,
        `${tenant.path}/leagues/other-league/seasons/other-season`,
      );
      expect(single.status).toBe(200);
      expect(textOf(definition(single.html, 'Location'))).toBe('Alpha Field');
      expect(definition(single.html, 'Locations')).toBeUndefined();
    },
  );
});

test.describe('public season page in the browser', () => {
  test('hydrates with no console error and passes the axe helper', async ({
    page,
    consoleGuard,
  }) => {
    const { path } = await seed();
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'Summer 2027' })).toBeVisible();
    await hydrated(consoleGuard);
    await expect(page).toHaveTitle(`Summer 2027 | ${LEAGUE} | Omni League`);
    await expect(page.getByRole('heading', { level: 2, name: 'Season details' })).toBeVisible();
    await expect(page.locator('main dl')).toContainText('Jun 6 – Aug 29, 2027');
    await expect(page.locator('main dl')).toContainText('Teams need at least 4 players');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expectAccessible(page);
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
        await expect(page.getByRole('navigation')).toHaveCount(0);
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
        // The server writes the stored 2027-01-01, not the 31 December a UTC midnight reads as
        // west of UTC.
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
    await expect(page).toHaveTitle(`Summer 2027 | ${LEAGUE} | Omni League`);
    await expect(page.locator('main dl')).toContainText('Jun 6 – Aug 29, 2027');

    // The breadcrumb goes back to the league page.
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: LEAGUE })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: LEAGUE })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`${tenant.path}/leagues/${LEAGUE_SLUG}`);
  });
});

// Offline (#82): chromium-mobile only (ADR 0013).
test.describe('public season page offline', () => {
  test('offline (tester probe): a viewed season opens offline from its saved copy with the note; a season never viewed shows the not-saved view', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only (ADR 0013)');
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

    // Online: the league page, then one season through its row, then back through the breadcrumb.
    await page.goto(leaguePath);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await page.getByRole('main').getByRole('link', { name: 'Winter 2027-28', exact: true }).click();
    await expect(h1).toHaveText('Winter 2027-28');
    await expect(dates).toHaveText('Dec 1, 2027 – Feb 20, 2028');
    await expect(note).toHaveCount(0);
    await crumbs.getByRole('link', { name: 'Offline League' }).click();
    await expect(h1).toHaveText('Offline League');

    // Offline: the viewed season opens from its saved copies (the season and the organization
    // header), with the saved-copy note under the h1.
    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await page.getByRole('main').getByRole('link', { name: 'Winter 2027-28', exact: true }).click();
    await expect(h1).toHaveText('Winter 2027-28');
    await expect(dates).toHaveText('Dec 1, 2027 – Feb 20, 2028');
    await expect(dates.locator('time')).toHaveText(['Dec 1, 2027', 'Feb 20, 2028']);
    await expect(note).toBeVisible();
    await expect(page.locator('app-not-saved-view')).toHaveCount(0);

    // A season never viewed has no saved copy: the not-saved view, with "Try again" to the page
    // asked for, and no season details.
    await crumbs.getByRole('link', { name: 'Offline League' }).click();
    await expect(h1).toHaveText('Offline League');
    await page.getByRole('main').getByRole('link', { name: 'Spring 2028', exact: true }).click();
    await expect(page.locator('app-not-saved-view')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('main dl')).toHaveCount(0);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.locator('app-not-saved-view a')).toHaveAttribute('href', springPath);

    // Back online: the live season replaces the not-saved view.
    await context.setOffline(false);
    await page.goto(winterPath);
    await expect(h1).toHaveText('Winter 2027-28');
    await expect(note).toHaveCount(0);
  });
});
