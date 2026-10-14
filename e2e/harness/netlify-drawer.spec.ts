// Runs in a separate browser context, not watched by the console fixture, because the unstubbed
// request is a 404 locally.
import type { Browser, ConsoleMessage, Page } from '@playwright/test';
import { ConsoleGuard } from '../support/console-guard';
import { baseURL, remoteBaseUrl } from '../support/env';
import { expect, test } from '../support/fixtures';
import { NETLIFY_DRAWER_SCRIPT_PATH, stubNetlifyDrawer } from '../support/netlify-drawer';
import { VIEWPORT_AGNOSTIC } from '../support/viewport-agnostic';

async function fetchFromPage(page: Page, path: string): Promise<{ status: number; body: string }> {
  return page.evaluate(async (p) => {
    const response = await fetch(p);
    return { status: response.status, body: await response.text() };
  }, path);
}

// The expected-failure probe below would otherwise write a failure screenshot into the report.
test.use({ screenshot: 'off' });

async function pageAtRoot(browser: Browser, stub: boolean) {
  const context = await browser.newContext({ baseURL });
  if (stub) await stubNetlifyDrawer(context);
  const page = await context.newPage();
  await page.goto('/');
  return { page, close: () => context.close() };
}

test.describe('Netlify Drawer stub', VIEWPORT_AGNOSTIC, () => {
  test('answers the Drawer script with an empty script', async ({ browser }) => {
    const { page, close } = await pageAtRoot(browser, true);
    expect(await fetchFromPage(page, NETLIFY_DRAWER_SCRIPT_PATH)).toEqual({
      status: 200,
      body: '',
    });
    await close();
  });

  test('leaves every other path to the server', async ({ browser }) => {
    const { page, close } = await pageAtRoot(browser, true);
    const other = await fetchFromPage(page, '/.netlify/scripts/cdp-other');
    expect(other.status).not.toBe(200);
    await close();
  });

  test('without the stub, the Drawer path reaches the server', async ({ browser }) => {
    const { page, close } = await pageAtRoot(browser, false);
    const drawer = await fetchFromPage(page, NETLIFY_DRAWER_SCRIPT_PATH);
    // Locally the SSR handler has no such route; on Netlify the real script answers.
    expect(drawer.body).not.toBe('');
    await close();
  });

  test('does not hide an app console error or uncaught error from the console fixture', async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL });
    await stubNetlifyDrawer(context);
    const page = await context.newPage();
    const guard = new ConsoleGuard();
    guard.attach(page);
    await page.goto('/');
    await Promise.all([
      page.waitForEvent('console', (m: ConsoleMessage) => m.text() === 'probe app error'),
      page.evaluate(() => console.error('probe app error')),
    ]);
    // On the app page, Angular's global error listener reports an uncaught error as
    // `console.error('ERROR', error)` instead of a page error; the guard must still see it.
    await Promise.all([
      page.waitForEvent(
        'console',
        (m: ConsoleMessage) => m.type() === 'error' && m.text().includes('probe app uncaught'),
      ),
      page.evaluate(() => {
        setTimeout(() => {
          throw new Error('probe app uncaught');
        });
      }),
    ]);
    expect(guard.problems()).toEqual([
      'console.error: probe app error',
      expect.stringMatching(/^console\.error: ERROR Error: probe app uncaught/),
    ]);
    await context.close();
  });

  test('the shared fixtures still fail a test that logs console.error', async ({ page }) => {
    test.fail();
    await page.goto('/');
    await page.evaluate(() => console.error('probe app error through the fixture'));
  });

  test.describe('remote runs (E2E_BASE_URL)', () => {
    test.skip(!remoteBaseUrl, 'needs E2E_BASE_URL: Netlify injects the Drawer script only there');

    test('the page loads the Drawer script and the auto fixture answers it empty', async ({
      page,
    }) => {
      const drawerResponse = page.waitForResponse(
        (r) => new URL(r.url()).pathname === NETLIFY_DRAWER_SCRIPT_PATH,
      );
      await page.goto('/');
      const response = await drawerResponse;
      expect(response.status()).toBe(200);
      expect(await response.text()).toBe('');
      expect(await page.locator('iframe').count()).toBe(0);
    });
  });
});
