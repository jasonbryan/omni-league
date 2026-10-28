import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { tokensSettled } from './support/auth-tokens';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { holdServiceWorkerRegistration } from './support/no-service-worker';
import { accountByEmail, newUser, seedUser, type TestUser } from './support/users';
import { screenshot } from './support/screenshot';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

const CLIENT_SHELL_CACHE = 'public, max-age=0, must-revalidate';
const LOCAL_ONLY = 'reads or seeds the local Convex backend';

const SIGN_UP_ORDER = [
  'a[href$="#main"]',
  'header a[href="/"]',
  'header a[href^="/sign-in"]',
  '#name',
  '#email',
  '#password',
  'button[aria-controls="password"]',
  '#adult',
  'button[type="submit"]',
  'main p a[href^="/sign-in"]',
  'footer a[href="/"]',
  'footer a[href="/app"]',
  'footer a[href="/app/organizations/new"]',
  'footer a[href^="/sign-in"]',
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

test.describe('sign-up', () => {
  // Remote runs: the production build's service worker would hide the auth requests these tests
  // intercept and count.
  test.beforeEach(async ({ context }) => {
    if (remoteBaseUrl) await holdServiceWorkerRegistration(context);
  });

  test(
    'raw /sign-up, /app, and /app/x: 200 with the empty client shell, kept by no shared cache',
    RAW_HTTP,
    async ({ request }) => {
      for (const path of ['/sign-up', '/sign-up?returnTo=%2Fapp', '/app', '/app/x', '/app/x/y']) {
        const { status, headers, html } = await fetchRawHtml(request, path);
        expect(status, path).toBe(200);
        expect(headers['cache-control']?.replace(/\s+/g, ''), path).toBe(
          CLIENT_SHELL_CACHE.replace(/\s+/g, ''),
        );
        expect(headers['content-type'], path).toContain('text/html');
        expect(html, path).toMatch(/<app-root><\/app-root>/);
        expect(html, path).not.toMatch(/<h1\b/);
        expect(html, path).not.toContain('Create your account');
        expect(html, path).not.toContain('Page not found');
        expect(html, path).not.toContain('returnTo');
      }
    },
  );

  test(
    'a signed-out visitor opening /app goes to /sign-in?returnTo=/app',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      await page.goto('/app');
      await expect(page).toHaveURL(/\/sign-in\?/);
      expect(new URL(page.url()).pathname).toBe('/sign-in');
      expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/app');
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
      await expect(page).toHaveTitle('Sign in | Omni League');
    },
  );

  test('the empty form: fields, policy text, Show password, axe, and Tab order', async ({
    page,
    hasTouch,
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
    await expect(page.locator('header').getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/sign-in?returnTo=%2Fapp',
    );
    await expect(
      page.getByText('Already have an account?').locator('a', { hasText: 'Sign in' }),
    ).toHaveAttribute('href', '/sign-in?returnTo=%2Fapp');
    // Phones use 16px input text so iOS does not zoom.
    const show = page.getByRole('button', { name: 'Show password' });
    for (const control of [field(page, 'name'), password(page), show, createAccount(page)]) {
      expect((await control.boundingBox())?.height).toBe(hasTouch ? 44 : 36);
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

  test('a field is checked when the user leaves it, and the error clears as they fix it', async ({
    page,
  }) => {
    await page.goto('/sign-up');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeVisible();

    await field(page, 'name').focus();
    await page.keyboard.press('Tab');
    await expect(field(page, 'email')).toBeFocused();
    await expect(fieldError(page, 'name')).toHaveCount(0);
    await page.keyboard.type('maya.okafor.example.com');
    await expect(fieldError(page, 'email')).toHaveCount(0);

    await page.keyboard.press('Tab');
    await expect(fieldError(page, 'email')).toHaveText(
      'Enter an email address like name@example.com.',
    );
    await expect(field(page, 'email')).toHaveAttribute('aria-invalid', 'true');
    await expect(field(page, 'email')).toHaveAttribute('aria-describedby', 'email-error');
    await expect(fieldError(page, 'name')).toHaveCount(0);
    await expectAccessible(page, { expectedOrder: SIGN_UP_ORDER });

    await field(page, 'email').fill('maya.okafor@example.com');
    await expect(fieldError(page, 'email')).toHaveCount(0);
    await expect(field(page, 'email')).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page).toHaveURL(`${baseURL}/sign-up`);
  });

  test('Password is checked once focus leaves it and its Show button, by keyboard and by mouse', async ({
    page,
  }) => {
    const short = 'Use at least 15 characters. This password has 10.';
    await page.goto('/sign-up');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeVisible();

    await field(page, 'password').focus();
    await page.keyboard.type('tenletters');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: /Show password/ })).toBeFocused();
    await expect(fieldError(page, 'password')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(adult(page)).toBeFocused();
    await expect(fieldError(page, 'password')).toHaveText(short);
    await expect(field(page, 'password')).toHaveAttribute('aria-invalid', 'true');

    await page.reload();
    await field(page, 'password').fill('tenletters');
    await page.getByRole('button', { name: /Show password/ }).click();
    await expect(field(page, 'password')).toHaveAttribute('type', 'text');
    await expect(fieldError(page, 'password')).toHaveCount(0);
    await field(page, 'name').click();
    await expect(fieldError(page, 'password')).toHaveText(short);
  });

  test('the Password error is announced as an alert, linked to the field, and passes axe', async ({
    page,
  }) => {
    await page.goto('/sign-up');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeVisible();

    await field(page, 'password').focus();
    await page.keyboard.type('tenletters');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: /Show password/ })).toBeFocused();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(adult(page)).toBeFocused();
    const alert = page.getByRole('alert');
    await expect(alert).toHaveCount(1);
    await expect(alert).toHaveText('Use at least 15 characters. This password has 10.');
    await expect(alert).toHaveAttribute('id', 'password-error');
    await expect(field(page, 'password')).toHaveAttribute('aria-invalid', 'true');
    await expect(field(page, 'password')).toHaveAttribute(
      'aria-describedby',
      /(^|\s)password-error(\s|$)/,
    );
    await expectAccessible(page, { expectedOrder: SIGN_UP_ORDER });
  });

  test('signs up, lands on /app, and Sign out on Account settings goes to /', async ({
    page,
  }, testInfo) => {
    // The mockup's name, so the screenshot compares with the mockup; the email is unique.
    const user = { ...newUser(), name: 'Maya Okafor' };
    const before = Date.now();
    await signUp(page, user);

    await expect(page).toHaveURL(`${baseURL}/app`);
    await expect(page).toHaveTitle('Home | Omni League');
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await expect(page.getByRole('link', { name: `Account settings: ${user.name}` })).toBeVisible();
    if (!remoteBaseUrl) {
      const account = await accountByEmail(user.email);
      expect(account).toMatchObject({ name: user.name, sessions: 1 });
      expect(account?.adultConfirmedAt).toBeGreaterThanOrEqual(before - 60_000);
    }
    await screenshot(page, testInfo, '62-app-signed-in');
    await expectAccessible(page, {
      expectedOrder: [
        'a[href$="#main"]',
        'header a[href="/"]',
        'header a[href="/app/account"]',
        'main a[href="/app/organizations/new"]',
      ],
    });

    await page.goto('/sign-up');
    await expect(page).toHaveURL(`${baseURL}/app`);

    await page.getByRole('link', { name: `Account settings: ${user.name}` }).click();
    const panel = page.getByRole('region', { name: 'Your details' });
    await expect(page).toHaveURL(`${baseURL}/app/account`);
    await expect(panel).toContainText(user.name);
    await expect(panel).toContainText(user.email);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
    if (!remoteBaseUrl)
      await expect.poll(async () => (await accountByEmail(user.email))?.sessions).toBe(0);

    await page.goto('/app');
    await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fapp$/);
  });

  test('returnTo=//evil.example/x lands on /', VIEWPORT_AGNOSTIC, async ({ page }) => {
    await signUp(page, newUser('Return'), '/sign-up?returnTo=%2F%2Fevil.example%2Fx');
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
  });

  for (const raw of [
    'https://evil.example/x',
    '/\\evil.example/x',
    '%2F%2Fevil.example%2Fx',
    '/..//evil.example/x',
    '/.//evil.example/x',
    '/%2e%2e//evil.example/x',
  ]) {
    test(
      `returnTo=${JSON.stringify(raw)} lands on / after sign-up and on /app when signed in`,
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
        const query = `?returnTo=${encodeURIComponent(raw)}`;
        const tokens = tokensSettled(page);
        await signUp(page, newUser('Variant'), `/sign-up${query}`);
        await expect(page).toHaveURL(`${baseURL}/`);
        await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
        await tokens;

        await page.goto(`/sign-up${query}`);
        await expect(page).toHaveURL(`${baseURL}/app`);
        await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
      },
    );
  }

  test(
    'every returnTo keeps a signed-in visitor on this site',
    VIEWPORT_AGNOSTIC,
    async ({ page, context }) => {
      test.setTimeout(120_000);
      const offSite: string[] = [];
      context.on('request', (request) => {
        if (new URL(request.url()).hostname.includes('evil')) offSite.push(request.url());
      });
      const first = tokensSettled(page);
      await signUp(page, newUser('Fuzz'));
      await expect(page).toHaveURL(`${baseURL}/app`);
      await first;
      const cases: [raw: string, landing: string | null][] = [
        ['/..//evil.example/x', '/app'],
        ['/%2e%2e%2f%2fevil.example', null],
        ['/%2e%2e%5c%5cevil.example', null],
        ['/..\\\\evil.example', '/app'],
        ['/.\\/evil.example', '/app'],
        ['/\t/evil.example', '/app'],
        ['/.\n.//evil.example', '/app'],
        ['/%2F%2Fevil.example', null],
        ['/%5Cevil.example', null],
        ['/／／evil.example', null],
        ['/．．//evil.example', null],
        ['/x#//evil.example', null],
        ['/app?next=//evil.example', null],
        ['/@evil.example', null],
        ['javascript:alert(1)', '/app'],
        ['data:text/html,<script>alert(1)</script>', '/app'],
        ['//evil.example', '/app'],
        ['https://evil.example/app', '/app'],
        [`${baseURL}/app`, '/app'],
        [`/${'a'.repeat(4_000)}`, null],
      ];
      for (const [raw, landing] of cases) {
        const tokens = tokensSettled(page);
        await page.goto(`/sign-up?returnTo=${encodeURIComponent(raw)}`);
        await page.waitForURL((url) => url.pathname !== '/sign-up');
        await tokens;
        const url = new URL(page.url());
        expect(url.origin, raw).toBe(new URL(baseURL).origin);
        expect(url.pathname.startsWith('//'), `${raw} -> ${url.pathname}`).toBe(false);
        if (landing) expect(url.pathname, raw).toBe(landing);
      }
      expect(offSite).toEqual([]);
    },
  );

  // Better Auth 1.6 refuses a malformed email with 400 VALIDATION_ERROR (convex/auth.test.ts pins
  // the message). The page cannot send one today, so the response is replaced: an email-only
  // refusal shows on Email; one that also names another field is the generic alert.
  test.describe('a VALIDATION_ERROR refusal', VIEWPORT_AGNOSTIC, () => {
    test.use({ expectedFailedRequests: [{ status: 400, path: '/api/auth/sign-up/email' }] });

    for (const [message, onEmail] of [
      ['[body.email] Invalid email address', true],
      [
        '[body.name] Invalid input: expected string, received number; [body.email] Invalid email address',
        false,
      ],
    ] as const) {
      test(`${onEmail ? 'on email only shows on Email' : 'on two fields is the generic alert'}`, async ({
        page,
      }) => {
        await page.route('**/api/auth/sign-up/email', (route) =>
          route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({ code: 'VALIDATION_ERROR', message }),
          }),
        );
        await signUp(page, newUser('Validation'));
        if (onEmail) {
          await expect(fieldError(page, 'email')).toHaveText(
            'Enter an email address like name@example.com.',
          );
          await expect(field(page, 'email')).toHaveAttribute('aria-invalid', 'true');
          await expect(
            page.getByRole('alert').filter({ hasText: 'Sign-up could not be completed.' }),
          ).toHaveCount(0);
        } else {
          await expect(
            page.getByRole('alert').filter({ hasText: 'Sign-up could not be completed.' }),
          ).toBeVisible();
          await expect(fieldError(page, 'email')).toHaveCount(0);
        }
        await expect(page).toHaveURL(`${baseURL}/sign-up`);
      });
    }
  });

  test.describe('an email that already has an account', () => {
    test.use({ expectedFailedRequests: [{ status: 422, path: '/api/auth/sign-up/email' }] });

    test('shows the "already exists" message on Email, which takes focus', async ({
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
      await expect(
        fieldError(page, 'email').getByRole('link', { name: 'Sign in instead' }),
      ).toHaveAttribute('href', '/sign-in?returnTo=%2Fapp');
      await expect(field(page, 'email')).toBeFocused();
      await expect(page).toHaveURL(`${baseURL}/sign-up`);
      expect((await accountByEmail(existing.email))?.name).toBe(existing.name);
      await screenshot(page, testInfo, '62-sign-up-exists');
      const order = [...SIGN_UP_ORDER];
      order.splice(order.indexOf('#email') + 1, 0, '#email-error a');
      await expectAccessible(page, { expectedOrder: order });
    });
  });
});
