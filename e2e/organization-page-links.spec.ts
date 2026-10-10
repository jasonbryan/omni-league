// Tester probes for #95 (PR #120): the query-keeping same-path links of the organization page,
// beyond the implementer's league-2 / location-3 jumps: the last row of a tall page below the
// offline note, modified clicks, a repeated click, and several query strings.
import type { Locator, Page, TestInfo } from '@playwright/test';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { numberedLocations, seedTenant } from './support/tenant';

test.skip(
  remoteBaseUrl !== undefined,
  'E2E_BASE_URL is set: no local Convex backend to seed a tenant',
);

const isDesktop = (testInfo: TestInfo) => testInfo.project.name === 'chromium-desktop';

const LAST = 10;

function tallTenant() {
  return seedTenant({
    locations: numberedLocations(LAST),
    leagues: [
      { name: 'Alpha League', sport: 'soccer', locations: ['Location 01'] },
      { name: 'Beta League', sport: 'softball', locations: ['Location 02', 'Location 03'] },
    ],
  });
}

async function hydrated(consoleGuard: { hydrated: boolean }): Promise<void> {
  await expect.poll(() => consoleGuard.hydrated).toBe(true);
}

const marker = (page: Page) =>
  page.evaluate(() => (window as Window & { e2eNoReload?: boolean }).e2eNoReload);

async function arm(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    (window as Window & { e2eNoReload?: boolean }).e2eNoReload = true;
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

const rowTop = (row: Locator) => row.evaluate((el) => el.getBoundingClientRect().top);

/** A tap at the control's coordinates in Chromium; the keyboard in WebKit, where a tap does not focus. */
async function tap(page: Page, control: Locator): Promise<void> {
  if (page.context().browser()?.browserType().name() === 'webkit') {
    await control.focus();
    await page.keyboard.press('Enter');
    return;
  }
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  if (!box) throw new Error('control has no box');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('organization page links (#95, tester probes)', () => {
  test('the last row of a tall page lands below the top bar and the offline note, query kept', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    const tenant = await tallTenant();
    const desktop = isDesktop(testInfo);
    const menuButton = page.getByRole('button', { name: 'Open navigation' });
    const dialog = page.getByRole('dialog', { name: 'Navigation' });
    await page.goto(`${tenant.path}?utm_source=x`);
    await hydrated(consoleGuard);
    await arm(page);
    if (!desktop) {
      // The sheet's chunk loads while online; setOffline blocks every request.
      await tap(page, menuButton);
      await expect(dialog.locator('[data-slot="sheet-content"]')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }
    const note = page.locator('header + [role="status"]').locator('[data-offline-note]');
    await context.setOffline(true);
    await expect(note).toBeVisible({ timeout: 2_000 });
    const lengthBefore = await page.evaluate(() => history.length);

    const row = page.locator(`main #location-${LAST}`);
    expect(await rowTop(row)).toBeGreaterThan(page.viewportSize()!.height);
    const href = `${tenant.path}#location-${LAST}`;
    if (desktop) {
      await page
        .getByRole('navigation', { name: tenant.name })
        .locator(`a[href="${href}"]`)
        .click();
    } else {
      await tap(page, menuButton);
      await expect(dialog.locator('[data-slot="sheet-content"]')).toBeVisible();
      await tap(page, dialog.locator(`a[href="${href}"]`));
      await expect(dialog).toHaveCount(0);
    }

    await expect(page).toHaveURL(`${tenant.path}?utm_source=x#location-${LAST}`);
    const noteBottom = (await note.boundingBox())!.y + (await note.boundingBox())!.height;
    const headerBottom = (await page.locator('header').boundingBox())!.y + 56;
    await expect.poll(() => rowTop(row)).toBeGreaterThanOrEqual(noteBottom);
    expect(noteBottom).toBeGreaterThan(headerBottom);
    expect(await rowTop(row)).toBeLessThan(page.viewportSize()!.height);
    expect(await page.evaluate(() => history.length)).toBe(lengthBefore + 1);
    expect(await marker(page)).toBe(true);
    await context.setOffline(false);
  });

  test('1280: a modified click or the middle button does no router navigation and keeps the page', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(!isDesktop(testInfo), 'the sidebar column shows at 1280px only');
    const tenant = await tallTenant();
    await page.goto(`${tenant.path}?utm_source=x`);
    await hydrated(consoleGuard);
    await arm(page);
    const url = page.url();
    const lengthBefore = await page.evaluate(() => history.length);
    const link = page
      .getByRole('navigation', { name: tenant.name })
      .locator(`a[href="${tenant.path}#league-2"]`);
    for (const options of [
      { modifiers: ['Control' as const] },
      { modifiers: ['Meta' as const] },
      { modifiers: ['Shift' as const] },
      { modifiers: ['Alt' as const] },
      { button: 'middle' as const },
    ]) {
      const opened = page
        .context()
        .waitForEvent('page', { timeout: 1_500 })
        .catch(() => null);
      await link.click(options);
      const popup = await opened;
      await popup?.close();
      expect(page.url(), JSON.stringify(options)).toBe(url);
      expect(await page.evaluate(() => history.length), JSON.stringify(options)).toBe(lengthBefore);
      expect(await marker(page), JSON.stringify(options)).toBe(true);
    }
  });

  test('1280: ?ott= and ?utm_source= are both kept; a repeated click scrolls back and adds no entry', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(!isDesktop(testInfo), 'the sidebar column shows at 1280px only');
    const tenant = await tallTenant();
    const search = '?ott=abc123&utm_source=x';
    await page.goto(`${tenant.path}${search}`);
    await hydrated(consoleGuard);
    await arm(page);
    const link = page
      .getByRole('navigation', { name: tenant.name })
      .locator(`a[href="${tenant.path}#location-${LAST}"]`);
    const row = page.locator(`main #location-${LAST}`);
    const lengthBefore = await page.evaluate(() => history.length);

    await link.click();
    await expect(page).toHaveURL(`${tenant.path}${search}#location-${LAST}`);
    await expect.poll(() => rowTop(row)).toBeLessThan(page.viewportSize()!.height);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => rowTop(row)).toBeGreaterThan(page.viewportSize()!.height);

    await link.click();
    await expect.poll(() => rowTop(row)).toBeLessThan(page.viewportSize()!.height);
    expect(await rowTop(row)).toBeGreaterThanOrEqual(56);
    expect(page.url()).toBe(
      `${new URL(page.url()).origin}${tenant.path}${search}#location-${LAST}`,
    );
    expect(await page.evaluate(() => history.length)).toBe(lengthBefore + 1);
    expect(await marker(page)).toBe(true);
  });

  test('1280: a page loaded with a hash and a query string keeps the query and replaces the hash', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(!isDesktop(testInfo), 'the sidebar column shows at 1280px only');
    const tenant = await tallTenant();
    await page.goto(`${tenant.path}?utm_source=x#league-1`);
    await hydrated(consoleGuard);
    await arm(page);
    await page
      .getByRole('navigation', { name: tenant.name })
      .locator(`a[href="${tenant.path}#location-3"]`)
      .click();
    await expect(page).toHaveURL(`${tenant.path}?utm_source=x#location-3`);
    expect(await marker(page)).toBe(true);
  });
});
