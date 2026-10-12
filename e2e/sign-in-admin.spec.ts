// Sign-in (#63) together with the organization admin area (#65): the top bar's account link on the
// admin pages, and sign-out from the account page followed by a deep link into the admin area,
// which goes to /sign-in?returnTo=<admin path> and back after sign-in. Both features merged
// separately; this file checks they work together. Needs the local Convex backend.
import { convexRun } from './support/convex';
import { tokensSettled } from './support/auth-tokens';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { signUp } from './support/session';
import { seedTenant } from './support/tenant';
import { newUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const accountLink = (page: import('@playwright/test').Page) =>
  page.locator('header a[href="/app"]');
const signInLink = (page: import('@playwright/test').Page) =>
  page.locator('header a[href^="/sign-in"]');

test.describe('sign-in and the admin area together', VIEWPORT_AGNOSTIC, () => {
  test('admin pages carry the account link, and sign-out then a deep link signs in back to the page', async ({
    page,
  }) => {
    const user = newUser('AdminIn');
    await signUp(page, user);
    const tenant = await seedTenant({ name: 'E2E SignIn Admin' });
    await convexRun('testing:addMembership', {
      organizationSlug: tenant.slug,
      email: user.email,
      role: 'orgAdmin',
    });
    const base = `/app/organizations/${tenant.slug}`;

    // The top bar shows the account link, not "Sign in", on both admin pages.
    for (const [path, heading] of [
      [base, 'Overview'],
      [`${base}/locations`, 'Locations'],
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole('main').getByRole('heading', { level: 1, name: heading }),
      ).toBeVisible();
      await expect(accountLink(page)).toHaveAccessibleName(`Account: ${user.name}`);
      await expect(signInLink(page)).toHaveCount(0);
    }

    // The account link leads to /app, and Sign out there ends the session.
    await accountLink(page).click();
    await expect(page).toHaveURL(`${baseURL}/app`);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(signInLink(page)).toBeVisible();

    // A deep link into the admin area is sent to sign-in with the path as returnTo.
    await page.goto(`${base}/locations`);
    await expect(page).toHaveURL(
      `${baseURL}/sign-in?returnTo=${encodeURIComponent(`${base}/locations`)}`,
    );

    // Signing in returns to that admin page, as an org admin, with the account link.
    const tokens = tokensSettled(page);
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(`${baseURL}${base}/locations`);
    await expect(
      page.getByRole('main').getByRole('heading', { level: 1, name: 'Locations' }),
    ).toBeVisible();
    await expect(accountLink(page)).toHaveAccessibleName(`Account: ${user.name}`);
    await tokens;
  });

  test('a signed-in non-admin sees no-access on the admin area, with the account link in the top bar', async ({
    page,
  }) => {
    const user = newUser('NoAdmin');
    await signUp(page, user);
    const tenant = await seedTenant({ name: 'E2E SignIn NoAdmin' });
    await page.goto(`/app/organizations/${tenant.slug}`);
    await expect(accountLink(page)).toHaveAccessibleName(`Account: ${user.name}`);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).not.toHaveText(
      'Overview',
    );
    await expect(signInLink(page)).toHaveCount(0);
  });
});
