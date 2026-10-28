import type { Locator, Page } from '@playwright/test';
import { axeScan, checkReflow, describeViolations, tabKey } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { convexRun } from './support/convex';
import { expect, test } from './support/fixtures';
import { signUp } from './support/session';
import { seedTenant } from './support/tenant';
import { newUser, seedUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LEAGUE = 'Sunday Reverse Coed 4s';
const LEAGUE_SLUG = 'sunday-reverse-coed-4s';

const mainElement = (page: Page) => page.locator('main#main');
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

async function seed() {
  const tenant = await seedTenant({
    name: 'E2E Navigation',
    locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
    leagues: [{ name: LEAGUE, sport: 'beachVolleyball', locations: ['Alpha Field'] }],
  });
  return { tenant, leaguePath: `${tenant.path}/leagues/${LEAGUE_SLUG}` };
}

async function adminNav(page: Page, organizationName: string): Promise<Locator> {
  if (isDesktop(page)) return page.getByRole('navigation', { name: `${organizationName} admin` });
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Navigation' });
  await expect(dialog.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  return dialog.getByRole('navigation', { name: `${organizationName} admin` });
}

async function signUpAsAdminOfNewOrganization(page: Page) {
  const user = newUser('Nav');
  await signUp(page, user);
  const { tenant } = await seed();
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });
  return { user, tenant, base: `/app/organizations/${tenant.slug}` };
}

test.describe('focus moves to the page after navigation', () => {
  test('from the organization page to a league', async ({ page, consoleGuard }) => {
    const { tenant, leaguePath } = await seed();
    await page.goto(tenant.path);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await page.getByRole('main').getByRole('link', { name: LEAGUE, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: LEAGUE })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(leaguePath);
    await expect(mainElement(page)).toBeFocused();
  });

  test('from the admin Overview to Locations', async ({ page }) => {
    const { tenant, base } = await signUpAsAdminOfNewOrganization(page);
    await page.goto(base);
    await expect(
      page.getByRole('main').getByRole('heading', { level: 1, name: 'Overview' }),
    ).toBeVisible();
    const nav = await adminNav(page, tenant.name);
    await nav.getByRole('link', { name: 'Locations' }).click();
    await expect(page).toHaveURL(`${baseURL}${base}/locations`);
    await expect(
      page.getByRole('main').getByRole('heading', { level: 1, name: 'Locations' }),
    ).toBeVisible();
    await expect(mainElement(page)).toBeFocused();
  });

  test('from Your organizations to the admin Overview', async ({ page }) => {
    const { tenant, base } = await signUpAsAdminOfNewOrganization(page);
    await page
      .getByRole('region', { name: 'Your organizations' })
      .getByRole('link', { name: `Manage ${tenant.name}` })
      .click();
    await expect(page).toHaveURL(`${baseURL}${base}`);
    await expect(
      page.getByRole('main').getByRole('heading', { level: 1, name: 'Overview' }),
    ).toBeVisible();
    await expect(mainElement(page)).toBeFocused();
  });

  test('from sign-in to /app', async ({ page }) => {
    const user = await seedUser();
    await page.goto('/sign-in');
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.getByRole('button', { name: /^Sign in/ }).click();
    await expect(page).toHaveURL(`${baseURL}/app`, { timeout: 20_000 });
    await expect(mainElement(page)).toBeFocused();
  });
});

test.describe('Back skips a finished form', () => {
  test(
    'after sign-in, Back shows the page before /sign-in',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const user = await seedUser();
      const { tenant, leaguePath } = await seed();
      await page.goto(tenant.path);
      // The sign-in hand-off goes to a Server route, such as a public league page.
      await page.goto(`/sign-in?returnTo=${encodeURIComponent(leaguePath)}`);
      await page.locator('#email').fill(user.email);
      await page.locator('#password').fill(user.password);
      await page.getByRole('button', { name: /^Sign in/ }).click();
      await expect(page).toHaveURL(`${baseURL}${leaguePath}`, { timeout: 20_000 });
      await expect(page.getByRole('heading', { level: 1, name: LEAGUE })).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(`${baseURL}${tenant.path}`);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(tenant.name);
    },
  );

  test(
    'after sign-up, Back shows the page before /sign-up',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const user = newUser('Back');
      const { tenant, leaguePath } = await seed();
      await page.goto(tenant.path);
      await page.goto(`/sign-up?returnTo=${encodeURIComponent(leaguePath)}`);
      await page.locator('#name').fill(user.name);
      await page.locator('#email').fill(user.email);
      await page.locator('#password').fill(user.password);
      await page.getByRole('checkbox', { name: 'I am 18 or older' }).click();
      await page.getByRole('button', { name: /Create account/ }).click();
      await expect(page).toHaveURL(`${baseURL}${leaguePath}`, { timeout: 20_000 });
      await page.goBack();
      await expect(page).toHaveURL(`${baseURL}${tenant.path}`);
    },
  );

  test(
    'after creating an organization, Back from its Overview shows the page before the form',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      await signUp(page, newUser('Create'));
      await page.getByRole('link', { name: 'Create an organization' }).first().click();
      await expect(page).toHaveURL(`${baseURL}/app/organizations/new`);
      const slug = `e2e-back-${Date.now().toString(36)}`;
      await page.locator('#name').fill(`E2E Back ${slug}`);
      await page.locator('#slug').fill(slug);
      await page.getByRole('button', { name: /Create organization/ }).click();
      await expect(page).toHaveURL(`${baseURL}/app/organizations/${slug}`, { timeout: 20_000 });
      await page.goBack();
      await expect(page).toHaveURL(`${baseURL}/app`);
      await expect(page.getByRole('region', { name: 'Your organizations' })).toBeVisible();
    },
  );
});

