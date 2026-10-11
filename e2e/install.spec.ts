// Install to the Home Screen (#80, ADR 0013): the head tags, the web app manifest, and the icons.
// One test, one page load, chromium-desktop only: the checks do not depend on a viewport.
// Installability itself is the owner's device check: `Page.getInstallabilityErrors` needs Chrome's
// browser layer (the headless shell lacks it) and Playwright contexts report `in-incognito`.
import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { fetchRawHtml } from './support/raw-html';

const EXPECTED_MANIFEST = {
  id: '/',
  name: 'Omni League',
  short_name: 'Omni League',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  theme_color: '#ffffff',
  background_color: '#f6f7fa',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    {
      src: 'icons/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
};

/** Raw-HTML head tags, in any attribute order: `[name, pattern]`. */
const HEAD_TAGS: readonly (readonly [string, RegExp])[] = [
  [
    'manifest link',
    /<link\b(?=[^>]*\brel="manifest")(?=[^>]*\bhref="manifest\.webmanifest")[^>]*>/,
  ],
  ['theme-color meta', /<meta\b(?=[^>]*\bname="theme-color")(?=[^>]*\bcontent="#ffffff")[^>]*>/],
  [
    'apple-touch-icon link',
    /<link\b(?=[^>]*\brel="apple-touch-icon")(?=[^>]*\bhref="icons\/apple-touch-icon\.png")[^>]*>/,
  ],
  [
    'apple-mobile-web-app-title meta',
    /<meta\b(?=[^>]*\bname="apple-mobile-web-app-title")(?=[^>]*\bcontent="Omni League")[^>]*>/,
  ],
];

/** `/` answers 200, the Client routes `/app`, `/sign-up` (#62), and `/sign-in` (#63) 200, an unknown path 404. */
const PAGES = [
  ['/', 200],
  ['/app', 200],
  ['/sign-up', 200],
  ['/sign-in', 200],
  ['/this-page-does-not-exist', 404],
] as const;

/** The width and height in a PNG's IHDR chunk (8-byte signature, 4-byte length, `IHDR`). */
function pngSize(body: Buffer): string {
  expect(body.subarray(1, 4).toString('latin1')).toBe('PNG');
  expect(body.toString('latin1', 12, 16)).toBe('IHDR');
  return `${body.readUInt32BE(16)}x${body.readUInt32BE(20)}`;
}

async function expectPng(request: APIRequestContext, path: string, size: string): Promise<void> {
  const response = await request.get(path);
  expect(response.status(), path).toBe(200);
  expect(response.headers()['content-type'], path).toContain('image/png');
  expect(pngSize(await response.body()), path).toBe(size);
}

test.describe('install to the Home Screen', () => {
  test.skip(
    ({ browserName, isMobile }) => browserName !== 'chromium' || isMobile,
    'chromium-desktop only',
  );

  test('head tags, manifest, icons, and the parsed manifest', async ({
    page,
    request,
    context,
  }) => {
    // 1. Raw HTML (no JavaScript) carries the head on a client route, a missing route, and `/`.
    for (const [path, status] of PAGES) {
      const { status: actual, html } = await fetchRawHtml(request, path);
      expect(actual, path).toBe(status);
      for (const [name, pattern] of HEAD_TAGS) expect(html, `${path}: ${name}`).toMatch(pattern);
      expect(html, path).not.toContain('apple-touch-startup-image');
    }

    // 2. The manifest: 200, a JSON media type, exactly the scoped fields and values.
    const manifestResponse = await request.get('/manifest.webmanifest');
    expect(manifestResponse.status()).toBe(200);
    expect(manifestResponse.headers()['content-type']).toMatch(/^application\/(manifest\+)?json/);
    expect(await manifestResponse.json()).toEqual(EXPECTED_MANIFEST);

    // 3. Every icon the manifest names, and the apple-touch icon: 200, image/png, declared size.
    for (const icon of EXPECTED_MANIFEST.icons) {
      await expectPng(request, `/${icon.src}`, icon.sizes);
    }
    await expectPng(request, '/icons/apple-touch-icon.png', '180x180');
    const favicon = await request.get('/favicon.ico');
    expect(favicon.status()).toBe(200);
    expect(favicon.headers()['content-type']).toMatch(/icon/);

    // 4. Chrome's own read of the page's manifest (Chrome DevTools Protocol): no errors, and the
    // raw `data` string, parsed as JSON, equals the scoped manifest. The parsed `manifest` field
    // is experimental and its shape varies (colours as rgba(), display as an enum name, no
    // short_name), so when it is present only the fields it carries are checked, with URLs
    // resolved against the manifest's own URL.
    await page.goto('/');
    const session = await context.newCDPSession(page);
    const result = (await session.send('Page.getAppManifest')) as {
      url?: string;
      errors: { message: string }[];
      data?: string;
      manifest?: {
        name?: string;
        id?: string;
        startUrl?: string;
        scope?: string;
        display?: string;
        themeColor?: string;
        backgroundColor?: string;
        icons?: { url: string; sizes: string }[];
      };
    };
    expect(result.errors).toEqual([]);
    const manifestUrl = new URL(result.url ?? '');
    expect(manifestUrl.pathname).toBe('/manifest.webmanifest');
    expect(JSON.parse(result.data ?? 'null')).toEqual(EXPECTED_MANIFEST);
    const parsed = result.manifest;
    if (parsed) {
      const resolve = (path: string) => new URL(path, manifestUrl).href;
      expect(parsed.name).toBe(EXPECTED_MANIFEST.name);
      expect(parsed.id).toBe(resolve(EXPECTED_MANIFEST.id));
      expect(parsed.startUrl).toBe(resolve(EXPECTED_MANIFEST.start_url));
      expect(parsed.scope).toBe(resolve(EXPECTED_MANIFEST.scope));
      expect(parsed.display).toMatch(/standalone/i);
      expect(parsed.themeColor).toBe('rgba(255,255,255,1)');
      expect(parsed.backgroundColor).toBe('rgba(246,247,250,1)');
      expect(parsed.icons?.map(({ url, sizes }) => [url, sizes])).toEqual(
        EXPECTED_MANIFEST.icons.map(({ src, sizes }) => [resolve(src), sizes]),
      );
    }
  });
});
