import type { Page } from '@playwright/test';
import { demoLogoBytes } from '../convex/seedAssets';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { seedTenant, type Tenant } from './support/tenant';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const SIZE_100_KB = 100 * 1024;

/** Decoders ignore bytes after the end chunk. */
const paddedPng = (size = SIZE_100_KB) =>
  Buffer.concat([Buffer.from(demoLogoBytes()), Buffer.alloc(size - demoLogoBytes().length)]);

const pngFile = (name = 'logo.png', size = SIZE_100_KB) => ({
  name,
  mimeType: 'image/png',
  buffer: paddedPng(size),
});

const fileInput = (page: Page) => page.locator('#logo-file');
const logoSection = (page: Page) => page.locator('section[aria-labelledby="logo-heading"]');
const preview = (page: Page) => logoSection(page).locator('app-organization-mark');
const previewImage = (page: Page) => preview(page).locator('img');
const status = (page: Page) => logoSection(page).getByRole('status').filter({ hasText: /Logo/ });
const removeButton = (page: Page) => logoSection(page).getByRole('button', { name: 'Remove logo' });
const fieldError = (page: Page) => page.locator('#logo-error');
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 768;

async function openDetails(page: Page): Promise<{ tenant: Tenant; base: string }> {
  const user = newUser('Logo');
  await signUp(page, user);
  const tenant = await seedTenant({
    name: 'E2E Logo',
    locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
    leagues: [
      { name: 'Alpha League', sport: 'soccer', locations: ['Alpha Field'] },
      { name: 'Beta League', sport: 'softball', locations: ['Alpha Field'] },
    ],
  });
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });
  const base = `/app/organizations/${tenant.slug}`;
  await page.goto(`${base}/details`);
  return { tenant, base };
}

async function upload(page: Page, file = pngFile()): Promise<void> {
  await fileInput(page).setInputFiles(file);
  await expect(status(page)).toContainText('Logo saved.');
}

