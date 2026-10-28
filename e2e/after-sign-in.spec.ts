import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { tokensSettled } from './support/auth-tokens';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { seedSeasons, seedTenant, type Tenant } from './support/tenant';
import { newUser, seedUser, type TestUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LEAGUE = 'Sunday Reverse Coed 4s';
const PLAYER_NEXT_STEP = 'Ask your league organizer for an invite or registration link';
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
  return { tokens };
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

        const { tokens } = await signInFrom(page, user, from, link);

        await expect(page).toHaveURL(`${baseURL}${from}`);
        await expect(
          page.getByRole('main').getByRole('heading', { level: 1, name: tenant.name }),
        ).toBeVisible();
        await expect(page.locator('header a[href="/app"]')).toHaveAccessibleName(
          `Account: ${user.name}`,
        );
        await tokens;
      });
    }

    for (const [name, relative] of [
      ['sport view', '/sports/soccer?utm=a#top'],
      ['league', '/leagues/sunday-reverse-coed-4s?utm=a&b=c#seasons'],
      ['season', '/leagues/sunday-reverse-coed-4s/seasons/summer-2027?utm=a#teams'],
    ] as const) {
      test(`the top bar Sign in link returns to the ${name} page, query and hash included`, async ({
        page,
      }) => {
        const tenant = await organization();
        await seedSeasons(tenant, 'sunday-reverse-coed-4s', [
          {
            name: 'Summer 2027',
            slug: 'summer-2027',
            startDate: '2027-06-06',
            endDate: '2027-08-29',
          },
        ]);
        const user = await seedUser(newUser('Pages'));
        const from = `${tenant.path}${relative}`;

        const { tokens } = await signInFrom(page, user, from, 'top-bar');

        await expect(page).toHaveURL(`${baseURL}${from}`);
        await expect(page.locator('header a[href="/app"]')).toHaveAccessibleName(
          `Account: ${user.name}`,
        );
        await tokens;
      });
    }

    test('opening a signed-in-only URL while signed out and then signing in returns to it, query and hash included', async ({
      page,
    }) => {
      const tenant = await organization();
      const user = await seedUser(newUser('Guard'));
      const target = `/app/organizations/${tenant.slug}/locations?tab=a#list`;

      await page.goto(target);
      await expect(page).toHaveURL(`${baseURL}/sign-in?returnTo=${encodeURIComponent(target)}`);
      const tokens = tokensSettled(page);
      await page.locator('#email').fill(user.email);
      await page.locator('#password').fill(user.password);
      await page.getByRole('button', { name: 'Sign in' }).click();

      await expect(page).toHaveURL(`${baseURL}${target}`);
      await tokens;
    });

    for (const raw of [
      '/',
      '/?x=1#y',
      '//evil.example/x',
      'https://evil.example',
      'javascript:alert(1)',
      'app',
    ]) {
      test(`sign-up with returnTo=${JSON.stringify(raw)} lands on /app`, async ({ page }) => {
        const user = newUser('UnsafeUp');

        await page.goto(`/sign-up?returnTo=${encodeURIComponent(raw)}`);
        const tokens = tokensSettled(page);
        await page.locator('#name').fill(user.name);
        await page.locator('#email').fill(user.email);
        await page.locator('#password').fill(user.password);
        await page.getByRole('checkbox', { name: 'I am 18 or older' }).click();
        await page.getByRole('button', { name: /Create account/ }).click();

        await expect(page).toHaveURL(`${baseURL}/app`, { timeout: 20_000 });
        await tokens;
      });
    }

    test('signing in from the home page, which has nothing for a signed-in user, lands on /app', async ({
      page,
    }) => {
      const user = await seedUser(newUser('Home'));

      const { tokens } = await signInFrom(page, user, '/', 'top-bar');

      await expect(page).toHaveURL(`${baseURL}/app`);
      await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
      await tokens;
    });

    test('a sign-in link with an off-site returnTo lands on /app', async ({ page }) => {
      const user = await seedUser(newUser('Offsite'));

      await page.goto(`/sign-in?returnTo=${encodeURIComponent('//evil.example/x')}`);
      const tokens = tokensSettled(page);
      await page.locator('#email').fill(user.email);
      await page.locator('#password').fill(user.password);
      await page.getByRole('button', { name: 'Sign in' }).click();

      await expect(page).toHaveURL(`${baseURL}/app`);
      await tokens;
    });

    test('sign-up from a public page follows the same rule', async ({ page }) => {
      const tenant = await organization();
      const user = newUser('SignUp');

      await page.goto(tenant.path);
      await page.locator('header a[href^="/sign-in"]').click();
      await page.getByRole('link', { name: 'Create an account' }).click();
      const tokens = tokensSettled(page);
      await page.locator('#name').fill(user.name);
      await page.locator('#email').fill(user.email);
      await page.locator('#password').fill(user.password);
      await page.getByRole('checkbox', { name: 'I am 18 or older' }).click();
      await page.getByRole('button', { name: /Create account/ }).click();

      await expect(page).toHaveURL(`${baseURL}${tenant.path}`, { timeout: 20_000 });
      await tokens;
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
      await expect(
        page.getByRole('link', { name: `Account settings: ${user.name}` }),
      ).toBeVisible();
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

    test('a player with no organization is told how to join a league and can create an organization', async ({
      page,
    }) => {
      const user = await seedUser(newUser('Player'));

      await landOnApp(page, user);

      await expect(page.getByRole('main')).toContainText(PLAYER_NEXT_STEP);
      await expect(page.getByRole('link', { name: 'Create an organization' })).toBeVisible();
      await expectAccessible(page);
    });
  });
});
