import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { expect, test } from './support/fixtures';

const CHUNK = /^\/chunk-[\w-]+\.js$/;

/**
 * The page-unavailable view loads after the first page, once the app is stable. Its chunk names the
 * view's selector, so the response that carries it shows the view is on the device.
 */
function viewLoaded(page: Page) {
  return page.waitForResponse(
    async (response) =>
      CHUNK.test(new URL(response.url()).pathname) &&
      (await response.text()).includes('app-page-unavailable-page'),
  );
}

test.describe('a page that cannot load', () => {
  test('offline, a link to a page not on the device shows the not-saved view at that address', async ({
    page,
    context,
  }) => {
    const loaded = viewLoaded(page);
    await page.goto('/');
    await loaded;
    await context.setOffline(true);

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
    await context.setOffline(false);
  });
});
