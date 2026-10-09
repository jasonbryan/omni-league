// Not-found page (#23): the router `**` route, rendered on the server with status 404 inside the
// app shell (top bar only). Each browser test does all its checks in one page load.
import { expectAccessible, tabKey } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { rawGet } from './support/raw-get';
import { fetchRawHtml } from './support/raw-html';

const UNKNOWN = '/this-page-does-not-exist';
const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
const NOT_FOUND_H1 = /<h1\b[^>]*>\s*Page not found\s*<\/h1>/g;
// The home link's text is "Go to the home page"; Angular may leave comment nodes beside it.
const HOME_LINK = /<a\b[^>]*\bhref="\/"[^>]*>(?:(?!<\/a>)[\s\S])*Go to the home page\s*<\/a>/;

test.describe('not-found page', () => {
  test.use({ expectedDocumentStatus: 404 });

  test('raw server HTML: 404 with the public Cache-Control for unknown paths, 200 for /', async ({
    request,
  }) => {
    for (const path of [UNKNOWN, '/app/x']) {
      const { status, headers, html } = await fetchRawHtml(request, path);
      expect(status, path).toBe(404);
      // Netlify removes the spaces after the commas.
      expect(headers['cache-control']?.replace(/\s+/g, ''), path).toBe(
        PUBLIC_PAGE_CACHE.replace(/\s+/g, ''),
      );
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
      // Netlify sends `/\` on as `/%5C`, one path segment, which gets the rendered 404.
      if (remoteBaseUrl && path.startsWith('/\\')) {
        expect(response.status, path).toBe(404);
        expect(response.body, path).toMatch(NOT_FOUND_H1);
        continue;
      }
      expect(response.status, path).toBe(301);
      expect(response.headers['cache-control'], path).toBe('no-store');
      expect(response.location, path).toBe(location);
      expect(new URL(response.location ?? '', `${baseURL}${path}`).origin, path).toBe(
        new URL(baseURL).origin,
      );
    }
    const target = await fetchRawHtml(request, '/evil.com/x');
    expect(target.status).toBe(404);
    expect(target.html).toMatch(NOT_FOUND_H1);
  });

  // The real engine, not a stub: encoded, mixed-slash, CR/LF, unicode, and long variants either
  // redirect on this site (Location starts with exactly one `/`, query kept) or get a 4xx, never a
  // 5xx. A host in front (Netlify) may answer some of them with its own 400, which is also safe.
  test('encoded and mixed-slash variants never get a 5xx or an off-site Location', async () => {
    const origin = new URL(baseURL).origin;
    const redirects: [string, string][] = [
      ['//evil.com/x?q=1&next=//evil.com', '/evil.com/x?q=1&next=//evil.com'],
      ['//evil.com/%0d%0aSet-Cookie:%20a=b', '/evil.com/%0d%0aSet-Cookie:%20a=b'],
      ['//evil.com/x?%0d%0aX-Injected:1', '/evil.com/x?%0d%0aX-Injected:1'],
      ['//%C3%A9vil.com/%C3%BC', '/%C3%A9vil.com/%C3%BC'],
      ['//@evil.com', '/@evil.com'],
      [`//evil.com/${'a'.repeat(2000)}`, `/evil.com/${'a'.repeat(2000)}`],
    ];
    for (const [path, location] of redirects) {
      const response = await rawGet(path);
      expect(response.status, path).toBe(301);
      expect(response.location, path).toBe(location);
    }
    for (const path of [
      '/%2F%2Fevil.com',
      '/%2f%2fevil.com',
      '/%5Cevil.com',
      '/%5C%5Cevil.com',
      '/%2e%2e//evil.com',
      '/%2E%2E/%2F/evil.com',
      '/./..//evil.com',
      '/\\/\\evil.com',
      '/%09/evil.com',
      '/%0d%0a/evil.com',
      '/app//evil.com',
      '/app/%2F%2Fevil.com',
      '/(//evil.com)',
      '/x(//evil.com)',
      `/${'a'.repeat(2000)}`,
      ...redirects.map(([path]) => path),
    ]) {
      const response = await rawGet(path);
      expect(response.status, path).toBeLessThan(500);
      expect(response.status, path).toBeGreaterThanOrEqual(300);
      if (response.status >= 300 && response.status < 400) {
        expect(response.location, path).toMatch(/^\/(?![/\\])/);
        expect(response.location, path).not.toMatch(/[\r\n\t]/);
        expect(new URL(response.location ?? '', `${origin}/`).origin, path).toBe(origin);
      }
    }
  });

  // The router normalizes these paths (`/x//` to `/x/`, `/x/(y)` to `/x`), so the engine answers
  // with a redirect, and it takes the status the not-found view set: production sends 404 with a
  // Location and an empty body (the browser shows its own error page), and the development build
  // throws "Invalid redirect status code: 404" (500). An unknown path must still end on the
  // not-found page: either directly, or through a redirect that no shared cache stores (its
  // Location carries the query string).
  test('an unknown path the router normalizes still ends on the not-found page', async () => {
    for (const path of [
      `${UNKNOWN}//`,
      `${UNKNOWN}//?ott=SECRET`,
      '/organizations/x//',
      '/organizations/(x)',
      '/app/x//',
    ]) {
      const response = await rawGet(path);
      expect(response.status, path).toBeLessThan(500);
      if (response.status >= 300 && response.status < 400) {
        expect(response.headers['cache-control'], path).toBe('no-store');
        expect(response.location, path).toMatch(/^\/(?![/\\])/);
        const target = await rawGet(response.location ?? '');
        expect(target.status, `${path} -> ${response.location}`).toBe(404);
        expect(target.body, `${path} -> ${response.location}`).toMatch(NOT_FOUND_H1);
      } else {
        expect(response.status, path).toBe(404);
        expect(response.body, path).toMatch(NOT_FOUND_H1);
      }
    }
  });

  // The engine's redirect for a normalized URL is a 302 that no shared cache stores, its Location
  // stays on this site, and the target renders the not-found page itself (PR #90, round 3).
  test('a normalized unknown path gets a no-store 302 to a page that renders the 404', async () => {
    for (const [path, location] of [
      [`${UNKNOWN}//?token=A/B`, `${UNKNOWN}/?token=A%2FB`],
      ['/organizations/(x)?token=A/B', '/organizations?token=A%2FB'],
      ['/organizations/x/(y)/', '/organizations/x'],
      ['/x/)', '/x/'],
    ]) {
      const response = await rawGet(path);
      expect(response.status, path).toBe(302);
      expect(response.headers['cache-control'], path).toBe('no-store');
      expect(response.headers['netlify-vary'], path).toBe('query');
      expect(response.location, path).toBe(location);
      expect(response.body, path).toBe('');
      const target = await rawGet(location);
      expect(target.status, location).toBe(404);
      expect(target.location, location).toBeUndefined();
      expect(target.body.match(NOT_FOUND_H1), location).toHaveLength(1);
    }
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
    const response = await page.goto('/app/x?ref=1');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    if (!remoteBaseUrl) {
      await expect
        .poll(() => consoleGuard.hydrated, {
          message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
        })
        .toBe(true);
    }
    // The server HTML leaves the query string out of the skip link (PR #90); hydration adds it.
    expect(await response?.text()).not.toContain('ref=1');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '/app/x?ref=1#main',
    );

    await page.getByRole('main').getByRole('link', { name: 'Go to the home page' }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
    await expect(page).toHaveTitle('Omni League');
  });
});
