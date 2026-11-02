import type { Page } from '@playwright/test';
import { expectAccessible, tabKey } from './support/a11y';
import { chipLabel, chooseChip } from './support/chip';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { signUp } from './support/session';
import { seedTenant, type TenantSeed } from './support/tenant';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LOCATIONS = [
  { name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX 78382' },
  {
    name: 'Pelican Shoals Sand Courts',
    address: '2150 Pelican Shoals Dr, Corpus Christi, TX 78418',
  },
];
const LEAGUES: NonNullable<TenantSeed['leagues']> = [
  { name: 'Coed 7v7 Rec', sport: 'soccer', locations: ['Redfish Flats Fields'] },
  { name: 'Sand 2s', sport: 'beachVolleyball', locations: ['Pelican Shoals Sand Courts'] },
];
const SLUG_MESSAGE =
  'Use 3 to 60 lowercase letters and digits, with single hyphens between them. Some slugs, like new, are reserved.';

const field = (page: Page, id: string) => page.locator(`#${id}`);
const fieldError = (page: Page, id: string) => page.locator(`#${id}-error`);

async function orgAdmin(page: Page) {
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenant({ name: 'E2E Blur', locations: LOCATIONS, leagues: LEAGUES });
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });
  return { base: `/app/organizations/${tenant.slug}` };
}

async function expectLinked(page: Page, id: string, describedBy: string) {
  await expect(field(page, id)).toHaveAttribute('aria-invalid', 'true');
  await expect(field(page, id)).toHaveAttribute('aria-describedby', describedBy);
}

