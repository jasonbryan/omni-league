import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { seedPublishedCamp } from './support/camp';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { dateFromToday, seedTenant, type Tenant } from './support/tenant';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const PLACE = 'North Beach Sand Courts';
const ADULT = {
  name: 'Adult Beach Skills Camp',
  slug: 'adult-beach-skills-camp',
  locations: [PLACE],
  minimumAge: 18,
  maximumAge: 99,
};
const YOUTH = {
  name: 'Youth Beach Camp',
  slug: 'youth-beach-camp',
  locations: [PLACE],
  minimumAge: 9,
  maximumAge: 17,
};

const week = (name: string, startInDays: number, deadlineInDays: number, places = 12) => ({
  name,
  startDate: dateFromToday(startInDays),
  endDate: dateFromToday(startInDays + 4),
  dailyStartTime: '09:00',
  dailyEndTime: '12:00',
  places,
  registrationDeadline: dateFromToday(deadlineInDays),
});

async function seed() {
  const tenant = await seedTenant({
    name: 'E2E Camp Registration',
    locations: [{ name: PLACE, address: '3500 Sandcourt Ln, Corpus Christi, TX 78402' }],
  });
  const adult = await seedPublishedCamp(tenant, {
    ...ADULT,
    sessions: [
      week('Week 1', 30, 23),
      { ...week('Last place', 37, 30, 1), registeredCount: 1 },
      week('Closed week', 10, -2),
    ],
  });
  const youth = await seedPublishedCamp(tenant, {
    ...YOUTH,
    sessions: [week('Week 1', 30, 23)],
  });
  const draft = await seedPublishedCamp(tenant, {
    ...ADULT,
    name: 'Secret Draft Camp',
    slug: 'secret-draft-camp',
    sessions: [week('Week 1', 30, 23)],
    status: 'draft',
  });
  return { tenant, adult, youth, draft };
}

async function sessionIds(tenant: Tenant, campSlug: string): Promise<Record<string, string>> {
  const camp = (await convexRun('camps:getPublicPage', {
    orgSlug: tenant.slug,
    campSlug,
  })) as { sessions: { name: string; sessionId: string }[] };
  return Object.fromEntries(camp.sessions.map(({ name, sessionId }) => [name, sessionId]));
}

const registerPath = (tenant: Tenant, campSlug: string, sessionId: string) =>
  `/app/organizations/${tenant.slug}/camps/${campSlug}/register?session=${sessionId}`;

const row = (page: Page, name: string) =>
  page.locator('#sessions li').filter({ has: page.getByRole('heading', { name, exact: true }) });
const ageBox = (page: Page) => page.getByRole('checkbox', { name: /^I am \d+ to \d+ years old/ });
const registerButton = (page: Page) => page.getByRole('button', { name: 'Register', exact: true });
const alert = (page: Page) => page.locator('main [data-slot="alert"]');

