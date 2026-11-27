import { expectAccessible } from './support/a11y';
import { expectBadges, SIGNED_IN_BADGE_HEIGHT } from './support/badges';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdServiceWorkerRegistration } from './support/no-service-worker';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { newUser } from './support/users';

const NOTIFICATIONS_PATH = '/app/notifications';
const TOUCH_TARGET = 44;

test.describe('notifications on this device', () => {
  test.beforeEach(async ({ context }) => {
    if (remoteBaseUrl) await holdServiceWorkerRegistration(context);
  });

  test('the e2e build has no worker and no VAPID key, so the page shows Not available and passes axe', async ({
    page,
  }, testInfo) => {
    let permissionRequests = 0;
    await page.exposeFunction('countPermissionRequest', () => permissionRequests++);
    await page.addInitScript(() => {
      // Playwright WebKit on Linux has no Notification global.
      if (!('Notification' in window)) return;
      const request = Notification.requestPermission.bind(Notification);
      Notification.requestPermission = (...args) => {
        void (window as unknown as { countPermissionRequest: () => void }).countPermissionRequest();
        return request(...args);
      };
    });
    const user = newUser('Notifications');
    await signUp(page, user);

    const manage = page.getByRole('link', { name: 'Manage notifications' });
    await expect(manage).toBeVisible();
    if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) {
      expect((await manage.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET);
    }
    await manage.click();
    await expect(page).toHaveURL(`${baseURL}${NOTIFICATIONS_PATH}`);
    await expect(page).toHaveTitle('Notifications | Omni League');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notifications');

    const device = page.getByRole('region', { name: 'This device' });
    await expect(device).toContainText('Not available');
    await expectBadges(device.locator('[data-slot="badge"]'), SIGNED_IN_BADGE_HEIGHT);
    await expect(device).toContainText("This browser can't show notifications from Omni League.");
    await expect(device.getByRole('button')).toHaveCount(0);
    await expect(
      page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Home' }),
    ).toHaveAttribute('href', '/app');

    await expectAccessible(page);
    await screenshot(page, testInfo, '83-notifications-not-available');
    expect(permissionRequests).toBe(0);
  });

  test('opened offline with no answer from the server, the card shows what this device holds and passes axe', async ({
    page,
    context,
  }, testInfo) => {
    await signUp(page, newUser('NotificationsOffline'));
    await page.getByRole('link', { name: 'Manage notifications' }).click();
    const device = page.getByRole('region', { name: 'This device' });
    await expect(device).toContainText('Not available');

    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Home' })
      .click();
    await expect(page).toHaveURL(`${baseURL}/app`);
    await context.setOffline(true);
    await page.goBack();
    await expect(page).toHaveURL(`${baseURL}${NOTIFICATIONS_PATH}`);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Notifications');
    await expect(device).toContainText('Not available');
    await expect(device).toContainText("This browser can't show notifications from Omni League.");
    await expect(device).not.toContainText('Checking');
    await expect(device.locator('.animate-pulse')).toHaveCount(0);
    await expect(page.locator('app-offline-note')).toContainText("You're offline");

    await expectAccessible(page);
    await screenshot(page, testInfo, '83-notifications-offline-opened');
  });
});
