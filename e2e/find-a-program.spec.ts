import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { axeScan, describeViolations, expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { freezeOrganizations } from './support/freeze-organizations';
import { holdQueries } from './support/hold-queries';
import { RAW_HTTP } from './support/raw-http';
import { rawGet } from './support/raw-get';
import { fetchRawHtml } from './support/raw-html';
import { FULL_LEAGUE, PACKED_LEAGUE, seedFullSeasonTenant } from './support/full-season';
import { screenshot } from './support/screenshot';
import { seedPublishedCamp } from './support/camp';
import { signUp } from './support/session';
import { dateFromToday, seedSeasons, seedTenant, type Tenant } from './support/tenant';
import { seedTournament } from './support/tournament';
import { newUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
/** Netlify removes the spaces after the commas. */
const noSpaces = (value: string | undefined) => value?.replace(/\s+/g, '');

const SUNDAY = 'Sunday Reverse Coed 4s';
const THURSDAY = 'Thursday Night Coed 2s';
const DRAFT = 'Coed Draft Night';
const NORTH_BEACH = 'North Beach Sand Courts';
const HARBOR = 'Harbor Fields';
const ADDRESS = '3500 Sandcourt Ln, Corpus Christi, TX 78402';

const OPEN_SEASON = {
  name: 'Open Season',
  slug: 'open-season',
  startDate: dateFromToday(30),
  endDate: dateFromToday(100),
  registrationDeadline: dateFromToday(10),
};

interface Seeded {
  tenant: Tenant;
  /** The unique word in the organization's name, which finds only this tenant's leagues. */
  id: string;
}

/** Local runs only. Each test seeds its own organization, whose name holds a word no other organization has. */
async function seed(): Promise<Seeded> {
  const tenant = await seedTenant({
    name: 'Gulf Coast Sport & Social',
    cityState: 'Corpus Christi, TX',
    locations: [
      { name: NORTH_BEACH, address: ADDRESS },
      { name: HARBOR, address: '10 Harbor Rd, Corpus Christi, TX 78401' },
    ],
    leagues: [
      {
        name: SUNDAY,
        sport: 'beachVolleyball',
        locations: [NORTH_BEACH],
        division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
      },
      {
        name: THURSDAY,
        sport: 'beachVolleyball',
        locations: [NORTH_BEACH, HARBOR],
        division: { gender: 'coed', playersPerSide: 2, level: 'b', ageGroup: 'adult' },
      },
      { name: DRAFT, sport: 'soccer', locations: [HARBOR], status: 'draft' },
    ],
  });
  await seedSeasons(tenant, 'sunday-reverse-coed-4s', [OPEN_SEASON]);
  return { tenant, id: tenant.slug.replace(/^e2e-/, '') };
}

const url = (q: string) => `/programs?q=${encodeURIComponent(q)}`;

/** The top bar's search opens `/leagues`, which redirects here. */
const leaguesUrl = (q: string) => `/programs?type=league&q=${encodeURIComponent(q)}`;

function resultsSection(html: string): string {
  return (
    /<section\b[^>]*aria-labelledby="results-heading"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ??
    ''
  );
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resultNames(html: string): string[] {
  return [...resultsSection(html).matchAll(/<h3\b[^>]*>\s*<a\b[^>]*>([^<]*)<\/a>/g)].map(
    ([, name]) => name.trim(),
  );
}

async function raw(request: APIRequestContext, path: string) {
  const response = await fetchRawHtml(request, path);
  expect(response.status, path).toBe(200);
  return response;
}

async function hydrated(consoleGuard: { hydrated: boolean }): Promise<void> {
  await expect
    .poll(() => consoleGuard.hydrated, {
      message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
    })
    .toBe(true);
}

const field = (page: Page) =>
  page.getByRole('searchbox', { name: 'Program, organization, or location' });
const results = (page: Page) => page.locator('section[aria-labelledby="results-heading"]');
const rowNames = (page: Page) => results(page).locator('ul > li h3');

async function submit(page: Page, q: string): Promise<void> {
  await field(page).fill(q);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
}

test.describe('find a program: raw server HTML', () => {
  test(
    '/programs without a search: 200, the public Cache-Control, the title, the form, and no results section',
    RAW_HTTP,
    async ({ request }) => {
      const { status, headers, html } = await fetchRawHtml(request, '/programs');
      expect(status).toBe(200);
      expect(noSpaces(headers['cache-control'])).toBe(noSpaces(PUBLIC_PAGE_CACHE));
      expect(headers['content-type']).toContain('text/html');
      expect(html).toContain('<title>Find a program | Omni League</title>');
      expect(html).toMatch(/<h1\b[^>]*>\s*Find a program\s*<\/h1>/);
      expect(html).toMatch(/<form\b[^>]*role="search"[^>]*action="\/programs"/);
      expect(html).toContain('Program, organization, or location');
      expect(html).toContain('name="q"');
      expect(html).not.toContain('results-heading');
      expect(html).not.toContain('name="robots"');
    },
  );

  test(
    '?q: the leagues of a published organization with their organization, division, and status, the count line, noindex, and the canonical /programs',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, id } = await seed();
      const { headers, html } = await raw(request, url(`coed ${id}`));
      expect(noSpaces(headers['cache-control'])).toBe(noSpaces(PUBLIC_PAGE_CACHE));
      expect(resultNames(html).slice(0, 2).sort()).toEqual([SUNDAY, THURSDAY]);
      expect(resultNames(html)).not.toContain(DRAFT);

      const section = plainText(resultsSection(html));
      expect(section).toMatch(/^Results (?:\d+ programs? match|Showing the first 50)/);
      const sunday = plainText(
        resultsSection(html)
          .split('</li>')
          .find((row) => row.includes(SUNDAY)) ?? '',
      );
      expect(sunday).toContain('Coed · 4v4 · BB');
      expect(sunday).toContain(`${tenant.name} · ${NORTH_BEACH}`);
      expect(sunday).toContain('Registration open');
      expect(sunday).toContain('Open Season · closes');
      const thursday = plainText(
        resultsSection(html)
          .split('</li>')
          .find((row) => row.includes(THURSDAY)) ?? '',
      );
      expect(thursday).toContain(`${tenant.name} · ${NORTH_BEACH}, ${HARBOR}`);
      expect(thursday).toContain('No upcoming season');
      expect(html).toContain(`href="${tenant.path}/leagues/sunday-reverse-coed-4s"`);

      expect(html).toMatch(/<meta\b[^>]*name="robots"[^>]*content="noindex"/);
      const exact = await raw(request, url(id));
      expect(plainText(resultsSection(exact.html))).toContain(`2 programs match “${id}”`);
      const canonicals = [...html.matchAll(/<link\b[^>]*\brel="canonical"[^>]*>/g)].map(
        ([tag]) => /\bhref="([^"]*)"/.exec(tag)?.[1] ?? '',
      );
      expect(canonicals).toHaveLength(1);
      expect(canonicals[0].endsWith('/programs')).toBe(true);
    },
  );

  test(
    'finds leagues by a location name, by City, state, and by the organization name, and never a draft',
    RAW_HTTP,
    async ({ request }) => {
      const { id } = await seed();
      for (const q of [`north beach ${id}`, `corpus ${id}`, `gulf ${id}`, id]) {
        const { html } = await raw(request, url(q));
        const names = resultNames(html);
        expect(names, q).toContain(SUNDAY);
        expect(names, q).toContain(THURSDAY);
        expect(names, q).not.toContain(DRAFT);
      }
      const byDraftName = await raw(request, url(`draft ${id}`));
      expect(resultNames(byDraftName.html)).not.toContain(DRAFT);
    },
  );

  test(
    'only the leagues held at a location are found by a word in it',
    RAW_HTTP,
    async ({ request }) => {
      const { id } = await seed();
      const harbor = await raw(request, url(`harbor ${id}`));
      expect(resultNames(harbor.html)).toEqual([THURSDAY]);
    },
  );

  test(
    'a search lists only the leagues that hold every word, the last word as the start of a word',
    RAW_HTTP,
    async ({ request }) => {
      const { id } = await seed();
      const all = await raw(request, url(`coed 4s corpus ${id}`));
      expect(resultNames(all.html)).toEqual([SUNDAY]);
      expect(plainText(resultsSection(all.html))).toContain(
        `1 program matches “coed 4s corpus ${id}”`,
      );
      const prefix = await raw(request, url(`coed ${id} corp`));
      expect(resultNames(prefix.html).sort()).toEqual([SUNDAY, THURSDAY]);
    },
  );

  test(
    'a search with a word no league holds lists nothing and links the search without that word',
    RAW_HTTP,
    async ({ request }) => {
      const { id } = await seed();
      const { html } = await raw(request, url(`coed 4s ${id} zz${id}`));
      const section = resultsSection(html);
      expect(plainText(section)).toContain(`No programs match “coed 4s ${id} zz${id}”`);
      expect(plainText(section)).toContain('Try fewer words:');
      expect(resultNames(html)).toEqual([]);
      const links = [
        ...section.matchAll(/<li\b[^>]*>\s*<a\b[^>]*\bhref="([^"]*)"[^>]*>([^<]*)<\/a>/g),
      ];
      expect(links.map(([, href, name]) => [href, name])).toEqual([
        [`/programs?q=${encodeURIComponent(`coed 4s ${id}`)}`, `coed 4s ${id}`],
      ]);
      expect(section.indexOf('Try fewer words:')).toBeLessThan(section.indexOf('Clear the search'));
      expect(section).toMatch(/<ul\b[^>]*aria-labelledby="suggestions-heading"/);
    },
  );

  test.describe('by sport and division', () => {
    const SUNDAY_ELEVEN = 'Sunday Eleven';
    const FALL_JUNIORS = 'Fall Juniors';
    const SUNSET_SIXES = 'Sunset Sixes';
    const MONDAY_NIGHTS = 'Monday Nights';
    const CREEK = 'Cottonwood Creek Fields';

    /** No name in the tenant holds a sport, gender, format, level, or age word. */
    async function seedDivisions(): Promise<string> {
      const tenant = await seedTenant({
        name: 'Cottonwood Collective',
        locations: [{ name: CREEK, address: '12 Creek Rd, Fort Collins, CO 80521' }],
        leagues: [
          {
            name: SUNDAY_ELEVEN,
            sport: 'soccer',
            locations: [CREEK],
            division: {
              gender: 'womens',
              playersPerSide: 11,
              level: 'intermediate',
              ageGroup: 'adult',
            },
          },
          {
            name: FALL_JUNIORS,
            sport: 'soccer',
            locations: [CREEK],
            division: { gender: 'womens', playersPerSide: 7, level: 'rec', ageGroup: 'u10' },
          },
          {
            name: SUNSET_SIXES,
            sport: 'beachVolleyball',
            locations: [CREEK],
            division: { gender: 'coed', playersPerSide: 6, level: 'rec', ageGroup: 'adult' },
          },
          {
            name: MONDAY_NIGHTS,
            sport: 'softball',
            locations: [CREEK],
            division: { gender: 'coed', playersPerSide: 10, level: 'rec', ageGroup: 'adult' },
          },
        ],
      });
      return tenant.slug.replace(/^e2e-/, '');
    }

    const namesFor = async (request: APIRequestContext, q: string) =>
      resultNames((await raw(request, url(q))).html).sort();

    test('a sport name lists the leagues of that sport', RAW_HTTP, async ({ request }) => {
      const id = await seedDivisions();
      expect(await namesFor(request, `soccer ${id}`)).toEqual([FALL_JUNIORS, SUNDAY_ELEVEN]);
      expect(await namesFor(request, `volleyball ${id}`)).toEqual([SUNSET_SIXES]);
    });

    test('a level lists the leagues at that level', RAW_HTTP, async ({ request }) => {
      const id = await seedDivisions();
      expect(await namesFor(request, `intermediate ${id}`)).toEqual([SUNDAY_ELEVEN]);
    });

    test(
      'a gender, an age group, and a sport together list one league',
      RAW_HTTP,
      async ({ request }) => {
        const id = await seedDivisions();
        expect(await namesFor(request, `girls u10 soccer ${id}`)).toEqual([FALL_JUNIORS]);
      },
    );

    test(
      'womens, typed as the plural, lists the adult league and not the girls league',
      RAW_HTTP,
      async ({ request }) => {
        const id = await seedDivisions();
        expect(await namesFor(request, `womens ${id}`)).toEqual([SUNDAY_ELEVEN]);
      },
    );
  });

  test('a search with no match shows the no-results state', RAW_HTTP, async ({ request }) => {
    const { headers, html } = await raw(request, url('pickleball'));
    expect(noSpaces(headers['cache-control'])).toBe(noSpaces(PUBLIC_PAGE_CACHE));
    const section = resultsSection(html);
    expect(plainText(section)).toContain('No programs match “pickleball”');
    expect(plainText(section)).toContain('Try a program name, an organization, or a location');
    expect(section).toMatch(/<a\b[^>]*href="\/programs"[^>]*>\s*Clear the search\s*<\/a>/);
    expect(section).not.toContain('<ul');
  });

  test(
    'a q of 300 characters, 20 words, or repeated renders 200 from the first 100 characters, 16 words, or value, and no other parameter reaches the response',
    RAW_HTTP,
    async ({ request }) => {
      const canary = `CANARY${randomUUID().replaceAll('-', '')}`;
      const longWord = 'x'.repeat(300);
      const long = await raw(request, `/programs?q=${longWord}&utm_source=${canary}`);
      expect(long.html).toContain(`No programs match “${'x'.repeat(100)}”`);
      expect(long.html).not.toContain('x'.repeat(101));
      expect(long.html).not.toContain(canary);

      const words = Array.from({ length: 20 }, (_, i) => `zz${i + 1}`);
      const many = await raw(request, `/programs?q=${words.join('+')}&ott=${canary}`);
      expect(plainText(resultsSection(many.html))).toContain(
        `No programs match “${words.slice(0, 16).join(' ')}”`,
      );
      expect(many.html).not.toContain('zz17');
      expect(many.html).not.toContain(canary);

      const repeated = await raw(request, `/programs?q=first&q=${canary}`);
      expect(plainText(resultsSection(repeated.html))).toContain('No programs match “first”');
      expect(repeated.html).not.toContain(canary);
      expect(JSON.stringify(repeated.headers)).not.toContain(canary);
    },
  );
});

