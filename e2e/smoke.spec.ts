// Smoke spec (#13): the prerendered placeholder home `/`. #15 runs it against previews with
// E2E_BASE_URL, where the local-build-only checks are skipped.
import { expectAccessible } from './support/a11y';
import { baseURL, LOCAL_BUILD_ONLY, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { fetchRawHtml } from './support/raw-html';

const HEADING = /<h1\b[^>]*>\s*Omni League\s*<\/h1>/;

test.describe('smoke: placeholder home', () => {
  test('raw server HTML of / is 200 and has the app shell around the h1', async ({ request }) => {
    const { status, headers, html } = await fetchRawHtml(request, '/');
    expect(status).toBe(200);
    expect(headers['content-type']).toContain('text/html');
    expect(html).toMatch(HEADING);

    // App shell (#75), in DOM order: skip link, top bar with the home link, main holding the h1.
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
    // No Sign in until the sign-in route exists, and no sidebar on the home page (#73 decisions).
    expect(html).not.toContain('Sign in');
    expect(html).not.toContain('aria-label="Open navigation"');
    expect(html).not.toMatch(/<nav\b/);
  });

  test.describe('with JavaScript disabled', () => {
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

    // App shell (#75): the first Tab reaches the skip link, shown as a pill with a visible outline;
    // Enter moves focus to main without leaving the page.
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await page.keyboard.press('Tab');
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

    // One banner and one main landmark, no navigation landmark, and a 56px sticky top bar.
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    expect(
      await page.locator('header').evaluate((el) => {
        const style = getComputedStyle(el);
        return { position: style.position, top: style.top, height: style.height };
      }),
    ).toEqual({ position: 'sticky', top: '0px', height: '56px' });

    // base.css (#61): the offset that keeps anchor targets and focused elements below the sticky
    // top bar (4.5rem at the 16px root font size, WCAG 2.4.11).
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop))
      .toBe('72px');

    // Inter is self-hosted (ADR 0007): the font face loads from the app's own origin. Vacuous
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
      expectedOrder: ['a[href$="#main"]', 'header a[href="/"]'],
    });

    // Focusing a top bar control on a scrolled page leaves the page where it is (#75): the sticky
    // header cancels the html scroll-padding-top, which otherwise makes the browser scroll focused
    // header elements "into view". The phone sheet returns focus to the menu button the same way.
    // The page is made tall here, in this page load, as the home page does not scroll.
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
    // By keyboard: Shift+Tab to the skip link, then Tab back to the home link.
    await page.keyboard.press('Shift+Tab');
    await expect(skipLink).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(home).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(600);
  });

  test('/ hydrates (dev-mode "Angular hydrated <n> component(s)" log)', async ({
    page,
    consoleGuard,
  }) => {
    test.skip(!!remoteBaseUrl, LOCAL_BUILD_ONLY);
    await page.goto('/');
    await expect
      .poll(() => consoleGuard.hydrated, {
        message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
      })
      .toBe(true);
  });

  test('a malformed URL gets a plain-text 400 with no stack trace or path', async ({ request }) => {
    test.skip(!!remoteBaseUrl, LOCAL_BUILD_ONLY);
    const response = await request.get('/%E0%A4%A');
    const body = await response.text();
    expect(response.status()).toBe(400);
    expect(response.headers()['content-type']).toMatch(/^text\/plain\b/);
    expect(body).toContain('Bad Request');
    expect(body).not.toMatch(/\bat /); // stack frame
    expect(body).not.toMatch(/\w+Error\b|stack/i);
    expect(body).not.toMatch(/(?:\/[\w.@-]+){2,}|[A-Za-z]:\\|node_modules|\.m?[jt]s\b/); // file path
  });
});
