import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { expect, test } from './support/fixtures';

const CHUNK = /^\/chunk-[\w-]+\.js$/;

/**
 * The page-unavailable view loads once the app is stable. Its chunk names the view's selector, so the
 * response that carries it shows the view is on the device.
 */
function viewLoaded(page: Page) {
  return page.waitForResponse(
    async (response) =>
      CHUNK.test(new URL(response.url()).pathname) &&
      (await response.text()).includes('app-page-unavailable-page'),
  );
}

/**
 * `context.setOffline` makes the browser log each refused chunk as a network error, which the
 * console fixture cannot allow, so the browser reports offline while every chunk answers 503.
 */
async function goOffline(page: Page): Promise<void> {
  await page.route(
    (url) => CHUNK.test(url.pathname),
    (route) => route.fulfill({ status: 503, body: '' }),
  );
  await page.evaluate(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
    window.dispatchEvent(new Event('offline'));
  });
}

test.describe('a page that cannot load', () => {
  test.use({ expectedFailedRequests: [{ status: 503, path: CHUNK }] });

  test('offline, a link to a page not on the device shows the not-saved view at that address', async ({
    page,
  }) => {
    const loaded = viewLoaded(page);
    await page.goto('/');
    await loaded;
    await goOffline(page);

    await page.getByRole('contentinfo').getByRole('link', { name: 'Find a league' }).click();

    const heading = page.getByRole('heading', {
      level: 1,
      name: "This page isn't saved on this device",
    });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page).toHaveURL(/\/leagues$/);
    await expect(page.getByRole('main').getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/leagues',
    );
    await expectAccessible(page);
  });
});
