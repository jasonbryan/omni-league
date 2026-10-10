// Offline note and connection signal (#88, ADR 0013 section 3) against the real ConvexClient and
// the local backend (#59): one test, one page load, chromium-mobile only. `page.clock` skips the
// 5-second wait and the client's reconnect back-off, so the test takes a few seconds of real time.
// It needs the local backend and the development build, so it is skipped with E2E_BASE_URL set.
import type { Page } from '@playwright/test';
import { axeScan, describeViolations } from './support/a11y';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { seedTenant } from './support/tenant';

const CONVEX_SOCKET = /\/api\/[^/]+\/sync$/;

/** Waits for the Convex client's first failed connect, logged as "Attempting reconnect in …". */
async function firstReconnectLogged(consoleGuard: { logMessages: readonly string[] }) {
  await expect
    .poll(() => consoleGuard.logMessages.some((text) => text.startsWith('Attempting reconnect')))
    .toBe(true);
}

async function scrollPaddingTop(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop);
}

test.describe('offline note', () => {
  test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: needs the local Convex backend');
  test('shows while the socket is refused or the browser is offline, and clears when it returns', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium-mobile',
      'one browser project only (ADR 0013, CI minutes)',
    );
    const tenant = await seedTenant({
      locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
      leagues: [{ name: 'Alpha League', sport: 'soccer', locations: ['Alpha Field'] }],
    });
    const status = page.locator('header + [role="status"]');
    const note = status.locator('[data-offline-note]');

    // Field wifi with no internet: every Convex socket is closed at once while navigator.onLine
    // stays true. The handler never calls connectToServer() while refusing: Playwright would
    // otherwise open a mocked socket, which counts as connected. Playwright has no unroute for
    // WebSocket routes, so "unrouting" switches the handler to pass sockets to the server.
    let refuse = true;
    await page.routeWebSocket(CONVEX_SOCKET, (ws) => {
      if (refuse) {
        void ws.close();
      } else {
        ws.connectToServer();
      }
    });
    await page.clock.install();

    // Step 1: the note shows within 10 s of fake time.
    await page.goto(tenant.path);
    await firstReconnectLogged(consoleGuard);
    await expect(note).toBeHidden();
    await page.clock.fastForward(5_000);
    await expect(note).toBeVisible();
    await expect(note).toHaveText("You're offline. Changes need a connection.");
    expect(await scrollPaddingTop(page)).toBe('108px');

    // Step 2: once sockets reach the server again, the note clears within 10 s of fake time.
    // Each fast-forward fires the client's pending reconnect at most once.
    refuse = false;
    await page.clock.fastForward(10_000);
    await expect(note).toBeHidden();
    await expect(status).toHaveText('Back online.');
    expect(await scrollPaddingTop(page)).toBe('72px');

    // Step 3: the browser goes offline; the note shows at once.
    await context.setOffline(true);
    await expect(note).toBeVisible({ timeout: 2_000 });

    // The note at 360px and 1280px: zero axe violations; screenshots for the mockup comparison.
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: width === 360 ? 800 : 720 });
      await expect(note).toBeVisible();
      const results = await axeScan(page);
      expect(describeViolations(results.violations), `axe violations at ${width}px`).toEqual([]);
      const path = testInfo.outputPath(`offline-note-${width}.png`);
      await page.screenshot({ path });
      await testInfo.attach(`offline-note-${width}.png`, { path, contentType: 'image/png' });
    }
    await page.setViewportSize({ width: 360, height: 800 });

    // Step 4: back online; the client reconnects at once on the browser's `online` event.
    await context.setOffline(false);
    await page.clock.fastForward(10_000);
    await expect(note).toBeHidden();
  });
});
