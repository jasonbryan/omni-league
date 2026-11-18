import type { ConsoleGuard } from './console-guard';
import { expect } from './fixtures';

/** Angular replays a click made before hydration but does not stop the browser following the server-rendered `href`. */
export async function hydrated(consoleGuard: Pick<ConsoleGuard, 'hydrated'>): Promise<void> {
  await expect
    .poll(() => consoleGuard.hydrated, {
      message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
    })
    .toBe(true);
}
