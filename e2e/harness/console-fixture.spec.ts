// Self-tests of the shared console fixture (#13). Two layers:
// - rule tests drive a ConsoleGuard on a page in a separate context (not watched by the auto
//   fixture) and assert the exact problems it reports;
// - wiring tests use the real fixture through `test.use`; the failing ones are marked `test.fail()`,
//   so they pass only if the fixture fails the test.
import type { Browser, ConsoleMessage, Page } from '@playwright/test';
import { ConsoleGuard, type ConsoleGuardOptions } from '../support/console-guard';
import { baseURL, LOCAL_BUILD_ONLY, remoteBaseUrl } from '../support/env';
import { expect, test } from '../support/fixtures';

async function guardedPage(
  browser: Browser,
  options: ConsoleGuardOptions = {},
): Promise<{ page: Page; guard: ConsoleGuard; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const guard = new ConsoleGuard(options);
  guard.attach(page);
  return { page, guard, close: () => context.close() };
}

/** Logs through `page.evaluate` and waits until the console event has arrived. */
async function logInPage(
  page: Page,
  level: 'error' | 'warn' | 'log' | 'info',
  text: string,
): Promise<void> {
  await Promise.all([
    page.waitForEvent('console', (m: ConsoleMessage) => m.text() === text),
    page.evaluate(([l, t]) => console[l](t), [level, text] as const),
  ]);
}

test.describe('console fixture rules', () => {
  test('fails on an uncaught page error', async ({ browser }) => {
    const { page, guard, close } = await guardedPage(browser);
    await Promise.all([
      page.waitForEvent('pageerror'),
      page.evaluate(() => {
        setTimeout(() => {
          throw new Error('probe page error');
        });
      }),
    ]);
    expect(guard.problems()).toEqual([expect.stringMatching(/^pageerror: .*probe page error/s)]);
    await close();
  });

  test('fails on console.error', async ({ browser }) => {
    const { page, guard, close } = await guardedPage(browser);
    await logInPage(page, 'error', 'probe error');
    expect(guard.problems()).toEqual(['console.error: probe error']);
    await close();
  });

  test('fails on an NG05xx console.warn and ignores other warnings', async ({ browser }) => {
    const { page, guard, close } = await guardedPage(browser);
    await logInPage(page, 'warn', 'plain warning');
    await logInPage(page, 'warn', 'NG0505: Angular hydration was requested on the client');
    expect(guard.problems()).toEqual([
      'console.warn: NG0505: Angular hydration was requested on the client',
    ]);
    await close();
  });

  test('ignores log and info, even with NG05xx or error text', async ({ browser }) => {
    const { page, guard, close } = await guardedPage(browser);
    await logInPage(page, 'log', 'NG0500: log text is ignored');
    await logInPage(page, 'info', 'ERROR info text is ignored');
    expect(guard.problems()).toEqual([]);
    expect(guard.logMessages).toEqual([
      'NG0500: log text is ignored',
      'ERROR info text is ignored',
    ]);
    await close();
  });

  test('takes only 404 as expectedDocumentStatus', () => {
    expect(() => new ConsoleGuard({ expectedDocumentStatus: 500 as 404 })).toThrow(
      'expectedDocumentStatus takes only 404; got 500',
    );
  });

  test.describe('expectedDocumentStatus: 404', () => {
    test.skip(!!remoteBaseUrl, LOCAL_BUILD_ONLY);

    test('ignores the 404 document message only with the option set', async ({ browser }) => {
      const withOption = await guardedPage(browser, { expectedDocumentStatus: 404 });
      const [message, response] = await Promise.all([
        withOption.page.waitForEvent('console', (m) => m.type() === 'error'),
        withOption.page.goto('/does-not-exist'),
      ]);
      expect(response?.status()).toBe(404);
      expect(message.text()).toMatch(
        /^Failed to load resource: the server responded with a status of 404/,
      );
      expect(withOption.guard.problems()).toEqual([]);
      await withOption.close();

      const unset = await guardedPage(browser);
      await Promise.all([
        unset.page.waitForEvent('console', (m) => m.type() === 'error'),
        unset.page.goto('/does-not-exist'),
      ]);
      expect(unset.guard.problems()).toEqual([
        expect.stringMatching(
          /^console\.error: Failed to load resource: the server responded with a status of 404 .*\(at http:\/\/[^)]+\/does-not-exist\)$/,
        ),
      ]);
      await unset.close();
    });

    test('still fails on console.error on the 404 page', async ({ browser }) => {
      const { page, guard, close } = await guardedPage(browser, { expectedDocumentStatus: 404 });
      await page.goto('/does-not-exist');
      await logInPage(page, 'error', 'probe error on a 404 page');
      expect(guard.problems()).toEqual(['console.error: probe error on a 404 page']);
      await close();
    });

    test('still fails on a 404 for another URL (sub-resource on /)', async ({ browser }) => {
      const { page, guard, close } = await guardedPage(browser, { expectedDocumentStatus: 404 });
      await page.goto('/');
      await Promise.all([
        page.waitForEvent('console', (m) => m.type() === 'error'),
        page.evaluate(() => fetch('/missing.png').then(() => undefined)),
      ]);
      expect(guard.problems()).toEqual([
        expect.stringMatching(
          /^console\.error: Failed to load resource: the server responded with a status of 404 .*\(at http:\/\/[^)]+\/missing\.png\)$/,
        ),
      ]);
      await close();
    });

    // The WebKit fallback (latest main-frame 404 response) must not outlive the 404 document.
    test('still fails on a 404 for the old document URL after leaving the 404 page', async ({
      browser,
    }) => {
      const { page, guard, close } = await guardedPage(browser, { expectedDocumentStatus: 404 });
      await page.goto('/does-not-exist');
      await page.goto('/');
      await Promise.all([
        page.waitForEvent('console', (m) => m.type() === 'error'),
        page.evaluate(() => fetch('/does-not-exist').then(() => undefined)),
      ]);
      expect(guard.problems()).toEqual([
        expect.stringMatching(
          /^console\.error: Failed to load resource: the server responded with a status of 404 .*\(at http:\/\/[^)]+\/does-not-exist\)$/,
        ),
      ]);
      await close();
    });

    test('still fails on a 404 iframe document on /', async ({ browser }) => {
      const { page, guard, close } = await guardedPage(browser, { expectedDocumentStatus: 404 });
      await page.goto('/');
      await Promise.all([
        page.waitForEvent('console', (m) => m.type() === 'error'),
        page.evaluate(() => {
          const frame = document.createElement('iframe');
          frame.title = 'probe';
          frame.src = '/iframe-missing';
          document.body.append(frame);
        }),
      ]);
      expect(guard.problems()).toEqual([
        expect.stringMatching(
          /^console\.error: Failed to load resource: the server responded with a status of 404 .*\(at http:\/\/[^)]+\/iframe-missing\)$/,
        ),
      ]);
      await close();
    });
  });

  test.describe("expectedConvexErrors: ['probe:add']", () => {
    const options = { expectedConvexErrors: ['probe:add'] };

    test('allows the listed mutation and action prefixes', async ({ browser }) => {
      const { page, guard, close } = await guardedPage(browser, options);
      await logInPage(page, 'error', '[CONVEX M(probe:add)] [Request ID: x] Server Error');
      await logInPage(page, 'error', '[CONVEX A(probe:add)] [Request ID: y] Server Error');
      expect(guard.problems()).toEqual([]);
      await close();
    });

    for (const text of [
      '[CONVEX M(probe:other)] [Request ID: x] Server Error',
      '[CONVEX Q(probe:add)] Could not parse console.log',
      '[CONVEX FATAL ERROR] x',
      'some other error',
    ]) {
      test(`still fails on: ${text}`, async ({ browser }) => {
        const { page, guard, close } = await guardedPage(browser, options);
        await logInPage(page, 'error', '[CONVEX M(probe:add)] [Request ID: x] Server Error');
        await logInPage(page, 'error', text);
        expect(guard.problems()).toEqual([`console.error: ${text}`]);
        await close();
      });
    }

    test('with the option unset, the probe:add message fails', async ({ browser }) => {
      const { page, guard, close } = await guardedPage(browser);
      await logInPage(page, 'error', '[CONVEX M(probe:add)] [Request ID: x] Server Error');
      expect(guard.problems()).toEqual([
        'console.error: [CONVEX M(probe:add)] [Request ID: x] Server Error',
      ]);
      await close();
    });

    test('fails on an unused entry, naming it', async ({ browser }) => {
      const { guard, close } = await guardedPage(browser, options);
      expect(guard.problems()).toEqual([
        expect.stringContaining('expectedConvexErrors entry "probe:add" was not used'),
      ]);
      expect(() => guard.verify()).toThrow(/probe:add/);
      await close();
    });
  });
});

