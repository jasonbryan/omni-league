import type { APIRequestContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { freezeOrganizations } from './support/freeze-organizations';
import { holdQueries } from './support/hold-queries';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { dateFromToday, seedSeasons, seedTenant, type Tenant } from './support/tenant';
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

const url = (q: string) => `/leagues?q=${encodeURIComponent(q)}`;

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
  page.getByRole('searchbox', { name: 'League, organization, or location' });
const results = (page: Page) => page.locator('section[aria-labelledby="results-heading"]');
const rowNames = (page: Page) => results(page).locator('ul > li h3');

async function submit(page: Page, q: string): Promise<void> {
  await field(page).fill(q);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
}

test.describe('find a league: raw server HTML', () => {
  test(
    '/leagues without a search: 200, the public Cache-Control, the title, the form, and no results section',
    RAW_HTTP,
    async ({ request }) => {
      const { status, headers, html } = await fetchRawHtml(request, '/leagues');
      expect(status).toBe(200);
      expect(noSpaces(headers['cache-control'])).toBe(noSpaces(PUBLIC_PAGE_CACHE));
      expect(headers['content-type']).toContain('text/html');
      expect(html).toContain('<title>Find a league | Omni League</title>');
      expect(html).toMatch(/<h1\b[^>]*>\s*Find a league\s*<\/h1>/);
      expect(html).toMatch(/<form\b[^>]*role="search"[^>]*action="\/leagues"/);
      expect(html).toContain('League, organization, or location');
      expect(html).toContain('name="q"');
      expect(html).not.toContain('results-heading');
      expect(html).not.toContain('name="robots"');
    },
  );

  test(
    '?q: the leagues of a published organization with their organization, division, and status, the count line, noindex, and the canonical /leagues',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, id } = await seed();
      const { headers, html } = await raw(request, url(`coed ${id}`));
      expect(noSpaces(headers['cache-control'])).toBe(noSpaces(PUBLIC_PAGE_CACHE));
      expect(resultNames(html).slice(0, 2).sort()).toEqual([SUNDAY, THURSDAY]);
      expect(resultNames(html)).not.toContain(DRAFT);

      const section = plainText(resultsSection(html));
      expect(section).toMatch(/^Results (?:\d+ leagues? match|Showing the first 50)/);
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
      expect(plainText(resultsSection(exact.html))).toContain(`2 leagues match “${id}”`);
      const canonicals = [...html.matchAll(/<link\b[^>]*\brel="canonical"[^>]*>/g)].map(
        ([tag]) => /\bhref="([^"]*)"/.exec(tag)?.[1] ?? '',
      );
      expect(canonicals).toHaveLength(1);
      expect(canonicals[0].endsWith('/leagues')).toBe(true);
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
        `1 league matches “coed 4s corpus ${id}”`,
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
      const { html } = await raw(request, url(`coed 4s ${id} austin`));
      const section = resultsSection(html);
      expect(plainText(section)).toContain(`No leagues match “coed 4s ${id} austin”`);
      expect(plainText(section)).toContain('Try fewer words:');
      expect(resultNames(html)).toEqual([]);
      const links = [
        ...section.matchAll(/<li\b[^>]*>\s*<a\b[^>]*\bhref="([^"]*)"[^>]*>([^<]*)<\/a>/g),
      ];
      expect(links.map(([, href, name]) => [href, name])).toEqual([
        [`/leagues?q=${encodeURIComponent(`coed 4s ${id}`)}`, `coed 4s ${id}`],
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
      'womens, typed without the apostrophe, lists the adult league and not the girls league',
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
    expect(plainText(section)).toContain('No leagues match “pickleball”');
    expect(plainText(section)).toContain('Try a league name, an organization, or a location');
    expect(section).toMatch(/<a\b[^>]*href="\/leagues"[^>]*>\s*Clear the search\s*<\/a>/);
    expect(section).not.toContain('<ul');
  });

  test(
    'a q of 300 characters, 20 words, or repeated renders 200 from the first 100 characters, 16 words, or value, and no other parameter reaches the response',
    RAW_HTTP,
    async ({ request }) => {
      const canary = `CANARY${randomUUID().replaceAll('-', '')}`;
      const longWord = 'x'.repeat(300);
      const long = await raw(request, `/leagues?q=${longWord}&utm_source=${canary}`);
      expect(long.html).toContain(`No leagues match “${'x'.repeat(100)}”`);
      expect(long.html).not.toContain('x'.repeat(101));
      expect(long.html).not.toContain(canary);

      const words = Array.from({ length: 20 }, (_, i) => `zz${i + 1}`);
      const many = await raw(request, `/leagues?q=${words.join('+')}&ott=${canary}`);
      expect(plainText(resultsSection(many.html))).toContain(
        `No leagues match “${words.slice(0, 16).join(' ')}”`,
      );
      expect(many.html).not.toContain('zz17');
      expect(many.html).not.toContain(canary);

      const repeated = await raw(request, `/leagues?q=first&q=${canary}`);
      expect(plainText(resultsSection(repeated.html))).toContain('No leagues match “first”');
      expect(repeated.html).not.toContain(canary);
      expect(JSON.stringify(repeated.headers)).not.toContain(canary);
    },
  );
});

