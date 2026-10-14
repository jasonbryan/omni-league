// Tests sign a user up and seed an organization, so they need the local Convex backend.
import type { Locator, Page } from '@playwright/test';
import { describeViolations, axeScan } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
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
  // The admin area is a Client route: the browser renders it, so there is no hydration log to wait for.
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

  // The first press creates the sheet on the loaded page. In a development build that
  // creation logged "no hydration info available for a given TNode" while the shell's template
  // held a view container; the console fixture fails the test on any warning.
  test('320: the first press on the loaded page opens it with no console warning', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await openAdminOverview(page);
    await activate(page, menuButton(page));
    await expect(dialogOf(page).locator('[data-slot="sheet-content"]')).toBeVisible();
    await expect(dialogOf(page).getByRole('button', { name: 'Close navigation' })).toBeFocused();
    expect(await page.locator('app-shell-sheet').count()).toBe(0);
  });

  // The sheet is created outside the shell's template. A navigation that replaces the page
  // while the sheet is open leaves no dialog, scrim, or scroll block on the next page. That the
  // shell destroys the sheet's ComponentRef is asserted in shell.spec.ts.
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
      document.querySelector<HTMLAnchorElement>('header a[href="/"]')?.click();
    });
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(menuButton(page)).toHaveCount(0);
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

  // The sheet opens and closes while the offline note shows. The sheet's chunk is
  // loaded by a first press while online, because `setOffline` blocks every request, the chunk's
  // included. The sheet is created outside the shell's template, so the note above it (a sibling
  // of the top bar) must stay where it is, and the sheet must still open at 288px with focus on
  // Close, close on Escape, and return focus to the menu button.
  test('opens and closes while the offline note shows, with no console warning', async ({
    page,
    context,
  }) => {
    await openAdminOverview(page);
    const sheet = dialogOf(page).locator('[data-slot="sheet-content"]');
    const note = page.locator('header + [role="status"]').locator('[data-offline-note]');

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
    // The tab walk of expectAccessible does not apply to an open modal: axe only.
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
});