test.describe('console fixture wiring (real fixture)', () => {
  test('passes on log and info', async ({ page }) => {
    await page.setContent('<p>ok</p>');
    await logInPage(page, 'log', 'just a log');
    await logInPage(page, 'info', 'just info');
  });

  test('a console.error fails the test', async ({ page }) => {
    test.fail(true, 'the console fixture must fail this test');
    await page.setContent('<p>ok</p>');
    await logInPage(page, 'error', 'probe error through the real fixture');
  });

  test.describe('with expectedConvexErrors', () => {
    test.use({ expectedConvexErrors: ['probe:add'] });

    test('a listed mutation error passes', async ({ page }) => {
      await page.setContent('<p>ok</p>');
      await logInPage(page, 'error', '[CONVEX M(probe:add)] [Request ID: x] Server Error');
    });

    test('an unused entry fails the test at teardown', async ({ page }) => {
      test.fail(true, 'the unused allowance probe:add must fail this test');
      await page.setContent('<p>ok</p>');
    });
  });

  test.describe('with expectedDocumentStatus: 404', () => {
    test.skip(!!remoteBaseUrl, LOCAL_BUILD_ONLY);
    test.use({ expectedDocumentStatus: 404 });

    test('opening an unknown URL passes', async ({ page }) => {
      const response = await page.goto('/does-not-exist');
      expect(response?.status()).toBe(404);
    });
  });

  test.describe('without expectedDocumentStatus', () => {
    test.skip(!!remoteBaseUrl, LOCAL_BUILD_ONLY);

    test('opening an unknown URL fails the test', async ({ page }) => {
      test.fail(true, 'the 404 document message must fail this test');
      await Promise.all([
        page.waitForEvent('console', (m) => m.type() === 'error'),
        page.goto('/does-not-exist'),
      ]);
    });
  });
});
