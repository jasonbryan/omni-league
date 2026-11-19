import type { Page } from '@playwright/test';
import { LOCAL_BUILD_ONLY, remoteBaseUrl } from '../support/env';
import { expect, test } from '../support/fixtures';
import { gotoHydrated, hydrated } from '../support/hydrated';
import { VIEWPORT_AGNOSTIC } from '../support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, LOCAL_BUILD_ONLY);

const SCRIPT_URL = /\/(main|chunk-[^/]+)\.js$/;
const STILL_PENDING_MS = 1_000;

/** The HTML of a document arrives and its scripts do not, so it cannot hydrate until `release`. */
async function holdScripts(page: Page): Promise<() => void> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(SCRIPT_URL, async (route) => {
    await released;
    await route.continue().catch(() => undefined);
  });
  return release;
}

function trackSettled(promise: Promise<unknown>): { readonly settled: boolean } {
  const state = { settled: false };
  promise.then(
    () => (state.settled = true),
    () => (state.settled = true),
  );
  return state;
}

test.describe('hydrated waits for the page under test', VIEWPORT_AGNOSTIC, () => {
  test('gotoHydrated stays pending on a second document until that document hydrates', async ({
    page,
    consoleGuard,
  }) => {
    await gotoHydrated(page, consoleGuard, '/');
    expect(consoleGuard.hydrationCount(page)).toBe(1);
    const release = await holdScripts(page);
    try {
      const documentArrived = page.waitForResponse(
        (response) =>
          response.request().isNavigationRequest() && response.url().endsWith('/programs'),
      );
      const second = gotoHydrated(page, consoleGuard, '/programs');
      const state = trackSettled(second);
      await documentArrived;
      await page.waitForTimeout(STILL_PENDING_MS);
      expect(state.settled).toBe(false);
      expect(consoleGuard.hydrationCount(page)).toBe(1);

      release();
      await second;
      expect(consoleGuard.hydrationCount(page)).toBe(2);
    } finally {
      release();
    }
  });

  test('another page that hydrates does not satisfy the wait of a page whose document is held', async ({
    context,
    page,
    consoleGuard,
  }) => {
    await gotoHydrated(page, consoleGuard, '/');
    const release = await holdScripts(page);
    try {
      const after = consoleGuard.hydrationCount(page);
      const documentArrived = page.waitForResponse(
        (response) =>
          response.request().isNavigationRequest() && response.url().endsWith('/programs'),
      );
      void page.goto('/programs').catch(() => undefined);
      const waiting = hydrated(consoleGuard, { page, after });
      const state = trackSettled(waiting);
      await documentArrived;

      const other = await context.newPage();
      await gotoHydrated(other, consoleGuard, '/');
      expect(consoleGuard.hydrationCount(other)).toBe(1);
      await page.waitForTimeout(STILL_PENDING_MS);
      expect(state.settled).toBe(false);
      expect(consoleGuard.hydrationCount(page)).toBe(after);

      release();
      await waiting;
      expect(consoleGuard.hydrationCount(page)).toBe(after + 1);
    } finally {
      release();
    }
  });

  test('gotoHydrated refuses a URL that differs from the current one only by its fragment', async ({
    page,
    consoleGuard,
  }) => {
    await gotoHydrated(page, consoleGuard, '/programs');
    await expect(gotoHydrated(page, consoleGuard, '/programs#results')).rejects.toThrow(
      'expected a new document',
    );
  });
});
