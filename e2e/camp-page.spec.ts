import type { Page } from '@playwright/test';
import { axeScan, checkReflow, describeViolations, expectAccessible } from './support/a11y';
import { seedCamp, seedCampSession, seedPublishedCamp, type CampSessionSeed } from './support/camp';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { gotoHydrated, hydrated } from './support/hydrated';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { dateFromToday, seedTenant, type Tenant } from './support/tenant';
import { newUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
/** Netlify removes the spaces after the commas. */
const noSpaces = (value: string | undefined) => value?.replace(/\s+/g, '');
const textOf = (html: string | undefined) =>
  (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const PLACE = 'North Beach Sand Courts';
const ADDRESS = '3500 Sandcourt Ln, Corpus Christi, TX 78402';
const JUNIOR = {
  name: 'Junior Beach Volleyball Camp',
  slug: 'junior-beach-volleyball-camp',
  locations: [PLACE],
  minimumAge: 9,
  maximumAge: 14,
};

const week = (name: string, startInDays: number, extra: Partial<CampSessionSeed> = {}) => ({
  name,
  startDate: dateFromToday(startInDays),
  endDate: dateFromToday(startInDays + 4),
  dailyStartTime: '09:00',
  dailyEndTime: '12:00',
  places: 20,
  registrationDeadline: dateFromToday(startInDays - 3),
  ...extra,
});

const SESSIONS = [
  week('Week 1', 14, { registeredCount: 5 }),
  week('Week 2', 21, { registeredCount: 20 }),
  week('Week 3', 7, { registrationDeadline: dateFromToday(-2) }),
];

async function seedTenantWithPlace(name: string): Promise<Tenant> {
  return seedTenant({ name, locations: [{ name: PLACE, address: ADDRESS }] });
}

async function seed() {
  const tenant = await seedTenantWithPlace('E2E Camp Page');
  const published = await seedPublishedCamp(tenant, { ...JUNIOR, sessions: SESSIONS });
  const draft = await seedPublishedCamp(tenant, {
    ...JUNIOR,
    name: 'Secret Draft Camp',
    slug: 'secret-draft-camp',
    sessions: [week('Week 1', 30)],
    status: 'draft',
  });
  return { tenant, published, draft };
}

test.describe('public camp page: raw server HTML', () => {
  test(
    'a published camp: 200, the public Cache-Control, the sessions with their places before the details, the ages, the address, the title, and the link-preview tags',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, published } = await seed();
      for (const query of ['', '?ott=SECRETtoken&page=2']) {
        const { status, headers, html } = await fetchRawHtml(request, `${published}${query}`);
        expect(status, query).toBe(200);
        expect(noSpaces(headers['cache-control']), query).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(headers['content-type'], query).toContain('text/html');
        expect(headers['netlify-vary'], query).toBe('query');
        expect(html.match(/<h1\b/g), query).toHaveLength(1);
        expect(textOf(/<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1]), query).toBe(JUNIOR.name);
        expect(html, query).toContain('Ages 9 to 14');
        expect(html, query).toContain(ADDRESS);

        const order = [
          '<h1',
          'id="sessions"',
          'Week 1',
          '15 places left',
          'id="details-heading"',
          ADDRESS,
        ].map((marker) => html.indexOf(marker));
        expect(
          order.every((position) => position > 0),
          query,
        ).toBe(true);
        expect(order, query).toEqual([...order].sort((a, b) => a - b));

        const rows = [...html.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/g)]
          .map(([row]) => textOf(row))
          .filter((row) => row.startsWith('Week'));
        expect(rows.map((row) => row.split(' ').slice(0, 2).join(' '))).toEqual([
          'Week 3',
          'Week 1',
          'Week 2',
        ]);
        expect(rows[0], query).toContain('Registration closed');
        expect(rows[1], query).toContain('15 places left');
        expect(rows[1], query).toContain('Registration open');
        expect(rows[2], query).toContain('Full');

        expect(html, query).toContain(
          `<title>${JUNIOR.name} | ${tenant.name} | Omni League</title>`,
        );
        expect(html, query).toContain(
          `<meta property="og:title" content="${JUNIOR.name} | ${tenant.name} | Omni League"`,
        );
        expect(html, query).toMatch(/<meta property="og:description" content="Beach volleyball/);
        expect(html, query).toContain('property="og:type" content="website"');
        expect(html, query).toMatch(/<meta property="og:url" content="[^"]+\/camps\//);
        expect(html, query).toContain('<link rel="canonical" href="');
        expect(html, query).toContain(`${published}"`);
        expect(html, query).toContain(`href="${tenant.path}"`);
        expect(html, query).not.toContain('SECRETtoken');
        expect(html, query).not.toContain('ott=');
      }
    },
  );

  test(
    'a draft camp, an unknown web address, and an unknown organization answer 404 with the not-found view and nothing about the draft',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, draft } = await seed();
      for (const path of [
        draft,
        `${tenant.path}/camps/no-such-camp`,
        `/organizations/no-such-org-${tenant.slug}/camps/${JUNIOR.slug}`,
      ]) {
        const { status, headers, html } = await fetchRawHtml(request, path);
        expect(status, path).toBe(404);
        expect(noSpaces(headers['cache-control']), path).toBe(noSpaces(PUBLIC_PAGE_CACHE));
        expect(html, path).toMatch(/<h1\b[^>]*>\s*Page not found\s*<\/h1>/);
        expect(html, path).not.toMatch(/<link\b[^>]*rel="canonical"|property="og:/);
        expect(html, path).not.toContain('Secret Draft Camp');
      }
    },
  );
});

