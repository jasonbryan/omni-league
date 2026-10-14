import type { Page } from '@playwright/test';
import { tokensSettled } from './support/auth-tokens';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdServiceWorkerRegistration } from './support/no-service-worker';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { seedTenant } from './support/tenant';
import { newUser, seedUser } from './support/users';
import { screenshot } from './support/screenshot';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

const LOCAL_ONLY = 'seeds a tenant or a user on the local Convex backend';

const signInLink = (page: Page) => page.locator('header a[href^="/sign-in"]');
const accountLink = (page: Page) => page.locator('header a[href="/app"]');

async function hydrated(consoleGuard: { hydrated: boolean }): Promise<void> {
  await expect
    .poll(() => consoleGuard.hydrated, {
      message: 'expected the dev-mode log "Angular hydrated <n> component(s)"',
    })
    .toBe(true);
}

async function signInAs(page: Page, user: { email: string; password: string }): Promise<void> {
  const tokens = tokensSettled(page);
  await page.goto('/sign-in?returnTo=%2Fapp');
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(`${baseURL}/app`);
  await tokens;
}

test.describe('top bar', () => {
  test.beforeEach(async ({ context }) => {
    if (remoteBaseUrl) await holdServiceWorkerRegistration(context);
  });

  test.describe('signed out', () => {
    test(
      'the raw HTML of a public page contains "Sign in" with the path alone as returnTo',
      RAW_HTTP,
      async ({ request }) => {
        test.skip(!!remoteBaseUrl, LOCAL_ONLY);
        const tenant = await seedTenant();
        const { status, html } = await fetchRawHtml(
          request,
          `${tenant.path}?tab=leagues&ott=SECRET-TOKEN`,
        );
        expect(status).toBe(200);
        const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
        expect(header).toMatch(/>Sign in<\/a>/);
        expect(header).toContain(`/sign-in?returnTo=${encodeURIComponent(tenant.path)}"`);
        // The CDN may store this HTML, and a query string can carry a one-time token.
        expect(html).not.toContain('SECRET-TOKEN');
        expect(header).not.toContain('Account:');
      },
    );

    test(
      'the not-found page has "Sign in" too, even in the raw HTML',
      RAW_HTTP,
      async ({ request }) => {
        const { html } = await fetchRawHtml(request, '/no/such/page');
        const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
        expect(header).toMatch(/>Sign in<\/a>/);
        expect(header).toContain('/sign-in?returnTo=%2Fno%2Fsuch%2Fpage"');
      },
    );

    test('"Sign in" carries the current path, goes to /sign-in, and is gone there', async ({
      page,
      consoleGuard,
    }, testInfo) => {
      test.skip(!!remoteBaseUrl, LOCAL_ONLY);
      const tenant = await seedTenant();
      await page.goto(`${tenant.path}?tab=leagues`);
      await hydrated(consoleGuard);
      await expect(signInLink(page)).toHaveText('Sign in');
      await expect(signInLink(page)).toHaveAttribute(
        'href',
        `/sign-in?returnTo=${encodeURIComponent(`${tenant.path}?tab=leagues`)}`,
      );
      await expect(accountLink(page)).toHaveCount(0);
      await screenshot(page, testInfo, '63-top-bar-signed-out');

      await signInLink(page).click();
      await expect(page).toHaveURL(
        `${baseURL}/sign-in?returnTo=${encodeURIComponent(`${tenant.path}?tab=leagues`)}`,
      );
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
      await expect(signInLink(page)).toHaveCount(0);
      await expect(page.locator('header')).not.toContainText('Sign in');
    });

    test(
      'on /sign-up the link carries that page’s own returnTo, and drops one that is off-site',
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
        await page.goto('/sign-up?returnTo=%2Fleagues%2Fx%2Fregister');
        await expect(
          page.getByRole('heading', { level: 1, name: 'Create your account' }),
        ).toBeVisible();
        await expect(signInLink(page).first()).toHaveAttribute(
          'href',
          '/sign-in?returnTo=%2Fleagues%2Fx%2Fregister',
        );
        for (const raw of ['//evil.example/x', '/\\evil.example', 'https://evil.example']) {
          await page.goto(`/sign-up?returnTo=${encodeURIComponent(raw)}`);
          await expect(
            page.getByRole('heading', { level: 1, name: 'Create your account' }),
          ).toBeVisible();
          const hrefs = await page
            .locator('main a[href^="/sign-in"], header a[href^="/sign-in"]')
            .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
          expect(hrefs, raw).toEqual(['/sign-in?returnTo=%2Fapp', '/sign-in?returnTo=%2Fapp']);
        }
      },
    );
  });

  test.describe('signed in', () => {
    test('a public page renders "Sign in", then the account link replaces it after hydration', async ({
      page,
      consoleGuard,
    }, testInfo) => {
      test.skip(!!remoteBaseUrl, LOCAL_ONLY);
      const user = { ...newUser(), name: 'Maya Okafor' };
      await seedUser(user);
      const tenant = await seedTenant();
      await signInAs(page, user);

      const raw = await page.request.get(tenant.path);
      expect(await raw.text()).toMatch(/>Sign in<\/a>/);

      await page.goto(tenant.path);
      await hydrated(consoleGuard);
      const link = accountLink(page);
      await expect(link).toBeVisible();
      await expect(link).toHaveAccessibleName(`Account: ${user.name}`);
      await expect(link.locator('[aria-hidden="true"]')).toHaveText('MO');
      await expect(link.locator('.truncate')).toHaveText(user.name);
      await expect(signInLink(page)).toHaveCount(0);
      await screenshot(page, testInfo, '63-top-bar-signed-in');

      await link.click();
      await expect(page).toHaveURL(`${baseURL}/app`);
      await expect(accountLink(page)).toHaveAttribute('aria-current', 'page');
    });

    test('a long name ends in an ellipsis past 144px on a phone and 256px from 768px', async ({
      page,
      consoleGuard,
    }, testInfo) => {
      test.skip(!!remoteBaseUrl, LOCAL_ONLY);
      const user = { ...newUser(), name: 'Alejandra Castellanos-Whitfield' };
      await seedUser(user);
      const tenant = await seedTenant();
      await signInAs(page, user);
      await page.goto(tenant.path);
      await hydrated(consoleGuard);

      const link = accountLink(page);
      await expect(link).toHaveAccessibleName(`Account: ${user.name}`);
      await expect(link.locator('[aria-hidden="true"]')).toHaveText('AC');
      const name = link.locator('.truncate');
      const [linkBox, truncated] = [
        await link.boundingBox(),
        await name.evaluate((el) => el.scrollWidth > el.clientWidth),
      ];
      const phone = (page.viewportSize()?.width ?? 0) < 768;
      if (phone) {
        expect(linkBox?.width).toBeLessThanOrEqual(144);
        expect(truncated).toBe(true);
        await expect(name).toHaveCSS('text-overflow', 'ellipsis');
      } else {
        expect(linkBox?.width).toBeLessThanOrEqual(256);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        page.viewportSize()?.width ?? 0,
      );
      await screenshot(page, testInfo, '63-top-bar-long-name');
    });
  });
});