test.describe('register for a camp session', () => {
  test('a signed-in adult ticks the age box and registers for Week 1, which takes one place and reads "You\'re registered"', async ({
    page,
  }, testInfo) => {
    const { tenant, adult } = await seed();
    const ids = await sessionIds(tenant, ADULT.slug);
    await signUp(page, newUser('Adult'));
    await page.goto(adult);
    await expect(row(page, 'Week 1')).toContainText('12 places left');
    await expect(row(page, 'Week 1')).toContainText('Registration open');
    await expectAccessible(page);
    await screenshot(page, testInfo, '355-camp-open');

    await row(page, 'Week 1').getByRole('link', { name: 'Register for Week 1' }).click();
    const path = registerPath(tenant, ADULT.slug, ids['Week 1']);
    await expect(page).toHaveURL(`${baseURL}${path}`);
    await expect(page.getByRole('heading', { level: 1, name: ADULT.name })).toBeVisible();
    await expect(page.getByRole('group', { name: "Who's attending" })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Me' })).toBeChecked();
    await expect(ageBox(page)).not.toBeChecked();
    await expect(registerButton(page)).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '355-register-form');

    await registerButton(page).click();
    await expect(page.locator('#age-confirmed-error')).toHaveText('Confirm your age to continue.');
    await expect(ageBox(page)).toBeFocused();
    await expectAccessible(page);
    await screenshot(page, testInfo, '355-register-age-error');

    await ageBox(page).click();
    await expect(page.locator('#age-confirmed-error')).toHaveCount(0);
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${adult}`, { timeout: 20_000 });
    await expect(row(page, 'Week 1').locator('[data-slot="session-registered"]')).toHaveText(
      "You're registered",
    );
    await expect(row(page, 'Week 1')).toContainText('11 places left');
    await expect(row(page, 'Week 1').getByRole('link')).toHaveCount(0);
    await expect(row(page, 'Last place').getByRole('link')).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '355-camp-registered');

    // The register page was replaced in history, so Back leaves the camp.
    await page.goBack();
    expect(page.url()).not.toContain('/register');

    await page.goto(path);
    await expect(alert(page)).toContainText("You're registered for Week 1.");
    await expect(ageBox(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to the camp page' })).toHaveAttribute(
      'href',
      adult,
    );
    await expectAccessible(page);
    await screenshot(page, testInfo, '355-register-registered');
  });

  test('a signed-out visitor who presses Register returns to the same session’s register page after signing in', async ({
    page,
  }, testInfo) => {
    const { tenant, adult } = await seed();
    const ids = await sessionIds(tenant, ADULT.slug);
    const path = registerPath(tenant, ADULT.slug, ids['Week 1']);
    await page.goto(adult);
    await row(page, 'Week 1').getByRole('link', { name: 'Register for Week 1' }).click();
    await expect(page).toHaveURL(/\/sign-in\?/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(path);
    await screenshot(page, testInfo, '355-sign-in');

    await page.getByRole('main').getByRole('link', { name: 'Create an account' }).click();
    const user = newUser('Adult');
    await page.locator('#name').fill(user.name);
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.getByRole('checkbox', { name: 'I am 18 or older' }).click();
    await page.getByRole('button', { name: /Create account/ }).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1, name: ADULT.name })).toBeVisible();
    await expect(ageBox(page)).toBeVisible();
  });

  test('a full session, a closed one, and an unknown one show their reason with a link back and no form', async ({
    page,
  }, testInfo) => {
    const { tenant, adult } = await seed();
    const ids = await sessionIds(tenant, ADULT.slug);
    await page.goto(adult);
    await expect(row(page, 'Last place')).toContainText('Full');
    await expect(row(page, 'Last place').getByRole('link')).toHaveCount(0);
    await expect(row(page, 'Closed week').getByRole('link')).toHaveCount(0);

    await signUp(page, newUser('Late'));
    const cases = [
      ['Last place', 'This session is full.', '355-register-full'],
      ['Closed week', 'Registration for this session is closed.', '355-register-closed'],
    ] as const;
    for (const [name, reason, shot] of cases) {
      await page.goto(registerPath(tenant, ADULT.slug, ids[name]));
      await expect(alert(page)).toContainText(reason);
      await expect(ageBox(page)).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Back to the camp page' })).toHaveAttribute(
        'href',
        adult,
      );
      await expectAccessible(page);
      await screenshot(page, testInfo, shot);
    }

    for (const query of ['?session=no-such-session', '']) {
      await page.goto(`/app/organizations/${tenant.slug}/camps/${ADULT.slug}/register${query}`);
      await expect(alert(page)).toContainText('This session was not found.');
      await expect(ageBox(page)).toHaveCount(0);
    }
    await expectAccessible(page);
    await screenshot(page, testInfo, '355-register-unknown-session');
  });

  test('a camp whose oldest age is 17 tells an adult they cannot register themself', async ({
    page,
  }, testInfo) => {
    const { tenant } = await seed();
    const ids = await sessionIds(tenant, YOUTH.slug);
    await signUp(page, newUser('Parent'));
    await page.goto(registerPath(tenant, YOUTH.slug, ids['Week 1']));
    await expect(alert(page)).toContainText('This camp is for ages 9 to 17.');
    await expect(alert(page)).toContainText('An adult cannot register themself for it.');
    await expect(ageBox(page)).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '355-register-youth');
  });

  test('an unknown camp, a draft, and another organization’s path show the not-found view', async ({
    page,
  }, testInfo) => {
    const { tenant } = await seed();
    const ids = await sessionIds(tenant, ADULT.slug);
    await signUp(page, newUser('Lost'));
    for (const path of [
      `/app/organizations/${tenant.slug}/camps/no-such-camp/register`,
      registerPath(tenant, 'secret-draft-camp', ids['Week 1']),
      `/app/organizations/no-such-org/camps/${ADULT.slug}/register`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
      await expect(ageBox(page)).toHaveCount(0);
    }
    await expectAccessible(page);
    await screenshot(page, testInfo, '355-register-not-found');
  });
});
