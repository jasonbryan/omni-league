// Sign-up with email and password, the signed-in landing, and sign-out (#62; ADR 0008; approved
// design design/mockups/62-sign-up.html). /sign-up and /app are Client routes: the server sends the
// empty shell and no auth code runs there. Checks of what sign-up wrote run on local runs only
// (they read the local backend through `testing:accountByEmail`); against a preview the browser
// flow still runs, which is the "sign-up from the deploy-preview origin" check.
import type { Page, TestInfo } from '@playwright/test';
import { join } from 'node:path';
import { expectAccessible } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { fetchRawHtml } from './support/raw-html';
import { accountByEmail, newUser, seedUser, type TestUser } from './support/users';

const CLIENT_SHELL_CACHE = 'public, max-age=0, s-maxage=86400';
const LOCAL_ONLY = 'reads or seeds the local Convex backend';

/** Sign-up form order (mockup "Focus order", without #63's two Sign in links). */
const SIGN_UP_ORDER = [
  'a[href$="#main"]',
  'header a[href="/"]',
  '#name',
  '#email',
  '#password',
  'button[aria-controls="password"]',
  '#adult',
  'button[type="submit"]',
];

const password = (page: Page) => page.locator('#password');
const field = (page: Page, id: string) => page.locator(`#${id}`);
const fieldError = (page: Page, id: string) => page.locator(`#${id}-error`);
const adult = (page: Page) => page.getByRole('checkbox', { name: 'I am 18 or older' });
const createAccount = (page: Page) => page.getByRole('button', { name: /Create account/ });

async function fillForm(page: Page, user: TestUser, { confirm = true } = {}): Promise<void> {
  await field(page, 'name').fill(user.name);
  await field(page, 'email').fill(user.email);
  await password(page).fill(user.password);
  if (confirm) await adult(page).click();
}

async function signUp(page: Page, user: TestUser, path = '/sign-up'): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible();
  await fillForm(page, user);
  await createAccount(page).click();
}

/** A full-page PNG for the tester's mockup comparison, at this project's width. */
async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const width = page.viewportSize()?.width ?? 0;
  const file = join(testInfo.config.rootDir, 'screenshots', `${name}-${width}.png`);
  const png = await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  await testInfo.attach(`${name}-${width}.png`, { body: png, contentType: 'image/png' });
}

