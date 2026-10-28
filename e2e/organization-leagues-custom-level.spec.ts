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
];

async function openLeagues(page: Page) {
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenant({ name: 'E2E Custom Levels', locations: LOCATIONS });
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });
  await page.goto(`/app/organizations/${tenant.slug}/leagues`);
  await page.getByRole('radio', { name: 'Beach volleyball', exact: true }).check({ force: true });
}

const form = (page: Page) => page.locator('#create-league form');
const level = (page: Page, name: string) =>
  form(page).locator('#level').getByRole('radio', { name, exact: true });
const addLink = (page: Page) => form(page).getByRole('button', { name: 'Add a custom level' });
const panel = (page: Page) => page.locator('#custom-level');

async function addGold(page: Page) {
  await addLink(page).click();
  await panel(page).getByLabel('Custom level').fill('Gold');
  await panel(page).getByLabel('Filters as').selectOption({ label: 'A' });
  await panel(page).getByRole('button', { name: 'Add level' }).click();
}

test.describe('Leagues: a custom level', () => {
  test('adds Gold mapped to A, chooses it, and the league lists as Gold (A)', async ({
    page,
  }, testInfo) => {
    await openLeagues(page);
    await addGold(page);

    await expect(panel(page)).toHaveCount(0);
    await expect(level(page, 'Gold')).toBeChecked();
    const status = form(page).getByRole('status').filter({ hasText: 'Gold added.' });
    await expect(status).toContainText('Gold added. It filters as A.');
    await expect(status).toBeFocused();
    await expect(form(page).locator('#level-description')).toHaveText(
      'Standard levels for beach volleyball. Your custom levels: Gold (filters as A).',
    );
    await screenshot(page, testInfo, '300-league-form-custom-level-added');
    await expectAccessible(page);

    await page.locator('#name').fill('Sunday Night Sand');
    await form(page).getByRole('radio', { name: '4v4', exact: true }).check({ force: true });
    await form(page)
      .getByRole('button', { name: /^Create draft league/ })
      .click();
    await expect(page.locator('#leagues-list [data-slot="league-division"]')).toHaveText(
      'Coed · 4v4 · Gold (A)',
    );
  });

  test('Add level without a standard level shows the error, focuses the select, and keeps the name', async ({
    page,
  }, testInfo) => {
    await openLeagues(page);
    await addLink(page).click();
    await panel(page).getByLabel('Custom level').fill('Gold');
    await panel(page).getByRole('button', { name: 'Add level' }).click();

    await expect(page.locator('#custom-level-maps-error')).toHaveText(
      'Choose the standard level Gold matches, so players can filter for it.',
    );
    await expect(panel(page).getByLabel('Filters as')).toBeFocused();
    await expect(panel(page).getByLabel('Custom level')).toHaveValue('Gold');
    await screenshot(page, testInfo, '300-league-form-custom-level-open');
    await expectAccessible(page);
  });

  test('Undo deletes the level and puts the earlier level back', async ({ page }) => {
    await openLeagues(page);
    await level(page, 'BB').check({ force: true });
    await addGold(page);
    await expect(level(page, 'Gold')).toBeChecked();

    await form(page).getByRole('button', { name: 'Undo' }).click();
    await expect(form(page).getByRole('status').filter({ hasText: 'Gold removed.' })).toBeVisible();
    await expect(level(page, 'Gold')).toHaveCount(0);
    await expect(level(page, 'BB')).toBeChecked();
  });

  test('changing the sport closes the panel and offers no Gold for the new sport', async ({
    page,
  }) => {
    await openLeagues(page);
    await addGold(page);
    await expect(level(page, 'Gold')).toBeChecked();
    await addLink(page).click();

    await form(page).getByRole('radio', { name: 'Soccer', exact: true }).check({ force: true });
    await expect(panel(page)).toHaveCount(0);
    await expect(level(page, 'Gold')).toHaveCount(0);
    await expect(level(page, 'Rec')).toBeChecked();
  });
});