const FIELD = 'Larkspur Turf Center';
const FIELD_ADDRESS = '455 Larkspur Mesa Dr, Lakewood, CO 80228';

/** Names that sort before any other tenant's, so a sport view lists them among its first rows. */
const GIRLS_ROOKIES = '00 Girls Rookies';
const GIRLS_SELECT = '00 Girls Select';
const BOYS_ROOKIES = '00 Boys Rookies';
const WOMEN_ELEVEN = '00 Women Eleven';
const GIRLS_SANDS = '00 Girls Sands';

/** A test that reads live rows takes an age group no other test seeds (u10 is shared by the raw-HTML tests and `seedDivisions`), so another test's leagues never crowd or re-sort its list. */
async function seedYouth(
  ageGroup: 'u10' | 'over30' | 'over35' | 'over40' | 'over50' = 'u10',
): Promise<Tenant> {
  return seedTenant({
    name: 'Front Range Youth',
    locations: [{ name: FIELD, address: FIELD_ADDRESS }],
    leagues: [
      {
        name: GIRLS_ROOKIES,
        sport: 'soccer',
        locations: [FIELD],
        division: { gender: 'womens', playersPerSide: 7, level: 'rec', ageGroup },
      },
      {
        name: GIRLS_SELECT,
        sport: 'soccer',
        locations: [FIELD],
        division: { gender: 'womens', playersPerSide: 7, level: 'competitive', ageGroup },
      },
      {
        name: BOYS_ROOKIES,
        sport: 'soccer',
        locations: [FIELD],
        division: { gender: 'mens', playersPerSide: 7, level: 'rec', ageGroup },
      },
      {
        name: WOMEN_ELEVEN,
        sport: 'soccer',
        locations: [FIELD],
        division: {
          gender: 'womens',
          playersPerSide: 11,
          level: 'intermediate',
          ageGroup: 'adult',
        },
      },
      {
        name: GIRLS_SANDS,
        sport: 'beachVolleyball',
        locations: [FIELD],
        division: { gender: 'womens', playersPerSide: 2, level: 'a', ageGroup: 'u10' },
      },
    ],
  });
}

function filterBar(html: string): string {
  return /<form\b[^>]*aria-label="Filter programs"[^>]*>([\s\S]*?)<\/form>/.exec(html)?.[1] ?? '';
}

function currentChip(html: string): string {
  const chips = /<nav\b[^>]*aria-label="Sport"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  return plainText(/<a\b[^>]*aria-current="page"[^>]*>([\s\S]*?)<\/a>/.exec(chips)?.[1] ?? '');
}

function canonicalOf(html: string): string | undefined {
  const tag = /<link\b[^>]*\brel="canonical"[^>]*>/.exec(html)?.[0];
  return tag && /\bhref="([^"]*)"/.exec(tag)?.[1]?.replaceAll('&amp;', '&');
}

