import type { Locator, Page, TestInfo } from '@playwright/test';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { seedTenant, tallLocations } from './support/tenant';

test.skip(
  remoteBaseUrl !== undefined,
  'E2E_BASE_URL is set: no local Convex backend to seed a tenant',
);

const isDesktop = (testInfo: TestInfo) => testInfo.project.name === 'chromium-desktop';

const LAST = 5;

function tallTenant() {
  return seedTenant({
    locations: tallLocations(),
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

test.describe('organization page links', () => {
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

  test('1280: a modified click or the middle button is left to the browser: no router navigation, the page stays', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(!isDesktop(testInfo), 'the sidebar column shows at 1280px only');
    const tenant = await tallTenant();
    await page.goto(`${tenant.path}?utm_source=x`);
    await hydrated(consoleGuard);
    await arm(page);
    // What a modified click does natively depends on the platform (Ctrl+click opens a tab on Linux
    // and Windows, Cmd+click on macOS), so the test does not rely on the browser's default action.
    // A window listener, which runs after the app's handlers, records whether the app cancelled the
    // event, then cancels it itself so no platform follows the link.
    await page.evaluate(() => {
      const seen: { type: string; defaultPrevented: boolean }[] = [];
      (window as Window & { e2eClicks?: typeof seen }).e2eClicks = seen;
      for (const type of ['click', 'auxclick']) {
        window.addEventListener(type, (event) => {
          seen.push({ type, defaultPrevented: event.defaultPrevented });
          event.preventDefault();
        });
      }
    });
    const url = page.url();
    const lengthBefore = await page.evaluate(() => history.length);
    const link = page
      .getByRole('navigation', { name: tenant.name })
      .locator(`a[href="${tenant.path}#league-2"]`);
    // On macOS, Ctrl+click is a secondary click (a context menu), so the page gets no click event.
    const mac = await page.evaluate(() => navigator.userAgent.includes('Macintosh'));
    const cases = [
      { modifiers: ['Control' as const], type: mac ? undefined : 'click' },
      { modifiers: ['Meta' as const], type: 'click' },
      { modifiers: ['Shift' as const], type: 'click' },
      { modifiers: ['Alt' as const], type: 'click' },
      { button: 'middle' as const, type: 'auxclick' },
    ];
    const expected: { type: string; defaultPrevented: boolean }[] = [];
    for (const { type, ...options } of cases) {
      const label = JSON.stringify(options);
      await link.click(options);
      if (type) expected.push({ type, defaultPrevented: false });
      const seen = await page.evaluate(
        () =>
          (window as Window & { e2eClicks?: { type: string; defaultPrevented: boolean }[] })
            .e2eClicks,
      );
      expect(seen, label).toEqual(expected);
      expect(page.url(), label).toBe(url);
      expect(await page.evaluate(() => history.length), label).toBe(lengthBefore);
      expect(await marker(page), label).toBe(true);
    }
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await link.click();
    await expect(page).toHaveURL(`${tenant.path}?utm_source=x#league-2`);
    expect(await marker(page)).toBe(true);
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
