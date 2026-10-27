import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { seedTenant } from './support/tenant';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LOCATIONS = [
  { name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX 78382' },
  {
    name: 'Pelican Shoals Sand Courts',
    address: '2150 Pelican Shoals Dr, Corpus Christi, TX 78418',
  },
];

const FILLED_STATUS =
  'Gender, format, and level were filled in from the name. Change any that are wrong.';

async function openLeagues(page: Page) {
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenant({ name: 'E2E Divisions', locations: LOCATIONS });
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });
  await page.goto(`/app/organizations/${tenant.slug}/leagues`);
}

const form = (page: Page) => page.locator('#create-league form');
const submit = (page: Page) => form(page).getByRole('button', { name: /^Create draft league/ });
const radio = (page: Page, name: string) => form(page).getByRole('radio', { name, exact: true });

test.describe('Leagues: the division', () => {
  test('the choices follow the sport, with the defaults chosen', async ({ page }, testInfo) => {
    await openLeagues(page);
    await expect(form(page)).toContainText('Choose a sport to see its formats and levels.');

    await radio(page, 'Beach volleyball').check();
    await expect(radio(page, 'Coed')).toBeChecked();
    await expect(form(page).locator('#format input[type="radio"]')).toHaveCount(5);
    await expect(form(page).locator('#format input:checked')).toHaveCount(0);
    await expect(form(page).locator('#level input[type="radio"]')).toHaveCount(6);
    await expect(radio(page, 'Rec')).toBeChecked();
    await expect(form(page).getByLabel('Age group')).toHaveValue('adult');
    await screenshot(page, testInfo, '300-league-form-defaults');
    await expectAccessible(page);

    await radio(page, 'Soccer').check();
    await expect(form(page).locator('#format input[type="radio"]')).toHaveCount(8);
    await expect(form(page).locator('#level input[type="radio"]')).toHaveCount(3);
  });

  test('leaving Name fills gender, format, and level, and a gender chosen by hand stays', async ({
    page,
  }, testInfo) => {
    await openLeagues(page);
    await radio(page, 'Beach volleyball').check();
    await page.locator('#name').fill('Wednesday Women’s 2s BB');
    await page.locator('#name').blur();
    await expect(radio(page, "Women's")).toBeChecked();
    await expect(radio(page, '2v2')).toBeChecked();
    await expect(radio(page, 'BB')).toBeChecked();
    await expect(form(page).getByRole('status').filter({ hasText: FILLED_STATUS })).toBeVisible();
    await screenshot(page, testInfo, '300-league-form-filled-from-name');
    await expectAccessible(page);

    await radio(page, 'Coed').check();
    await page.locator('#name').fill('Thursday Men’s 3s A');
    await page.locator('#name').blur();
    await expect(radio(page, 'Coed')).toBeChecked();
    await expect(radio(page, '3v3')).toBeChecked();
    await expect(radio(page, 'A')).toBeChecked();
  });

  test('a submit without a format shows the error under Format and focuses its first chip', async ({
    page,
  }, testInfo) => {
    await openLeagues(page);
    await page.locator('#name').fill('Sunday Night Sand');
    await radio(page, 'Beach volleyball').check();
    await page.getByRole('checkbox', { name: 'Pelican Shoals Sand Courts' }).click();
    await submit(page).click();
    await expect(page.locator('#format-error')).toHaveText(
      'Choose a format. Players filter leagues by it.',
    );
    await expect(radio(page, '2v2')).toBeFocused();
    await expect(page.getByText('No leagues yet')).toBeVisible();
    await screenshot(page, testInfo, '300-league-form-no-format');
    await expectAccessible(page);

    await radio(page, '4v4').check();
    await expect(page.locator('#format-error')).toHaveCount(0);
  });

  test('the minimum roster size is behind a button and is checked against the format', async ({
    page,
  }) => {
    await openLeagues(page);
    await radio(page, 'Beach volleyball').check();
    await radio(page, '4v4').check();
    await page.getByRole('button', { name: 'Raise the minimum roster size' }).click();
    const minimum = page.getByLabel('Minimum roster size');
    await expect(minimum).toBeFocused();
    await minimum.fill('3');
    await minimum.blur();
    await expect(page.locator('#minimum-roster-size-error')).toHaveText(
      '4v4 needs at least 4 players. Enter 4 or more.',
    );
    await minimum.fill('6');
    await expect(page.locator('#minimum-roster-size-error')).toHaveCount(0);
  });
});