test.describe('find a program: sport chips and division filters, raw server HTML', () => {
  test(
    '?sport=soccer&age=u10&gender=girls lists only the soccer U10 womens leagues, with the Soccer chip current, the pills, and the count',
    RAW_HTTP,
    async ({ request }) => {
      await seedYouth();
      const { headers, html } = await raw(request, '/programs?sport=soccer&age=u10&gender=girls');
      expect(noSpaces(headers['cache-control'])).toBe(noSpaces(PUBLIC_PAGE_CACHE));
      const names = resultNames(html);
      expect(names).toEqual(expect.arrayContaining([GIRLS_ROOKIES, GIRLS_SELECT]));
      for (const other of [BOYS_ROOKIES, WOMEN_ELEVEN, GIRLS_SANDS]) {
        expect(names).not.toContain(other);
      }
      // A camp has no division, so the filters leave it listed.
      for (const row of resultsSection(html)
        .split('</li>')
        .filter((part) => part.includes('<h3') && !/>\s*Camp\s*</.test(part))) {
        expect(plainText(row)).toMatch(/Girls · \d+v\d+ · [A-Za-z]+ · U10/);
      }
      expect(currentChip(html)).toBe('Soccer');
      const bar = filterBar(html);
      const pills = /<ul\b[^>]*aria-label="Active filters"[^>]*>([\s\S]*?)<\/ul>/.exec(bar)?.[1];
      expect(plainText(pills ?? '')).toContain('Gender: Girls');
      expect(plainText(pills ?? '')).toContain('U10');
      const count = /<p\b[^>]*role="status"[^>]*>([\s\S]*?)<\/p>/.exec(bar)?.[1] ?? '';
      expect(plainText(count)).toMatch(/^\d+ of \d+ soccer programs?$/);
    },
  );

  test(
    '?q=coed&sport=beach-volleyball lists only the beach volleyball leagues that match, and the chips keep q',
    RAW_HTTP,
    async ({ request }) => {
      const tenant = await seedTenant({
        name: 'Coed Cross Sport',
        locations: [{ name: FIELD, address: FIELD_ADDRESS }],
        leagues: [
          { name: 'Coed Sands', sport: 'beachVolleyball', locations: [FIELD] },
          { name: 'Coed Turf', sport: 'soccer', locations: [FIELD] },
        ],
      });
      const id = tenant.slug.replace(/^e2e-/, '');
      const q = `coed ${id}`;
      const { html } = await raw(
        request,
        `/programs?q=${encodeURIComponent(q)}&sport=beach-volleyball`,
      );
      expect(resultNames(html)).toEqual(['Coed Sands']);
      expect(plainText(resultsSection(html))).toContain(
        `1 beach volleyball program matches “${q}”`,
      );
      expect(currentChip(html)).toBe('Beach volleyball');
      const encoded = encodeURIComponent(q);
      for (const href of [
        `/programs?q=${encoded}`,
        `/programs?q=${encoded}&amp;sport=soccer`,
        `/programs?q=${encoded}&amp;sport=softball`,
      ]) {
        expect(html, href).toContain(`href="${href}"`);
      }
    },
  );

  test(
    '?sport=softball&level=bb ignores the level, which is not a softball level, and writes it nowhere',
    RAW_HTTP,
    async ({ request }) => {
      const { html } = await raw(request, '/programs?sport=softball&level=bb');
      expect(html).not.toContain('level=bb');
      expect(html).not.toContain('level%3Dbb');
      expect(html).not.toMatch(/name="robots"/);
      expect(canonicalOf(html)?.endsWith('/programs?sport=softball')).toBe(true);
      expect(currentChip(html)).toBe('Softball');
    },
  );

  test(
    'more than 5 matching leagues without a search make numbered pages whose links keep the filters',
    RAW_HTTP,
    async ({ request }) => {
      // A retry runs on the same backend, so the names carry an id of their own.
      const id = randomUUID().slice(0, 8);
      const mine = Array.from({ length: 7 }, (_, i) => `00 ${id} Over60 ${String(i + 1)}`);
      await seedTenant({
        name: 'Senior Slow-Pitch',
        locations: [{ name: FIELD, address: FIELD_ADDRESS }],
        leagues: mine.map((name) => ({
          name,
          sport: 'softball' as const,
          locations: [FIELD],
          division: {
            gender: 'mens' as const,
            playersPerSide: 10,
            level: 'rec' as const,
            ageGroup: 'over60' as const,
          },
        })),
      });
      const path = '/programs?sport=softball&gender=mens&age=over60';
      const encoded = path.replaceAll('&', '&amp;');
      const first = await raw(request, path);
      expect(resultNames(first.html)).toHaveLength(5);
      const pager = /<nav\b[^>]*aria-label="Programs pages"[^>]*>([\s\S]*?)<\/nav>/.exec(
        first.html,
      )?.[1];
      expect(pager).toContain(`href="${encoded}&amp;page=2"`);
      const found = new Set<string>();
      for (let page = 1; page <= 4 && found.size < mine.length; page++) {
        const { html } = await raw(request, page === 1 ? path : `${path}&page=${String(page)}`);
        for (const name of resultNames(html)) if (mine.includes(name)) found.add(name);
        if (page > 1) expect(html).toContain(`href="${encoded}"`);
      }
      expect([...found].sort()).toEqual(mine);
    },
  );

  test(
    'a sport alone is indexable with the canonical /programs?sport=soccer; with a division filter it is noindex with the canonical /programs',
    RAW_HTTP,
    async ({ request }) => {
      await seedYouth();
      const plain = await raw(request, '/programs?sport=soccer');
      expect(plain.html).not.toMatch(/name="robots"/);
      expect(canonicalOf(plain.html)?.endsWith('/programs?sport=soccer')).toBe(true);
      expect(plain.html).toContain('<title>Soccer | Find a program | Omni League</title>');
      const filtered = await raw(request, '/programs?sport=soccer&age=u10');
      expect(filtered.html).toMatch(/<meta\b[^>]*name="robots"[^>]*content="noindex"/);
      expect(canonicalOf(filtered.html)?.endsWith('/programs')).toBe(true);
    },
  );

  test(
    'Format and Level are not offered with no sport, and Soccer offers only the soccer formats and levels',
    RAW_HTTP,
    async ({ request }) => {
      await seedYouth();
      const legends = (html: string) =>
        [...filterBar(html).matchAll(/<legend\b[^>]*>([\s\S]*?)<\/legend>/g)].map(([, legend]) =>
          plainText(legend),
        );
      const labels = (html: string, legend: string) => {
        const set = filterBar(html)
          .split('<fieldset')
          .find((part) => new RegExp(`<legend\\b[^>]*>\\s*${legend}\\s*</legend>`).test(part));
        return [...(set ?? '').matchAll(/<span\b[^>]*>([^<]*)<\/span>/g)].map(([, text]) => text);
      };
      const anySport = await raw(request, `/programs?q=${encodeURIComponent('00 girls')}`);
      expect(legends(anySport.html)).toEqual(['Gender', 'Age group']);
      const soccer = await raw(request, '/programs?sport=soccer');
      expect(legends(soccer.html)).toEqual(['Gender', 'Format', 'Level', 'Age group']);
      expect(labels(soccer.html, 'Format')).toEqual(expect.arrayContaining(['7v7', '11v11']));
      expect(labels(soccer.html, 'Format')).not.toContain('2v2');
      expect(labels(soccer.html, 'Level')).not.toContain('BB');
    },
  );
});