test.describe('sign-up', () => {
  test('raw /sign-up, /app, and /app/x: 200 with the empty client shell, cacheable as a shell', async ({
    request,
  }) => {
    for (const path of ['/sign-up', '/sign-up?returnTo=%2Fapp', '/app', '/app/x', '/app/x/y']) {
      const { status, headers, html } = await fetchRawHtml(request, path);
      expect(status, path).toBe(200);
      expect(headers['cache-control']?.replace(/\s+/g, ''), path).toBe(
        CLIENT_SHELL_CACHE.replace(/\s+/g, ''),
      );
      expect(headers['content-type'], path).toContain('text/html');
      // No server render: the root is empty, so no guard, page, or auth code ran on the server.
      expect(html, path).toMatch(/<app-root><\/app-root>/);
      expect(html, path).not.toMatch(/<h1\b/);
      expect(html, path).not.toContain('Create your account');
      expect(html, path).not.toContain('Page not found');
      expect(html, path).not.toContain('returnTo');
    }
  });

  test('a signed-out visitor opening /app goes to /sign-up?returnTo=/app', async ({ page }) => {
    await page.goto('/app');
    await expect(page).toHaveURL(/\/sign-up\?/);
    expect(new URL(page.url()).pathname).toBe('/sign-up');
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/app');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeVisible();
    await expect(page).toHaveTitle('Create an account | Omni League');
  });

  test('the empty form: fields, policy text, Show password, axe, and Tab order', async ({
    page,
  }, testInfo) => {
    await page.goto('/sign-up');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeVisible();
    await expect(page.getByText('All fields are required.')).toBeVisible();
    await expect(field(page, 'name')).toHaveAttribute('autocomplete', 'name');
    await expect(field(page, 'email')).toHaveAttribute('autocomplete', 'email');
    await expect(password(page)).toHaveAttribute('autocomplete', 'new-password');
    await expect(password(page)).toHaveAttribute('aria-describedby', 'password-description');
    await expect(page.locator('#password-description')).toHaveText(
      'At least 15 characters; a phrase of several words works.',
    );
    for (const absent of [/Forgot password/i, /Google/, /verif/i]) {
      await expect(page.getByText(absent)).toHaveCount(0);
    }
    // 36px controls, and 16px input text on phones so iOS does not zoom (PR #96 decision 5).
    const show = page.getByRole('button', { name: 'Show password' });
    for (const control of [field(page, 'name'), password(page), show, createAccount(page)]) {
      expect((await control.boundingBox())?.height).toBe(36);
    }
    const phone = (page.viewportSize()?.width ?? 0) < 768;
    for (const id of ['name', 'email', 'password']) {
      await expect(field(page, id)).toHaveCSS('font-size', phone ? '16px' : '14px');
    }
    await screenshot(page, testInfo, '62-sign-up-empty');

    await show.click();
    await expect(password(page)).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'Hide password' })).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Your password is shown.' }),
    ).toHaveCount(1);
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(password(page)).toHaveAttribute('type', 'password');

    await expectAccessible(page, { expectedOrder: SIGN_UP_ORDER });
  });

  test('field errors: next to each field with aria-invalid and aria-describedby; nothing is created', async ({
    page,
  }, testInfo) => {
    const user = newUser('Invalid');
    await page.goto('/sign-up');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeVisible();

    // Submitted empty: every field's error, focus on Name.
    await createAccount(page).click();
    const empty: [string, string][] = [
      ['name', 'Enter your name.'],
      ['email', 'Enter your email address.'],
      ['password', 'Enter a password.'],
      ['adult', 'Confirm that you are 18 or older to create an account.'],
    ];
    for (const [id, message] of empty) {
      await expect(fieldError(page, id)).toHaveText(message);
      await expect(field(page, id)).toHaveAttribute('aria-invalid', 'true');
      await expect(field(page, id)).toHaveAttribute(
        'aria-describedby',
        new RegExp(`\\b${id}-error\\b`),
      );
    }
    await expect(field(page, 'name')).toBeFocused();
    await screenshot(page, testInfo, '62-sign-up-errors-required');
    await expectAccessible(page, { expectedOrder: SIGN_UP_ORDER });

    // Invalid email, a short password, and no 18+ confirmation.
    await fillForm(
      page,
      { ...user, email: 'maya.okafor.example.com', password: 'tenletters' },
      {
        confirm: false,
      },
    );
    await createAccount(page).click();
    await expect(fieldError(page, 'name')).toHaveCount(0);
    await expect(field(page, 'name')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(fieldError(page, 'email')).toHaveText(
      'Enter an email address like name@example.com.',
    );
    await expect(fieldError(page, 'password')).toHaveText(
      'Use at least 15 characters. This password has 10.',
    );
    await expect(fieldError(page, 'adult')).toHaveText(
      'Confirm that you are 18 or older to create an account.',
    );
    await expect(field(page, 'email')).toBeFocused();
    await screenshot(page, testInfo, '62-sign-up-errors-format');
    await expectAccessible(page, { expectedOrder: SIGN_UP_ORDER });

    // A valid password but still no 18+ confirmation: focus goes to the checkbox.
    await field(page, 'email').fill(user.email);
    await password(page).fill(user.password);
    await createAccount(page).click();
    await expect(fieldError(page, 'email')).toHaveCount(0);
    await expect(fieldError(page, 'password')).toHaveCount(0);
    await expect(adult(page)).toBeFocused();
    await expect(adult(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(`${baseURL}/sign-up`);

    if (!remoteBaseUrl) expect(await accountByEmail(user.email)).toBeNull();
  });

  test('signs up, lands on /app showing "Signed in as <name>", and Sign out goes to /', async ({
    page,
  }, testInfo) => {
    // The mockup's name, so the screenshot compares with state 10; the email is unique.
    const user = { ...newUser(), name: 'Maya Okafor' };
    const before = Date.now();
    await signUp(page, user);

    await expect(page).toHaveURL(`${baseURL}/app`);
    await expect(page).toHaveTitle('Your account | Omni League');
    await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();
    const panel = page.getByRole('region', { name: 'Signed-in account' });
    await expect(panel).toContainText('Signed in as');
    await expect(panel).toContainText(user.name);
    if (!remoteBaseUrl) {
      const account = await accountByEmail(user.email);
      expect(account).toMatchObject({ name: user.name, sessions: 1 });
      expect(account?.adultConfirmedAt).toBeGreaterThanOrEqual(before - 60_000);
    }
    await screenshot(page, testInfo, '62-app-signed-in');
    await expectAccessible(page, {
      expectedOrder: ['a[href$="#main"]', 'header a[href="/"]', 'main button'],
    });

    // Signed in, /sign-up goes straight on to /app.
    await page.goto('/sign-up');
    await expect(page).toHaveURL(`${baseURL}/app`);
    await expect(panel).toContainText(user.name);

    await panel.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
    if (!remoteBaseUrl)
      await expect.poll(async () => (await accountByEmail(user.email))?.sessions).toBe(0);

    // The session is gone in this browser too.
    await page.goto('/app');
    await expect(page).toHaveURL(/\/sign-up\?returnTo=%2Fapp$/);
  });

  test('returnTo=//evil.example/x lands on /', async ({ page }) => {
    await signUp(page, newUser('Return'), '/sign-up?returnTo=%2F%2Fevil.example%2Fx');
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
  });

  test.describe('an email that already has an account', () => {
    test.use({ expectedFailedRequests: [{ status: 422, path: '/api/auth/sign-up/email' }] });

    test('shows ADR 0008\'s "already exists" message on Email, which takes focus', async ({
      page,
    }, testInfo) => {
      test.skip(!!remoteBaseUrl, LOCAL_ONLY);
      const existing = await seedUser(newUser('Existing'));
      await page.goto('/sign-up');
      await fillForm(page, { ...newUser('Again'), email: existing.email });
      await createAccount(page).click();
      await expect(fieldError(page, 'email')).toHaveText(
        'An account with this email already exists. Sign in instead.',
      );
      await expect(field(page, 'email')).toHaveAttribute('aria-invalid', 'true');
      await expect(field(page, 'email')).toHaveAttribute('aria-describedby', 'email-error');
      // Plain text until #63 adds /sign-in.
      await expect(fieldError(page, 'email').getByRole('link')).toHaveCount(0);
      await expect(field(page, 'email')).toBeFocused();
      await expect(page).toHaveURL(`${baseURL}/sign-up`);
      expect((await accountByEmail(existing.email))?.name).toBe(existing.name);
      await screenshot(page, testInfo, '62-sign-up-exists');
      await expectAccessible(page, { expectedOrder: SIGN_UP_ORDER });
    });
  });
});
