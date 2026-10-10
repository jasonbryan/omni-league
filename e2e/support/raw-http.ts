/**
 * Raw-HTTP tests (#91): tests that send requests with `request` or `rawGet` and open no page.
 * Their result does not depend on the viewport or the browser, so they run in one project only,
 * to save CI minutes. Tag such a test with `RAW_HTTP` and `playwright.config.ts` leaves it out of
 * every other project, so `--list` shows it once:
 *
 *   test('a path … gets the plain 404', RAW_HTTP, async () => { … });
 *
 * Imported by `playwright.config.ts`, so it imports nothing from `@playwright/test`.
 */

/** The only project that runs raw-HTTP tests. */
export const RAW_HTTP_PROJECT = 'chromium-desktop';

const RAW_HTTP_TAG = '@raw-http';

/** Test details for a raw-HTTP test: `test(title, RAW_HTTP, body)`. */
export const RAW_HTTP = { tag: RAW_HTTP_TAG } as const;

/**
 * The project setting that leaves raw-HTTP tests out of the project `name`: a `grepInvert` for
 * every project except {@link RAW_HTTP_PROJECT}, nothing for that one.
 */
export function rawHttpProjectFilter(name: string): { grepInvert?: RegExp } {
  return name === RAW_HTTP_PROJECT ? {} : { grepInvert: new RegExp(`${RAW_HTTP_TAG}\\b`) };
}
