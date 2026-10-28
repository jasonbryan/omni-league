import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { tokensSettled } from './support/auth-tokens';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, failedRequests, test } from './support/fixtures';
import { holdServiceWorkerRegistration } from './support/no-service-worker';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { accountByEmail, newUser, seedUser, type TestUser } from './support/users';
import { screenshot } from './support/screenshot';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

const LOCAL_ONLY = 'seeds a user or the throttle on the local Convex backend';
const SIGN_IN_PATH = '/api/auth/sign-in/email';

const SIGN_IN_ORDER = [
  'a[href$="#main"]',
  'header a[href="/"]',
  '#email',
  '#password',
  'button[aria-controls="password"]',
  'button[type="submit"]',
  'main p a[href^="/sign-up"]',
  'footer a[href="/"]',
  'footer a[href="/app"]',
  'footer a[href="/app/organizations/new"]',
  'footer a[href^="/sign-in"]',
];

const field = (page: Page, id: string) => page.locator(`#${id}`);
const fieldError = (page: Page, id: string) => page.locator(`#${id}-error`);
const alert = (page: Page) => page.locator('#form-error');
const submit = (page: Page) => page.getByRole('button', { name: /^Sign in|Signing in/ });
const heading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Sign in' });

async function fillForm(page: Page, email: string, password: string): Promise<void> {
  await field(page, 'email').fill(email);
  await field(page, 'password').fill(password);
}

async function press(page: Page): Promise<number> {
  const answered = page.waitForResponse((response) => response.url().endsWith(SIGN_IN_PATH));
  await submit(page).click();
  return (await answered).status();
}

async function signInAs(page: Page, user: TestUser, path = '/sign-in'): Promise<void> {
  await page.goto(path);
  await expect(heading(page)).toBeVisible();
  await fillForm(page, user.email, user.password);
  await submit(page).click();
}

