// Runs in a separate browser context, not watched by the console fixture, because the unstubbed
// request is a 404 locally.
import type { Browser, ConsoleMessage, Page } from '@playwright/test';
import { ConsoleGuard } from '../support/console-guard';
import { baseURL, remoteBaseUrl } from '../support/env';
import { expect, test } from '../support/fixtures';
import { NETLIFY_DRAWER_SCRIPT_PATH, stubNetlifyDrawer } from '../support/netlify-drawer';
import { fetchRawHtml } from '../support/raw-html';
import { VIEWPORT_AGNOSTIC } from '../support/viewport-agnostic';

async function fetchFromPage(page: Page, path: string): Promise<{ status: number; body: string }> {
  return page.evaluate(async (p) => {
    const response = await fetch(p);
    return { status: response.status, body: await response.text() };
  }, path);
}

// The expected-failure probe below would otherwise write a failure screenshot into the report.
test.use({ screenshot: 'off' });

const DRAWER_IS_ON =
  'The Netlify Drawer is on for this site, so previews and staging lose offline support (docs/process/hosting.md, "Netlify Drawer").';

function recordDrawerRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === NETLIFY_DRAWER_SCRIPT_PATH) urls.push(request.url());
  });
  return urls;
}

interface DrawerEvidence {
  html: string;
  drawerRequests: readonly string[];
  iframeCount: number;
}

function drawerProblems({ html, drawerRequests, iframeCount }: DrawerEvidence): string[] {
  const problems: string[] = [];
  if (html.includes(NETLIFY_DRAWER_SCRIPT_PATH)) problems.push('the HTML loads the Drawer script');
  if (drawerRequests.length > 0) problems.push('the page requested the Drawer script');
  if (iframeCount > 0) problems.push('the page has an iframe');
  return problems;
}

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

  test.describe('Drawer guard control', () => {
    test.use({ netlifyDrawerStub: false });

    test('reports a Drawer that loads its script and adds an iframe', async ({ page }) => {
      await page.route(
        (url) => url.pathname === '/',
        (route) =>
          route.fulfill({
            contentType: 'text/html',
            body: `<!doctype html><html><body><app-root></app-root><script src="${NETLIFY_DRAWER_SCRIPT_PATH}"></script></body></html>`,
          }),
      );
      await page.route(
        (url) => url.pathname === NETLIFY_DRAWER_SCRIPT_PATH,
        (route) =>
          route.fulfill({
            contentType: 'text/javascript; charset=utf-8',
            body: "document.body.append(document.createElement('iframe'));",
          }),
      );
      const drawerRequests = recordDrawerRequests(page);
      await page.goto('/');
      const served = await fetchFromPage(page, '/');
      expect(served.status).toBe(200);
      expect(
        drawerProblems({
          html: served.body,
          drawerRequests,
          iframeCount: await page.locator('iframe').count(),
        }),
      ).toEqual([
        'the HTML loads the Drawer script',
        'the page requested the Drawer script',
        'the page has an iframe',
      ]);
    });
  });

  test.describe('remote runs (E2E_BASE_URL)', () => {
    test.skip(
      !remoteBaseUrl,
      'needs E2E_BASE_URL: the guard checks a deployed site, which Netlify would inject the Drawer into',
    );

    test.describe('Drawer guard', () => {
      // The default stub would answer a returning Drawer script empty, so no iframe could appear.
      test.use({ netlifyDrawerStub: false });

      test('the Netlify Drawer stays off', async ({ page, request }) => {
        const raw = await fetchRawHtml(request, '/');
        expect(raw.status).toBe(200);
        expect(raw.html).toContain('<app-root');
        const drawerRequests = recordDrawerRequests(page);
        await page.goto('/');
        const problems = drawerProblems({
          html: raw.html,
          drawerRequests,
          iframeCount: await page.locator('iframe').count(),
        });
        expect(problems, DRAWER_IS_ON).toEqual([]);
      });
    });

    test('by default, the Drawer path gets the empty stub in the test context', async ({
      page,
    }) => {
      await page.goto('/');
      expect(await fetchFromPage(page, NETLIFY_DRAWER_SCRIPT_PATH)).toEqual({
        status: 200,
        body: '',
      });
    });

    test.describe('with netlifyDrawerStub: false', () => {
      // Locally the SSR handler has no such route and answers its 404 page; on Netlify the real script answers.
      test.use({ netlifyDrawerStub: false, expectedDocumentStatus: 404 });

      test("the Drawer path gets the server's own response, not the empty stub", async ({
        page,
      }) => {
        const response = await page.goto(NETLIFY_DRAWER_SCRIPT_PATH);
        expect(response).not.toBeNull();
        expect(await response!.text()).not.toBe('');
      });
    });
  });
});