test.describe('find a program: in the browser', () => {
  test('a new search shows skeleton rows with "Searching." until the results arrive, adds a history entry, and Back restores the earlier results', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'one browser project only');
    const { id } = await seed();
    // The socket must be routed before the page opens it.
    const held = await holdQueries(page, ['search:programs']);
    await page.goto('/programs');
    await hydrated(consoleGuard);
    await submit(page, id);
    await expect(page).toHaveURL(`${baseURL}${url(id)}`);
    const skeleton = page.getByTestId('find-skeleton');
    await expect(skeleton).toBeVisible();
    await expect(skeleton.getByRole('status')).toHaveText('Searching.');
    await expect(rowNames(page)).toHaveCount(0);
    await expect.poll(() => held.isHolding()).toBe(true);
    held.release();
    await expect(rowNames(page)).toHaveText([SUNDAY, THURSDAY]);
    await expect(skeleton).toHaveCount(0);

    await submit(page, `harbor ${id}`);
    await expect(page).toHaveURL(`${baseURL}${url(`harbor ${id}`)}`);
    await expect(rowNames(page)).toHaveText([THURSDAY]);

    await page.goBack();
    await expect(page).toHaveURL(`${baseURL}${url(id)}`);
    await expect(field(page)).toHaveValue(id);
    await expect(rowNames(page)).toHaveText([SUNDAY, THURSDAY]);

    await page.goForward();
    await expect(page).toHaveURL(`${baseURL}${url(`harbor ${id}`)}`);
    await expect(rowNames(page)).toHaveText([THURSDAY]);
  });

  test(
    'the form works from the keyboard: type, Enter, results',
    VIEWPORT_AGNOSTIC,
    async ({ page, consoleGuard }) => {
      const { id } = await seed();
      await page.goto('/programs');
      await hydrated(consoleGuard);
      await field(page).fill(id);
      await field(page).press('Enter');
      await expect(page).toHaveURL(`${baseURL}${url(id)}`);
      await expect(rowNames(page)).toHaveText([SUNDAY, THURSDAY]);
      await expect(results(page).getByRole('status')).toContainText('2 programs match');
    },
  );

  test(
    'a search before hydration submits the plain form',
    VIEWPORT_AGNOSTIC,
    async ({ browser }) => {
      const { id } = await seed();
      const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
      const plain = await context.newPage();
      try {
        await plain.goto('/programs');
        await plain.getByRole('searchbox').fill(id);
        await plain.getByRole('button', { name: 'Search', exact: true }).click();
        await expect(plain).toHaveURL(`${baseURL}${url(id)}`);
        await expect(
          plain.locator('section[aria-labelledby="results-heading"] ul > li h3'),
        ).toHaveText([SUNDAY, THURSDAY]);
      } finally {
        await context.close();
      }
    },
  );

  test('after a client-side navigation from the footer link, focus is on main', async ({
    page,
    consoleGuard,
  }) => {
    const { tenant } = await seed();
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    await page.getByRole('contentinfo').getByRole('link', { name: 'Find a league' }).click();
    await expect(page).toHaveURL(`${baseURL}/programs?type=league`);
    await expect(page.getByRole('heading', { level: 1, name: 'Find a program' })).toBeVisible();
    await expect(page.locator('main#main')).toBeFocused();
  });

  test(
    'renaming a location makes the next search find the new name',
    VIEWPORT_AGNOSTIC,
    async ({ page, consoleGuard }) => {
      const { tenant, id } = await seed();
      const word = `Zephyr${id}`;
      const user = newUser('Rename');
      await signUp(page, user);
      await convexRun('testing:addMembership', {
        organizationSlug: tenant.slug,
        email: user.email,
        role: 'orgAdmin',
      });
      await page.goto(`/app/organizations/${tenant.slug}/locations`);
      await page.getByRole('button', { name: `Edit ${HARBOR}` }).click();
      await page.locator('#edit-name').fill(`${word} Fields`);
      await page
        .locator('#locations-list form')
        .getByRole('button', { name: 'Save changes' })
        .click();
      await expect(
        page.locator('section[aria-labelledby="locations-heading"]').getByRole('status'),
      ).toHaveText(`${word} Fields saved.`);

      await page.goto(url(word));
      await hydrated(consoleGuard);
      await expect(rowNames(page)).toHaveText([THURSDAY]);
      await page.goto(url(`harbor ${id}`));
      await expect(results(page)).toContainText(`No programs match “harbor ${id}”`);
      await expect(rowNames(page)).toHaveCount(0);
    },
  );

  test('states 2 to 4: the results, no results, and the form pass the accessibility checks', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const { id } = await seed();
    await freezeOrganizations(page);
    await page.goto('/programs');
    await hydrated(consoleGuard);
    await screenshot(page, testInfo, '300-find-start');
    await expectAccessible(page);

    await submit(page, id);
    await expect(rowNames(page)).toHaveText([SUNDAY, THURSDAY]);
    await screenshot(page, testInfo, '300-find-results');
    await expectAccessible(page);

    await submit(page, 'pickleball');
    await expect(results(page)).toContainText('No programs match “pickleball”');
    await screenshot(page, testInfo, '300-find-none');
    await expectAccessible(page);

    await submit(page, `coed 4s ${id} zz${id}`);
    const fewer = results(page).getByRole('list', { name: 'Try fewer words:' });
    await expect(fewer.getByRole('link')).toHaveText([`coed 4s ${id}`]);
    await screenshot(page, testInfo, '300-find-fewer-words');
    await expectAccessible(page);
    await fewer.getByRole('link').click();
    await expect(page).toHaveURL(`${baseURL}${url(`coed 4s ${id}`)}`);
    await expect(rowNames(page)).toHaveText([SUNDAY]);
    await expect(results(page).getByRole('status')).toBeFocused();
    await submit(page, 'pickleball');
    await expect(results(page)).toContainText('No programs match “pickleball”');
    await results(page).getByRole('link', { name: 'Clear the search' }).click();
    await expect(page).toHaveURL(`${baseURL}/programs`);
    await expect(results(page)).toHaveCount(0);
    await expect(field(page)).toHaveValue('');
    await expect(field(page)).toBeFocused();
  });

  test('a suggestion followed with the keyboard moves a visible focus to the new results and announces the count', async ({
    page,
    consoleGuard,
  }) => {
    const { id } = await seed();
    await page.goto(url(`coed 4s ${id} zz${id}`));
    await hydrated(consoleGuard);
    await results(page)
      .getByRole('link', { name: `coed 4s ${id}` })
      .focus();
    await page.keyboard.press('Enter');
    await expect(rowNames(page)).toHaveText([SUNDAY]);
    const status = results(page).getByRole('status');
    await expect(status).toBeFocused();
    await expect(status).toHaveText(`1 program matches “coed 4s ${id}”`);
    expect(await status.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await expectAccessible(page);
  });

  test('Clear the search followed with the keyboard moves a visible focus to the search field', async ({
    page,
    consoleGuard,
  }) => {
    await page.goto(url('pickleball'));
    await hydrated(consoleGuard);
    await results(page).getByRole('link', { name: 'Clear the search' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${baseURL}/programs`);
    await expect(field(page)).toBeFocused();
    expect(await field(page).evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  });

  test('a suggestion opened in a new tab leaves the page and its focus as they were', async ({
    page,
    consoleGuard,
  }) => {
    const { id } = await seed();
    await page.goto(url(`coed 4s ${id} zz${id}`));
    await hydrated(consoleGuard);
    const link = results(page).getByRole('link', { name: `coed 4s ${id}` });
    await link.click({ modifiers: ['ControlOrMeta'] });
    await expect(page).toHaveURL(`${baseURL}${url(`coed 4s ${id} zz${id}`)}`);
    await expect(field(page)).not.toBeFocused();
    await expect(results(page).getByRole('status')).not.toBeFocused();
  });

  async function failTheSearch(page: Page): Promise<() => void> {
    let failing = true;
    const searchIds = new Set<number>();
    await page.routeWebSocket(/\/api\/[^/]+\/sync$/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => {
        const { modifications = [] } = JSON.parse(String(message)) as {
          modifications?: { type: string; queryId: number; udfPath?: string }[];
        };
        for (const { type, queryId, udfPath } of modifications) {
          if (type === 'Add' && udfPath === 'search:programs') searchIds.add(queryId);
        }
        server.send(message);
      });
      server.onMessage((message) => {
        const frame = JSON.parse(String(message)) as {
          type: string;
          modifications?: { type: string; queryId: number }[];
        };
        const fails =
          failing &&
          frame.modifications?.some(
            ({ type, queryId }) => type === 'QueryUpdated' && searchIds.has(queryId),
          );
        if (!fails) {
          ws.send(message);
          return;
        }
        const failed = frame.modifications?.map((change) =>
          searchIds.has(change.queryId)
            ? { type: 'QueryFailed', queryId: change.queryId, errorMessage: 'down', logLines: [] }
            : change,
        );
        ws.send(JSON.stringify({ ...frame, modifications: failed }));
      });
    });
    return () => {
      failing = false;
    };
  }

  async function heights(page: Page): Promise<{ coarse: boolean; clear: number; retry: number }> {
    const { id } = await seed();
    const recover = await failTheSearch(page);
    await page.goto(url(id));
    const retry = page.getByRole('alert').getByRole('link', { name: 'Try again' });
    await expect(retry).toBeVisible();
    const retryBox = await retry.boundingBox();
    recover();
    await page.goto(url('pickleball'));
    const clear = page.getByRole('link', { name: 'Clear the search' });
    await expect(clear).toBeVisible();
    const clearBox = await clear.boundingBox();
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    return { coarse, clear: clearBox?.height ?? 0, retry: retryBox?.height ?? 0 };
  }

  test.describe('on a wide touch screen', () => {
    test.use({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true });

    test('Try again and Clear the search are at least 44px tall', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium-desktop', 'one project covers the wide screen');
      const measured = await heights(page);
      expect(measured.coarse).toBe(true);
      expect(measured.retry).toBeGreaterThanOrEqual(44);
      expect(measured.clear).toBeGreaterThanOrEqual(44);
    });
  });

  test.describe('on a wide touch screen with suggestions', () => {
    test.use({ viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true });

    test('each suggestion link is at least 44px tall', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium-desktop', 'one project covers the wide screen');
      const { id } = await seed();
      await page.goto(url(`coed 4s ${id} zz${id}`));
      const link = results(page).getByRole('list', { name: 'Try fewer words:' }).getByRole('link');
      await expect(link).toBeVisible();
      expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    });
  });

  test.describe('at 320px', () => {
    test.use({ viewport: { width: 320, height: 700 } });

    test('the no-results state with suggestions does not scroll sideways', async ({
      page,
    }, testInfo) => {
      test.skip(
        testInfo.project.name !== 'chromium-desktop',
        'one project covers the narrow screen',
      );
      const { id } = await seed();
      await page.goto(url(`coed 4s ${id} zz${id}`));
      await expect(results(page).getByRole('link', { name: `coed 4s ${id}` })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        320,
      );
    });
  });

  test('Try again and Clear the search keep their line height with a mouse', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'only the desktop project has a mouse');
    const measured = await heights(page);
    expect(measured.coarse).toBe(false);
    expect(measured.retry).toBeLessThan(44);
    expect(measured.clear).toBeLessThan(44);
  });
});

test.describe('find a program: a full season with registration open', () => {
  test(
    'raw: the row of a league whose soonest-closing open season is full reads Full and the waitlist',
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(
        testInfo.project.name !== 'chromium-desktop',
        'raw HTML does not depend on the viewport',
      );
      const { searchWord } = await seedFullSeasonTenant();
      const { html } = await raw(request, url(searchWord));
      expect(resultNames(html).sort()).toEqual([FULL_LEAGUE, PACKED_LEAGUE]);
      const text = plainText(resultsSection(html));
      expect(text).toContain('Alpha Field Full Full Season · waitlist open');
      expect(text).toContain('Beta Diamond Full Packed Season · waitlist open');
      expect(text).not.toContain('Registration open');
    },
  );

  test('browser: the rows show the outline Full badge, nothing scrolls sideways at 320px, and the page passes the axe helper', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const { searchWord } = await seedFullSeasonTenant();
    await page.goto(url(searchWord));
    await hydrated(consoleGuard);
    await expect(rowNames(page)).toHaveCount(2);
    const row = results(page)
      .locator('ul > li')
      .filter({ has: page.getByRole('heading', { name: FULL_LEAGUE }) });
    const status = row.locator('p:last-of-type [data-slot="badge"]');
    await expect(status).toHaveText('Full');
    await expect(status).toHaveClass(/\bborder-border\b/);
    await expect(row).toContainText('Full Season · waitlist open');
    await screenshot(page, testInfo, '530-find-full-season');
    await expectAccessible(page);
    await page.setViewportSize({ width: 320, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320,
    );
  });
});

test.describe('find a program: sport chips and division filters, in the browser', () => {
  const sheet = (page: Page) => page.getByRole('dialog', { name: 'Filters' });
  const filtersButton = (page: Page) =>
    page.getByRole('search', { name: 'Filter programs' }).getByRole('button', { name: /^Filters/ });

  const rowNamed = (page: Page, name: string) => rowNames(page).filter({ hasText: name });

  test('the Soccer chip opens the sport with its pills, and removing a pill loads the sport with the other filter', async ({
    page,
    consoleGuard,
  }) => {
    await seedYouth('over30');
    await page.goto('/programs?sport=soccer&age=over30&gender=womens');
    await hydrated(consoleGuard);
    await expect(rowNamed(page, GIRLS_ROOKIES).first()).toBeVisible();
    await expect(rowNamed(page, GIRLS_SELECT).first()).toBeVisible();
    await expect(rowNamed(page, BOYS_ROOKIES)).toHaveCount(0);
    await expect(
      page.getByRole('navigation', { name: 'Sport' }).getByRole('link', { name: 'Soccer' }),
    ).toHaveAttribute('aria-current', 'page');

    await page
      .getByRole('list', { name: 'Active filters' })
      .getByRole('link', { name: /^30\+/ })
      .click();
    await expect(page).toHaveURL(/\/programs\?sport=soccer&gender=womens$/);
    await expect(rowNames(page).first()).toBeVisible();
    await expect(rowNamed(page, BOYS_ROOKIES)).toHaveCount(0);

    await page
      .getByRole('navigation', { name: 'Sport' })
      .getByRole('link', { name: 'Softball' })
      .click();
    await expect(page).toHaveURL(/\/programs\?sport=softball&gender=womens$/);
    await expect(
      page.getByRole('navigation', { name: 'Sport' }).getByRole('link', { name: 'Softball' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  const WIDTHS = [
    { name: 'the default width', width: undefined },
    { name: 'a touch screen 800px wide and a mouse 600px wide', width: { touch: 800, mouse: 600 } },
  ];
  for (const { name, width } of WIDTHS) {
    test(`the results heading stays where it is as the facets arrive at ${name}`, async ({
      page,
      consoleGuard,
    }, testInfo) => {
      test.skip(
        !['chromium-desktop', 'chromium-mobile'].includes(testInfo.project.name),
        'one Chromium project per pointer',
      );
      if (width) {
        const touch = testInfo.project.name === 'chromium-mobile';
        await page.setViewportSize({ width: touch ? width.touch : width.mouse, height: 900 });
      }
      const { id } = await seed();
      const held = await holdQueries(page, ['search:programs']);
      await page.goto('/programs');
      await hydrated(consoleGuard);
      await submit(page, id);
      await expect.poll(() => held.isHolding()).toBe(true);
      await expect(page.getByTestId('find-skeleton')).toBeVisible();
      const headingTop = async () => (await page.locator('#results-heading').boundingBox())?.y;
      const before = await headingTop();
      expect(before).toBeGreaterThan(0);

      held.release();
      await expect(rowNames(page)).toHaveText([SUNDAY, THURSDAY]);
      expect(await headingTop()).toBe(before);
    });
  }

  test('a new search keeps the sport and the filters', async ({ page, consoleGuard }) => {
    await seedYouth('over35');
    await page.goto('/programs?sport=soccer&age=over35');
    await hydrated(consoleGuard);
    await submit(page, 'girls');
    await expect(page).toHaveURL(/\/programs\?q=girls&sport=soccer&age=over35$/);
    await expect(rowNamed(page, GIRLS_ROOKIES).first()).toBeVisible();
    await expect(rowNamed(page, BOYS_ROOKIES)).toHaveCount(0);
  });

  test.describe('the phone sheet', () => {
    test.skip(({ isMobile }) => !isMobile, 'the sheet runs at phone widths only');

    test('lists the U-ages, then Adult, then the adult brackets, and Show counts as chips change', async ({
      page,
      consoleGuard,
    }, testInfo) => {
      await seedTenant({
        name: 'Senior Ladder',
        locations: [{ name: FIELD, address: FIELD_ADDRESS }],
        leagues: [
          ...(['over55', 'over55', 'over60'] as const).map((ageGroup, i) => ({
            name: `00 Ladder ${String(i)}`,
            sport: 'softball' as const,
            locations: [FIELD],
            division: {
              gender: 'coed' as const,
              playersPerSide: 10,
              level: 'rec' as const,
              ageGroup,
            },
          })),
          {
            name: '00 Ladder U10',
            sport: 'softball' as const,
            locations: [FIELD],
            division: {
              gender: 'coed' as const,
              playersPerSide: 10,
              level: 'rec' as const,
              ageGroup: 'u10' as const,
            },
          },
          {
            name: '00 Ladder Adult',
            sport: 'softball' as const,
            locations: [FIELD],
            division: {
              gender: 'coed' as const,
              playersPerSide: 10,
              level: 'rec' as const,
              ageGroup: 'adult' as const,
            },
          },
        ],
      });
      await page.goto('/programs?sport=softball');
      await hydrated(consoleGuard);
      await filtersButton(page).click();
      await expect(sheet(page).locator('[data-slot="sheet-content"]')).toBeVisible();
      const age = sheet(page).getByRole('group', { name: 'Age group' });
      const labels = await age.locator('label').allTextContents();
      const rank = (label: string) => (label.startsWith('U') ? 0 : label === 'Adult' ? 1 : 2);
      expect(labels.map(rank)).toEqual([...labels.map(rank)].sort());
      expect(labels).toEqual(expect.arrayContaining(['U10', 'Adult', '55+', '60+']));
      await sheet(page).evaluate((element) =>
        Promise.all(element.getAnimations({ subtree: true }).map((a) => a.finished)),
      );
      expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
      await screenshot(page, testInfo, 'find-filter-sheet');

      const show = sheet(page).getByRole('button', { name: /^Show \d+ programs?$/ });
      const countOf = (label: string) => Number(/\d+/.exec(label)?.[0]);
      const initial = (await show.textContent()) ?? '';
      await age.getByText('55+', { exact: true }).click();
      await expect(show).not.toHaveText(initial);
      const fifties = (await show.textContent()) ?? '';
      expect(countOf(fifties)).toBeGreaterThanOrEqual(2);
      await age.getByText('60+', { exact: true }).click();
      await expect(show).not.toHaveText(fifties);
      expect(countOf((await show.textContent()) ?? '')).toBeGreaterThan(countOf(fifties));
      await age.getByText('60+', { exact: true }).click();
      await expect(show).toHaveText(fifties);
      const withFifties = countOf(fifties);

      await show.click();
      await expect(page).toHaveURL(/\/programs\?sport=softball&age=over55$/);
      await expect(
        page.getByRole('search', { name: 'Filter programs' }).getByRole('status'),
      ).toHaveText(new RegExp(`^${String(withFifties)} of \\d+ softball programs\\s*$`));
    });
  });

  test('states 5 and 6 pass the accessibility checks and do not scroll sideways at 320px', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    await seedYouth('over50');
    await page.goto('/programs?sport=soccer&age=over50&gender=womens');
    await hydrated(consoleGuard);
    await expect(rowNames(page).first()).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, 'find-sport-filtered');
    await page.setViewportSize({ width: 320, height: 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test('no match for the filters names them and offers each removal', async ({
    page,
    consoleGuard,
  }) => {
    await seedYouth('over40');
    // The league type, because a soccer camp in the same backend stays listed under any filter.
    await page.goto(
      '/programs?type=league&sport=soccer&gender=womens&age=over40&level=intermediate',
    );
    await hydrated(consoleGuard);
    await expect(results(page).getByRole('status')).toHaveText(
      'No soccer leagues match these filters',
    );
    await results(page)
      .getByRole('link', { name: /^Remove Level: Intermediate/ })
      .click();
    await expect(page).toHaveURL(/\/programs\?type=league&sport=soccer&gender=womens&age=over40$/);
    await expect(rowNamed(page, GIRLS_ROOKIES).first()).toBeVisible();
  });
});

test.describe('find a program: top bar', () => {
  const searchForm = (page: Page) => page.getByRole('search', { name: 'Find a league' });
  const phoneLink = (page: Page) =>
    page.getByRole('banner').getByRole('link', { name: 'Find a league' });

  test(
    'the raw HTML of a public page holds a GET search form to /leagues and the link to it',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant } = await seed();
      const { html } = await raw(request, `${tenant.path}?ott=SECRET-TOKEN`);
      const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
      expect(header).toMatch(/<form\b[^>]*role="search"[^>]*>/);
      expect(header).toMatch(/<form\b[^>]*action="\/leagues"[^>]*>/);
      expect(header).toMatch(/<form\b[^>]*method="get"[^>]*>/);
      expect(header).toMatch(/<form\b[^>]*aria-label="Find a league"[^>]*>/);
      expect(header).toMatch(/<input\b[^>]*name="q"[^>]*>/);
      expect(header).toMatch(/<a\b[^>]*href="\/leagues"[^>]*>[\s\S]*Find a league[\s\S]*<\/a>/);
      expect(html).not.toContain('SECRET-TOKEN');
    },
  );

  test('on a wide screen the field submits the words to /leagues and shows the results', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'the field shows from 768px');
    const { tenant, id } = await seed();
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    await expect(phoneLink(page)).toBeHidden();
    const input = searchForm(page).getByRole('searchbox', { name: 'Find a league' });
    await input.fill(id);
    await input.press('Enter');
    await expect(page).toHaveURL(`${baseURL}${leaguesUrl(id)}`);
    await expect(rowNames(page)).toHaveText([SUNDAY, THURSDAY]);
    await expect(searchForm(page)).toHaveCount(0);
  });

  test('with JavaScript disabled the field loads /leagues?q=', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'the field shows from 768px');
    const { tenant, id } = await seed();
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const plain = await context.newPage();
    try {
      await plain.goto(tenant.path);
      const input = searchForm(plain).getByRole('searchbox');
      await input.fill(id);
      await input.press('Enter');
      await expect(plain).toHaveURL(`${baseURL}${leaguesUrl(id)}`);
      await expect(rowNames(plain)).toHaveText([SUNDAY, THURSDAY]);
    } finally {
      await context.close();
    }
  });

  test('on a phone the bar holds a 44px square link to /leagues and no field', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'the link shows below 768px');
    const { tenant } = await seed();
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    await expect(searchForm(page)).toBeHidden();
    const link = phoneLink(page);
    await expect(link).toHaveAttribute('href', '/leagues');
    const box = await link.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await link.click();
    await expect(page).toHaveURL(`${baseURL}/programs?type=league`);
    await expect(page.getByRole('heading', { level: 1, name: 'Find a program' })).toBeVisible();
  });

  for (const path of ['/leagues', '/programs']) {
    test(`on ${path} the bar has neither the field nor the link`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('banner')).toBeVisible();
      await expect(
        page.getByRole('banner').getByRole('link', { name: 'Find a league' }),
      ).toHaveCount(0);
      await expect(page.getByRole('banner').getByRole('searchbox')).toHaveCount(0);
      await expect(page.getByRole('main').getByRole('searchbox')).toHaveCount(1);
    });
  }

  for (const width of [768, 1280]) {
    test(`at ${width}px the page with the field passes axe and does not scroll at 320px`, async ({
      page,
      consoleGuard,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium-desktop', 'sets its own width');
      const { tenant } = await seed();
      await page.setViewportSize({ width, height: 800 });
      await page.goto(tenant.path);
      await hydrated(consoleGuard);
      await expect(searchForm(page)).toBeVisible();
      await expectAccessible(page);
    });
  }

  test('at 360px the page with the link passes axe and does not scroll at 320px', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'the phone project is 360px');
    const { tenant } = await seed();
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    await expect(phoneLink(page)).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('find a program: offline', () => {
  test('a search viewed online opens from its saved copy with the note; any other search shows the not-saved view', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    const { id } = await seed();
    await page.goto(url(id));
    await expect(rowNames(page)).toHaveText([SUNDAY, THURSDAY]);
    await hydrated(consoleGuard);
    await submit(page, `harbor ${id}`);
    await expect(rowNames(page)).toHaveText([THURSDAY]);

    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await submit(page, id);
    await expect(rowNames(page)).toHaveText([SUNDAY, THURSDAY]);
    await expect(page.locator('app-saved-copy-note')).toBeVisible();

    await field(page).fill(`never viewed ${id}`);
    await field(page).press('Enter');
    await expect(page.locator('app-not-saved-view')).toBeVisible({ timeout: 3_000 });
    await expect(
      page.locator('app-not-saved-view').getByRole('heading', { level: 1 }),
    ).toBeFocused();
    await expect(page.locator('app-not-saved-view a')).toHaveAttribute(
      'href',
      url(`never viewed ${id}`),
    );
    await context.setOffline(false);
  });
});

const BEACH_OPEN_DIVISION = {
  gender: 'coed',
  playersPerSide: 4,
  level: 'bb',
  ageGroup: 'adult',
} as const;

const tournamentName = (id: string) => `Beach Open ${id}`;

const OVER_60_WOMENS = {
  gender: 'womens',
  playersPerSide: 10,
  level: 'rec',
  ageGroup: 'over60',
} as const;

/** No other test seeds a tournament in this division, so a browse of it lists only these, by name. */
const OVER_60_BROWSE = '/programs?type=tournament&sport=softball&gender=womens&age=over60';

async function seedOver60Tournaments(): Promise<{ id: string; names: string[] }> {
  const { tenant, id } = await seed();
  const names = [`Alpha Open ${id}`, `Bravo Open ${id}`];
  for (const [index, name] of names.entries()) {
    await seedTournament(tenant, {
      name,
      slug: `over-60-${String(index)}`,
      sport: 'softball',
      locations: [NORTH_BEACH],
      division: OVER_60_WOMENS,
      startDate: dateFromToday(40),
      endDate: dateFromToday(41),
    });
  }
  return { id, names };
}

async function seedWithTournament(): Promise<Seeded & { tournamentPath: string }> {
  const seeded = await seed();
  const tournamentPath = await seedTournament(seeded.tenant, {
    name: tournamentName(seeded.id),
    slug: 'beach-open',
    locations: [NORTH_BEACH],
    division: BEACH_OPEN_DIVISION,
    startDate: dateFromToday(40),
    endDate: dateFromToday(41),
    registrationDeadline: dateFromToday(30),
  });
  return { ...seeded, tournamentPath };
}

const rowOf = (html: string, name: string) =>
  plainText(
    resultsSection(html)
      .split('</li>')
      .find((row) => row.includes(name)) ?? '',
  );

const typeChipLinks = (html: string) =>
  [
    ...(
      /<nav\b[^>]*aria-label="Program type"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? ''
    ).matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g),
  ].map(([, attributes, name]) => ({
    name: name.trim(),
    href: /\bhref="([^"]*)"/.exec(attributes)?.[1]?.replace(/&amp;/g, '&'),
    current: attributes.includes('aria-current="page"'),
  }));

test.describe('find a program: leagues and tournaments', () => {
  test(
    'a search finds leagues and a tournament, each with its type, and the tournament shows its dates and status',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, id, tournamentPath } = await seedWithTournament();
      const { html } = await raw(request, url(id));
      expect(resultNames(html).sort()).toEqual([tournamentName(id), SUNDAY, THURSDAY].sort());
      expect(plainText(resultsSection(html))).toContain(`3 programs match “${id}”`);
      expect(rowOf(html, SUNDAY)).toContain(`${SUNDAY} League Coed`);
      expect(rowOf(html, tournamentName(id))).toContain(`${tournamentName(id)} Tournament Coed`);
      const tournament = rowOf(html, tournamentName(id));
      expect(tournament).toContain('Registration open');
      expect(tournament).toMatch(/[A-Z][a-z]{2} \d{1,2}(?: – [A-Z][a-z]{2} \d{1,2})?, \d{4}/);
      expect(tournament).toContain('closes');
      expect(html).toContain(`href="${tournamentPath}"`);
      expect(html).toContain(`href="${tenant.path}/leagues/sunday-reverse-coed-4s"`);
      expect(typeChipLinks(html)).toEqual([
        { name: 'All', href: url(id), current: true },
        { name: 'Leagues', href: `/programs?type=league&q=${id}`, current: false },
        { name: 'Tournaments', href: `/programs?type=tournament&q=${id}`, current: false },
      ]);
    },
  );

  test(
    'a type chosen with a search lists only that type, and the chips keep every type with a match',
    RAW_HTTP,
    async ({ request }) => {
      const { id } = await seedWithTournament();
      const tournaments = await raw(request, `/programs?type=tournament&q=${id}`);
      expect(resultNames(tournaments.html)).toEqual([tournamentName(id)]);
      expect(typeChipLinks(tournaments.html).map((chip) => [chip.name, chip.current])).toEqual([
        ['All', false],
        ['Leagues', false],
        ['Tournaments', true],
      ]);
      const leagues = await raw(request, `/programs?type=league&q=${id}`);
      expect(resultNames(leagues.html).sort()).toEqual([SUNDAY, THURSDAY]);
    },
  );

  test(
    'a type and a sport without a search list the tournaments by name',
    RAW_HTTP,
    async ({ request }) => {
      const { id, names } = await seedOver60Tournaments();
      const { html } = await raw(request, OVER_60_BROWSE);
      expect(resultNames(html).filter((name) => name.endsWith(id))).toEqual(names);
      const rows = resultsSection(html).split('</li>').slice(0, -1);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => plainText(row).includes('Tournament'))).toBe(true);
      expect(rows.some((row) => /<span[^>]*>\s*League\s*<\/span>/.test(row))).toBe(false);
    },
  );

  test(
    'a type and a sport are indexable with their own canonical and title',
    RAW_HTTP,
    async ({ request }) => {
      const path = '/programs?type=tournament&sport=beach-volleyball';
      const { html } = await raw(request, path);
      expect(html).not.toMatch(/name="robots"/);
      expect(canonicalOf(html)?.endsWith(path)).toBe(true);
      expect(html).toContain(
        '<title>Beach volleyball tournaments | Find a program | Omni League</title>',
      );
    },
  );

  test(
    'a type with no match shows its chip as current with no results, training is named as not listed, and an unknown type is ignored and appears nowhere',
    RAW_HTTP,
    async ({ request }) => {
      const { id } = await seedWithTournament();
      const camps = await raw(request, `/programs?type=camp&q=${id}`);
      expect(resultNames(camps.html)).toEqual([]);
      expect(typeChipLinks(camps.html).find((chip) => chip.current)).toMatchObject({
        name: 'Camps',
      });
      expect(plainText(resultsSection(camps.html))).toContain(`No camps match “${id}”`);
      expect(plainText(resultsSection(camps.html))).toContain('3 programs of other types match.');
      const training = await raw(request, '/programs?type=training');
      expect(resultNames(training.html)).toEqual([]);
      expect(plainText(resultsSection(training.html))).toContain(
        'Find a program does not list training programs yet',
      );
      expect(plainText(resultsSection(training.html))).toContain(
        'Search the leagues, tournaments, and camps instead.',
      );

      const unknown = await raw(request, `/programs?type=zzz&q=${id}`);
      expect(unknown.html).not.toContain('zzz');
      expect(resultNames(unknown.html)).toEqual(resultNames((await raw(request, url(id))).html));
      expect(typeChipLinks(unknown.html).some((chip) => chip.current && chip.name === 'All')).toBe(
        true,
      );
    },
  );

  test(
    'the search and the sport views are indexed as before: a search is noindex with the canonical /programs, a sport is indexable, and page 2 keeps its page',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant } = await seed();
      for (let i = 1; i <= 6; i++) {
        await seedTournament(tenant, {
          name: `Softball Cup ${i}`,
          slug: `softball-cup-${i}`,
          sport: 'softball',
          locations: [NORTH_BEACH],
          startDate: dateFromToday(40),
          endDate: dateFromToday(41),
        });
      }
      const search = await raw(request, '/programs?q=coed');
      expect(search.html).toMatch(/<meta\b[^>]*name="robots"[^>]*content="noindex"/);
      expect(canonicalOf(search.html)?.endsWith('/programs')).toBe(true);
      const sport = await raw(request, '/programs?sport=soccer');
      expect(sport.html).not.toMatch(/name="robots"/);
      expect(canonicalOf(sport.html)?.endsWith('/programs?sport=soccer')).toBe(true);
      const second = await raw(request, '/programs?sport=softball&page=2');
      expect(second.html).not.toMatch(/name="robots"/);
      expect(canonicalOf(second.html)?.endsWith('/programs?sport=softball&page=2')).toBe(true);
    },
  );

  test(
    'a tournament row’s status reads Registration closed after its deadline',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, id } = await seed();
      await seedTournament(tenant, {
        name: `Closed Cup ${id}`,
        slug: 'closed-cup',
        locations: [NORTH_BEACH],
        startDate: dateFromToday(40),
        endDate: dateFromToday(41),
        registrationDeadline: dateFromToday(-3),
      });
      const { html } = await raw(request, url(`closed cup ${id}`));
      expect(rowOf(html, `Closed Cup ${id}`)).toContain('Registration closed');
    },
  );
});

const CAMP_NAME = 'Junior Beach Volleyball Camp';

interface CampSeeded extends Seeded {
  campName: string;
  campPath: string;
}

/**
 * The organization also has a draft camp and one whose only session has ended, which no search or browse lists.
 * `prefix` puts the camps first by name in a browse, which lists every organization's camps of the sport.
 */
async function seedWithCamp(prefix = '', withTournament = false): Promise<CampSeeded> {
  const seeded = await seed();
  if (withTournament) {
    await seedTournament(seeded.tenant, {
      name: tournamentName(seeded.id),
      slug: 'beach-open',
      locations: [NORTH_BEACH],
      division: BEACH_OPEN_DIVISION,
      startDate: dateFromToday(40),
      endDate: dateFromToday(41),
      registrationDeadline: dateFromToday(30),
    });
  }
  const camp = (name: string, slug: string, session: [number, number], status?: 'draft') => ({
    name: `${prefix}${name}`,
    slug,
    locations: [NORTH_BEACH],
    minimumAge: 9,
    maximumAge: 14,
    sessions: [
      {
        name: 'Week 1',
        startDate: dateFromToday(session[0]),
        endDate: dateFromToday(session[1]),
        registrationDeadline: dateFromToday(session[0] - 4),
      },
    ],
    ...(status && { status }),
  });
  const campPath = await seedPublishedCamp(seeded.tenant, camp(CAMP_NAME, 'junior-camp', [14, 18]));
  await seedPublishedCamp(
    seeded.tenant,
    camp('Draft Junior Camp', 'draft-camp', [14, 18], 'draft'),
  );
  await seedPublishedCamp(seeded.tenant, camp('Ended Junior Camp', 'ended-camp', [-20, -15]));
  return { ...seeded, campName: `${prefix}${CAMP_NAME}`, campPath };
}

const chipNames = (html: string) => typeChipLinks(html).map((chip) => chip.name);

test.describe('find a program: camps', () => {
  test(
    'a search finds the camp with its Camp badge, ages, and next session’s dates and status, and lists no draft or ended camp',
    RAW_HTTP,
    async ({ request }) => {
      const { id, campPath } = await seedWithCamp();
      const { html } = await raw(request, url(`junior ${id}`));
      expect(resultNames(html)).toEqual([CAMP_NAME]);
      const row = rowOf(html, CAMP_NAME);
      expect(row).toContain(`${CAMP_NAME} Camp Ages 9 to 14`);
      expect(row).toContain('Registration open');
      expect(row).toMatch(/[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}, \d{4}/);
      expect(row).toContain('closes');
      expect(html).toContain(`href="${campPath}"`);
      expect(chipNames(html)).toEqual(['All', 'Camps']);
    },
  );

  test(
    'a search lists the leagues and the camp, with a chip for each type that matches and no count on any chip',
    RAW_HTTP,
    async ({ request }) => {
      const { id } = await seedWithCamp();
      const { html } = await raw(request, url(id));
      expect(resultNames(html).sort()).toEqual([CAMP_NAME, SUNDAY, THURSDAY].sort());
      expect(plainText(resultsSection(html))).toContain(`3 programs match “${id}”`);
      expect(chipNames(html)).toEqual(['All', 'Leagues', 'Camps']);
      expect(chipNames(html).every((name) => !/\d/.test(name))).toBe(true);
      const camps = await raw(request, `/programs?type=camp&q=${id}`);
      expect(resultNames(camps.html)).toEqual([CAMP_NAME]);
    },
  );

  test(
    'a type and a sport without a search list the camp, and not a draft or ended camp',
    RAW_HTTP,
    async ({ request }) => {
      const { campName } = await seedWithCamp('Aaa ');
      const { html } = await raw(request, '/programs?type=camp&sport=beach-volleyball');
      expect(resultNames(html)).toContain(campName);
      expect(resultNames(html)).not.toContain('Aaa Draft Junior Camp');
      expect(resultNames(html)).not.toContain('Aaa Ended Junior Camp');
      expect(rowOf(html, campName)).toContain('Camp Ages 9 to 14');
      expect(currentChip(html)).toBe('Beach volleyball');
    },
  );

  test(
    'a division filter narrows the leagues and leaves the camp listed and counted',
    RAW_HTTP,
    async ({ request }) => {
      const { id } = await seedWithCamp();
      const { html } = await raw(request, `${url(id)}&gender=womens`);
      expect(resultNames(html)).toEqual([CAMP_NAME]);
      expect(chipNames(html)).toEqual(['All', 'Camps']);
      const count = /<p\b[^>]*role="status"[^>]*>([\s\S]*?)<\/p>/.exec(filterBar(html))?.[1] ?? '';
      expect(plainText(count)).toBe('1 of 3 programs');
    },
  );

  test(
    'a camp search for words only a league holds says no camps match and how many programs of another type do',
    RAW_HTTP,
    async ({ request }) => {
      const { id } = await seedWithCamp();
      const { html } = await raw(
        request,
        `/programs?type=camp&q=${encodeURIComponent(`sunday ${id}`)}`,
      );
      expect(resultNames(html)).toEqual([]);
      const text = plainText(resultsSection(html));
      expect(text).toContain(`No camps match “sunday ${id}”`);
      expect(text).toContain('1 program of another type matches.');
      expect(text).toContain('Show all types');
    },
  );

  test('the intro and the description of the page name camps', RAW_HTTP, async ({ request }) => {
    const { html } = await raw(request, '/programs');
    expect(plainText(html)).toContain(
      'Beach volleyball, soccer, and softball leagues, tournaments, and camps on Omni League.',
    );
    expect(html).toContain('leagues, tournaments, and camps on Omni League');
  });

  test('the camp states pass the axe helper and do not scroll sideways at 320px', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const { id, campName } = await seedWithCamp();
    await page.goto(url(`junior ${id}`));
    await hydrated(consoleGuard);
    await expect(rowNames(page)).toHaveText([campName]);
    await screenshot(page, testInfo, '373-programs-camp-result');
    await expectAccessible(page);

    await page.goto(`/programs?type=camp&q=${encodeURIComponent(`sunday ${id}`)}`);
    await hydrated(consoleGuard);
    await expect(results(page)).toContainText(`No camps match “sunday ${id}”`);
    await screenshot(page, testInfo, '373-programs-camp-other-type');
    await expectAccessible(page);

    await page.goto('/programs?type=camp&sport=beach-volleyball');
    await hydrated(consoleGuard);
    await expect(results(page).locator('ul > li').first()).toContainText('Camp');
    await screenshot(page, testInfo, '373-programs-camp-browse');
    await expectAccessible(page);
  });

  test('the Camps chip lists the camp and keeps the search, and All brings the leagues back', async ({
    page,
    consoleGuard,
  }) => {
    const { id } = await seedWithCamp();
    await page.goto(url(id));
    await hydrated(consoleGuard);
    await expect(rowNames(page)).toHaveCount(3);
    const chips = page.getByRole('navigation', { name: 'Program type' });
    await chips.getByRole('link', { name: 'Camps' }).click();
    await expect(page).toHaveURL(`${baseURL}/programs?type=camp&q=${id}`);
    await expect(rowNames(page)).toHaveText([CAMP_NAME]);
    await chips.getByRole('link', { name: 'All' }).click();
    await expect(rowNames(page)).toHaveCount(3);
  });
});

test.describe('find a program: /leagues redirects', () => {
  test(
    '/leagues answers a 301 to /programs?type=league with the known parameters only, no-store, and no other parameter anywhere in the response',
    RAW_HTTP,
    async () => {
      const canary = `CANARY${randomUUID().slice(0, 8)}`;
      const response = await rawGet(`/leagues?q=coed&sport=soccer&canary=${canary}&ott=${canary}`);
      expect(response.status).toBe(301);
      expect(response.location).toBe('/programs?type=league&q=coed&sport=soccer');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(response.headers)).not.toContain(canary);
      expect(response.body).not.toContain(canary);

      const bare = await rawGet('/leagues');
      expect(bare.status).toBe(301);
      expect(bare.location).toBe('/programs?type=league');
      const filtered = await rawGet('/leagues?sport=soccer&gender=girls&age=u10&page=2&zzz=1');
      expect(filtered.location).toBe(
        '/programs?type=league&sport=soccer&gender=girls&age=u10&page=2',
      );
    },
  );

  test('an in-app link to /leagues lands on /programs?type=league', async ({
    page,
    consoleGuard,
  }) => {
    await page.goto('/programs');
    await hydrated(consoleGuard);
    await page.getByRole('contentinfo').getByRole('link', { name: 'Find a league' }).click();
    await expect(page).toHaveURL(`${baseURL}/programs?type=league`);
    await expect(page.getByRole('heading', { level: 1, name: 'Find a program' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Program type' }).getByRole('link', { name: 'Leagues' }),
    ).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('find a program: type chips in the browser', () => {
  test('choosing Tournaments lists the tournament and keeps the search, and All brings the leagues back', async ({
    page,
    consoleGuard,
  }) => {
    const { id } = await seedWithTournament();
    await page.goto(url(id));
    await hydrated(consoleGuard);
    await expect(rowNames(page)).toHaveCount(3);
    const chips = page.getByRole('navigation', { name: 'Program type' });
    await chips.getByRole('link', { name: 'Tournaments' }).click();
    await expect(page).toHaveURL(`${baseURL}/programs?type=tournament&q=${id}`);
    await expect(rowNames(page)).toHaveText([tournamentName(id)]);
    await expect(chips.getByRole('link', { name: 'Tournaments' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await chips.getByRole('link', { name: 'All' }).click();
    await expect(page).toHaveURL(`${baseURL}${url(id)}`);
    await expect(rowNames(page)).toHaveCount(3);
  });

  test('a new search keeps the chosen type', async ({ page, consoleGuard }) => {
    const { id } = await seedWithTournament();
    await page.goto('/programs?type=tournament&sport=beach-volleyball');
    await hydrated(consoleGuard);
    await submit(page, id);
    await expect(page).toHaveURL(
      `${baseURL}/programs?type=tournament&q=${id}&sport=beach-volleyball`,
    );
    await expect(rowNames(page)).toHaveText([tournamentName(id)]);
  });

  test('the type chips pass the axe helper with the results, the empty type, and the browse, and nothing scrolls sideways at 320px', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const { id } = await seedWithTournament();
    const over60 = await seedOver60Tournaments();
    await page.goto(url(id));
    await hydrated(consoleGuard);
    await expect(rowNames(page)).toHaveCount(3);
    await screenshot(page, testInfo, '350-programs-results');
    await expectAccessible(page);

    await page.goto(`/programs?type=camp&q=${id}`);
    await hydrated(consoleGuard);
    await expect(results(page)).toContainText(`No camps match “${id}”`);
    await screenshot(page, testInfo, '350-programs-other-type');
    await expectAccessible(page);

    await page.goto(OVER_60_BROWSE);
    await hydrated(consoleGuard);
    await expect(rowNames(page).filter({ hasText: over60.id }).first()).toBeVisible();
    await screenshot(page, testInfo, '350-programs-browse');
    await expectAccessible(page);
  });

  test('no type chip moves while the answer to a type press loads', async ({
    page,
    consoleGuard,
  }) => {
    const { id } = await seedWithTournament();
    const held = await holdQueries(page, ['search:programs'], {
      watchFromStart: false,
      holdFromStart: false,
    });
    await page.goto(url(id));
    await hydrated(consoleGuard);
    await expect(rowNames(page)).toHaveCount(3);
    const chips = page.getByRole('navigation', { name: 'Program type' }).getByRole('link');
    const positions = async () =>
      Promise.all((await chips.all()).map(async (chip) => (await chip.boundingBox())?.x));
    const before = await positions();
    expect(before).toHaveLength(3);

    held.watchNewSubscriptions();
    held.holdNextAnswer();
    await chips.filter({ hasText: 'Tournaments' }).click();
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(page.getByTestId('find-skeleton')).toBeVisible();
    expect(await positions()).toEqual(before);

    held.release();
    await expect(rowNames(page)).toHaveText([tournamentName(id)]);
    expect(await positions()).toEqual(before);
  });

  test('the chips and the results do not move when a search answers', async ({
    page,
    consoleGuard,
  }) => {
    const { id } = await seedWithTournament();
    const held = await holdQueries(page, ['search:programs']);
    await page.goto('/programs');
    await hydrated(consoleGuard);
    await submit(page, id);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(page.getByTestId('find-skeleton')).toBeVisible();
    const chips = page.getByRole('navigation', { name: 'Program type' });
    const top = async () => ({
      chips: (await chips.boundingBox())?.y,
      sports: (await page.getByRole('navigation', { name: 'Sport' }).boundingBox())?.y,
      results: (await page.locator('#results-heading').boundingBox())?.y,
    });
    const before = await top();
    held.release();
    await expect(rowNames(page)).toHaveCount(3);
    expect(await top()).toEqual(before);
  });
});

interface ProgramsBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function programsBox(locator: Locator): Promise<ProgramsBox> {
  const found = await locator.boundingBox();
  expect(found, 'the element has a box').not.toBeNull();
  return found as ProgramsBox;
}

/** The boxes above the results, which neither a search nor a type press may move. */
async function programsFrame(page: Page) {
  const chipBoxes = async (name: string) =>
    Promise.all(
      (await page.getByRole('navigation', { name }).getByRole('link').all()).map(programsBox),
    );
  return {
    heading: await programsBox(page.getByRole('heading', { level: 1 })),
    form: await programsBox(page.getByRole('search', { name: 'Filter programs' })),
    types: await programsBox(page.getByRole('navigation', { name: 'Program type' })),
    typeChips: await chipBoxes('Program type'),
    sports: await programsBox(page.getByRole('navigation', { name: 'Sport' })),
    sportChips: await chipBoxes('Sport'),
    results: await programsBox(page.locator('#results-heading')),
  };
}

const typeNav = (page: Page) => page.getByRole('navigation', { name: 'Program type' });
const sportNav = (page: Page) => page.getByRole('navigation', { name: 'Sport' });

for (const width of [320, 360, 1280]) {
  test.describe(`find a program: layout at ${String(width)}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('the chips, the form, and the results heading keep their boxes from the skeleton to the loaded rows', async ({
      page,
      consoleGuard,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium-desktop', 'the test sets the width itself');
      const { id } = await seedWithTournament();
      const held = await holdQueries(page, ['search:programs']);
      await page.goto('/programs');
      await hydrated(consoleGuard);
      await submit(page, id);
      await expect.poll(() => held.isHolding()).toBe(true);
      await expect(page.getByTestId('find-skeleton')).toBeVisible();
      const loading = await programsFrame(page);
      const skeletonRow = await programsBox(
        page.getByTestId('find-skeleton').locator('div.py-4').first(),
      );
      await screenshot(page, testInfo, `350-programs-loading-${String(width)}`);

      held.release();
      await expect(rowNames(page)).toHaveCount(3);
      await screenshot(page, testInfo, `350-programs-loaded-${String(width)}`);
      const loaded = await programsFrame(page);
      // The start view offers Camps, which leaves the row when no camp matches; the chips before it stay where they were.
      expect({ ...loaded, typeChips: [] }).toEqual({ ...loading, typeChips: [] });
      expect(loaded.typeChips).toHaveLength(3);
      expect(loaded.typeChips).toEqual(loading.typeChips.slice(0, 3));
      const rowHeights = await results(page)
        .locator('ul > li')
        .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
      await testInfo.attach('row-heights', {
        body: JSON.stringify({ skeletonRow: skeletonRow.height, loadedRows: rowHeights }),
        contentType: 'application/json',
      });
      // A narrow screen wraps the text of a row, which a skeleton cannot know.
      if (width >= 1024) {
        expect(Math.abs(rowHeights[0] - skeletonRow.height)).toBeLessThanOrEqual(2);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });

    const PRESSES = [
      {
        name: 'a type press',
        press: (page: Page) => typeNav(page).getByRole('link', { name: 'Tournaments' }).click(),
      },
      {
        name: 'a sport press',
        press: (page: Page) =>
          sportNav(page).getByRole('link', { name: 'Beach volleyball' }).click(),
      },
    ];
    for (const { name, press } of PRESSES) {
      test(`every chip keeps its box while the answer to ${name} loads`, async ({
        page,
        consoleGuard,
      }, testInfo) => {
        test.skip(testInfo.project.name !== 'chromium-desktop', 'the test sets the width itself');
        const { id } = await seedWithTournament();
        const held = await holdQueries(page, ['search:programs'], {
          watchFromStart: false,
          holdFromStart: false,
        });
        await page.goto(url(id));
        await hydrated(consoleGuard);
        await expect(rowNames(page)).toHaveCount(3);
        const before = await programsFrame(page);
        expect(before.typeChips).toHaveLength(3);

        held.watchNewSubscriptions();
        held.holdNextAnswer();
        await press(page);
        await expect.poll(() => held.isHolding()).toBe(true);
        await expect(page.getByTestId('find-skeleton')).toBeVisible();
        const during = await programsFrame(page);
        expect(during.typeChips).toEqual(before.typeChips);
        expect(during.sportChips).toEqual(before.sportChips);
        expect(during.heading).toEqual(before.heading);
        expect(during.form).toEqual(before.form);

        held.release();
        await expect(page.getByTestId('find-skeleton')).toBeHidden();
        const after = await programsFrame(page);
        expect(after.typeChips).toEqual(before.typeChips);
        expect(after.sportChips).toEqual(before.sportChips);
      });
    }

    test('the chips are where the server put them once the page hydrates', async ({
      page,
      browser,
      consoleGuard,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium-desktop', 'the test sets the width itself');
      const { id } = await seedWithTournament();
      const path = `/programs?q=${id}&sport=beach-volleyball`;
      const bare = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width, height: 900 },
      });
      const serverPage = await bare.newPage();
      await serverPage.goto(`${baseURL}${path}`);
      await expect(rowNames(serverPage)).toHaveCount(3);
      const server = await programsFrame(serverPage);
      const serverTypes = await typeNav(serverPage).getByRole('link').allTextContents();
      const serverSports = await sportNav(serverPage).getByRole('link').allTextContents();
      await bare.close();

      await page.goto(path);
      await hydrated(consoleGuard);
      await expect(rowNames(page)).toHaveCount(3);
      expect(await programsFrame(page)).toEqual(server);
      expect(await typeNav(page).getByRole('link').allTextContents()).toEqual(serverTypes);
      expect(await sportNav(page).getByRole('link').allTextContents()).toEqual(serverSports);
      expect(serverTypes).toEqual(['All', 'Leagues', 'Tournaments']);
    });
  });
}

for (const width of [320, 360, 1280]) {
  test.describe(`find a program: camp layout at ${String(width)}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    for (const withTournament of [true, false]) {
      const offers = withTournament ? 'all three types' : 'two types';
      test(`the chips, the form, and the results heading keep their boxes from the skeleton to a search that offers ${offers}`, async ({
        page,
        consoleGuard,
      }, testInfo) => {
        test.skip(testInfo.project.name !== 'chromium-desktop', 'the test sets the width itself');
        const { id } = await seedWithCamp('', withTournament);
        const held = await holdQueries(page, ['search:programs']);
        await page.goto('/programs');
        await hydrated(consoleGuard);
        await submit(page, id);
        await expect.poll(() => held.isHolding()).toBe(true);
        await expect(page.getByTestId('find-skeleton')).toBeVisible();
        const loading = await programsFrame(page);

        held.release();
        await expect(rowNames(page)).toHaveCount(withTournament ? 4 : 3);
        await screenshot(
          page,
          testInfo,
          `373-programs-camp-loaded-${withTournament ? 'three' : 'two'}-types-${String(width)}`,
        );
        const loaded = await programsFrame(page);
        expect(loaded.typeChips).toHaveLength(withTournament ? 4 : 3);
        // A chip with no match leaves the row as the answer arrives; the boxes around the row stay where they were.
        expect({ ...loaded, typeChips: [] }).toEqual({ ...loading, typeChips: [] });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
      });
    }

    test('every chip keeps its box while the answer to a Camps press loads', async ({
      page,
      consoleGuard,
    }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium-desktop', 'the test sets the width itself');
      const { id } = await seedWithCamp('', true);
      const held = await holdQueries(page, ['search:programs'], {
        watchFromStart: false,
        holdFromStart: false,
      });
      await page.goto(url(id));
      await hydrated(consoleGuard);
      await expect(rowNames(page)).toHaveCount(4);
      const before = await programsFrame(page);
      expect(before.typeChips).toHaveLength(4);

      held.watchNewSubscriptions();
      held.holdNextAnswer();
      await typeNav(page).getByRole('link', { name: 'Camps' }).click();
      await expect.poll(() => held.isHolding()).toBe(true);
      await expect(page.getByTestId('find-skeleton')).toBeVisible();
      const during = await programsFrame(page);
      expect(during.typeChips).toEqual(before.typeChips);
      expect(during.types).toEqual(before.types);
      expect(during.sports).toEqual(before.sports);

      held.release();
      await expect(rowNames(page)).toHaveText([CAMP_NAME]);
      const after = await programsFrame(page);
      expect(after.typeChips).toEqual(before.typeChips);
      expect(after.types).toEqual(before.types);
      expect(after.sports).toEqual(before.sports);
    });
  });
}

test.describe('find a program: the chips with script off and by keyboard', () => {
  test('a type chip and a sport chip are links that load their own page without script', async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'script is off in every project');
    const { id } = await seedWithTournament();
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(`${baseURL}${url(id)}`);
    await expect(rowNames(page)).toHaveCount(3);
    await typeNav(page).getByRole('link', { name: 'Tournaments' }).click();
    await expect(page).toHaveURL(`${baseURL}/programs?type=tournament&q=${id}`);
    await expect(rowNames(page)).toHaveCount(1);
    await sportNav(page).getByRole('link', { name: 'Beach volleyball' }).click();
    await expect(page).toHaveURL(
      `${baseURL}/programs?type=tournament&q=${id}&sport=beach-volleyball`,
    );
    await expect(rowNames(page)).toHaveCount(1);
    await context.close();
  });

  test('Tab reaches each type chip after the search button and Enter chooses it', async ({
    page,
    consoleGuard,
  }) => {
    const { id } = await seedWithTournament();
    await page.goto(url(id));
    await hydrated(consoleGuard);
    await expect(rowNames(page)).toHaveCount(3);
    await page.getByRole('button', { name: 'Search', exact: true }).focus();
    const reached: string[] = [];
    for (let step = 0; step < 8 && reached.at(-1) !== 'Tournaments'; step++) {
      await page.keyboard.press('Tab');
      reached.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
    }
    expect(reached).toEqual(expect.arrayContaining(['All', 'Leagues', 'Tournaments']));
    await expect(typeNav(page).getByRole('link', { name: 'Tournaments' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${baseURL}/programs?type=tournament&q=${id}`);
    await expect(rowNames(page)).toHaveText([tournamentName(id)]);
    await expect(typeNav(page).getByRole('link', { name: 'Tournaments' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('a sport chip is chosen with Enter and the page passes the accessibility checks with both chip rows', async ({
    page,
    consoleGuard,
  }) => {
    const { id } = await seedWithTournament();
    await page.goto(url(id));
    await hydrated(consoleGuard);
    await expect(rowNames(page)).toHaveCount(3);
    await expectAccessible(page);
    await sportNav(page).getByRole('link', { name: 'Beach volleyball' }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${baseURL}/programs?q=${id}&sport=beach-volleyball`);
  });
});
