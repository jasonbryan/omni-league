import type { BrowserContext } from '@playwright/test';

/**
 * Keeps the service worker out of the pages of `context`: `navigator.serviceWorker.register`
 * returns a promise that never settles, so no worker installs and none controls the page.
 *
 * Remote runs (`E2E_BASE_URL`) test a production build, which registers Angular's service worker
 * as soon as the app is stable (ADR 0013, #81). Once it controls the page, the worker makes the
 * page's cross-origin fetches itself, and `page.route` and the page's `request` events no longer
 * see them (Playwright, "Service Workers"). Specs that intercept or count the page's own requests
 * (`auth-session`, `sign-up`) therefore call this on remote runs; `pwa.spec.ts` tests the worker.
 *
 * It does not use Playwright's `serviceWorkers: 'block'`, which logs a `console.warn` on every
 * page that the console fixture would report. Local e2e builds register no worker, so it changes
 * nothing there.
 */
export async function holdServiceWorkerRegistration(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const container = navigator.serviceWorker as ServiceWorkerContainer | undefined;
    if (!container) return;
    Object.defineProperty(container, 'register', {
      configurable: true,
      value: () => new Promise<ServiceWorkerRegistration>(() => undefined),
    });
  });
}
