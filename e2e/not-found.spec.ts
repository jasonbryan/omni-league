import { expectAccessible, tabKey } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { rawGet } from './support/raw-get';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';
import { topBarFind } from './support/top-bar-find';

const UNKNOWN = '/this-page-does-not-exist';
const PUBLIC_PAGE_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
const NOT_FOUND_H1 = /<h1\b[^>]*>\s*Page not found\s*<\/h1>/g;
const HOME_H1 = /<h1\b[^>]*>\s*Omni League\s*<\/h1>/;
// The home link's text is "Go to the home page"; Angular may leave comment nodes beside it.
const FIND_LINK =
  /<main\b[\s\S]*<a\b[^>]*\bhref="\/leagues"[^>]*>(?:(?!<\/a>)[\s\S])*Find a league\s*<\/a>[\s\S]*Go to the home page/;
const HOME_LINK = /<a\b[^>]*\bhref="\/"[^>]*>(?:(?!<\/a>)[\s\S])*Go to the home page\s*<\/a>/;

test.describe('not-found page', () => {
  test.use({ expectedDocumentStatus: 404 });

  test(
    'raw server HTML: 404 with the public Cache-Control for unknown paths, 200 for /',
    RAW_HTTP,
    async ({ request }) => {
      // `/application/x` is not under /app, so the server renders it.
      for (const path of [UNKNOWN, '/application/x']) {
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
        // The main way on, above the link to the home page.
        expect(html, path).toMatch(FIND_LINK);
        expect(html, path).toMatch(/<title>[^<]*Page not found[^<]*<\/title>/);
        expect(html, path).not.toContain('aria-label="Open navigation"');
        expect(html.match(/<nav\b/g), path).toHaveLength(1);
        expect(html, path).toMatch(/<footer\b[\s\S]*<nav\b[^>]*aria-label="Footer"/);
        expect(html.slice(html.indexOf('<header'), html.indexOf('</header>')), path).toMatch(
          />Sign in<\/a>/,
        );
      }

      const home = await fetchRawHtml(request, '/');
      expect(home.status).toBe(200);
      expect(home.html).toMatch(HOME_H1);
    },
  );

  // Angular throws NG05702 for a request path starting with `//`, so the server redirects to the
  // path with one leading slash (src/server-redirect.ts), which stays on this site.
  test(
    'a path starting with // or /\\ redirects to the same path with one leading slash',
    RAW_HTTP,
    async ({ request }) => {
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
    },
  );

  // The router parses `/(` and `/()x` to `/`, so the engine rendered the home page under each with
  // the public Cache-Control. Netlify may answer before the function: 400 or 404.
  test('a path the router reads as / gets the plain 404, not the home page', RAW_HTTP, async () => {
    for (const path of ['/(', '/()x']) {
      const response = await rawGet(path);
      expect(response.headers['cache-control'] ?? '', path).not.toContain('s-maxage');
      expect(response.body, path).not.toMatch(HOME_H1);
      if (remoteBaseUrl) {
        expect([400, 404], path).toContain(response.status);
        continue;
      }
      expect(response.status, path).toBe(404);
      expect(response.headers['content-type'], path).toMatch(/^text\/plain\b/);
      expect(response.body, path).toBe('Not found');
    }
  });

  // The router cannot decode `?q=%` and rendered the home page for any path. The server renders the
  // path without the query string, so an unknown path gets the not-found page. Not a redirect:
  // Netlify copies the query string into a Location without one, so it would loop. Netlify may
  // answer before the function: 400.
  test(
    'a query string the router cannot decode renders the path without it',
    RAW_HTTP,
    async () => {
      const response = await rawGet('/x?q=%');
      expect(response.body).not.toMatch(HOME_H1);
      if (remoteBaseUrl && response.status === 400) return;
      expect(response.status).toBe(404);
      expect(response.location).toBeUndefined();
      expect(response.headers['cache-control']?.replace(/\s+/g, '')).toBe(
        PUBLIC_PAGE_CACHE.replace(/\s+/g, ''),
      );
      expect(response.headers['netlify-vary']).toBe('query');
      expect(response.body.match(NOT_FOUND_H1)).toHaveLength(1);
      expect(response.body).not.toContain('q=%');
    },
  );

  // Angular's Location drops one trailing slash before the router parses the URL, so `/x//?q=%`
  // reaches the router as `/x/?q=%`, which it cannot decode: it rendered the home page with 200 and
  // the public Cache-Control under any path ending in `//`.
  test(
    'a path ending in // with an undecodable query string never gets the home page',
    RAW_HTTP,
    async () => {
      for (const path of ['/x//?q=%', '/x/\\?q=%', '/organizations/nf-x//?ref=%']) {
        const response = await rawGet(path);
        expect(response.status, path).toBeLessThan(500);
        expect(response.status, path).not.toBe(200);
        expect(response.body, path).not.toMatch(HOME_H1);
      }
    },
  );

  // The browser's router parses the same URL after hydration. If it cannot decode the query string
  // it warns NG04018 and navigates to `/`, so the visitor ends on the home page.
  test(
    'a query string the router cannot decode: the browser stays on the not-found page',
    VIEWPORT_AGNOSTIC,
    async ({ page, consoleGuard }) => {
      const response = await page.goto('/x?q=%');
      expect(response?.status()).toBe(404);
      if (remoteBaseUrl) await page.waitForLoadState('networkidle');
      else await expect.poll(() => consoleGuard.hydrated).toBe(true);
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
      await expect(page).toHaveTitle('Page not found | Omni League');
      expect(new URL(page.url()).pathname).toBe('/x');
    },
  );

  // The real engine, not a stub: encoded, mixed-slash, CR/LF, unicode, and long variants either
  // redirect on this site (Location starts with exactly one `/`, query kept) or get a 4xx, never a
  // 5xx. A host in front (Netlify) may answer some of them with its own 400, which is also safe.
  test(
    'encoded and mixed-slash variants never get a 5xx or an off-site Location',
    RAW_HTTP,
    async () => {
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
    },
  );

  // The router normalizes these paths (`/x//` to `/x/`, `/x/(y)` to `/x`), so the engine answers
  // with a redirect, and it takes the status the not-found view set: production sends 404 with a
  // Location and an empty body (the browser shows its own error page), and the development build
  // throws "Invalid redirect status code: 404" (500). An unknown path must still end on the
  // not-found page: either directly, or through a redirect that no shared cache stores (its
  // Location carries the query string).
  test(
    'an unknown path the router normalizes still ends on the not-found page',
    RAW_HTTP,
    async () => {
      for (const path of [
        `${UNKNOWN}//`,
        `${UNKNOWN}//?ott=SECRET`,
        '/organizations/x//',
        '/organizations/(x)',
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
    },
  );

  // The engine's redirect for a normalized URL is a 302 that no shared cache stores, its Location
  // stays on this site, and the target renders the not-found page itself.
  test(
    'a normalized unknown path gets a no-store 302 to a page that renders the 404',
    RAW_HTTP,
    async () => {
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
    },
  );

  // `setNotFoundStatus` copies the engine's URL comparison (src/app/core/not-found-status.ts). If
  // the copy says "no redirect" where the engine redirects, the development build throws (500); if
  // it says "redirect" where the engine renders, the not-found page goes out with 200 and the
  // public Cache-Control. This corpus crosses the router's normalizations with route prefixes and
  // query strings, so an `@angular/ssr` upgrade that moves either side fails here.
  test(
    'the not-found status agrees with the engine across normalized paths',
    RAW_HTTP,
    async () => {
      const prefixes = [UNKNOWN, '/organizations/nf-drift', '/application/nf-drift'];
      const suffixes = [
        '',
        '/',
        '//',
        '///',
        '/(y)',
        '/(y)/',
        '/)',
        '/x/..',
        '/index.html',
        '//index.html',
        '/(y)/index.html',
        ';a=b',
        ';a=b//',
        '/%28y%29',
        '(y)',
        '()',
        '/x//y',
      ];
      const notFoundH1 = new RegExp(NOT_FOUND_H1.source);
      const failures: string[] = [];
      for (const prefix of prefixes) {
        for (const suffix of suffixes) {
          for (const query of ['', '?token=A/B', '?q=(a)']) {
            const path = `${prefix}${suffix}${query}`;
            const response = await rawGet(path);
            const notFound = notFoundH1.test(response.body);
            if (response.status >= 500) failures.push(`${path}: ${response.status}`);
            if (notFound && response.status !== 404) {
              failures.push(`${path}: not-found page with ${response.status}`);
            }
            if (response.location === undefined) continue;
            if (response.status < 300 || response.status >= 400) {
              failures.push(`${path}: Location with ${response.status}`);
            }
            if (response.headers['cache-control'] !== 'no-store') {
              failures.push(`${path}: Location with ${response.headers['cache-control']}`);
            }
            if (!/^\/(?![/\\])/.test(response.location)) {
              failures.push(`${path}: Location ${response.location}`);
              continue;
            }
            const target = await rawGet(response.location);
            if (target.status !== 404 || !notFoundH1.test(target.body)) {
              failures.push(`${path} -> ${response.location}: ${target.status}`);
            }
          }
        }
      }
      expect(failures).toEqual([]);
    },
  );

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

    const tab = tabKey(page);
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await page.keyboard.press(tab);
    await expect(skipLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
    expect(new URL(page.url()).pathname).toBe(UNKNOWN);

    // Polled, because the button's `transition-all` animates the width from the unfocused `medium`
    // (3px) over 150ms.
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

    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('navigation')).toHaveCount(1);
    await expect(page.getByRole('button')).toHaveCount(0);

    await expectAccessible(page, {
      expectedOrder: [
        'a[href$="#main"]',
        'header a[href="/"]',
        topBarFind(page),
        'header a[href^="/sign-in"]',
        'main a[href="/leagues"]',
        'main a[href="/"]',
        'footer a[href="/"]',
        'footer a[href="/leagues"]',
        'footer a[href="/app"]',
        'footer a[href="/app/organizations/new"]',
        'footer a[href^="/sign-in"]',
      ],
    });

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

  // Client routes: the server sends the empty shell with status 200 (no guard or page runs there),
  // even for these odd paths, and never a 5xx or a Location.
  test(
    'paths under /app get the client shell: 200, no Location, nothing rendered',
    RAW_HTTP,
    async () => {
      for (const path of ['/app//evil.com', '/app/%2F%2Fevil.com', '/app/x//', '/app/x/(y)']) {
        const response = await rawGet(path);
        expect(response.status, path).toBe(200);
        expect(response.location, path).toBeUndefined();
        expect(response.body, path).toMatch(/<app-root><\/app-root>/);
        expect(response.body, path).not.toMatch(NOT_FOUND_H1);
      }
    },
  );

  test(
    '/app/x shows the not-found view in the client shell, and the home link goes home',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const response = await page.goto('/app/x?ref=1');
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
      await expect(page).toHaveTitle(/Page not found/);
      expect(await response?.text()).not.toContain('ref=1');
      await expect(page.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
        'href',
        '/app/x?ref=1#main',
      );

      await page.getByRole('main').getByRole('link', { name: 'Go to the home page' }).click();
      await expect(page).toHaveURL(`${baseURL}/`);
      await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
      await expect(page).toHaveTitle('Omni League');
    },
  );
});
