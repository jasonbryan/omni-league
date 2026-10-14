import type { BrowserContext } from '@playwright/test';

/**
 * The script Netlify injects into the HTML of Deploy Previews and branch deploys to load the
 * Netlify Drawer, a review toolbar in an iframe. It is not app markup, and the iframe fails the axe
 * helper's Tab walk (2.4.7), so remote runs (`E2E_BASE_URL`) stub it (`docs/process/hosting.md`,
 * "Smoke runs").
 */
export const NETLIFY_DRAWER_SCRIPT_PATH = '/.netlify/scripts/cdp';

/**
 * It is fulfilled rather than aborted: an aborted script logs a resource error, which the console
 * fixture would report. Every other request goes to the network unchanged.
 */
export async function stubNetlifyDrawer(context: BrowserContext): Promise<void> {
  await context.route(
    (url) => url.pathname === NETLIFY_DRAWER_SCRIPT_PATH,
    (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: '' }),
  );
}
