// Tests that seed a tenant or a user need the local Convex backend and are skipped with
// E2E_BASE_URL set.
import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { signUp } from './support/session';
import { seedSeasons, seedTenant, type Tenant } from './support/tenant';
import { newUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
/** Netlify removes the spaces after the commas. */
const noSpaces = (value: string | undefined) => value?.replace(/\s+/g, '');

const LEAGUE = 'Sunday Reverse Coed 4s';
const LEAGUE_SLUG = 'sunday-reverse-coed-4s';

async function seed(): Promise<{ tenant: Tenant; paths: string[] }> {
  const tenant = await seedTenant({
    name: 'E2E Public Layout',
    locations: [{ name: 'Beta Courts', address: '2 Beta Street, Corpus Christi, TX 78402' }],
    leagues: [{ name: LEAGUE, sport: 'beachVolleyball', locations: ['Beta Courts'] }],
  });
  await seedSeasons(tenant, LEAGUE_SLUG, [
    { name: 'Summer 2027', slug: 'summer-2027', startDate: '2027-06-06', endDate: '2027-08-29' },
  ]);
  const league = `${tenant.path}/leagues/${LEAGUE_SLUG}`;
  return { tenant, paths: [tenant.path, league, `${league}/seasons/summer-2027`] };
}

async function hydrated(consoleGuard: { hydrated: boolean }): Promise<void> {
  await expect
    .poll(() => consoleGuard.hydrated, {
      message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
    })
    .toBe(true);
}

const footerLinks = (path: string) =>
  [
    ['Your account', '/app'],
    ['Create an organization', '/app/organizations/new'],
    ['Sign in to manage', `/sign-in?returnTo=${encodeURIComponent(path)}`],
  ] as const;

test.describe('public layout: raw server HTML', () => {
  test(
    'the organization, league, and season pages hold the skip link, the top bar, the page, and the footer, with the same status and Cache-Control',
    RAW_HTTP,
    async ({ request }) => {
      const { tenant, paths } = await seed();
      const headings = [tenant.name, LEAGUE, `${LEAGUE}&nbsp;· Summer 2027`];

      for (const [i, path] of paths.entries()) {
        const { status, headers, html } = await fetchRawHtml(request, path);
        expect(status, path).toBe(200);
        expect(noSpaces(headers['cache-control']), path).toBe(noSpaces(PUBLIC_PAGE_CACHE));

        const skip = html.search(/<a\b[^>]*href="[^"]*#main"[^>]*>\s*Skip to main content\s*<\/a>/);
        const header = html.indexOf('<header');
        const main = html.search(/<main\b[^>]*\bid="main"[^>]*\btabindex="-1"/);
        const footer = html.indexOf('<footer');
        expect(skip, path).toBeGreaterThanOrEqual(0);
        expect(header, path).toBeGreaterThan(skip);
        expect(main, path).toBeGreaterThan(header);
        expect(footer, path).toBeGreaterThan(main);
        const bar = html.slice(header, html.indexOf('</header>'));
        expect(bar, path).toMatch(/>\s*Omni League\s*(?:<!--[^>]*-->\s*)*<\/a>/);
        expect(bar, path).toMatch(/>Sign in<\/a>/);
        expect(bar, path).not.toContain('Account:');

        expect(html.match(/<header\b/g), path).toHaveLength(1);
        expect(html.match(/<main\b/g), path).toHaveLength(1);
        expect(html.match(/<footer\b/g), path).toHaveLength(1);
        const nav = /<nav\b[^>]*aria-label="Footer"[^>]*>([\s\S]*?)<\/nav>/.exec(html);
        expect(nav, path).not.toBeNull();
        expect(html.indexOf(nav![0]), path).toBeGreaterThan(footer);
        for (const [label, href] of footerLinks(path)) {
          expect(nav![1], `${path} ${label}`).toMatch(
            new RegExp(`<a\\b[^>]*href="${href.replace('?', '\\?')}"[^>]*>\\s*${label}\\s*</a>`),
          );
        }
        expect(html.slice(footer), path).toContain(
          'Recreational leagues for beach volleyball, soccer, and softball.',
        );
        expect(html.slice(footer), path).toContain('2026 Omni League');

        expect(html, path).not.toContain('aria-label="Open navigation"');
        expect(html, path).not.toMatch(/<aside\b/);
        expect(html, path).not.toContain(`<nav aria-label="${tenant.name}"`);
        expect(html.slice(main, footer), path).toMatch(
          new RegExp(`<h1\\b[^>]*>\\s*${headings[i]}\\s*</h1>`),
        );
      }
    },
  );

  test('the HTML holds nothing of the query string', RAW_HTTP, async ({ request }) => {
    const { paths } = await seed();
    const { html } = await fetchRawHtml(request, `${paths[0]}?ott=SECRET-TOKEN`);
    expect(html).not.toContain('SECRET-TOKEN');
  });
});

test.describe('public layout: signed in', () => {
  test(
    'a signed-in visitor sees the account link in place of "Sign in" on a public page, after hydration',
    VIEWPORT_AGNOSTIC,
    async ({ page, consoleGuard }) => {
      const { paths } = await seed();
      const user = newUser('Layout');
      await signUp(page, user);
      await page.goto(paths[0]);
      await hydrated(consoleGuard);
      await expect(page.locator('header a[href="/app"]')).toContainText(user.name);
      await expect(page.locator('header a[href^="/sign-in"]')).toHaveCount(0);
      await expect(page.locator('footer')).toHaveCount(1);
    },
  );

  test('/app keeps the app shell: its 56px top bar and no footer', async ({ page }) => {
    // /app is a Client route: the browser renders it, so there is no hydration log to wait for.
    await signUp(page, newUser('Shell'));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('footer')).toHaveCount(0);
    expect((await page.locator('header').boundingBox())?.height).toBe(56);
  });
});