test.describe('a field is checked when the user leaves it', () => {
  test('sign-in: Email shows its error on leaving, not while typing, and Password passes through', async ({
    page,
  }) => {
    await page.goto('/sign-in');
    await field(page, 'email').focus();
    await page.keyboard.type('maya.okafor.example.com');
    await expect(fieldError(page, 'email')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(field(page, 'password')).toBeFocused();
    await expect(fieldError(page, 'email')).toHaveText(
      'Enter an email address like name@example.com.',
    );
    await expectLinked(page, 'email', 'email-error');
    await page.keyboard.press('Tab');
    await expect(fieldError(page, 'password')).toHaveCount(0);
    await expectAccessible(page);

    await field(page, 'email').fill('maya.okafor@example.com');
    await expect(fieldError(page, 'email')).toHaveCount(0);
    await expect(field(page, 'email')).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('add location: Address shows its error on leaving, Name passes through unchanged', async ({
    page,
  }) => {
    const { base } = await orgAdmin(page);
    await page.goto(`${base}/locations`);
    await field(page, 'name').focus();
    await page.keyboard.press('Tab');
    await expect(field(page, 'address')).toBeFocused();
    await expect(fieldError(page, 'name')).toHaveCount(0);
    await page.keyboard.type('   ');
    await expect(fieldError(page, 'address')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(fieldError(page, 'address')).toHaveText('Enter the location’s address.');
    await expectLinked(page, 'address', 'address-description address-error');
    await expect(fieldError(page, 'name')).toHaveCount(0);
    await expectAccessible(page);

    await field(page, 'address').fill('1 Main St');
    await expect(fieldError(page, 'address')).toHaveCount(0);
  });

  test('edit location: clearing Name and leaving it shows the error, and a valid name clears it', async ({
    page,
  }) => {
    const { base } = await orgAdmin(page);
    await page.goto(`${base}/locations`);
    await page.getByRole('button', { name: 'Edit Redfish Flats Fields' }).click();
    await field(page, 'edit-name').fill('');
    await expect(fieldError(page, 'edit-name')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(fieldError(page, 'edit-name')).toHaveText('Enter the location’s name.');
    await expectLinked(page, 'edit-name', 'edit-name-description edit-name-error');
    await expect(fieldError(page, 'edit-address')).toHaveCount(0);
    await expectAccessible(page);

    await field(page, 'edit-name').fill('Redfish Flats Soccer Fields');
    await expect(fieldError(page, 'edit-name')).toHaveCount(0);
  });

  test('create league: Slug, the Locations group, and the Sport radios are checked as the criteria say', async ({
    page,
  }) => {
    const { base } = await orgAdmin(page);
    await page.goto(`${base}/leagues`);
    const form = page.locator('#create-league form');

    await field(page, 'name').focus();
    await page.keyboard.press(tabKey(page));
    await expect(field(page, 'slug')).toBeFocused();
    await expect(fieldError(page, 'name')).toHaveCount(0);
    await page.keyboard.type('Bad-Slug');
    await expect(fieldError(page, 'slug')).toHaveCount(0);
    await page.keyboard.press(tabKey(page));
    await expect(fieldError(page, 'slug')).toHaveText(SLUG_MESSAGE);
    await expectLinked(page, 'slug', 'slug-description slug-error');

    await expect(page.locator('#sport input[type="radio"]').first()).toBeFocused();
    await expect(fieldError(page, 'sport')).toHaveCount(0);
    await page.keyboard.press(tabKey(page));
    await expect(fieldError(page, 'sport')).toHaveCount(0);

    const first = page.getByRole('checkbox', { name: 'Pelican Shoals Sand Courts' });
    await first.click();
    await first.click();
    await page.keyboard.press(tabKey(page));
    await expect(page.getByRole('checkbox', { name: 'Redfish Flats Fields' })).toBeFocused();
    await expect(fieldError(page, 'locations')).toHaveCount(0);
    await page.keyboard.press(tabKey(page));
    await expect(fieldError(page, 'locations')).toHaveText('Choose at least one location.');
    await expect(form.locator('fieldset', { hasText: 'Locations' })).toHaveAttribute(
      'aria-describedby',
      'locations-description locations-error',
    );
    await expectAccessible(page);

    await form.getByRole('button', { name: /^Create draft league/ }).click();
    await expect(fieldError(page, 'name')).toHaveText('Enter the league’s name.');
    await expect(fieldError(page, 'sport')).toHaveText('Choose a sport.');
    await expect(field(page, 'name')).toBeFocused();
    await expectAccessible(page);

    await chooseChip(chipLabel(page, 'Soccer'));
    await expect(fieldError(page, 'sport')).toHaveCount(0);
  });

  test('create season: Slug and dates are checked on leaving', async ({ page }) => {
    const { base } = await orgAdmin(page);
    await page.goto(`${base}/leagues/coed-7v7-rec`);
    const form = page.locator('#create-season form');

    await field(page, 'name').fill('Fall 2026');
    await expect(field(page, 'slug')).toHaveValue('fall-2026');
    await field(page, 'slug').fill('Bad-Slug');
    await expect(fieldError(page, 'slug')).toHaveCount(0);
    await field(page, 'start-date').focus();
    await expect(fieldError(page, 'slug')).toHaveText(SLUG_MESSAGE);
    await expectLinked(page, 'slug', 'slug-description slug-error');

    await field(page, 'start-date').fill('2026-09-01');
    await field(page, 'end-date').fill('2026-08-01');
    await expect(fieldError(page, 'end-date')).toHaveCount(0);
    await field(page, 'registration-deadline').focus();
    await expect(fieldError(page, 'end-date')).toHaveText(
      'The end date must be on or after the start date.',
    );
    await expect(field(page, 'end-date')).toHaveAttribute('aria-invalid', 'true');

    await expectAccessible(page);

    await field(page, 'end-date').fill('2026-11-15');
    await expect(fieldError(page, 'end-date')).toHaveCount(0);

    await page.reload();
    await expect(form).toBeVisible();
    await field(page, 'name').focus();
    await page.keyboard.press('Tab');
    await expect(fieldError(page, 'name')).toHaveCount(0);
    await form.getByRole('button', { name: /^Create draft season/ }).click();
    await expect(fieldError(page, 'name')).toHaveText('Enter the season’s name.');
    await expect(field(page, 'name')).toBeFocused();
  });

  test('create season: a slug derived from the name that is invalid shows its error when Slug is left', async ({
    page,
  }) => {
    const { base } = await orgAdmin(page);
    await page.goto(`${base}/leagues/coed-7v7-rec`);
    await field(page, 'name').fill('ab');
    await expect(field(page, 'slug')).toHaveValue('ab');
    await field(page, 'name').blur();
    await expect(fieldError(page, 'name')).toHaveCount(0);
    await expect(fieldError(page, 'slug')).toHaveCount(0);
    await field(page, 'slug').focus();
    await page.keyboard.press('Tab');
    await expect(fieldError(page, 'slug')).toHaveText(SLUG_MESSAGE);
    await expectAccessible(page);
  });

  test('create league: after a successful create, passing through the emptied form shows no errors', async ({
    page,
  }) => {
    const { base } = await orgAdmin(page);
    await page.goto(`${base}/leagues`);
    const form = page.locator('#create-league form');
    await field(page, 'name').fill('Friday Night Fours');
    await chooseChip(chipLabel(page, 'Beach volleyball'));
    await chooseChip(chipLabel(page, '4v4'));
    await page.getByRole('checkbox', { name: 'Pelican Shoals Sand Courts' }).click();
    await form.getByRole('button', { name: /^Create draft league/ }).click();
    await expect(form.getByRole('status').filter({ hasText: 'created as a draft' })).toBeVisible();
    await expect(field(page, 'name')).toHaveValue('');

    await field(page, 'name').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const checkbox = page.getByRole('checkbox', { name: 'Pelican Shoals Sand Courts' });
    await checkbox.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(form.locator('[data-slot="field-error"]')).toHaveCount(0);
    await expect(form.locator('[aria-invalid="true"]')).toHaveCount(0);
  });

  test('add location: after a successful add, passing through the emptied form shows no errors', async ({
    page,
  }) => {
    const { base } = await orgAdmin(page);
    await page.goto(`${base}/locations`);
    const form = page.locator('#add-location form');
    await field(page, 'name').fill('Rockport Beach Courts');
    await field(page, 'address').fill('1 Beach Rd, Rockport, TX 78382');
    await form.getByRole('button', { name: /^Add location/ }).click();
    await expect(field(page, 'name')).toHaveValue('');

    await field(page, 'name').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(form.locator('[data-slot="field-error"]')).toHaveCount(0);
  });

  test('invite staff: Email and the Leagues group are checked on leaving', async ({ page }) => {
    const { base } = await orgAdmin(page);
    await page.goto(`${base}/staff`);
    await field(page, 'email').focus();
    await page.keyboard.type('not-an-email');
    await expect(fieldError(page, 'email')).toHaveCount(0);
    await page.keyboard.press(tabKey(page));
    await expect(fieldError(page, 'email')).toHaveText(
      'Enter an email address like name@example.com.',
    );
    await expectLinked(page, 'email', 'email-description email-error');

    const coed = page.getByRole('checkbox', { name: 'Coed 7v7 Rec' });
    await coed.click();
    await coed.click();
    await page.keyboard.press(tabKey(page));
    await expect(page.getByRole('checkbox', { name: 'Sand 2s' })).toBeFocused();
    await expect(fieldError(page, 'leagues')).toHaveCount(0);
    await page.keyboard.press(tabKey(page));
    await expect(fieldError(page, 'leagues')).toBeVisible();
    await expectAccessible(page);

    await field(page, 'email').fill('dana@example.com');
    await expect(fieldError(page, 'email')).toHaveCount(0);
    await coed.click();
    await expect(fieldError(page, 'leagues')).toHaveCount(0);
  });
});
