// Tests sign a user up and seed an organization, so they need the local Convex backend.
import type { Locator, Page } from '@playwright/test';
import { describeViolations, axeScan } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { overlayPanes } from './support/overlay';
import { signUp } from './support/session';
import { seedTenant } from './support/tenant';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

async function openAdminOverview(page: Page): Promise<void> {
  const user = newUser('Sheet');
  await signUp(page, user);
  const tenant = await seedTenant({ name: 'E2E Sheet' });
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });
  await page.goto(`/app/organizations/${tenant.slug}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(menuButton(page)).toBeVisible();
}

async function makeTall(page: Page): Promise<void> {
  await page.locator('main').evaluate((main) => {
    const spacer = document.createElement('div');
    spacer.style.height = '2000px';
    main.append(spacer);
  });
}

async function activate(page: Page, control: Locator): Promise<void> {
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  if (!box) throw new Error('control has no box');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

const dialogOf = (page: Page) => page.getByRole('dialog', { name: 'Navigation' });
const menuButton = (page: Page) => page.getByRole('button', { name: 'Open navigation' });

test.describe('the phone sheet on the admin area', () => {
  test.skip(({ isMobile }) => !isMobile, 'the phone sheet runs at phone widths only');

  test('320: the first press on the loaded page opens it in the overlay container, not the popover top layer, with no console warning', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await openAdminOverview(page);
    await activate(page, menuButton(page));
    await expect(dialogOf(page).locator('[data-slot="sheet-content"]')).toBeVisible();
    expect(await overlayPanes(page)).toEqual([{ inContainer: true, inPopover: false }]);
    await expect(dialogOf(page).getByRole('button', { name: 'Close navigation' })).toBeFocused();
    expect(await page.locator('app-shell-sheet').count()).toBe(0);
  });

  test('a navigation away while it is open leaves no overlay or scroll block', async ({ page }) => {
    await openAdminOverview(page);
    await makeTall(page);
    await activate(page, menuButton(page));
    await expect(dialogOf(page).locator('[data-slot="sheet-content"]')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains('cdk-global-scrollblock')),
      )
      .toBe(true);

    await page.evaluate(() => {
      document.querySelector<HTMLAnchorElement>('nav a[href="/app"]')?.click();
    });
    await expect(page).toHaveURL(`${baseURL}/app`);
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(page.locator('.cdk-overlay-backdrop')).toHaveCount(0);
    await expect(page.locator('.cdk-overlay-pane')).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        document.documentElement.classList.contains('cdk-global-scrollblock'),
      ),
    ).toBe(false);
    expect(await page.locator('app-shell-sheet, hlm-sheet').count()).toBe(0);
  });

  test('opens and closes while the offline note shows, with no console warning', async ({
    page,
    context,
  }) => {
    await openAdminOverview(page);
    const sheet = dialogOf(page).locator('[data-slot="sheet-content"]');
    const note = page.locator('header + [role="status"]').locator('[data-offline-note]');

    // The first press loads the sheet's chunk while online: setOffline blocks that request too.
    await activate(page, menuButton(page));
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialogOf(page)).toHaveCount(0);

    await context.setOffline(true);
    await expect(note).toBeVisible({ timeout: 2_000 });
    const noteBefore = await note.boundingBox();

    await activate(page, menuButton(page));
    await expect(sheet).toBeVisible();
    await expect(dialogOf(page).getByRole('button', { name: 'Close navigation' })).toBeFocused();
    await sheet.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished)),
    );
    expect((await sheet.boundingBox())?.width).toBe(288);
    await expect(note).toBeVisible();
    expect(await note.boundingBox()).toEqual(noteBefore);
    expect(await page.locator('app-shell-sheet').count()).toBe(0);
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(menuButton(page)).toBeFocused();
    await expect(note).toBeVisible();
    await expect(page.locator('.cdk-overlay-backdrop')).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        document.documentElement.classList.contains('cdk-global-scrollblock'),
      ),
    ).toBe(false);

    await activate(page, menuButton(page));
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialogOf(page)).toHaveCount(0);
  });

  test('keeps Tab inside the open sheet, and closing it leaves the page scrolled where it was', async ({
    page,
  }) => {
    await openAdminOverview(page);
    // The tiles arrive from separate queries and shift the layout until all three show a count.
    await expect(page.locator('main dd.tabular-nums')).toHaveCount(3);
    await makeTall(page);
    await expect
      .poll(async () => {
        await page.evaluate(() => window.scrollTo(0, 300));
        return page.evaluate(() => window.scrollY);
      })
      .toBe(300);
    const close = dialogOf(page).getByRole('button', { name: 'Close navigation' });
    const closers: [string, () => Promise<void>][] = [
      ['Escape', () => page.keyboard.press('Escape')],
      ['Close', () => activate(page, close)],
      ['the scrim', () => page.touchscreen.tap(340, 400)],
    ];
    for (const [how, closeSheet] of closers) {
      await activate(page, menuButton(page));
      await expect(close).toBeFocused();
      await closeSheet();
      await expect(dialogOf(page), how).toHaveCount(0);
      await expect(menuButton(page), how).toBeFocused();
      expect(await page.evaluate(() => window.scrollY), how).toBe(300);
    }

    await activate(page, menuButton(page));
    await expect(close).toBeFocused();
    const insideDialog = () =>
      page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    const stops = (await dialogOf(page).locator('a[href], button').count()) + 2;
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < stops; i++) {
        await page.keyboard.press(key);
        expect(await insideDialog(), `${key} #${i + 1}`).toBe(true);
      }
    }
  });
});
