import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { tokensSettled } from './support/auth-tokens';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdServiceWorkerRegistration } from './support/no-service-worker';
import { signUp } from './support/session';
import { screenshot } from './support/screenshot';
import { seedTenant } from './support/tenant';
import { newUser, seedUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

const LOCAL_ONLY = 'seeds a tenant or a user on the local Convex backend';
const ACCOUNT_PATH = '/app/account';
const SIGN_OUT_PATH = '/api/auth/sign-out';
const TOUCH_TARGET = 44;
const NARROWEST_VIEWPORT = { width: 320, height: 640 };

const signOutButton = (page: Page) => page.getByRole('button', { name: /^Sign out|Signing out/ });
const details = (page: Page) => page.getByRole('region', { name: 'Your details' });
const topBarLink = (page: Page) => page.locator('header a[href="/app/account"]');

async function openAccountSettings(page: Page, name: string): Promise<void> {
  await page.goto(ACCOUNT_PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'Account settings' })).toBeVisible();
  await expect(details(page)).toContainText(name);
}

test.describe('account settings', () => {
  test.beforeEach(async ({ context }) => {
    if (remoteBaseUrl) await holdServiceWorkerRegistration(context);
  });

  test('shows the title, the h1, the name and email, and Sign out', async ({ page }, testInfo) => {
    const user = { ...newUser(), name: 'Maya Okafor' };
    await signUp(page, user);
    await openAccountSettings(page, user.name);

    await expect(page).toHaveTitle('Account settings | Omni League');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(details(page)).toContainText(user.email);
    await expect(signOutButton(page)).toHaveText('Sign out');
    await screenshot(page, testInfo, 'account-settings');
  });

  test('passes axe at the viewport width, 44px Sign out on touch screens, and no horizontal scroll at 320px', async ({
    page,
  }) => {
    const user = newUser('Axe');
    await signUp(page, user);
    await openAccountSettings(page, user.name);
    await expectAccessible(page);

    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    if (coarse) {
      const box = await signOutButton(page).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_TARGET);
    }

    await page.setViewportSize(NARROWEST_VIEWPORT);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the top bar link inside the app opens it, and on a public page it still opens /app', async ({
    page,
  }) => {
    test.skip(!!remoteBaseUrl, LOCAL_ONLY);
    const user = newUser('Link');
    const tenant = await seedTenant();
    await signUp(page, user);
    await expect(page).toHaveURL(`${baseURL}/app`);
    await expect(topBarLink(page)).toHaveAccessibleName(`Account settings: ${user.name}`);
    await expect(topBarLink(page)).not.toHaveAttribute('aria-current');

    await topBarLink(page).click();
    await expect(page).toHaveURL(`${baseURL}${ACCOUNT_PATH}`);
    await expect(page).toHaveTitle('Account settings | Omni League');
    await expect(topBarLink(page)).toHaveAttribute('aria-current', 'page');

    await page.goto(tenant.path);
    await expect(page.locator('header a[href="/app"]')).toHaveAccessibleName(
      `Account: ${user.name}`,
    );
  });

  test('/app is Home, with no Sign out', async ({ page }) => {
    await signUp(page, newUser('Home'));
    await expect(page).toHaveURL(`${baseURL}/app`);
    await expect(page).toHaveTitle('Home | Omni League');
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  });

  test.describe('signed out', VIEWPORT_AGNOSTIC, () => {
    test('opening it redirects to sign-in with returnTo', async ({ page }) => {
      await page.goto(ACCOUNT_PATH);
      await expect(page).toHaveURL(`${baseURL}/sign-in?returnTo=%2Fapp%2Faccount`);
    });
  });

  test.describe('Sign out', VIEWPORT_AGNOSTIC, () => {
    test('ends the session and goes to /; Back and a reload of /app land on sign-in', async ({
      page,
    }) => {
      const user = newUser('Out');
      await signUp(page, user);
      await openAccountSettings(page, user.name);

      const signedOut = page.waitForResponse((r) => r.url().endsWith(SIGN_OUT_PATH));
      await signOutButton(page).click();
      expect((await signedOut).ok()).toBe(true);
      await expect(page).toHaveURL(`${baseURL}/`);
      await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
      await expect(page.locator('header a[href^="/sign-in"]')).toBeVisible();

      await page.goBack();
      await expect(page).toHaveURL(`${baseURL}/sign-in?returnTo=%2Fapp%2Faccount`);

      await page.goto('/app');
      await expect(page).toHaveURL(`${baseURL}/sign-in?returnTo=%2Fapp`);
    });

    test('reads "Signing out…" while the request is pending', async ({ page }) => {
      const user = newUser('Pending');
      await signUp(page, user);
      await openAccountSettings(page, user.name);

      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route(
        (url) => url.pathname === SIGN_OUT_PATH,
        async (route) => {
          await held;
          await route.continue();
        },
      );
      await signOutButton(page).click();
      await expect(signOutButton(page)).toHaveText('Signing out…');
      await expect(signOutButton(page)).toHaveAttribute('aria-disabled', 'true');
      release();
      await expect(page).toHaveURL(`${baseURL}/`);
    });

    test.describe('when the request is refused', () => {
      test.use({ expectedFailedRequests: [{ status: 500, path: SIGN_OUT_PATH }] });

      test('still signs this browser out and goes to /', async ({ page }) => {
        const user = newUser('Failing');
        await signUp(page, user);
        await openAccountSettings(page, user.name);

        await page.route(
          (url) => url.pathname === SIGN_OUT_PATH,
          (route) =>
            route.fulfill({
              status: 500,
              headers: {
                'access-control-allow-origin': new URL(baseURL).origin,
                'access-control-allow-credentials': 'true',
                'content-type': 'application/json',
              },
              body: '{"message":"boom"}',
            }),
        );
        await signOutButton(page).click();
        await expect(page).toHaveURL(`${baseURL}/`);

        await page.goto('/app');
        await expect(page).toHaveURL(`${baseURL}/sign-in?returnTo=%2Fapp`);
      });
    });
  });

  test('a second user who signs in right after sees their own name and email, never the first', async ({
    page,
  }) => {
    test.skip(!!remoteBaseUrl, LOCAL_ONLY);
    const alice = newUser('Alice');
    const bob = await seedUser(newUser('Bob'));
    await signUp(page, alice);
    await openAccountSettings(page, alice.name);
    await expect(details(page)).toContainText(alice.email);

    await signOutButton(page).click();
    await expect(page).toHaveURL(`${baseURL}/`);

    // Client-side navigation from here keeps this document, so the observer sees every state the page shows.
    await page.evaluate(
      ([name, email]) => {
        const win = window as Window & { aliceShown?: boolean };
        win.aliceShown = false;
        new MutationObserver(() => {
          const text = document.body.textContent ?? '';
          if (text.includes(name) || text.includes(email)) win.aliceShown = true;
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
      },
      [alice.name, alice.email],
    );

    await page.locator('header a[href^="/sign-in"]').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    const tokens = tokensSettled(page);
    await page.locator('#email').fill(bob.email);
    await page.locator('#password').fill(bob.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await tokens;

    await page.locator('header a[href="/app"]').click();
    await expect(page).toHaveURL(`${baseURL}/app`);
    await topBarLink(page).click();
    await expect(page).toHaveURL(`${baseURL}${ACCOUNT_PATH}`);
    await expect(details(page)).toContainText(bob.name);
    await expect(details(page)).toContainText(bob.email);
    await expect(details(page)).not.toContainText(alice.name);
    expect(
      await page.evaluate(() => (window as Window & { aliceShown?: boolean }).aliceShown),
    ).toBe(false);
  });
});
