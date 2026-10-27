// The Details page: City, state saved, undone, and checked. Each test signs up its own user and
// seeds its own organization, so the tests need the local Convex backend and are skipped with
// E2E_BASE_URL set.
import type { Locator, Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { seedTenant } from './support/tenant';
import { newUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const CITY_STATE_MESSAGE = 'Use 2 to 60 characters, such as Corpus Christi, TX.';

type Role = 'orgAdmin' | 'leagueOrganizer';

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;
const main = (page: Page) => page.getByRole('main');
const field = (page: Page) => page.locator('#cityState');
const fieldError = (page: Page) => page.locator('#cityState-error');
const saveButton = (page: Page) => page.getByRole('button', { name: /^Sav(e|ing)/ });
const undoButton = (page: Page) => page.getByRole('button', { name: /^Undo/ });
const status = (page: Page) =>
  main(page)
    .getByRole('status')
    .filter({ hasText: /Details/ });

async function openDetails(page: Page, role: Role | null, cityState?: string) {
  const user = newUser('Details');
  await signUp(page, user);
  const tenant = await seedTenant({
    name: 'E2E Details',
    ...(cityState !== undefined && { cityState }),
  });
  if (role) {
    await convexRun('testing:addMembership', {
      organizationSlug: tenant.slug,
      email: user.email,
      role,
    });
  }
  const base = `/app/organizations/${tenant.slug}`;
  await page.goto(`${base}/details`);
  return { tenant, base };
}

async function adminNav(page: Page, organizationName: string): Promise<Locator> {
  if (isDesktop(page)) return page.getByRole('navigation', { name: `${organizationName} admin` });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Navigation' });
  await expect(dialog.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  return dialog.getByRole('navigation', { name: `${organizationName} admin` });
}

test.describe('the Details page', () => {
  test('saves City, state with a status and Undo, and Undo restores the earlier value', async ({
    page,
  }, testInfo) => {
    const { tenant } = await openDetails(page, 'orgAdmin', 'Corpus Christi, TX');
    await expect(main(page).getByRole('heading', { level: 1, name: 'Details' })).toBeVisible();
    await expect(page).toHaveTitle(`Details | ${tenant.name} | Omni League`);
    await expect(page.locator('#name')).toHaveValue(tenant.name);
    await expect(page.locator('#name')).toHaveJSProperty('readOnly', true);
    await expect(field(page)).toHaveValue('Corpus Christi, TX');

    await field(page).fill('  Austin,   TX ');
    await saveButton(page).click();
    await expect(status(page)).toContainText('Details saved.');
    await expect(status(page)).toBeFocused();
    await expect(field(page)).toHaveValue('Austin, TX');
    await screenshot(page, testInfo, '248-details-saved');
    await expectAccessible(page);

    await page.goto(tenant.path);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
      'content',
      /in Austin, TX\.$/,
    );
  });

  test('Undo puts back the value from before the save', async ({ page }) => {
    await openDetails(page, 'orgAdmin', 'Corpus Christi, TX');
    await field(page).fill('Austin, TX');
    await saveButton(page).click();
    await expect(status(page)).toContainText('Details saved.');
    await undoButton(page).click();
    await expect(status(page)).toContainText('Details restored.');
    await expect(field(page)).toHaveValue('Corpus Christi, TX');
    await page.reload();
    await expect(field(page)).toHaveValue('Corpus Christi, TX');
  });

  test('a blank value removes it, and Undo brings it back', async ({ page }) => {
    await openDetails(page, 'orgAdmin', 'Corpus Christi, TX');
    await field(page).fill('');
    await saveButton(page).click();
    await expect(status(page)).toContainText('Details saved.');
    await page.reload();
    await expect(field(page)).toHaveValue('');
    await field(page).fill('Austin, TX');
    await saveButton(page).click();
    await undoButton(page).click();
    await expect(status(page)).toContainText('Details restored.');
    await expect(field(page)).toHaveValue('');
  });

  test('the field is checked when the user leaves it, and the error clears once it is valid', async ({
    page,
  }) => {
    await openDetails(page, 'orgAdmin');
    await expect(field(page)).toHaveValue('');
    await expect(page.locator('#cityState-description')).toHaveText('Such as Corpus Christi, TX');
    await field(page).fill('X');
    await expect(fieldError(page)).toHaveCount(0);
    await field(page).blur();
    await expect(fieldError(page)).toHaveText(CITY_STATE_MESSAGE);
    await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(field(page)).toHaveAttribute(
      'aria-describedby',
      'cityState-description cityState-error',
    );
    await saveButton(page).click();
    await expect(field(page)).toBeFocused();
    await expect(status(page)).toHaveCount(0);
    await field(page).fill('Austin, TX');
    await expect(fieldError(page)).toHaveCount(0);
    await expect(field(page)).toHaveValue('Austin, TX');
  });

  test('the Details item is current in the sidebar (1280) or the menu (360), and opens the page', async ({
    page,
  }) => {
    const { tenant, base } = await openDetails(page, 'orgAdmin');
    const nav = await adminNav(page, tenant.name);
    await expect(nav.locator('[aria-current="page"]')).toHaveText('Details');
    await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('href', `${base}/details`);
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    if (!isDesktop(page)) {
      await page.keyboard.press('Escape');
      await page.goto(base);
      const menu = await adminNav(page, tenant.name);
      await expect(menu.locator('[aria-current="page"]')).toHaveText('Overview');
      await menu.getByRole('link', { name: 'Details' }).click();
      await expect(page).toHaveURL(`${baseURL}${base}/details`);
    }
  });

  test('keeps Save visible and passes the axe helper at the viewport width', async ({
    page,
  }, testInfo) => {
    await openDetails(page, 'orgAdmin', 'Corpus Christi, TX');
    await expect(saveButton(page)).toBeInViewport();
    expect((await saveButton(page).boundingBox())?.height).toBeGreaterThanOrEqual(
      testInfo.project.use.hasTouch ? 44 : 36,
    );
    await screenshot(page, testInfo, '248-details');
    await expectAccessible(page);
  });

  for (const [label, role] of [
    ['a league organizer of the organization', 'leagueOrganizer'],
    ['a signed-in user with no membership', null],
  ] as const) {
    test(`${label} sees the no-access view on /details`, VIEWPORT_AGNOSTIC, async ({ page }) => {
      const { tenant } = await openDetails(page, role, 'Corpus Christi, TX');
      await expect(
        main(page).getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
      ).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Corpus Christi, TX');
      await expect(page.getByRole('navigation', { name: `${tenant.name} admin` })).toHaveCount(0);
      await expect(field(page)).toHaveCount(0);
    });
  }
});