test.describe('public camp page: in the browser', () => {
  test('a published camp lists its sessions with their status, passes the axe helper, and does not scroll sideways at 320px', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const { tenant, published } = await seed();
    const response = await page.goto(published);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: JUNIOR.name })).toBeVisible();
    await hydrated(consoleGuard);
    await expect(page).toHaveTitle(`${JUNIOR.name} | ${tenant.name} | Omni League`);
    await expect(page.getByText('Ages 9 to 14').first()).toBeVisible();
    await expect(page.getByText(ADDRESS)).toBeVisible();

    const rows = page.locator('#sessions li');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Week 3');
    await expect(rows.nth(0)).toContainText('Registration closed');
    await expect(rows.nth(1)).toContainText('Week 1');
    await expect(rows.nth(1)).toContainText('Registration open');
    await expect(rows.nth(1)).toContainText('15 places left');
    await expect(rows.nth(2)).toContainText('Week 2');
    await expect(rows.nth(2).locator('[data-slot="session-places"]')).toHaveText('Full');
    await expect(rows.nth(2).locator('[data-slot="badge"]')).toHaveCount(0);

    await screenshot(page, testInfo, 'camp-public');
    await expectAccessible(page);
    expect(await checkReflow(page)).toMatchObject({ passed: true });
  });

  test('the breadcrumb leads to the organization page, and its Camps crumb opens the Camps section', async ({
    context,
    page,
    consoleGuard,
  }) => {
    const { tenant, published } = await seed();
    await gotoHydrated(page, consoleGuard, published);
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await crumbs.getByRole('link', { name: 'E2E Camp Page' }).click();
    await expect(page).toHaveURL(tenant.path);

    await page.goBack();
    const campsCrumb = crumbs.getByRole('link', { name: 'Camps' });
    const campsHref = await campsCrumb.getAttribute('href');
    await campsCrumb.click();
    await expect(page).toHaveURL(`${tenant.path}#camps`);
    const section = page.locator('#camps');
    await expect(section.getByRole('link', { name: JUNIOR.name, exact: true })).toBeVisible();

    // Opened as a link, in a new tab or from a shared URL, the browser scrolls to the section.
    const opened = await context.newPage();
    await gotoHydrated(opened, consoleGuard, campsHref!);
    await expect(
      opened.locator('#camps').getByRole('heading', { level: 2, name: 'Camps' }),
    ).toBeInViewport();
  });

  test.describe('a draft camp', () => {
    test.use({ expectedDocumentStatus: 404 });

    test(
      'is the not-found view with a 404, and hydrates with no console error',
      VIEWPORT_AGNOSTIC,
      async ({ page, consoleGuard }) => {
        const { draft } = await seed();
        const response = await page.goto(draft);
        expect(response?.status()).toBe(404);
        await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
        await hydrated(consoleGuard);
      },
    );
  });
});

