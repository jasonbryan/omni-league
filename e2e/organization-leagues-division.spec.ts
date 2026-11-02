import type { Locator, Page } from '@playwright/test';
import { expectAccessible, tabKey } from './support/a11y';
import { chooseChip } from './support/chip';
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
const chip = (page: Page, name: string) =>
  form(page)
    .locator('label')
    .filter({ has: page.getByRole('radio', { name, exact: true }) });
const chipFace = (page: Page, name: string) => chip(page, name).locator('span');
const focusRingStyle = (face: Locator) => face.evaluate((el) => getComputedStyle(el).outlineStyle);

test.describe('Leagues: the division', () => {
  test('the choices follow the sport, with the defaults chosen', async ({ page }, testInfo) => {
    await openLeagues(page);
    await expect(form(page)).toContainText('Choose a sport to see its formats and levels.');

    await chooseChip(chip(page, 'Beach volleyball'));
    await expect(radio(page, 'Coed')).toBeChecked();
    await expect(form(page).locator('#format input[type="radio"]')).toHaveCount(5);
    await expect(form(page).locator('#format input:checked')).toHaveCount(0);
    await expect(form(page).locator('#level input[type="radio"]')).toHaveCount(6);
    await expect(radio(page, 'Rec')).toBeChecked();
    await expect(form(page).getByLabel('Age group')).toHaveValue('adult');
    await screenshot(page, testInfo, '300-league-form-defaults');
    await expectAccessible(page);

    await chooseChip(chip(page, 'Soccer'));
    await expect(form(page).locator('#format input[type="radio"]')).toHaveCount(8);
    await expect(form(page).locator('#level input[type="radio"]')).toHaveCount(3);
  });

  test('leaving Name fills gender, format, and level, and a gender chosen by hand stays', async ({
    page,
  }, testInfo) => {
    await openLeagues(page);
    await chooseChip(chip(page, 'Beach volleyball'));
    await page.locator('#name').fill('Wednesday Women’s 2s BB');
    await page.locator('#name').blur();
    await expect(radio(page, "Women's")).toBeChecked();
    await expect(radio(page, '2v2')).toBeChecked();
    await expect(radio(page, 'BB')).toBeChecked();
    await expect(form(page).getByRole('status').filter({ hasText: FILLED_STATUS })).toBeVisible();
    await screenshot(page, testInfo, '300-league-form-filled-from-name');
    await expectAccessible(page);

    await chooseChip(chip(page, 'Coed'));
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
    await chooseChip(chip(page, 'Beach volleyball'));
    await page.getByRole('checkbox', { name: 'Pelican Shoals Sand Courts' }).click();
    await submit(page).click();
    await expect(page.locator('#format-error')).toHaveText(
      'Choose a format. Players filter leagues by it.',
    );
    await expect(radio(page, '2v2')).toBeFocused();
    await expect(page.getByText('No leagues yet')).toBeVisible();
    await screenshot(page, testInfo, '300-league-form-no-format');
    await expectAccessible(page);

    await chooseChip(chip(page, '4v4'));
    await expect(page.locator('#format-error')).toHaveCount(0);
  });

  test('the minimum roster size is behind a button and is checked against the format', async ({
    page,
  }) => {
    await openLeagues(page);
    await chooseChip(chip(page, 'Beach volleyball'));
    await chooseChip(chip(page, '4v4'));
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

test.describe('Leagues: the division chips', () => {
  test('a click on the visible chip chooses it, in every group', async ({ page }) => {
    await openLeagues(page);
    await chip(page, 'Soccer').click();
    await expect(radio(page, 'Soccer')).toBeChecked();
    await expect(radio(page, 'Beach volleyball')).not.toBeChecked();

    await chip(page, "Women's").click();
    await expect(radio(page, "Women's")).toBeChecked();
    await expect(radio(page, 'Coed')).not.toBeChecked();

    await chip(page, '7v7').click();
    await expect(radio(page, '7v7')).toBeChecked();

    await chip(page, 'Intermediate').click();
    await expect(radio(page, 'Intermediate')).toBeChecked();
    await expect(radio(page, 'Rec')).not.toBeChecked();

    await chip(page, '9v9').click();
    await expect(radio(page, '9v9')).toBeChecked();
    await expect(radio(page, '7v7')).not.toBeChecked();
  });

  test('a chip is at least 44px tall on a touch screen and shows a ring when focused by keyboard', async ({
    page,
  }) => {
    await openLeagues(page);
    await chip(page, 'Beach volleyball').click();
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    const box = await chipFace(page, '2v2').boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(coarse ? 44 : 36);

    await radio(page, '2v2').focus();
    await page.keyboard.press('ArrowRight');
    expect(await focusRingStyle(chipFace(page, '3v3'))).not.toBe('none');
    expect(await focusRingStyle(chipFace(page, '2v2'))).toBe('none');
  });

  test('Tab enters a chip group once, the arrow keys move and choose, and Space chooses', async ({
    page,
  }) => {
    await openLeagues(page);
    await page.locator('#slug').focus();
    await page.keyboard.press(tabKey(page));
    await expect(radio(page, 'Beach volleyball')).toBeFocused();
    await page.keyboard.press('Space');
    await expect(radio(page, 'Beach volleyball')).toBeChecked();
    await expect(radio(page, 'Coed')).toBeChecked();

    await page.keyboard.press('ArrowRight');
    await expect(radio(page, 'Soccer')).toBeFocused();
    await expect(radio(page, 'Soccer')).toBeChecked();
    await page.keyboard.press('ArrowLeft');
    await expect(radio(page, 'Beach volleyball')).toBeChecked();

    await page.keyboard.press(tabKey(page));
    await expect(radio(page, 'Coed')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(radio(page, "Men's")).toBeChecked();
    await page.keyboard.press('ArrowDown');
    await expect(radio(page, "Women's")).toBeChecked();

    // None is chosen in Format, so Tab lands on its first chip and Space chooses it.
    await page.keyboard.press(tabKey(page));
    await expect(radio(page, '2v2')).toBeFocused();
    await expect(radio(page, '2v2')).not.toBeChecked();
    await page.keyboard.press('Space');
    await expect(radio(page, '2v2')).toBeChecked();
    await page.keyboard.press('ArrowRight');
    await expect(radio(page, '3v3')).toBeChecked();

    await page.keyboard.press(tabKey(page));
    await expect(
      form(page).getByRole('button', { name: 'Raise the minimum roster size' }),
    ).toBeFocused();
    await page.keyboard.press(tabKey(page));
    await expect(radio(page, 'Rec')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(radio(page, 'B')).toBeChecked();
    await page.keyboard.press(tabKey(page));
    await expect(form(page).getByRole('button', { name: 'Add a custom level' })).toBeFocused();
    await page.keyboard.press(tabKey(page));
    await expect(form(page).getByLabel('Age group')).toBeFocused();
  });

  test('a screen reader hears each group by its legend, each chip by its label, and the hint', async ({
    page,
  }) => {
    await openLeagues(page);
    await chip(page, 'Beach volleyball').click();
    const format = form(page).getByRole('group', { name: 'Format' });
    await expect(format).toHaveAccessibleDescription(
      'Players on each side. It sets the minimum roster size of every season of this league.',
    );
    await expect(format.getByRole('radio')).toHaveCount(5);
    await expect(form(page).getByRole('group', { name: 'Gender' })).toHaveAccessibleDescription(
      'Shown as Boys and Girls for youth age groups.',
    );
    await expect(form(page).getByRole('group', { name: 'Level' })).toHaveAccessibleDescription(
      'Standard levels for beach volleyball.',
    );
    await expect(form(page).getByRole('group', { name: 'Sport' })).toHaveAccessibleDescription(
      'The division options below are this sport’s.',
    );
    await expect(form(page).getByRole('combobox', { name: 'Age group' })).toHaveValue('adult');

    await submit(page).click();
    await expect(format).toHaveAccessibleDescription(
      /Choose a format\. Players filter leagues by it\.$/,
    );
    await expect(radio(page, '2v2')).toHaveAttribute('aria-invalid', 'true');
    await expect(
      form(page).getByRole('alert').filter({ hasText: 'Choose a format' }),
    ).toBeVisible();
  });

  test('a name left before the sport is chosen fills in once the sport is chosen', async ({
    page,
  }) => {
    await openLeagues(page);
    await page.locator('#name').fill('Wednesday Women’s 2s BB');
    await page.locator('#name').blur();
    await expect(form(page).getByRole('status').filter({ hasText: FILLED_STATUS })).toHaveCount(0);

    await chip(page, 'Beach volleyball').click();
    await expect(radio(page, "Women's")).toBeChecked();
    await expect(radio(page, '2v2')).toBeChecked();
    await expect(radio(page, 'BB')).toBeChecked();
    await expect(form(page).getByRole('status').filter({ hasText: FILLED_STATUS })).toBeVisible();
  });

  test('leaving Name again fills only what the organizer has not chosen', async ({ page }) => {
    await openLeagues(page);
    await chip(page, 'Beach volleyball').click();
    await page.locator('#name').fill('Wednesday Women’s 2s BB');
    await page.locator('#name').blur();
    await chip(page, '5v5').click();

    await page.locator('#name').fill('Thursday Men’s 3s A');
    await page.locator('#name').blur();
    await expect(radio(page, "Men's")).toBeChecked();
    await expect(radio(page, '5v5')).toBeChecked();
    await expect(radio(page, 'A')).toBeChecked();
  });

  test('changing the sport after a fill clears the format it no longer offers and keeps gender', async ({
    page,
  }) => {
    await openLeagues(page);
    await chip(page, 'Beach volleyball').click();
    await page.locator('#name').fill('Wednesday Women’s 2s BB');
    await page.locator('#name').blur();

    await chip(page, 'Soccer').click();
    await expect(radio(page, "Women's")).toBeChecked();
    await expect(form(page).locator('#format input:checked')).toHaveCount(0);
    await expect(radio(page, 'Rec')).toBeChecked();
    await expect(
      form(page).getByRole('group', { name: 'Division' }).getByRole('status'),
    ).toContainText('Gender was filled in from the name. Change any that are wrong.');
  });

  test('pressing Enter in Name fills the format from the name first, so the league is created', async ({
    page,
  }) => {
    await openLeagues(page);
    await chip(page, 'Beach volleyball').click();
    await page.getByRole('checkbox', { name: 'Pelican Shoals Sand Courts' }).click();
    await page.locator('#name').fill('Sunday Coed 4s');
    await page.locator('#name').press('Enter');
    await expect(page.locator('#format-error')).toHaveCount(0);
    const row = page.locator('#leagues-list > li').first();
    await expect(row.locator('h3')).toHaveText('Sunday Coed 4s');
    await expect(row.locator('[data-slot="league-division"]')).toHaveText('Coed · 4v4 · Rec');
  });

  test('a name edit that no longer states a filled value returns it to its default, and a hand-chosen one stays', async ({
    page,
  }) => {
    await openLeagues(page);
    await chip(page, 'Beach volleyball').click();
    await page.locator('#name').fill('Wednesday Women’s 2s BB');
    await page.locator('#name').blur();
    await expect(radio(page, 'BB')).toBeChecked();

    await page.locator('#name').fill('Wednesday Women’s 4s');
    await page.locator('#name').blur();
    await expect(radio(page, "Women's")).toBeChecked();
    await expect(radio(page, '4v4')).toBeChecked();
    await expect(radio(page, 'Rec')).toBeChecked();
    await expect(
      form(page).getByRole('group', { name: 'Division' }).getByRole('status'),
    ).toContainText('Gender and format were filled in from the name.');

    await chip(page, 'A').click();
    await page.locator('#name').fill('Wednesday night');
    await page.locator('#name').blur();
    await expect(radio(page, 'Coed')).toBeChecked();
    await expect(form(page).locator('#format input:checked')).toHaveCount(0);
    await expect(radio(page, 'A')).toBeChecked();
    await expect(form(page).getByText('filled in from the name')).toHaveCount(0);
  });
});
