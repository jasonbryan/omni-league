import { test as base, expect } from '@playwright/test';
import { ConsoleGuard, type ExpectedDocumentStatus } from './console-guard';
import { remoteBaseUrl } from './env';
import { stubNetlifyDrawer } from './netlify-drawer';

export interface ConsoleFixtureOptions {
  /** `test.use({ expectedDocumentStatus: 404 })`: allow the page's own 404 resource message. */
  expectedDocumentStatus: ExpectedDocumentStatus | undefined;
  /** `test.use({ expectedConvexErrors: ['leagues:create'] })`: allow listed M(/A( Convex errors. */
  expectedConvexErrors: readonly string[];
}

export interface ConsoleFixtures {
  /** The console rules for every page of the test's browser context (auto fixture). */
  consoleGuard: ConsoleGuard;
  /** Remote runs only: stubs the Netlify Drawer script (auto fixture, `netlify-drawer.ts`). */
  netlifyDrawerStub: void;
}

/**
 * Shared `test` for every spec: the console fixture runs automatically on every page the test
 * opens and fails the test at teardown (ADR 0005 rules; see `console-guard.ts`). With
 * `E2E_BASE_URL` set, the Netlify Drawer script is stubbed in every test's browser context.
 */
export const test = base.extend<ConsoleFixtures & ConsoleFixtureOptions>({
  expectedDocumentStatus: [undefined, { option: true }],
  expectedConvexErrors: [[], { option: true }],
  consoleGuard: [
    async ({ context, expectedDocumentStatus, expectedConvexErrors }, use) => {
      const guard = new ConsoleGuard({ expectedDocumentStatus, expectedConvexErrors });
      for (const page of context.pages()) guard.attach(page);
      context.on('page', (page) => guard.attach(page));
      await use(guard);
      guard.verify();
    },
    { auto: true },
  ],
  netlifyDrawerStub: [
    async ({ context }, use) => {
      if (remoteBaseUrl) await stubNetlifyDrawer(context);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
