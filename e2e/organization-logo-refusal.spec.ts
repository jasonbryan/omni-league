import type { Page } from '@playwright/test';
import { demoLogoBytes } from '../convex/seedAssets';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { signUp } from './support/session';
import { seedTenant } from './support/tenant';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const fileInput = (page: Page) => page.locator('#logo-file');
const logoSection = (page: Page) => page.locator('section[aria-labelledby="logo-heading"]');
const previewImage = (page: Page) => logoSection(page).locator('app-organization-mark img');
const status = (page: Page) => logoSection(page).getByRole('status').filter({ hasText: /Logo/ });

async function openDetails(page: Page): Promise<void> {
  const user = newUser('LogoRefusal');
  await signUp(page, user);
  const tenant = await seedTenant({
    name: 'E2E Logo Refusal',
    locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
    leagues: [{ name: 'Alpha League', sport: 'soccer', locations: ['Alpha Field'] }],
  });
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });
  await page.goto(`/app/organizations/${tenant.slug}/details`);
}

test.describe('the Details page: Logo, files the server refuses', () => {
  test.use({ expectedConvexErrors: ['organizations:setLogo'] });

  test('an SVG sent as image/png passes the page check, the server refuses it under the field, and the previous logo stays', async ({
    page,
  }) => {
    await openDetails(page);
    await fileInput(page).setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from(demoLogoBytes()),
    });
    await expect(status(page)).toContainText('Logo saved.');
    const kept = await previewImage(page).getAttribute('src');

    await fileInput(page).setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
    });
    const error = page.locator('#logo-error');
    await expect(error).toHaveText('Use a PNG, JPEG, or WebP image.');
    await expect(fileInput(page)).toHaveAttribute('aria-describedby', 'logo-hint logo-error');
    await expect(fileInput(page)).toBeFocused();
    await expect(previewImage(page)).toHaveAttribute('src', kept ?? '');
    await expect(logoSection(page).getByText('Uploading…')).toHaveCount(0);
  });
});

test.describe('the Details page: Logo, by keyboard', () => {
  test('the file input is reached by keyboard, shows its focus ring on the button, and opens the file chooser', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.use.hasTouch === true, 'a keyboard walk needs a desktop project');
    await openDetails(page);
    await expect(logoSection(page)).toBeVisible();
    await expect(page.getByLabel('Upload a logo')).toHaveAttribute('type', 'file');
    await fileInput(page).focus();
    await expect(fileInput(page)).toBeFocused();
    const outline = await logoSection(page)
      .locator('label[for="logo-file"]')
      .evaluate((label) => getComputedStyle(label).outlineStyle);
    expect(outline).not.toBe('none');
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Space');
    expect((await chooser).isMultiple()).toBe(false);
  });
});