const main = (page: Page) => page.getByRole('main');
const publishDialog = (page: Page) => page.getByRole('alertdialog');
const publishButton = (page: Page) => main(page).getByRole('button', { name: 'Publish' });
const stateBadge = (page: Page) => main(page).locator('h1 + div [data-slot="badge"]').first();

async function adminOfDraftCamp(page: Page, sessions: ReturnType<typeof week>[]) {
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenantWithPlace('E2E Camp Publish');
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });
  const slug = await seedCamp(tenant, JUNIOR);
  for (const session of sessions) await seedCampSession(tenant, slug, session);
  return {
    tenant,
    publicPath: `${tenant.path}/camps/${slug}`,
    managePath: `/app/organizations/${tenant.slug}/camps/${slug}`,
  };
}

test.describe('Camps: the management page and Publish', () => {
  test('an org admin publishes: Cancel changes nothing, Publish confirms, and the public page then answers 200', async ({
    page,
  }, testInfo) => {
    const { publicPath, managePath } = await adminOfDraftCamp(page, [week('Week 1', 14)]);
    await page.goto(managePath);
    await expect(stateBadge(page)).toHaveText('Draft');
    await screenshot(page, testInfo, 'camp-draft');
    expect((await page.request.get(publicPath)).status()).toBe(404);

    await publishButton(page).click();
    await expect(publishDialog(page)).toContainText(`Publish ${JUNIOR.name}?`);
    await expect(publishDialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
    await screenshot(page, testInfo, 'camp-publish-dialog');
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    await publishDialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(publishDialog(page)).toHaveCount(0);
    await expect(publishButton(page)).toBeFocused();
    await expect(stateBadge(page)).toHaveText('Draft');
    expect((await page.request.get(publicPath)).status()).toBe(404);

    await publishButton(page).click();
    await publishDialog(page).getByRole('button', { name: 'Publish camp' }).click();
    await expect(publishDialog(page)).toHaveCount(0);
    await expect(stateBadge(page)).toHaveText('Published');
    const notice = main(page).getByRole('status').filter({ hasText: 'is published.' });
    await expect(notice).toContainText(`${JUNIOR.name} is published.`);
    await expect(notice).toBeFocused();
    await expect(publishButton(page)).toHaveCount(0);
    await screenshot(page, testInfo, 'camp-published');
    await expectAccessible(page);
    expect((await page.request.get(publicPath)).status()).toBe(200);

    await notice.getByRole('link', { name: 'View public page' }).click();
    await expect(page).toHaveURL(publicPath);
    await expect(page.getByRole('heading', { level: 1, name: JUNIOR.name })).toBeVisible();
    await expect(page.locator('#sessions')).toContainText('Week 1');
  });

  test('a camp with no session keeps Publish disabled and says to add a session first, and the page stays a draft', async ({
    page,
  }, testInfo) => {
    const { publicPath, managePath } = await adminOfDraftCamp(page, []);
    await page.goto(managePath);
    const button = publishButton(page);
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(main(page).getByText('Add a session first.')).toBeVisible();
    await button.click({ force: true });
    await expect(publishDialog(page)).toHaveCount(0);
    await screenshot(page, testInfo, 'camp-publish-needs-session');
    await expectAccessible(page);
    expect((await page.request.get(publicPath)).status()).toBe(404);
  });

  test('a published camp keeps its last session: it has no Delete, and says why', async ({
    page,
  }) => {
    const { managePath } = await adminOfDraftCamp(page, [week('Week 1', 14)]);
    await page.goto(managePath);
    await publishButton(page).click();
    await publishDialog(page).getByRole('button', { name: 'Publish camp' }).click();
    await expect(stateBadge(page)).toHaveText('Published');
    const row = page.locator('#sessions-list > li');
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('button', { name: /delete/i })).toHaveCount(0);
    await expect(row).toContainText('Required while published');
  });
});
