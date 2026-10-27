import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { tokensSettled } from './support/auth-tokens';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { seedTenant, type Tenant } from './support/tenant';
import { newUser, seedUser, type TestUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LEAGUE = 'Sunday Reverse Coed 4s';
const LOCATION = { name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX' };

const organization = () =>
  seedTenant({
    name: 'E2E After Sign-in',
    locations: [LOCATION],
    leagues: [{ name: LEAGUE, sport: 'soccer', locations: [LOCATION.name], status: 'published' }],
  });

async function signInFrom(page: Page, user: TestUser, from: string, link: 'top-bar' | 'footer') {
  await page.goto(from);
  const selector = link === 'top-bar' ? 'header a[href^="/sign-in"]' : 'footer a[href^="/sign-in"]';
  await page.locator(selector).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
  const tokens = tokensSettled(page);
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  return tokens;
}

test.describe('after sign-in', () => {
  test.describe('the page the visitor started from', VIEWPORT_AGNOSTIC, () => {
    for (const link of ['top-bar', 'footer'] as const) {
      test(`the ${link} Sign in link returns to the public organization page, query and hash included`, async ({
        page,
      }) => {
        const tenant = await organization();
        const user = await seedUser(newUser('Return'));
        const from = `${tenant.path}?utm=a#leagues`;

        await signInFrom(page, user, from, link);

        await expect(page).toHaveURL(`${baseURL}${from}`);
        await expect(
          page.getByRole('main').getByRole('heading', { level: 1, name: tenant.name }),
        ).toBeVisible();
        await expect(page.locator('header a[href="/app"]')).toHaveAccessibleName(
          `Account: ${user.name}`,
        );
      });
    }

    test('signing in from the home page, which has nothing for a signed-in user, lands on /app', async ({
      page,
    }) => {
      const user = await seedUser(newUser('Home'));

      await signInFrom(page, user, '/', 'top-bar');

      await expect(page).toHaveURL(`${baseURL}/app`);
      await expect(page.getByRole('heading', { level: 1, name: 'Your account' })).toBeVisible();
    });

    test('a sign-in link with an off-site returnTo lands on /app', async ({ page }) => {
      const user = await seedUser(newUser('Offsite'));

      await page.goto(`/sign-in?returnTo=${encodeURIComponent('//evil.example/x')}`);
      await page.locator('#email').fill(user.email);
      await page.locator('#password').fill(user.password);
      await page.getByRole('button', { name: 'Sign in' }).click();

      await expect(page).toHaveURL(`${baseURL}/app`);
    });

    test('sign-up from a public page follows the same rule', async ({ page }) => {
      const tenant = await organization();
      const user = newUser('SignUp');

      await page.goto(tenant.path);
      await page.locator('header a[href^="/sign-in"]').click();
      await page.getByRole('link', { name: 'Create an account' }).click();
      await page.locator('#name').fill(user.name);
      await page.locator('#email').fill(user.email);
      await page.locator('#password').fill(user.password);
      await page.getByRole('checkbox', { name: 'I am 18 or older' }).click();
      await page.getByRole('button', { name: /Create account/ }).click();

      await expect(page).toHaveURL(`${baseURL}${tenant.path}`, { timeout: 20_000 });
    });
  });

  test.describe('/app with no return page is never empty', () => {
    async function landOnApp(page: Page, user: TestUser) {
      await page.goto('/sign-in');
      const tokens = tokensSettled(page);
      await page.locator('#email').fill(user.email);
      await page.locator('#password').fill(user.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page).toHaveURL(`${baseURL}/app`);
      await expect(page.getByRole('region', { name: 'Signed-in account' })).toContainText(
        user.name,
      );
      await tokens;
    }

    test('an org admin sees their organization with a way to manage it', async ({ page }) => {
      const tenant: Tenant = await organization();
      const user = await seedUser(newUser('Admin'));
      await convexRun('testing:addMembership', {
        organizationSlug: tenant.slug,
        email: user.email,
        role: 'orgAdmin',
      });

      await landOnApp(page, user);

      const row = page
        .getByRole('listitem')
        .filter({ has: page.getByRole('heading', { name: tenant.name }) });
      await expect(row.getByRole('link', { name: /^Manage/ })).toHaveAttribute(
        'href',
        `/app/organizations/${tenant.slug}`,
      );
      await expectAccessible(page);
    });

    test('a league organizer sees their assigned league', async ({ page }) => {
      const tenant = await organization();
      const user = await seedUser(newUser('Organizer'));
      await convexRun('testing:addLeagueOrganizer', {
        organizationSlug: tenant.slug,
        email: user.email,
        leagueSlugs: ['sunday-reverse-coed-4s'],
      });

      await landOnApp(page, user);

      await expect(page.getByRole('link', { name: LEAGUE })).toHaveAttribute(
        'href',
        `/app/organizations/${tenant.slug}/leagues/sunday-reverse-coed-4s`,
      );
      await expectAccessible(page);
    });

    test('a player with no organization is offered Find a league and Create an organization', async ({
      page,
    }) => {
      const user = await seedUser(newUser('Player'));

      await landOnApp(page, user);

      await expect(page.getByRole('link', { name: 'Find a league' })).toHaveAttribute('href', '/');
      await expect(page.getByRole('link', { name: 'Create an organization' })).toBeVisible();
      await expectAccessible(page);
    });
  });
});
