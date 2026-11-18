import type { ConsoleGuard } from './console-guard';
import { expect } from './fixtures';

/**
 * Waits for the dev-mode log "Angular hydrated <n> component(s)". Until then the page's click
 * handlers are not attached, and a click follows the server-rendered `href`, which has no query
 * string or fragment.
 */
export async function hydrated(consoleGuard: Pick<ConsoleGuard, 'hydrated'>): Promise<void> {
  await expect
    .poll(() => consoleGuard.hydrated, {
      message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
    })
    .toBe(true);
}
