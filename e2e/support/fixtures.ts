import { test as base, expect } from '@playwright/test';
import {
  ConsoleGuard,
  type ExpectedDocumentStatus,
  type ExpectedFailedRequest,
} from './console-guard';
import { remoteBaseUrl } from './env';
import { stubNetlifyDrawer } from './netlify-drawer';

export interface ConsoleFixtureOptions {
  expectedDocumentStatus: ExpectedDocumentStatus | undefined;
  expectedConvexErrors: readonly string[];
  expectedFailedRequests: readonly ExpectedFailedRequest[];
  /**
   * Allows `console.warn` messages that start with a listed string or match a listed RegExp; an
   * unused entry fails the test. Each entry needs a one-line why at the call site.
   */
  expectedConsoleWarnings: readonly (string | RegExp)[];
}

export interface NetlifyDrawerOptions {
  /**
   * `false` leaves the context with no `context.route`, so its HTTP cache stays on, as in a user's
   * browser. Only for runs on `localhost` or a preview with the Drawer off.
   */
  netlifyDrawerStub: boolean;
}

export interface ConsoleFixtures {
  consoleGuard: ConsoleGuard;
  netlifyDrawer: void;
}

/**
 * Playwright reads a fixture value that is an array whose second element is an object as a `[value,
 * options]` pair, so a plain list of two entries would silently become its first entry and break
 * the guard. One entry needs no helper.
 */
export function failedRequests(
  ...entries: ExpectedFailedRequest[]
): ConsoleFixtureOptions['expectedFailedRequests'] {
  return [entries, {}] as unknown as ConsoleFixtureOptions['expectedFailedRequests'];
}

/**
 * The console fixture runs automatically on every page the test opens and fails the test at
 * teardown. With `E2E_BASE_URL` set, the Netlify Drawer script is stubbed in every test's browser
 * context unless the test sets `netlifyDrawerStub: false`.
 */
export const test = base.extend<ConsoleFixtures & ConsoleFixtureOptions & NetlifyDrawerOptions>({
  expectedDocumentStatus: [undefined, { option: true }],
  expectedConvexErrors: [[], { option: true }],
  expectedFailedRequests: [[], { option: true }],
  expectedConsoleWarnings: [[], { option: true }],
  netlifyDrawerStub: [true, { option: true }],
  consoleGuard: [
    async (
      {
        context,
        expectedDocumentStatus,
        expectedConvexErrors,
        expectedFailedRequests,
        expectedConsoleWarnings,
      },
      use,
      testInfo,
    ) => {
      const guard = new ConsoleGuard({
        expectedDocumentStatus,
        expectedConvexErrors,
        expectedFailedRequests,
        expectedConsoleWarnings,
      });
      for (const page of context.pages()) guard.attach(page);
      context.on('page', (page) => guard.attach(page));
      await use(guard);
      // `test.skip()` in the body runs after `test.use()` set the allowances.
      guard.verify({ skipped: testInfo.status === 'skipped' });
    },
    { auto: true },
  ],
  netlifyDrawer: [
    async ({ context, netlifyDrawerStub }, use) => {
      if (remoteBaseUrl && netlifyDrawerStub) await stubNetlifyDrawer(context);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
