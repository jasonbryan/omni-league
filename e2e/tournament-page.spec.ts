import { expectAccessible } from './support/a11y';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { screenshot } from './support/screenshot';
import { dateFromToday, seedTenant, type Tenant } from './support/tenant';
import { seedTournament } from './support/tournament';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
/** Netlify removes the spaces after the commas. */
const noSpaces = (value: string | undefined) => value?.replace(/\s+/g, '');
const textOf = (html: string | undefined) =>
  (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&middot;|&#183;/g, '·')
    .replace(/\s+/g, ' ')
    .trim();

const ADDRESS = '3500 Sandcourt Ln, Corpus Christi, TX 78402';
const OPEN_DEADLINE = dateFromToday(20);

async function seed(): Promise<{ tenant: Tenant; open: string; closed: string; draft: string }> {
  const tenant = await seedTenant({
    name: 'E2E Tournament Page',
    locations: [{ name: 'North Beach Sand Courts', address: ADDRESS }],
  });
  const common = { locations: ['North Beach Sand Courts'] };
  const open = await seedTournament(tenant, {
    ...common,
    name: 'Gulf Coast Beach Open',
    slug: 'gulf-coast-beach-open',
    division: { gender: 'coed', playersPerSide: 2, level: 'open', ageGroup: 'adult' },
    startDate: dateFromToday(30),
    endDate: dateFromToday(31),
    registrationDeadline: OPEN_DEADLINE,
  });
  const closed = await seedTournament(tenant, {
    ...common,
    name: 'Past Deadline Classic',
    slug: 'past-deadline-classic',
    startDate: dateFromToday(30),
    endDate: dateFromToday(30),
    registrationDeadline: dateFromToday(-2),
  });
  const draft = await seedTournament(tenant, {
    ...common,
    name: 'Secret Draft Open',
    slug: 'secret-draft-open',
    startDate: dateFromToday(60),
    endDate: dateFromToday(61),
    registrationDeadline: dateFromToday(50),
    status: 'draft',
  });
  return { tenant, open, closed, draft };
}

test.describe('public tournament page: raw server HTML', () => {
  test(
    'a published tournament: 200, the public Cache-Control, the h1, division, dates, address, and the registration card before the details',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, open } = await seed();
      for (const query of ['', '?ott=SECRETtoken&page=2']) {
        const { status, headers, html } = await fetchRawHtml(request, `${open}${query}`);
        expect(status, query).toBe(200);
        expect(noSpaces(headers['cache-control']), query).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(headers['content-type'], query).toContain('text/html');
        expect(headers['netlify-vary'], query).toBe('query');
        expect(html.match(/<h1\b/g), query).toHaveLength(1);
        expect(textOf(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]), query).toBe(
          'Gulf Coast Beach Open',
        );
        expect(html, query).toContain('Coed · 2v2 · Open');
        expect(html, query).toContain(ADDRESS);
        expect(html, query).toMatch(/<time\b[^>]*datetime="\d{4}-\d{2}-\d{2}"/);
        const order = ['<h1', 'id="registration"', 'id="details-heading"', ADDRESS].map((marker) =>
          html.indexOf(marker),
        );
        expect(
          order.every((position) => position > 0),
          query,
        ).toBe(true);
        expect(order, query).toEqual([...order].sort((a, b) => a - b));
        const card = /<section\b[^>]*id="registration"[\s\S]*?<\/section>/.exec(html)?.[0];
        expect(textOf(card), query).toContain('Registration open · closes');
        expect(html, query).toContain(`href="${tenant.path}"`);
        expect(html, query).toContain(`<link rel="canonical" href="`);
        expect(html, query).toContain(`${open}"`);
        expect(html, query).not.toContain('SECRETtoken');
        expect(html, query).not.toContain('ott=');
      }
    },
  );

  test(
    'a tournament past its deadline: the card reads Registration closed',
    RAW_HTTP,
    async ({ request }) => {
      const { closed } = await seed();
      const { status, html } = await fetchRawHtml(request, closed);
      expect(status).toBe(200);
      const card = /<section\b[^>]*id="registration"[\s\S]*?<\/section>/.exec(html)?.[0];
      expect(textOf(card)).toContain('Registration closed');
      expect(textOf(card)).not.toContain('Registration open');
    },
  );

  test(
    'a draft tournament, an unknown web address, and an unknown organization answer 404 with the not-found view and nothing about the draft',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, draft } = await seed();
      for (const path of [
        draft,
        `${tenant.path}/tournaments/no-such-tournament`,
        `/organizations/no-such-org-${tenant.slug}/tournaments/gulf-coast-beach-open`,
      ]) {
        const { status, headers, html } = await fetchRawHtml(request, path);
        expect(status, path).toBe(404);
        expect(noSpaces(headers['cache-control']), path).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(html, path).toMatch(/<h1\b[^>]*>\s*Page not found\s*<\/h1>/);
        expect(html, path).not.toMatch(/<link\b[^>]*rel="canonical"|property="og:/);
        expect(html, path).not.toContain('Secret Draft Open');
      }
    },
  );
});

test.describe('public tournament page: in the browser', () => {
  test('an open tournament shows the card first, passes the axe helper, and has no horizontal scroll', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const { open } = await seed();
    const response = await page.goto(`${open}#registration`);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Gulf Coast Beach Open' }),
    ).toBeVisible();
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(page.locator('#registration')).toContainText('Registration open · closes');
    await expect(page.locator('#registration').getByRole('link')).toHaveCount(0);
    await expect(page.getByText(ADDRESS)).toBeVisible();
    await expect(page).toHaveTitle(
      /^Gulf Coast Beach Open \| E2E Tournament Page [0-9a-f]+ \| Omni League$/,
    );
    await expectAccessible(page);
    await screenshot(page, testInfo, 'tournament-open');
  });

  test('a tournament past its deadline shows Registration closed', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const { closed } = await seed();
    await page.goto(closed);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(page.locator('#registration')).toContainText('Registration closed');
    await expect(page.locator('#registration')).not.toContainText('Registration open');
    await expectAccessible(page);
    await screenshot(page, testInfo, 'tournament-closed');
  });

  test.describe('a draft tournament', () => {
    test.use({ expectedDocumentStatus: 404 });

    test(
      'is the not-found view with a 404, and hydrates with no console error',
      VIEWPORT_AGNOSTIC,
      async ({ page, consoleGuard }) => {
        const { draft } = await seed();
        const response = await page.goto(draft);
        expect(response?.status()).toBe(404);
        await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
        await expect.poll(() => consoleGuard.hydrated).toBe(true);
      },
    );
  });
});