test.describe('sign-in', () => {
  // Remote runs: the production build's service worker would hide the auth requests these tests
  // intercept and count.
  test.beforeEach(async ({ context }) => {
    if (remoteBaseUrl) await holdServiceWorkerRegistration(context);
  });

  test(
    'raw /sign-in: 200 with the empty client shell, kept by no shared cache',
    RAW_HTTP,
    async ({ request }) => {
      for (const path of ['/sign-in', '/sign-in?returnTo=%2Fapp']) {
        const { status, headers, html } = await fetchRawHtml(request, path);
        expect(status, path).toBe(200);
        expect(headers['cache-control']?.replace(/\s+/g, ''), path).toBe(
          'public,max-age=0,must-revalidate',
        );
        expect(html, path).toMatch(/<app-root><\/app-root>/);
        expect(html, path).not.toMatch(/<h1\b/);
        expect(html, path).not.toContain('returnTo');
      }
    },
  );

  test('the empty form: fields, no policy text, Show password, axe, and Tab order', async ({
    page,
    hasTouch,
  }, testInfo) => {
    await page.goto('/sign-in?returnTo=%2Fleagues%2Fsandbar-summer-doubles%2Fregister');
    await expect(heading(page)).toBeVisible();
    await expect(page).toHaveTitle('Sign in | Omni League');
    await expect(field(page, 'email')).toHaveAttribute('autocomplete', 'email');
    await expect(field(page, 'password')).toHaveAttribute('autocomplete', 'current-password');
    for (const absent of [/Forgot password/i, /Google/, /verif/i, /at least 15/i]) {
      await expect(page.getByText(absent)).toHaveCount(0);
    }
    await expect(page.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/sign-up?returnTo=%2Fleagues%2Fsandbar-summer-doubles%2Fregister',
    );
    await expect(page.locator('header').getByText('Sign in')).toHaveCount(0);
    // Phones use 16px input text so iOS does not zoom.
    const show = page.getByRole('button', { name: 'Show password' });
    for (const control of [field(page, 'email'), field(page, 'password'), show, submit(page)]) {
      expect((await control.boundingBox())?.height).toBe(hasTouch ? 44 : 36);
    }
    const phone = (page.viewportSize()?.width ?? 0) < 768;
    for (const id of ['email', 'password']) {
      await expect(field(page, id)).toHaveCSS('font-size', phone ? '16px' : '14px');
    }
    await screenshot(page, testInfo, '63-sign-in-empty');

    await show.click();
    await expect(field(page, 'password')).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'Hide password' })).toBeVisible();
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(field(page, 'password')).toHaveAttribute('type', 'password');

    await expectAccessible(page, { expectedOrder: SIGN_IN_ORDER });
  });

  test('submitted empty, and a malformed email: errors under the fields, nothing is sent', async ({
    page,
  }, testInfo) => {
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith(SIGN_IN_PATH)) requests.push(request.url());
    });
    await page.goto('/sign-in');
    await expect(heading(page)).toBeVisible();
    await submit(page).click();
    await expect(fieldError(page, 'email')).toHaveText('Enter your email address.');
    await expect(fieldError(page, 'password')).toHaveText('Enter your password.');
    for (const id of ['email', 'password']) {
      await expect(field(page, id)).toHaveAttribute('aria-invalid', 'true');
      await expect(field(page, id)).toHaveAttribute('aria-describedby', `${id}-error`);
    }
    await expect(field(page, 'email')).toBeFocused();
    await screenshot(page, testInfo, '63-sign-in-errors-required');
    await expectAccessible(page, { expectedOrder: SIGN_IN_ORDER });

    await fillForm(page, 'maya.okafor.example.com', 'x');
    await submit(page).click();
    await expect(fieldError(page, 'email')).toHaveText(
      'Enter an email address like name@example.com.',
    );
    await expect(fieldError(page, 'password')).toHaveCount(0);
    await expect(field(page, 'email')).toBeFocused();
    expect(requests).toEqual([]);
  });

  test(
    'a seeded user signs in at /sign-in?returnTo=/app and lands on /app signed in',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      test.skip(!!remoteBaseUrl, LOCAL_ONLY);
      const user = await seedUser();
      const tokens = tokensSettled(page);
      await signInAs(page, user, '/sign-in?returnTo=%2Fapp');
      await expect(page).toHaveURL(`${baseURL}/app`);
      await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
      await expect(
        page.getByRole('link', { name: `Account settings: ${user.name}` }),
      ).toBeVisible();
      await tokens;
      expect((await accountByEmail(user.email))?.sessions).toBeGreaterThanOrEqual(1);

      await page.goto('/sign-in');
      await expect(page).toHaveURL(`${baseURL}/app`);
    },
  );

  test('with no returnTo, sign-in lands on /app', VIEWPORT_AGNOSTIC, async ({ page }) => {
    test.skip(!!remoteBaseUrl, LOCAL_ONLY);
    const user = await seedUser();
    await signInAs(page, user);
    await expect(page).toHaveURL(`${baseURL}/app`);
  });

  test(
    'a returnTo to a public page lands there, with the account link in the top bar',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      test.skip(!!remoteBaseUrl, LOCAL_ONLY);
      const user = await seedUser();
      await signInAs(page, user, '/sign-in?returnTo=%2Fno-such-page');
      await expect(page).toHaveURL(`${baseURL}/no-such-page`);
      await expect(page.getByRole('link', { name: `Account: ${user.name}` })).toBeVisible();
    },
  );

  for (const raw of ['//evil.example/x', '/\\evil.example', 'https://evil.example']) {
    test(
      `returnTo=${JSON.stringify(raw)} lands on / after sign-in`,
      VIEWPORT_AGNOSTIC,
      async ({ page, context }) => {
        test.skip(!!remoteBaseUrl, LOCAL_ONLY);
        const offSite: string[] = [];
        context.on('request', (request) => {
          if (new URL(request.url()).hostname.includes('evil')) offSite.push(request.url());
        });
        const user = await seedUser();
        const tokens = tokensSettled(page);
        await signInAs(page, user, `/sign-in?returnTo=${encodeURIComponent(raw)}`);
        await expect(page).toHaveURL(`${baseURL}/`);
        await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
        await tokens;
        expect(offSite).toEqual([]);
      },
    );
  }

  for (const page of ['/sign-in', '/sign-up']) {
    test(
      `a signed-in visitor opening ${page} goes to the valid returnTo, else /app`,
      VIEWPORT_AGNOSTIC,
      async ({ page: browser }) => {
        test.skip(!!remoteBaseUrl, LOCAL_ONLY);
        const user = await seedUser();
        const first = tokensSettled(browser);
        await signInAs(browser, user, '/sign-in?returnTo=%2Fapp');
        await expect(browser).toHaveURL(`${baseURL}/app`);
        await first;
        const cases: [query: string, landing: string][] = [
          ['?returnTo=%2Fapp', '/app'],
          ['', '/app'],
          ['?returnTo=%2F%2Fevil.example%2Fx', '/app'],
          ['?returnTo=https%3A%2F%2Fevil.example', '/app'],
          ['?returnTo=%2Fno-such-page', '/no-such-page'],
        ];
        for (const [query, landing] of cases) {
          const tokens = tokensSettled(browser);
          await browser.goto(`${page}${query}`);
          await browser.waitForURL((url) => url.pathname === landing);
          await tokens;
          expect(new URL(browser.url()).pathname, query).toBe(landing);
        }
      },
    );
  }

  test.describe('a wrong password', () => {
    test.use({ expectedFailedRequests: [{ status: 401, path: SIGN_IN_PATH }] });

    test('a wrong password and an unknown email get the same answer; the values stay', async ({
      page,
    }, testInfo) => {
      test.skip(!!remoteBaseUrl, LOCAL_ONLY);
      const user = await seedUser();
      const wrong = 'not the right password';
      const answers: { status: number; text: string }[] = [];
      for (const email of [user.email, newUser('Nobody').email]) {
        await page.goto('/sign-in');
        await expect(heading(page)).toBeVisible();
        await fillForm(page, email, wrong);
        const status = await press(page);
        await expect(alert(page)).toBeVisible();
        answers.push({ status, text: (await alert(page).innerText()).replace(/\s+/g, ' ') });
        await expect(alert(page)).toBeFocused();
        for (const id of ['email', 'password']) {
          await expect(field(page, id)).not.toHaveAttribute('aria-invalid', 'true');
          await expect(fieldError(page, id)).toHaveCount(0);
        }
        await expect(field(page, 'email')).toHaveValue(email);
        await expect(field(page, 'password')).toHaveValue(wrong);
        await page.getByRole('button', { name: 'Show password' }).click();
        await expect(field(page, 'password')).toHaveValue(wrong);
        await expect(field(page, 'password')).toHaveAttribute('type', 'text');
      }
      expect(answers[0]?.status).toBe(401);
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[0]?.text).toBe('Email or password is incorrect. Check both and try again.');
      await screenshot(page, testInfo, '63-sign-in-incorrect');
      await expectAccessible(page, { expectedOrder: SIGN_IN_ORDER });
      expect((await accountByEmail(user.email))?.sessions).toBe(1);
    });
  });

  test.describe('too many attempts', () => {
    test.use({
      expectedFailedRequests: failedRequests(
        { status: 401, path: SIGN_IN_PATH },
        { status: 429, path: SIGN_IN_PATH },
      ),
    });

    async function fiveWrongThenCorrect(page: Page, known: boolean): Promise<TestUser> {
      const user = await seedUser();
      const email = known ? user.email : newUser('Ghost').email;
      await page.goto('/sign-in');
      await expect(heading(page)).toBeVisible();
      await fillForm(page, email, 'wrong password number one');
      for (let attempt = 1; attempt <= 5; attempt++) {
        expect(await press(page), `attempt ${attempt}`).toBe(401);
      }
      await field(page, 'password').fill(user.password);
      expect(await press(page)).toBe(429);
      await expect(alert(page)).toContainText('Too many attempts. Try again in 1 minute.');
      await expect(alert(page)).toContainText(
        'Sign-in for this email address is paused after several incorrect passwords.',
      );
      await expect(page).toHaveURL(`${baseURL}/sign-in`);
      await expect(field(page, 'email')).toHaveValue(email);
      await expect(submit(page)).not.toHaveAttribute('aria-disabled', 'true');
      return user;
    }

    // The unknown address gets the same answer and needs no screenshot, focus or accessibility
    // check, so it runs in one project; the known address runs at both widths with those checks.
    test(
      'an unknown address: five 401s, then 429 with the wait, even for the correct password',
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
        test.skip(!!remoteBaseUrl, LOCAL_ONLY);
        await fiveWrongThenCorrect(page, false);
      },
    );

    test('a known address: five 401s, then 429 with the wait, even for the correct password', async ({
      page,
    }, testInfo) => {
      test.skip(!!remoteBaseUrl, LOCAL_ONLY);
      const user = await fiveWrongThenCorrect(page, true);
      await expect(alert(page)).toBeFocused();
      expect((await accountByEmail(user.email))?.sessions).toBe(1);
      await screenshot(page, testInfo, '63-sign-in-throttled');
      await expectAccessible(page, { expectedOrder: SIGN_IN_ORDER });
    });
  });

  test.describe('the hard limit', () => {
    test.use({ expectedFailedRequests: [{ status: 429, path: SIGN_IN_PATH }] });

    async function lockedWithCorrectPassword(page: Page, known: boolean): Promise<TestUser> {
      const user = await seedUser();
      const email = known ? user.email : newUser('Ghost').email;
      await convexRun('testing:seedSignInFailures', { email, failures: 100 });
      await page.goto('/sign-in');
      await expect(heading(page)).toBeVisible();
      await fillForm(page, email, user.password);
      expect(await press(page)).toBe(429);
      await expect(alert(page)).toContainText('Password sign-in is locked for this email address.');
      await expect(alert(page)).toContainText(
        'There have been too many incorrect attempts. Contact the Omni League team to unlock it.',
      );
      await expect(field(page, 'password')).toHaveValue(user.password);
      return user;
    }

    test(
      'an unknown address at 100 failures: the lock text, with the correct password',
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
        test.skip(!!remoteBaseUrl, LOCAL_ONLY);
        await lockedWithCorrectPassword(page, false);
      },
    );

    test('a known address at 100 failures: the lock text, with the correct password', async ({
      page,
    }, testInfo) => {
      test.skip(!!remoteBaseUrl, LOCAL_ONLY);
      const user = await lockedWithCorrectPassword(page, true);
      await expect(alert(page)).toBeFocused();
      expect((await accountByEmail(user.email))?.sessions).toBe(1);
      await screenshot(page, testInfo, '63-sign-in-locked');
      await expectAccessible(page, { expectedOrder: SIGN_IN_ORDER });
    });
  });

  test.describe('a server error', () => {
    test.use({ expectedFailedRequests: [{ status: 500, path: SIGN_IN_PATH }] });

    test('shows the generic alert and keeps the values', async ({ page }, testInfo) => {
      await page.route(`**${SIGN_IN_PATH}`, (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'boom' }),
        }),
      );
      await page.goto('/sign-in');
      await expect(heading(page)).toBeVisible();
      await fillForm(page, 'maya.okafor@example.com', 'sandbar sunset spike 2026');
      await submit(page).click();
      await expect(alert(page)).toContainText('Sign-in could not be completed.');
      await expect(alert(page)).toContainText('Check your connection and try again.');
      await expect(alert(page)).toBeFocused();
      await expect(field(page, 'email')).toHaveValue('maya.okafor@example.com');
      await screenshot(page, testInfo, '63-sign-in-generic-error');
    });

    test('Submitting: "Signing in…", aria-disabled, and a second press sends nothing', async ({
      page,
    }, testInfo) => {
      let requests = 0;
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route(`**${SIGN_IN_PATH}`, async (route) => {
        requests += 1;
        await held;
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      });
      await page.goto('/sign-in');
      await expect(heading(page)).toBeVisible();
      await fillForm(page, 'maya.okafor@example.com', 'sandbar sunset spike 2026');
      await submit(page).click();
      const busy = page.getByRole('button', { name: 'Signing in…' });
      await expect(busy).toHaveAttribute('aria-disabled', 'true');
      await expect(page.getByRole('status').filter({ hasText: 'Signing in.' })).toHaveCount(1);
      await screenshot(page, testInfo, '63-sign-in-submitting');
      await busy.click({ force: true });
      release();
      await expect(alert(page)).toBeVisible();
      expect(requests).toBe(1);
    });
  });
});
