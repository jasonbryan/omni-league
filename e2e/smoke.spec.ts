import { expectAccessible, tabKey } from './support/a11y';
import { baseURL, LOCAL_BUILD_ONLY, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { fetchRawHtml } from './support/raw-html';
import { RAW_HTTP } from './support/raw-http';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';
import { topBarFind } from './support/top-bar-find';

const HEADING = /<h1\b[^>]*>\s*Omni League\s*<\/h1>/;

test.describe('smoke: placeholder home', () => {
  test(
    'raw server HTML of / is 200 and has the app shell around the h1',
    RAW_HTTP,
    async ({ request }) => {
      const { status, headers, html } = await fetchRawHtml(request, '/');
      expect(status).toBe(200);
      expect(headers['content-type']).toContain('text/html');
      expect(html).toMatch(HEADING);

      const at = (pattern: RegExp): number => html.search(pattern);
      const skipLink = at(/<a\b[^>]*\bhref="[^"]*#main"[^>]*>\s*Skip to main content\s*<\/a>/);
      const header = at(/<header\b/);
      // The link's only text is "Omni League"; Angular may leave comment nodes beside it.
      const home = at(
        /<a\b[^>]*\bhref="\/"[^>]*>(?:(?!<\/a>)[\s\S])*>\s*Omni League\s*(?:<!--[^>]*-->\s*)*<\/a>/,
      );
      const main = at(/<main\b[^>]*\bid="main"[^>]*\btabindex="-1"/);
      const heading = at(HEADING);
      expect(skipLink).toBeGreaterThanOrEqual(0);
      expect(header).toBeGreaterThan(skipLink);
      expect(home).toBeGreaterThan(header);
      expect(main).toBeGreaterThan(home);
      expect(heading).toBeGreaterThan(main);
      expect(html.indexOf('</main>')).toBeGreaterThan(heading);
      expect(html.slice(html.indexOf('<header'), html.indexOf('</header>'))).toMatch(
        />Sign in<\/a>/,
      );
      expect(html).not.toContain('aria-label="Open navigation"');
      expect(html.match(/<nav\b/g)).toHaveLength(1);
      expect(html).toMatch(/<footer\b[\s\S]*<nav\b[^>]*aria-label="Footer"/);
    },
  );

  test.describe('with JavaScript disabled', VIEWPORT_AGNOSTIC, () => {
    test.use({ javaScriptEnabled: false });

    test('/ shows the h1 and has a non-empty title (2.4.2)', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
      await expect(page).toHaveTitle(/\S/);
    });
  });

  test('/ loads in the app shell, applies the global styles, and passes the axe helper', async ({
    page,
    consoleGuard,
  }) => {
    const thirdPartyRequests: string[] = [];
    const ownOrigin = new URL(baseURL).origin;
    page.on('request', (request) => {
      const { protocol, origin } = new URL(request.url());
      if (/^https?:$/.test(protocol) && origin !== ownOrigin)
        thirdPartyRequests.push(request.url());
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
    // On the local development build, scan the hydrated page, not the server HTML alone.
    if (!remoteBaseUrl) await expect.poll(() => consoleGuard.hydrated).toBe(true);

    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    const tab = tabKey(page);
    await page.keyboard.press(tab);
    await expect(skipLink).toBeFocused();
    const box = await skipLink.boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport).toBeTruthy();
    if (box && viewport) {
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    expect(await skipLink.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
    expect(new URL(page.url()).pathname).toBe('/');

    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('navigation')).toHaveCount(1);
    expect(
      await page.locator('header').evaluate((el) => {
        const style = getComputedStyle(el);
        return { position: style.position, top: style.top, height: style.height };
      }),
    ).toEqual({ position: 'sticky', top: '0px', height: '65px' });

    // The offset that keeps anchor targets and focused elements below the sticky top bar (4.5rem at
    // the 16px root font size, WCAG 2.4.11).
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop))
      .toBe('72px');

    // `fonts.check` is true when no face matches, so the loaded face is asserted too.
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('16px "Inter Variable"'))).toBe(true);
    expect(
      await page.evaluate(() =>
        [...document.fonts].some(
          (face) => face.family.includes('Inter Variable') && face.status === 'loaded',
        ),
      ),
    ).toBe(true);
    expect(thirdPartyRequests).toEqual([]);

    await expectAccessible(page, {
      expectedOrder: [
        'a[href$="#main"]',
        'header a[href="/"]',
        topBarFind(page),
        'header a[href^="/sign-in"]',
        'footer a[href="/"]',
        'footer a[href="/leagues"]',
        'footer a[href="/app"]',
        'footer a[href="/app/organizations/new"]',
        'footer a[href^="/sign-in"]',
      ],
    });

    // The sticky header cancels the html scroll-padding-top, which otherwise makes the browser
    // scroll focused header elements "into view". The phone sheet returns focus to the menu button
    // the same way. The page is made tall here, in this page load, as the home page does not
    // scroll.
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.style.height = '3000px';
      document.querySelector('main')?.append(spacer);
      window.scrollTo(0, 600);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
    const home = page.locator('header a[href="/"]');
    await home.evaluate((el: HTMLElement) => {
      el.focus();
    });
    await expect(home).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(600);
    await page.keyboard.press(`Shift+${tab}`);
    await expect(skipLink).toBeFocused();
    await page.keyboard.press(tab);
    await expect(home).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(600);
  });

  test(
    '/ hydrates (dev-mode "Angular hydrated <n> component(s)" log)',
    VIEWPORT_AGNOSTIC,
    async ({ page, consoleGuard }) => {
      test.skip(!!remoteBaseUrl, LOCAL_BUILD_ONLY);
      await page.goto('/');
      await expect
        .poll(() => consoleGuard.hydrated, {
          message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
        })
        .toBe(true);
    },
  );

  // Only production builds register the worker, as soon as the app is stable, so two seconds after
  // hydration a wrongly enabled worker would have been fetched and registered.
  test(
    'the development build registers no service worker',
    VIEWPORT_AGNOSTIC,
    async ({ page, consoleGuard }) => {
      test.skip(!!remoteBaseUrl, LOCAL_BUILD_ONLY);
      const workerRequests: string[] = [];
      page.on('request', (request) => {
        if (/\/ngsw(?:-worker)?\.js(?:on)?(?:\?|$)/.test(request.url()))
          workerRequests.push(request.url());
      });
      await page.goto('/');
      await expect.poll(() => consoleGuard.hydrated).toBe(true);
      await page.waitForTimeout(2_000);
      expect(
        await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
      ).toBe(0);
      expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
      expect(workerRequests).toEqual([]);
      await expect(page.locator('app-update-prompt')).toHaveCount(0);
    },
  );

  test(
    'a malformed URL gets a plain-text 400 with no stack trace or path',
    RAW_HTTP,
    async ({ request }) => {
      test.skip(!!remoteBaseUrl, LOCAL_BUILD_ONLY);
      const response = await request.get('/%E0%A4%A');
      const body = await response.text();
      expect(response.status()).toBe(400);
      expect(response.headers()['content-type']).toMatch(/^text\/plain\b/);
      expect(body).toContain('Bad Request');
      const STACK_FRAME = /\bat /;
      const FILE_PATH = /(?:\/[\w.@-]+){2,}|[A-Za-z]:\\|node_modules|\.m?[jt]s\b/;
      expect(body).not.toMatch(STACK_FRAME);
      expect(body).not.toMatch(/\w+Error\b|stack/i);
      expect(body).not.toMatch(FILE_PATH);
    },
  );
});
