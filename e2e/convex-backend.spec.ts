// Self-test of the e2e Convex wiring (#59): the run reaches the anonymous local backend, IS_TEST is
// set there, and the build under test names that backend (and its HTTP-action URL, #62). It opens no page and has no viewport,
// so it runs in chromium-desktop only. With E2E_BASE_URL set there is no local backend: skipped.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { convexRun } from './support/convex';
import { LOCAL_CONVEX_SITE_URL, LOCAL_CONVEX_URL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';

const dist = join(process.cwd(), 'dist', 'omni-league');

/** Every `.js`/`.mjs` file under `dir`, recursively (source maps excluded). */
function bundleFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.m?js$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * Convex deployment URLs that appear as quoted string literals in `files` (the compiled-in
 * `__CONVEX_URL__` and `__CONVEX_SITE_URL__`). Library doc comments quote example URLs in
 * backticks, so they do not count.
 */
function convexUrlLiterals(files: string[]): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const literal = /["'](https?:\/\/[^"'\s]+)["']/g;
  const convexLike = /\.convex\.(cloud|site)\b|^https?:\/\/(127\.0\.0\.1|localhost):\d+\/?$/;
  for (const file of files) {
    for (const [, url = ''] of readFileSync(file, 'utf8').matchAll(literal)) {
      if (!convexLike.test(url)) continue;
      found.set(url, [...(found.get(url) ?? []), relative(dist, file)]);
    }
  }
  return found;
}

test.describe('local Convex backend', () => {
  test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend');
  // Desktop Chromium is the chromium-desktop project (the mobile projects set isMobile).
  test.skip(
    ({ browserName, isMobile }) => browserName !== 'chromium' || isMobile,
    'no viewport: chromium-desktop only',
  );

  test('testing:ping answers "ok" (IS_TEST is set on the local backend)', async () => {
    expect(await convexRun('testing:ping')).toBe('ok');
  });

  test('the served browser and server bundles name only the local backend', async ({ request }) => {
    const browser = convexUrlLiterals(bundleFiles(join(dist, 'browser')));
    const server = convexUrlLiterals(bundleFiles(join(dist, 'server')));
    console.log(`Convex URL literals, browser bundle: ${JSON.stringify([...browser])}`);
    console.log(`Convex URL literals, server bundle: ${JSON.stringify([...server])}`);
    // The deployment URL, and its HTTP-action URL for the Better Auth client (#62).
    const expected = [LOCAL_CONVEX_URL, LOCAL_CONVEX_SITE_URL].sort();
    expect([...browser.keys()].sort()).toEqual(expected);
    expect([...server.keys()].sort()).toEqual(expected);

    // The SSR server serves exactly these browser files.
    for (const url of expected) {
      for (const file of browser.get(url) ?? []) {
        const response = await request.get(`/${file.replace(/^browser\//, '')}`);
        expect(response.status(), file).toBe(200);
        expect(await response.text(), file).toContain(`"${url}"`);
      }
    }
  });
});
