// Self-tests of the shared console fixture (#13). Two layers:
// - rule tests drive a ConsoleGuard on a page in a separate context (not watched by the auto
//   fixture) and assert the exact problems it reports;
// - wiring tests use the real fixture through `test.use`; the failing ones are marked `test.fail()`,
//   so they pass only if the fixture fails the test.
import type { Browser, ConsoleMessage, Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsoleGuard, type ConsoleGuardOptions } from '../support/console-guard';
import { baseURL, LOCAL_BUILD_ONLY, remoteBaseUrl } from '../support/env';
import { expect, failedRequests, test } from '../support/fixtures';
import { VIEWPORT_AGNOSTIC } from '../support/viewport-agnostic';

// The expected-failure probes would otherwise write a failure screenshot into the report. Playwright
// allows `screenshot` only at file level (a describe-level `use` would force a new worker).
test.use({ screenshot: 'off' });

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

test.describe('console fixture rules', VIEWPORT_AGNOSTIC, () => {
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

  // Angular's hydration warnings come with a code (NG0505) and without one (#94).
  test('fails on every console.warn, with or without an NG05xx code', async ({ browser }) => {
    const { page, guard, close } = await guardedPage(browser);
    await logInPage(page, 'warn', 'plain warning');
    await logInPage(
      page,
      'warn',
      'Unexpected state: no hydration info available for a given TNode, which represents a view container.',
    );
    await logInPage(page, 'warn', 'NG0505: Angular hydration was requested on the client');
    expect(guard.problems()).toEqual([
      'console.warn: plain warning',
      'console.warn: Unexpected state: no hydration info available for a given TNode, which represents a view container.',
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

  test.describe('expectedFailedRequests: 409 on /probe-conflict', () => {
    const options = { expectedFailedRequests: [{ status: 409, path: '/probe-conflict' }] };

    /** Fetches `path`, answered with `status` by a route, and waits for the console error. */
    async function failRequest(page: Page, path: string, status: number): Promise<void> {
      await page.route(`**${path}`, (route) => route.fulfill({ status, body: '' }));
      await Promise.all([
        page.waitForEvent('console', (m) => m.type() === 'error'),
        page.evaluate((p) => fetch(p).then(() => undefined), path),
      ]);
    }

    test('allows the listed status and path', async ({ browser }) => {
      const { page, guard, close } = await guardedPage(browser, options);
      await page.goto('/');
      await failRequest(page, '/probe-conflict', 409);
      expect(guard.problems()).toEqual([]);
      await close();
    });

    for (const [path, status] of [
      ['/probe-conflict', 500],
      ['/probe-other', 409],
      ['/probe-conflict/x', 409],
    ] as const) {
      test(`still fails on ${status} ${path}`, async ({ browser }) => {
        const { page, guard, close } = await guardedPage(browser, options);
        await page.goto('/');
        await failRequest(page, '/probe-conflict', 409);
        await failRequest(page, path, status);
        expect(guard.problems()).toEqual([
          expect.stringMatching(
            new RegExp(
              `^console\\.error: Failed to load resource: the server responded with a status of ${status} `,
            ),
          ),
        ]);
        await close();
      });
    }

    test('fails on an unused entry, naming it', async ({ browser }) => {
      const { guard, close } = await guardedPage(browser, options);
      expect(guard.problems()).toEqual([
        expect.stringContaining('expectedFailedRequests entry 409 /probe-conflict was not used'),
      ]);
      await close();
    });
  });

  test.describe("expectedConsoleWarnings: ['probe warning']", () => {
    const options = { expectedConsoleWarnings: ['probe warning'] };

    test('allows a warning that starts with the entry', async ({ browser }) => {
      const { page, guard, close } = await guardedPage(browser, options);
      await logInPage(page, 'warn', 'probe warning: one');
      await logInPage(page, 'warn', 'probe warning: two');
      expect(guard.problems()).toEqual([]);
      await close();
    });

    for (const text of ['a probe warning', 'Probe warning', 'other warning']) {
      test(`still fails on: ${text}`, async ({ browser }) => {
        const { page, guard, close } = await guardedPage(browser, options);
        await logInPage(page, 'warn', 'probe warning: used');
        await logInPage(page, 'warn', text);
        expect(guard.problems()).toEqual([`console.warn: ${text}`]);
        await close();
      });
    }

    test('does not allow a console.error with the same text', async ({ browser }) => {
      const { page, guard, close } = await guardedPage(browser, options);
      await logInPage(page, 'warn', 'probe warning: used');
      await logInPage(page, 'error', 'probe warning as an error');
      expect(guard.problems()).toEqual(['console.error: probe warning as an error']);
      await close();
    });

    test('a RegExp entry matches anywhere in the message, also with the g flag', async ({
      browser,
    }) => {
      const { page, guard, close } = await guardedPage(browser, {
        expectedConsoleWarnings: [/probe \d+/g],
      });
      await logInPage(page, 'warn', 'a probe 1 warning');
      await logInPage(page, 'warn', 'a probe 2 warning');
      expect(guard.problems()).toEqual([]);
      await close();
    });

    test('fails on an unused entry, naming it', async ({ browser }) => {
      const { guard, close } = await guardedPage(browser, {
        expectedConsoleWarnings: ['probe warning', /probe \d+/],
      });
      expect(guard.problems()).toEqual([
        expect.stringContaining('expectedConsoleWarnings entry "probe warning" was not used'),
        expect.stringContaining('expectedConsoleWarnings entry /probe \\d+/ was not used'),
      ]);
      expect(() => guard.verify()).toThrow(/probe warning/);
      await close();
    });
  });

  // #62 tester: `test.skip()` inside a test runs after `test.use()` set the allowances, so a
  // skipped test never reaches the request it allowed.
  test.describe('in a skipped test', () => {
    const options = {
      expectedConvexErrors: ['probe:add'],
      expectedFailedRequests: [{ status: 409, path: '/probe-conflict' }],
      expectedConsoleWarnings: ['probe warning', /probe \d+/],
    };

    test('reports every unused entry when the test ran', async ({ browser }) => {
      const { guard, close } = await guardedPage(browser, options);
      expect(guard.problems()).toEqual([
        expect.stringContaining('expectedConvexErrors entry "probe:add" was not used'),
        expect.stringContaining('expectedFailedRequests entry 409 /probe-conflict was not used'),
        expect.stringContaining('expectedConsoleWarnings entry "probe warning" was not used'),
        expect.stringContaining('expectedConsoleWarnings entry /probe \\d+/ was not used'),
      ]);
      await close();
    });

    test('does not report unused entries', async ({ browser }) => {
      const { guard, close } = await guardedPage(browser, options);
      expect(guard.problems({ skipped: true })).toEqual([]);
      expect(() => guard.verify({ skipped: true })).not.toThrow();
      await close();
    });

    test('still reports a console error', async ({ browser }) => {
      const { page, guard, close } = await guardedPage(browser, options);
      await logInPage(page, 'error', 'probe error before the skip');
      expect(guard.problems({ skipped: true })).toEqual([
        'console.error: probe error before the skip',
      ]);
      await close();
    });

    test('still reports an unlisted console.warn', async ({ browser }) => {
      const { page, guard, close } = await guardedPage(browser, options);
      await logInPage(page, 'warn', 'other warning before the skip');
      expect(guard.problems({ skipped: true })).toEqual([
        'console.warn: other warning before the skip',
      ]);
      await close();
    });
  });
});

test.describe('console fixture wiring (real fixture)', VIEWPORT_AGNOSTIC, () => {
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

  test('a console.warn without an NG05xx code fails the test', async ({ page }) => {
    test.fail(true, 'the console fixture must fail this test');
    await page.setContent('<p>ok</p>');
    await logInPage(page, 'warn', 'probe warning through the real fixture');
  });

  test.describe('with expectedConsoleWarnings', () => {
    test.use({ expectedConsoleWarnings: ['probe warning'] });

    test('a listed warning passes', async ({ page }) => {
      await page.setContent('<p>ok</p>');
      await logInPage(page, 'warn', 'probe warning through the real fixture');
    });

    test('an unused entry fails the test at teardown', async ({ page }) => {
      test.fail(true, 'the unused allowance "probe warning" must fail this test');
      await page.setContent('<p>ok</p>');
    });
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

  // #62 tester: a test that skips itself after `test.use()` set allowances must end skipped, not
  // failed at teardown. Before the fix this test failed with "entry … was not used".
  test.describe('with allowances, skipped inside the test', () => {
    test.use({
      expectedConvexErrors: ['probe:add'],
      expectedFailedRequests: [{ status: 409, path: '/probe-conflict' }],
      expectedConsoleWarnings: ['probe warning'],
    });

    test('ends skipped without an unused-entry failure', async ({ page }) => {
      await page.setContent('<p>ok</p>');
      test.skip(true, 'skips before the allowed request, as a local-only test does on a preview');
    });
  });

  // #62 tester (round 2): an unused expectedFailedRequests entry still fails a test that runs.
  test.describe('with expectedFailedRequests', () => {
    test.use({ expectedFailedRequests: [{ status: 409, path: '/probe-conflict' }] });

    test('an unused entry fails the test at teardown', async ({ page }) => {
      test.fail(true, 'the unused allowance 409 /probe-conflict must fail this test');
      await page.setContent('<p>ok</p>');
    });
  });

  // #63 tester: `failedRequests(...)` keeps every entry of a list of two or more. A plain array of
  // two entries is read by Playwright as `[value, options]` and loses the second entry.
  test.describe('with failedRequests(a, b)', () => {
    test.use({
      expectedFailedRequests: failedRequests(
        { status: 409, path: '/probe-conflict' },
        { status: 429, path: '/probe-limit' },
      ),
    });

    async function failRequest(page: Page, path: string, status: number): Promise<void> {
      await page.route(`**${path}`, (route) => route.fulfill({ status, body: '' }));
      await Promise.all([
        page.waitForEvent('console', (m) => m.type() === 'error'),
        page.evaluate((p) => fetch(p).then(() => undefined), path),
      ]);
    }

    test('allows both listed requests', async ({ page }) => {
      await page.goto('/');
      await failRequest(page, '/probe-conflict', 409);
      await failRequest(page, '/probe-limit', 429);
    });

    test('an unused second entry fails the test at teardown', async ({ page }) => {
      test.fail(true, 'the unused allowance 429 /probe-limit must fail this test');
      await page.goto('/');
      await failRequest(page, '/probe-conflict', 409);
    });

    test('an unlisted request still fails the test', async ({ page }) => {
      test.fail(true, 'a 500 on /probe-limit is not allowed');
      await page.goto('/');
      await failRequest(page, '/probe-conflict', 409);
      await failRequest(page, '/probe-limit', 429);
      await failRequest(page, '/probe-limit', 500);
    });
  });

  // #62 tester (round 2): a test that skips itself still fails on a console or page error it hit
  // before the skip. Its outcome is read from a child Playwright run (`probes/`), because a test
  // cannot both skip itself and expect to fail.
  test('a test that skips itself still fails on an earlier console or page error', ({
    browserName,
  }, testInfo) => {
    // The child run is browser-independent: one Chromium project is enough.
    test.skip(
      browserName !== 'chromium' || testInfo.project.name !== 'chromium-desktop',
      'one child run is enough',
    );
    test.setTimeout(120_000);
    const outputDir = mkdtempSync(join(tmpdir(), 'console-probe-'));
    try {
      const run = spawnSync(
        process.execPath,
        [
          join(testInfo.config.rootDir, '..', 'node_modules', '@playwright', 'test', 'cli.js'),
          'test',
          '--config',
          join(testInfo.config.rootDir, 'harness', 'probes', 'probe.config.ts'),
        ],
        { encoding: 'utf8', env: { ...process.env, PROBE_OUTPUT_DIR: outputDir } },
      );
      const report = JSON.parse(run.stdout) as {
        suites: {
          specs: { title: string; tests: { status: string; results: { status: string }[] }[] }[];
        }[];
      };
      const outcomes = Object.fromEntries(
        report.suites.flatMap((suite) =>
          suite.specs.map((spec) => [spec.title, spec.tests[0]?.results[0]?.status]),
        ),
      );
      expect(outcomes).toEqual({
        'skips with no console error': 'skipped',
        'skips after a console.error': 'failed',
        'skips after a page error': 'failed',
        'skips after a console.error on a second page': 'failed',
        'skips after an unlisted console.warn': 'failed',
        'does not skip (condition false), allowances unused': 'failed',
      });
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
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
