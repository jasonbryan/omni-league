/**
 * Raw-HTTP tests send requests with `request` or `rawGet` and open no page. Their result does not
 * depend on the viewport or the browser, so they run in one project only, to save CI minutes. Tag
 * such a test with `RAW_HTTP` and `playwright.config.ts` leaves it out of every other project
 * (`projectFilter` in e2e/support/viewport-agnostic.ts), so `--list` shows it once.
 *
 * Imported by `playwright.config.ts`, so it imports nothing from `@playwright/test`.
 */

export const RAW_HTTP_PROJECT = 'chromium-desktop';

const RAW_HTTP_TAG = '@raw-http';

export const RAW_HTTP = { tag: RAW_HTTP_TAG } as const;