const ROUTES = ['/', '/sign-in', '/sign-up', '/invites/accept'];

test.describe('public layout: other routes', () => {
  for (const route of ROUTES) {
    test(`${route} renders in the public layout, passes the axe helper, and has 44px targets on a phone`, async ({
      page,
    }, testInfo) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      // Client routes (sign-in, sign-up, accept-invite) are not hydrated: wait for the page itself.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectInPublicLayout(page);
      await expectAccessible(page);
      await expectTouchTargets(page, testInfo.project.name === 'chromium-mobile');
    });
  }

  test.describe('an unknown path', () => {
    test.use({ expectedDocumentStatus: 404 });

    test('/nope answers 404 with the not-found view in the public layout', async ({
      page,
      consoleGuard,
    }, testInfo) => {
      const response = await page.goto('/nope');
      expect(response?.status()).toBe(404);
      await hydrated(consoleGuard);
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
      await expectInPublicLayout(page);
      await expectAccessible(page);
      await expectTouchTargets(page, testInfo.project.name === 'chromium-mobile');
    });
  });

  test('the organization, league, and season pages pass the axe helper and have 44px targets on a phone', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    const { paths } = await seed();
    for (const path of paths) {
      await page.goto(path);
      await hydrated(consoleGuard);
      await expectInPublicLayout(page);
      await expectAccessible(page);
      await expectTouchTargets(page, testInfo.project.name === 'chromium-mobile');
    }
  });
});

async function expectInPublicLayout(page: Page): Promise<void> {
  await expect(page.getByRole('banner')).toHaveCount(1);
  await expect(page.locator('main#main[tabindex="-1"]')).toHaveCount(1);
  await expect(page.getByRole('contentinfo')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: 'Footer' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveCount(0);
  await expect(page.locator('aside')).toHaveCount(0);
}

async function expectTouchTargets(page: Page, touch: boolean): Promise<void> {
  if (!touch) return;
  expect(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)).toBe(true);
  const links = page.locator('header a, footer a');
  const count = await links.count();
  expect(count).toBeGreaterThanOrEqual(5);
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    const box = await link.boundingBox();
    const name = (await link.textContent())?.trim();
    expect(box?.height, `${name} is at least 44px tall`).toBeGreaterThanOrEqual(44);
  }
}
