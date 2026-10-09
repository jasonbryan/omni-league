// Self-test of the Netlify Drawer stub (#15). It runs in a separate browser context, not watched by
// the console fixture, because the unstubbed request is a 404 locally. The fixture's remote-only
// wiring is exercised by the smoke run against a preview (docs/process/hosting.md).
import type { Browser, Page } from '@playwright/test';
import { baseURL } from '../support/env';
import { expect, test } from '../support/fixtures';
import { NETLIFY_DRAWER_SCRIPT_PATH, stubNetlifyDrawer } from '../support/netlify-drawer';

async function fetchFromPage(page: Page, path: string): Promise<{ status: number; body: string }> {
  return page.evaluate(async (p) => {
    const response = await fetch(p);
    return { status: response.status, body: await response.text() };
  }, path);
}

async function pageAtRoot(browser: Browser, stub: boolean) {
  const context = await browser.newContext({ baseURL });
  if (stub) await stubNetlifyDrawer(context);
  const page = await context.newPage();
  await page.goto('/');
  return { page, close: () => context.close() };
}

test.describe('Netlify Drawer stub', () => {
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
});