test.describe('find a league: in the browser', () => {
  test('a new search shows skeleton rows with "Searching." until the results arrive, adds a history entry, and Back restores the earlier results', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'one browser project only');
    const { id } = await seed();
    // The socket must be routed before the page opens it.
    const held = await holdQueries(page, ['search:leagues']);
    await page.goto('/leagues');
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
      await page.goto('/leagues');
      await hydrated(consoleGuard);
      await field(page).fill(id);
      await field(page).press('Enter');
      await expect(page).toHaveURL(`${baseURL}${url(id)}`);
      await expect(rowNames(page)).toHaveText([SUNDAY, THURSDAY]);
      await expect(results(page).getByRole('status')).toContainText('2 leagues match');
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
        await plain.goto('/leagues');
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
    await expect(page).toHaveURL(`${baseURL}/leagues`);
    await expect(page.getByRole('heading', { level: 1, name: 'Find a league' })).toBeVisible();
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
      await expect(results(page)).toContainText(`No leagues match “harbor ${id}”`);
      await expect(rowNames(page)).toHaveCount(0);
    },
  );

  test('states 2 to 4: the results, no results, and the form pass the accessibility checks', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const { id } = await seed();
    await freezeOrganizations(page);
    await page.goto('/leagues');
    await hydrated(consoleGuard);
    await screenshot(page, testInfo, '300-find-start');
    await expectAccessible(page);

    await submit(page, id);
    await expect(rowNames(page)).toHaveText([SUNDAY, THURSDAY]);
    await screenshot(page, testInfo, '300-find-results');
    await expectAccessible(page);

    await submit(page, 'pickleball');
    await expect(results(page)).toContainText('No leagues match “pickleball”');
    await screenshot(page, testInfo, '300-find-none');
    await expectAccessible(page);

    await submit(page, `coed 4s ${id} austin`);
    const fewer = results(page).getByRole('list', { name: 'Try fewer words:' });
    await expect(fewer.getByRole('link')).toHaveText([`coed 4s ${id}`]);
    await screenshot(page, testInfo, '300-find-fewer-words');
    await expectAccessible(page);
    await fewer.getByRole('link').click();
    await expect(page).toHaveURL(`${baseURL}${url(`coed 4s ${id}`)}`);
    await expect(rowNames(page)).toHaveText([SUNDAY]);
    await expect(results(page).getByRole('status')).toBeFocused();
    await submit(page, 'pickleball');
    await expect(results(page)).toContainText('No leagues match “pickleball”');
    await results(page).getByRole('link', { name: 'Clear the search' }).click();
    await expect(page).toHaveURL(`${baseURL}/leagues`);
    await expect(results(page)).toHaveCount(0);
    await expect(field(page)).toHaveValue('');
    await expect(field(page)).toBeFocused();
  });

  test('a suggestion followed with the keyboard moves a visible focus to the new results and announces the count', async ({
    page,
    consoleGuard,
  }) => {
    const { id } = await seed();
    await page.goto(url(`coed 4s ${id} austin`));
    await hydrated(consoleGuard);
    await results(page)
      .getByRole('link', { name: `coed 4s ${id}` })
      .focus();
    await page.keyboard.press('Enter');
    await expect(rowNames(page)).toHaveText([SUNDAY]);
    const status = results(page).getByRole('status');
    await expect(status).toBeFocused();
    await expect(status).toHaveText(`1 league matches “coed 4s ${id}”`);
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
    await expect(page).toHaveURL(`${baseURL}/leagues`);
    await expect(field(page)).toBeFocused();
    expect(await field(page).evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  });

  test('a suggestion opened in a new tab leaves the page and its focus as they were', async ({
    page,
    consoleGuard,
  }) => {
    const { id } = await seed();
    await page.goto(url(`coed 4s ${id} austin`));
    await hydrated(consoleGuard);
    const link = results(page).getByRole('link', { name: `coed 4s ${id}` });
    await link.click({ modifiers: ['ControlOrMeta'] });
    await expect(page).toHaveURL(`${baseURL}${url(`coed 4s ${id} austin`)}`);
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
          if (type === 'Add' && udfPath === 'search:leagues') searchIds.add(queryId);
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
      await page.goto(url(`coed 4s ${id} austin`));
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
      await page.goto(url(`coed 4s ${id} austin`));
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

test.describe('find a league: top bar', () => {
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
    await expect(page).toHaveURL(`${baseURL}${url(id)}`);
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
      await expect(plain).toHaveURL(`${baseURL}${url(id)}`);
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
    await expect(page).toHaveURL(`${baseURL}/leagues`);
    await expect(page.getByRole('heading', { level: 1, name: 'Find a league' })).toBeVisible();
  });

  test('on /leagues the bar has neither the field nor the link', async ({ page }) => {
    await page.goto('/leagues');
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('banner').getByRole('link', { name: 'Find a league' })).toHaveCount(
      0,
    );
    await expect(page.getByRole('banner').getByRole('searchbox')).toHaveCount(0);
    await expect(page.getByRole('search')).toHaveCount(1);
  });

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

test.describe('find a league: offline', () => {
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

    await submit(page, `never viewed ${id}`);
    await expect(page.locator('app-not-saved-view')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('app-not-saved-view a')).toHaveAttribute(
      'href',
      url(`never viewed ${id}`),
    );
    await context.setOffline(false);
  });
});
