// Smoke spec (#13): the prerendered placeholder home `/`. #15 runs it against previews with
// E2E_BASE_URL, where the local-build-only checks are skipped.
import { expectAccessible } from './support/a11y';
import { baseURL, LOCAL_BUILD_ONLY, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { fetchRawHtml } from './support/raw-html';

const HEADING = /<h1\b[^>]*>\s*Omni League\s*<\/h1>/;

test.describe('smoke: placeholder home', () => {
  test('raw server HTML of / is 200 and contains the h1', async ({ request }) => {
    const { status, headers, html } = await fetchRawHtml(request, '/');
    expect(status).toBe(200);
    expect(headers['content-type']).toContain('text/html');
    expect(html).toMatch(HEADING);
  });

  test.describe('with JavaScript disabled', () => {
    test.use({ javaScriptEnabled: false });

    test('/ shows the h1 and has a non-empty title (2.4.2)', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
      await expect(page).toHaveTitle(/\S/);
    });
  });

  test('/ loads, shows the h1, applies the global styles, and passes the axe helper', async ({
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

    await expectAccessible(page);
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