/** The upload swaps the label from a primary to an outline button, and its colours transition, so axe would read a colour halfway between the two. */
async function transitionsFinished(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

async function markHtml(request: Parameters<typeof fetchRawHtml>[0], path: string) {
  const { status: code, html } = await fetchRawHtml(request, path);
  expect(code).toBe(200);
  const mark = /<app-organization-mark\b[^>]*>[\s\S]*?<\/app-organization-mark>/.exec(html)?.[0];
  expect(mark, 'the organization mark in the raw HTML').toBeDefined();
  return mark ?? '';
}

async function hydrated(consoleGuard: { hydrated: boolean }): Promise<void> {
  await expect.poll(() => consoleGuard.hydrated).toBe(true);
}

test.describe('the Details page: Logo', () => {
  test(
    'uploads a 100 KB PNG, shows it, and the public page has it in the mark in its raw HTML',
    RAW_HTTP,
    async ({ page, request }, testInfo) => {
      const { tenant } = await openDetails(page);
      await expect(logoSection(page).getByRole('heading', { name: 'Logo' })).toBeVisible();
      await expect(previewImage(page)).toHaveCount(0);
      await upload(page);
      await expect(status(page)).toBeFocused();
      await expect(previewImage(page)).toHaveAttribute('src', /\/api\/storage\//);
      await expect
        .poll(() => previewImage(page).evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBe(64);
      const served = await request.get((await previewImage(page).getAttribute('src')) ?? '');
      expect(served.status()).toBe(200);
      expect(served.headers()['content-type']).toBe('image/png');
      await screenshot(page, testInfo, '251-logo-saved');

      const mark = await markHtml(request, tenant.path);
      expect(mark).toMatch(/<img\b[^>]*\bsrc="[^"]*\/api\/storage\/[^"]+"/);
      expect(mark).toMatch(/<img\b[^>]*\balt=""/);
      expect(mark).toMatch(/<img\b[^>]*\bwidth="48"/);
      expect(mark).toMatch(/<img\b[^>]*\bheight="48"/);
    },
  );

  test('a replacement shows the new image, and the mark is the one on the public page', async ({
    page,
  }) => {
    const { tenant } = await openDetails(page);
    await upload(page);
    const first = await previewImage(page).getAttribute('src');
    await expect(fileInput(page)).toHaveAttribute('aria-label', 'Replace logo');

    await fileInput(page).setInputFiles(pngFile('second.png', 50 * 1024));
    await expect(previewImage(page)).not.toHaveAttribute('src', first ?? '');
    const second = await previewImage(page).getAttribute('src');
    expect(second).toMatch(/\/api\/storage\//);

    await page.goto(tenant.path);
    await expect(page.locator('app-organization-mark img')).toHaveAttribute('src', second ?? '');
  });

  test('a file of the wrong type or over 256 KB is refused before it is sent, with its message', async ({
    page,
  }) => {
    await openDetails(page);
    await fileInput(page).setInputFiles({
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    });
    await expect(fieldError(page)).toHaveText('Use a PNG, JPEG, or WebP image.');
    await expect(fileInput(page)).toBeFocused();
    await expect(fileInput(page)).toHaveAttribute('aria-describedby', 'logo-hint logo-error');

    await fileInput(page).setInputFiles(pngFile('big.png', 300 * 1024));
    await expect(fieldError(page)).toHaveText(
      'Use an image of 256 KB or less. This one is 300 KB.',
    );
    await expect(previewImage(page)).toHaveCount(0);
  });

  test('Remove asks first, Cancel returns focus to Remove, and confirming shows the initials on the public page', async ({
    page,
  }, testInfo) => {
    const { tenant } = await openDetails(page);
    await upload(page);

    await removeButton(page).click();
    const dialog = page.getByRole('alertdialog', { name: 'Remove the logo?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await screenshot(page, testInfo, '251-logo-remove-confirm');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(removeButton(page)).toBeFocused();
    await expect(previewImage(page)).toHaveCount(1);

    await removeButton(page).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(removeButton(page)).toBeFocused();

    await removeButton(page).click();
    await dialog.getByRole('button', { name: 'Remove logo' }).click();
    await expect(status(page)).toContainText('Logo removed.');
    await expect(status(page)).toBeFocused();
    await expect(previewImage(page)).toHaveCount(0);
    await expect(logoSection(page).getByText('Upload a logo')).toBeVisible();

    await page.goto(tenant.path);
    const mark = page.locator('app-organization-mark');
    await expect(mark).toHaveText(/^\s*[A-Z]{1,2}\s*$/);
    await expect(mark.locator('img')).toHaveCount(0);
  });

  test('the Logo section passes the axe helper without a logo, with one, and with an error', async ({
    page,
  }) => {
    await openDetails(page);
    await expect(logoSection(page)).toBeVisible();
    await expectAccessible(page);
    await expect(page.getByLabel('Upload a logo')).toHaveAttribute('type', 'file');

    await fileInput(page).setInputFiles({
      name: 'logo.gif',
      mimeType: 'image/gif',
      buffer: Buffer.from('GIF89a'),
    });
    await expect(fieldError(page)).toBeVisible();
    await expectAccessible(page);

    await upload(page);
    await expect(page.getByLabel('Replace logo')).toHaveAttribute('type', 'file');
    await transitionsFinished(page);
    await expectAccessible(page);
  });

  test('the controls are 44px tall on a touch screen', async ({ page }, testInfo) => {
    await openDetails(page);
    await upload(page);
    const minimum = testInfo.project.use.hasTouch ? 44 : 36;
    for (const control of [
      logoSection(page).locator('label[for="logo-file"]'),
      removeButton(page),
    ]) {
      await control.scrollIntoViewIfNeeded();
      expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(minimum);
    }
    await screenshot(page, testInfo, '251-logo-section');
  });
});

test.describe('the public organization page: the logo mark', () => {
  async function organizationWithLogo(page: Page): Promise<Tenant> {
    const { tenant } = await openDetails(page);
    await upload(page);
    return tenant;
  }

  test('is 32px on a phone and 48px from 768px, with the image filling it', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await organizationWithLogo(page);
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    const mark = page.locator('app-organization-mark');
    const size = isDesktop(page) ? 48 : 32;
    const markBox = await mark.boundingBox();
    expect(markBox?.width).toBe(size);
    expect(markBox?.height).toBe(size);
    const imageBox = await mark.locator('img').boundingBox();
    expect(imageBox?.width).toBe(size);
    expect(imageBox?.height).toBe(size);
    await expect(mark.locator('img')).toHaveAttribute('alt', '');
    await expect(mark).toHaveAttribute('aria-hidden', 'true');
    await expectAccessible(page);
  });

  test('shows the initials, not a broken image, when the image does not load', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await organizationWithLogo(page);
    // A 200 with bytes that are not an image fails the load without a console error.
    await page.route(/\/api\/storage\//, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: 'not an image' }),
    );
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    const mark = page.locator('app-organization-mark');
    await expect(mark.locator('img')).toHaveCount(0);
    await expect(mark).toHaveText(/^\s*[A-Z]{1,2}\s*$/);
  });

  test('shows the initials offline from a saved copy whose image is not cached', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    const tenant = await organizationWithLogo(page);
    const chips = page.getByRole('navigation', { name: 'Sports' });
    await page.goto(tenant.path);
    await hydrated(consoleGuard);
    await expect(page.locator('app-organization-mark img')).toHaveCount(1);
    // The sport view is viewed online too, so it has a saved copy to open offline.
    await chips.getByRole('link', { name: /^Soccer/ }).click();
    await expect(page).toHaveURL(`${baseURL}${tenant.path}/sports/soccer`);
    await expect(page.locator('app-organization-mark img')).toHaveCount(1);
    await chips.getByRole('link', { name: /^All sports/ }).click();
    await expect(page).toHaveURL(`${baseURL}${tenant.path}`);

    await page.route(/\/api\/storage\//, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: 'not an image' }),
    );
    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await chips.getByRole('link', { name: /^Soccer/ }).click();
    await expect(page.locator('app-saved-copy-note')).toBeVisible();
    const mark = page.locator('app-organization-mark');
    await expect(mark).toHaveText(/^\s*[A-Z]{1,2}\s*$/);
    await expect(mark.locator('img')).toHaveCount(0);
    await context.setOffline(false);
  });
});
