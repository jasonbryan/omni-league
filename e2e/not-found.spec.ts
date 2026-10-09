// Not-found page (#23): the router `**` route, rendered on the server with status 404 inside the
// app shell (top bar only). Each browser test does all its checks in one page load.
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { expectAccessible, tabKey } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { fetchRawHtml } from './support/raw-html';

const UNKNOWN = '/this-page-does-not-exist';
const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
const NOT_FOUND_H1 = /<h1\b[^>]*>\s*Page not found\s*<\/h1>/g;
// The home link's text is "Go to the home page"; Angular may leave comment nodes beside it.
const HOME_LINK = /<a\b[^>]*\bhref="\/"[^>]*>(?:(?!<\/a>)[\s\S])*Go to the home page\s*<\/a>/;

/**
 * One GET with the request target exactly as given. Playwright's request API and `fetch` resolve
 * `//evil.com/x` as a protocol-relative URL (another host), so they cannot send it.
 */
function rawGet(path: string): Promise<{ status: number; location: string | undefined }> {
  const base = new URL(baseURL);
  const send = base.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      { hostname: base.hostname, port: base.port || undefined, path, method: 'GET' },
      (res) => {
        res.resume();
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, location: res.headers.location });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test.describe('not-found page', () => {
  test.use({ expectedDocumentStatus: 404 });

  test('raw server HTML: 404 with the public Cache-Control for unknown paths, 200 for /', async ({
    request,
  }) => {
    for (const path of [UNKNOWN, '/app/x']) {
      const { status, headers, html } = await fetchRawHtml(request, path);
      expect(status, path).toBe(404);
      expect(headers['cache-control'], path).toBe(PUBLIC_PAGE_CACHE);
      expect(headers['content-type'], path).toContain('text/html');
      expect(html.match(NOT_FOUND_H1), path).toHaveLength(1);
      expect(html.match(/<h1\b/g), path).toHaveLength(1);
      expect(html, path).toMatch(HOME_LINK);
      expect(html, path).toMatch(/<title>[^<]*Page not found[^<]*<\/title>/);
      // Top bar only (#73 decisions 2 and 5): no menu button, no sidebar, no Sign in.
      expect(html, path).not.toContain('aria-label="Open navigation"');
      expect(html, path).not.toMatch(/<nav\b/);
      expect(html, path).not.toContain('Sign in');
    }

    // Regression: the catch-all does not capture the home route.
    const home = await fetchRawHtml(request, '/');
    expect(home.status).toBe(200);
    expect(home.html).toMatch(/<h1\b[^>]*>\s*Omni League\s*<\/h1>/);
  });

  // Angular throws NG05702 for a request path starting with `//`, so the server redirects to the
  // path with one leading slash (src/server-redirect.ts), which stays on this site.
  test('a path starting with // or /\\ redirects to the same path with one leading slash', async ({
    request,
  }) => {
    for (const [path, location] of [
      ['//evil.com/x', '/evil.com/x'],
      ['/\\evil.com/x', '/evil.com/x'],
      ['/x/..//evil.com', '/evil.com'],
    ]) {
      const response = await rawGet(path);
      expect(response.status, path).toBe(301);
      expect(response.location, path).toBe(location);
      expect(new URL(response.location ?? '', `${baseURL}${path}`).origin, path).toBe(
        new URL(baseURL).origin,
      );
    }
    const target = await fetchRawHtml(request, '/evil.com/x');
    expect(target.status).toBe(404);
    expect(target.html).toMatch(NOT_FOUND_H1);
  });

  test('hydrates; keyboard: skip link, home link focus ring, Enter goes home; axe and landmarks', async ({
    page,
    consoleGuard,
  }) => {
    const response = await page.goto(UNKNOWN);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    const home = page.getByRole('main').getByRole('link', { name: 'Go to the home page' });
    await expect(home).toBeVisible();
    await expect(page).toHaveTitle(/Page not found/);
    if (!remoteBaseUrl) {
      await expect
        .poll(() => consoleGuard.hydrated, {
          message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
        })
        .toBe(true);
    }

    // First Tab: the skip link; Enter moves focus to main on the same document.
    const tab = tabKey(page);
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await page.keyboard.press(tab);
    await expect(skipLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
    expect(new URL(page.url()).pathname).toBe(UNKNOWN);

    // Next Tab: the home link, with #61's 2px solid focus outline. Polled, because the button's
    // `transition-all` animates the width from the unfocused `medium` (3px) over 150ms.
    await page.keyboard.press(tab);
    await expect(home).toBeFocused();
    await expect
      .poll(() =>
        home.evaluate((el) => {
          const style = getComputedStyle(el);
          return { style: style.outlineStyle, width: style.outlineWidth };
        }),
      )
      .toEqual({ style: 'solid', width: '2px' });

    // One banner and one main landmark, no navigation landmark, and no menu button.
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(page.getByRole('button')).toHaveCount(0);

    // Tab order while Sign in is absent: skip link, "Omni League", "Go to the home page".
    await expectAccessible(page, {
      expectedOrder: ['a[href$="#main"]', 'header a[href="/"]', 'main a[href="/"]'],
    });

    // The Tab walk ends on the skip link: Enter, Tab, Enter follows the home link.
    await expect(skipLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
    await page.keyboard.press(tab);
    await expect(home).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
    await expect(page).toHaveTitle('Omni League');
  });

  test('/app/x shows the not-found page, hydrates, and the home link goes home by click', async ({
    page,
    consoleGuard,
  }) => {
    const response = await page.goto('/app/x');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    if (!remoteBaseUrl) {
      await expect
        .poll(() => consoleGuard.hydrated, {
          message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
        })
        .toBe(true);
    }

    await page.getByRole('main').getByRole('link', { name: 'Go to the home page' }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
    await expect(page).toHaveTitle('Omni League');
  });
});
