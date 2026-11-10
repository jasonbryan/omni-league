import type { Page } from '@playwright/test';
import { baseURL } from './env';

/**
 * A returning visitor's service worker answers every navigation with the client shell, so the
 * page renders in the browser with no server-rendered content to keep.
 */
export async function answerWithClientShell(page: Page, path: string): Promise<void> {
  // The fulfilled document has no address space, so Chromium would block its socket to the local backend.
  await page.context().grantPermissions(['local-network-access']);
  await page.route(`${baseURL}${path}`, async (route) => {
    if (!route.request().isNavigationRequest()) return route.fallback();
    const shell = await route.fetch({ url: `${baseURL}/index.csr.html` });
    return route.fulfill({ response: shell });
  });
}
