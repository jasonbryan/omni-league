// Self-test of holdServiceWorkerRegistration (#62, PR #102 round 5). Locally the development build
// registers no worker, so the first test calls `register` itself; on a remote run (a production
// build that registers ngsw-worker.js) the second checks the app's own registration is held too.
import { remoteBaseUrl } from '../support/env';
import { expect, test } from '../support/fixtures';
import { holdServiceWorkerRegistration } from '../support/no-service-worker';

test.describe('holdServiceWorkerRegistration', () => {
  test('a register call never settles and installs nothing', async ({ context, page }) => {
    await holdServiceWorkerRegistration(context);
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const outcome = await Promise.race([
        navigator.serviceWorker.register('/ngsw-worker.js').then(
          () => 'registered',
          () => 'rejected',
        ),
        new Promise((resolve) => setTimeout(() => resolve('pending'), 1_000)),
      ]);
      return { outcome, registrations: (await navigator.serviceWorker.getRegistrations()).length };
    });
    expect(result).toEqual({ outcome: 'pending', registrations: 0 });
  });

  test('the app registers no worker and none controls the page', async ({ context, page }) => {
    test.skip(!remoteBaseUrl, 'only a production build registers the worker');
    await holdServiceWorkerRegistration(context);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
    // The app registers as soon as it is stable (ADR 0013); allow it time to have done so.
    await page.waitForTimeout(3_000);
    expect(
      await page.evaluate(async () => ({
        controlled: navigator.serviceWorker.controller !== null,
        registrations: (await navigator.serviceWorker.getRegistrations()).length,
      })),
    ).toEqual({ controlled: false, registrations: 0 });
  });
});
