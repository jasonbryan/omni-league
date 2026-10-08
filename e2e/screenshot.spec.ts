// Screenshot command for the tester role (dev cycle Phase 5): one full-page PNG per Chromium
// viewport at e2e/screenshots/<route-slug>-<width>.png (gitignored; uploaded by CI as e2e-report).
// Routes: E2E_SCREENSHOT_ROUTES, comma-separated, default "/". Run with `npm run e2e:screenshots`.
import { join } from 'node:path';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';

const routes = (process.env['E2E_SCREENSHOT_ROUTES'] ?? '/')
  .split(',')
  .map((route) => route.trim())
  .filter(Boolean);

/** `/` -> `home`; `/leagues/abc?x=1` -> `leagues-abc-x-1`. */
function routeSlug(route: string): string {
  const slug = route
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug || 'home';
}

test.describe('screenshots', () => {
  for (const route of routes) {
    test(`full-page screenshot of ${route}`, async ({ page, consoleGuard }, testInfo) => {
      test.skip(
        testInfo.project.use.browserName !== 'chromium',
        'screenshots use the two Chromium projects (ADR 0005)',
      );
      await page.goto(route);
      if (!remoteBaseUrl) await expect.poll(() => consoleGuard.hydrated).toBe(true);
      await page.evaluate(() => document.fonts.ready);
      const width = page.viewportSize()?.width ?? 0;
      const path = join(testInfo.config.rootDir, 'screenshots', `${routeSlug(route)}-${width}.png`);
      const png = await page.screenshot({ path, fullPage: true });
      await testInfo.attach(`${routeSlug(route)}-${width}.png`, {
        body: png,
        contentType: 'image/png',
      });
      console.log(`Screenshot: ${path}`);
    });
  }
});
