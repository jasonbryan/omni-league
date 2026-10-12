/**
 * Viewport-agnostic tests (#181): tests whose result does not depend on the screen size run in
 * one Chromium project, not both, to save CI minutes. Pass `VIEWPORT_AGNOSTIC` as the details of
 * a test or of a `test.describe`:
 *
 *   test('an expired stored session token is signed out', VIEWPORT_AGNOSTIC, async ({ page }) => { … });
 *   test.describe('auth session store', VIEWPORT_AGNOSTIC, () => { … });
 *
 * `playwright.config.ts` then leaves the tagged tests out of `chromium-mobile` (see
 * {@link projectFilter}), so `--list` shows each once per remaining project. `chromium-desktop`
 * runs them, and so does `webkit-mobile` on release runs, because that project exists to catch
 * browser-engine differences and a tagged test still uses a browser.
 *
 * Tag a test only when it checks behaviour that does not depend on the viewport: backend and
 * security probes, token handling, throttling, the session store, permissions, redirects, cache
 * headers, harness self-tests. Keep it untagged, so it runs at both widths, when it checks
 * layout, accessibility (axe, Tab order, reflow), screenshots, focus, or responsive behaviour.
 * `scripts/e2e-viewport-agnostic.test.mjs` fails a tagged test that calls axe, a screenshot,
 * `checkReflow`, a viewport size, an element position (`boundingBox`, `toBeInViewport`), or a
 * focus check (`toBeFocused`, `document.activeElement`, a `'Tab'` key press), directly, through a
 * helper, or in a hook that runs around the test.
 *
 * Tests that open no page at all use `RAW_HTTP` instead (e2e/support/raw-http.ts), which runs in
 * `chromium-desktop` only.
 *
 * Imported by `playwright.config.ts`, so it imports nothing from `@playwright/test`.
 */
import { RAW_HTTP, RAW_HTTP_PROJECT } from './raw-http';

const VIEWPORT_AGNOSTIC_TAG = '@viewport-agnostic';

/** Test details for a viewport-agnostic test: `test(title, VIEWPORT_AGNOSTIC, body)`. */
export const VIEWPORT_AGNOSTIC = { tag: VIEWPORT_AGNOSTIC_TAG } as const;

/** The only project that does not run viewport-agnostic tests: the phone-width Chromium one. */
export const VIEWPORT_AGNOSTIC_SKIPPED_PROJECT = 'chromium-mobile';

/**
 * The project setting that leaves tagged tests out of the project `name`: one `grepInvert`
 * covering both tags. Raw-HTTP tests run only in {@link RAW_HTTP_PROJECT}; viewport-agnostic tests
 * run in every project except {@link VIEWPORT_AGNOSTIC_SKIPPED_PROJECT}.
 */
export function projectFilter(name: string): { grepInvert?: RegExp } {
  const tags: string[] = [];
  if (name !== RAW_HTTP_PROJECT) tags.push(RAW_HTTP.tag);
  if (name === VIEWPORT_AGNOSTIC_SKIPPED_PROJECT) tags.push(VIEWPORT_AGNOSTIC_TAG);
  return tags.length === 0 ? {} : { grepInvert: new RegExp(`(?:${tags.join('|')})\\b`) };
}
