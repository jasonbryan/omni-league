// Writes e2e/screenshots/<route-slug>-<width>.png (gitignored; uploaded by CI as e2e-report) for
// each route in E2E_SCREENSHOT_ROUTES, comma-separated, default "/". Run with `npm run
// e2e:screenshots`.
import { join } from 'node:path';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';

const routes = (process.env['E2E_SCREENSHOT_ROUTES'] ?? '/')
  .split(',')
  .map((route) => route.trim())
  .filter(Boolean);

function routeSlug(route: string): string {
  const slug = route
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return slug || 'home';
}

function isClientRoute(route: string): boolean {
  return /^\/(?:sign-up|sign-in|app)(?:[/?#]|$)/.test(route);
}

test.describe('screenshots', () => {
  // A route may be a 404 document: its own 404 resource message is allowed, and the status is
  // printed beside the path. Every other console rule still applies.
  test.use({ expectedDocumentStatus: 404 });

  for (const route of routes) {
    test(`full-page screenshot of ${route}`, async ({ page, consoleGuard }, testInfo) => {
      test.skip(
        testInfo.project.use.browserName !== 'chromium',
        'screenshots use the two Chromium projects',
      );
      const response = await page.goto(route);
      // Client routes render in the browser only, so they never log hydration.
      if (isClientRoute(route)) await expect(page.locator('main h1')).toBeVisible();
      else if (!remoteBaseUrl) await expect.poll(() => consoleGuard.hydrated).toBe(true);
      await page.evaluate(() => document.fonts.ready);
      const width = page.viewportSize()?.width ?? 0;
      const path = join(testInfo.config.rootDir, 'screenshots', `${routeSlug(route)}-${width}.png`);
      const png = await page.screenshot({ path, fullPage: true });
      await testInfo.attach(`${routeSlug(route)}-${width}.png`, {
        body: png,
        contentType: 'image/png',
      });
      console.log(`Screenshot: ${path} (HTTP ${String(response?.status())})`);
    });
  }
});
