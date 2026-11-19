import type { Page, Response } from '@playwright/test';
import type { ConsoleGuard } from './console-guard';
import { expect } from './fixtures';

type HydrationLog = Pick<ConsoleGuard, 'hydrated' | 'hydrationCount'>;

export type HydratedOptions =
  { page?: undefined; after?: undefined } | { page: Page; after?: number };

/**
 * Angular replays a click made before hydration but does not stop the browser following the
 * server-rendered `href`. With `page`, the wait is for that page's hydration number `after + 1`:
 * read `hydrationCount(page)` before a hard load, so a later document is not satisfied by an
 * earlier one, or by another page in the context. Without it, any hydration of any page counts.
 */
export async function hydrated(
  consoleGuard: HydrationLog,
  { page, after = 0 }: HydratedOptions = {},
): Promise<void> {
  if (page === undefined) {
    await expect
      .poll(() => consoleGuard.hydrated, {
        message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
      })
      .toBe(true);
    return;
  }
  await expect
    .poll(() => consoleGuard.hydrationCount(page), {
      message: `expected the dev-mode log "Angular hydrated <n> component(s)" from this page after its ${after} earlier one(s)`,
    })
    .toBeGreaterThan(after);
}

/** Loads a new document and waits for this page to hydrate it. */
export async function gotoHydrated(
  page: Page,
  consoleGuard: HydrationLog,
  url: string,
  options?: Parameters<Page['goto']>[1],
): Promise<Response> {
  const after = consoleGuard.hydrationCount(page);
  const from = page.url();
  const response = await page.goto(url, options);
  if (response === null) {
    throw new Error(
      `expected a new document: going from ${from} to ${url} is a same-document navigation`,
    );
  }
  await hydrated(consoleGuard, { page, after });
  return response;
}
