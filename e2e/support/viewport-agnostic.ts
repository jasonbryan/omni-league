/**
 * Tests whose result does not depend on the screen size run in one Chromium project, not both, to
 * save CI minutes. `webkit-mobile` on release runs also runs them: that project exists to catch
 * browser-engine differences, and a tagged test still uses a browser.
 *
 * Imported by `playwright.config.ts`, so it imports nothing from `@playwright/test`.
 */
import { RAW_HTTP, RAW_HTTP_PROJECT } from './raw-http';

const VIEWPORT_AGNOSTIC_TAG = '@viewport-agnostic';

export const VIEWPORT_AGNOSTIC = { tag: VIEWPORT_AGNOSTIC_TAG } as const;

export const VIEWPORT_AGNOSTIC_SKIPPED_PROJECT = 'chromium-mobile';

export function projectFilter(name: string): { grepInvert?: RegExp } {
  const tags: string[] = [];
  if (name !== RAW_HTTP_PROJECT) tags.push(RAW_HTTP.tag);
  if (name === VIEWPORT_AGNOSTIC_SKIPPED_PROJECT) tags.push(VIEWPORT_AGNOSTIC_TAG);
  return tags.length === 0 ? {} : { grepInvert: new RegExp(`(?:${tags.join('|')})\\b`) };
}