test.describe('focus on page loads, redirects, and other route changes', () => {
  const activeTag = (page: Page) => page.evaluate(() => document.activeElement?.tagName);

  test('a page load, and a guard redirect on load, leave focus on the body and the first Tab on the skip link', async ({
    page,
  }) => {
    await page.goto('/app');
    await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fapp$/);
    // Sign-in is a client-rendered route (no hydration log): its form is the sign the app is up.
    await expect(page.locator('#email')).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.locator('main#main')).not.toBeFocused();
    expect(await activeTag(page)).toBe('BODY');
    await page.keyboard.press(tabKey(page));
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  });

  test('a link to a guarded page, followed signed out, ends on sign-in with focus on main', async ({
    page,
    consoleGuard,
  }) => {
    const { tenant } = await seed();
    await page.goto(tenant.path);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await page.evaluate(() => {
      (window as Window & { e2eNoReload?: boolean }).e2eNoReload = true;
    });
    const topBarSignInLink = page.getByRole('link', { name: /^Sign in/ }).first();
    await topBarSignInLink.click();
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.locator('main#main')).toBeFocused();
    expect(
      await page.evaluate(() => (window as Window & { e2eNoReload?: boolean }).e2eNoReload),
    ).toBe(true);
  });

  test('Sign out ends on / with focus on main', async ({ page }) => {
    await signUp(page, newUser('Out'));
    await page.getByRole('link', { name: /^Account settings: / }).click();
    await expect(page).toHaveURL(`${baseURL}/app/account`);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(page.getByRole('heading', { level: 1, name: 'Omni League' })).toBeVisible();
    await expect(page.locator('main#main')).toBeFocused();
  });

  test('Back and Forward between two pages move focus to main', async ({ page, consoleGuard }) => {
    const { tenant, leaguePath } = await seed();
    await page.goto(tenant.path);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await page.getByRole('main').getByRole('link', { name: LEAGUE, exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${leaguePath}`);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.goBack();
    await expect(page).toHaveURL(`${baseURL}${tenant.path}`);
    await expect(page.locator('main#main')).toBeFocused();
  });

  test('main is a landmark with no stray name, and pages reached by navigation pass axe and reflow', async ({
    page,
    consoleGuard,
  }) => {
    const { tenant, leaguePath } = await seed();
    await page.goto(tenant.path);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await page.getByRole('main').getByRole('link', { name: LEAGUE, exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${leaguePath}`);
    await expect(page.locator('main#main')).toBeFocused();
    const landmark = page.getByRole('main');
    await expect(landmark).toHaveCount(1);
    await expect(landmark).toHaveAccessibleName('');
    const results = await axeScan(page);
    expect(describeViolations(results.violations)).toEqual([]);
    expect((await checkReflow(page)).passed).toBe(true);
  });
});

test.describe('a refused sign-in', () => {
  test.use({ expectedFailedRequests: [{ status: 401, path: '/api/auth/sign-in/email' }] });

  test('a refused sign-in stays on the page and focus stays with the form, not main', async ({
    page,
  }) => {
    const user = await seedUser();
    await page.goto('/sign-in');
    await expect(page.locator('#email')).toBeVisible();
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(`${user.password}-wrong`);
    await page.getByRole('button', { name: /^Sign in/ }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page).toHaveURL(`${baseURL}/sign-in`);
    await expect(page.locator('main#main')).not.toBeFocused();
  });
});
