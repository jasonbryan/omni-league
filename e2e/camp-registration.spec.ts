import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { seedPublishedCamp } from './support/camp';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { otherUser, signUp } from './support/session';
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

    // The register page was replaced in history, so Back does not return to it.
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

test.describe('places and refusals between people', () => {
  const onePlace = {
    ...ADULT,
    name: 'One Place Camp',
    slug: 'one-place-camp',
    sessions: [week('Only week', 30, 23, 1)],
  };

  test('each registration takes one place for everyone, and only the person who registered reads "You\'re registered"', async ({
    page,
    browser,
  }) => {
    const { tenant, adult } = await seed();
    const ids = await sessionIds(tenant, ADULT.slug);
    await signUp(page, newUser('First'));
    const second = await otherUser(browser, newUser('Second'));
    try {
      await second.goto(adult);
      await expect(row(second, 'Week 1')).toContainText('12 places left');

      await page.goto(registerPath(tenant, ADULT.slug, ids['Week 1']));
      await ageBox(page).click();
      await registerButton(page).click();
      await expect(page).toHaveURL(`${baseURL}${adult}`, { timeout: 20_000 });
      await expect(row(page, 'Week 1')).toContainText('11 places left');

      // The second visitor's open page follows the count without a reload.
      await expect(row(second, 'Week 1')).toContainText('11 places left');
      await expect(row(second, 'Week 1').locator('[data-slot="session-registered"]')).toHaveCount(
        0,
      );
      await row(second, 'Week 1').getByRole('link', { name: 'Register for Week 1' }).click();
      await ageBox(second).click();
      await registerButton(second).click();
      await expect(second).toHaveURL(`${baseURL}${adult}`, { timeout: 20_000 });
      await expect(row(second, 'Week 1')).toContainText('10 places left');
      await expect(row(second, 'Week 1').locator('[data-slot="session-registered"]')).toHaveText(
        "You're registered",
      );
      await expect(row(page, 'Week 1')).toContainText('10 places left');
    } finally {
      await second.context().close();
    }
  });

  test('a second tab of the same person follows the registration to "You\'re registered" and takes no second place', async ({
    page,
  }) => {
    const { tenant, adult } = await seed();
    const ids = await sessionIds(tenant, ADULT.slug);
    await signUp(page, newUser('Twice'));
    const path = registerPath(tenant, ADULT.slug, ids['Week 1']);
    const other = await page.context().newPage();
    await page.goto(path);
    await other.goto(path);
    await ageBox(other).click();

    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${adult}`, { timeout: 20_000 });

    await expect(alert(other)).toContainText("You're registered for Week 1.");
    await expect(ageBox(other)).toHaveCount(0);
    await expect(registerButton(other)).toHaveCount(0);
    await page.goto(adult);
    await expect(row(page, 'Week 1')).toContainText('11 places left');
  });

  test('a form left open while the last place goes turns into "This session is full." and takes nothing', async ({
    page,
    browser,
  }) => {
    const tenant = await seedTenant({
      name: 'E2E Camp Last Place',
      locations: [{ name: PLACE, address: '3500 Sandcourt Ln, Corpus Christi, TX 78402' }],
    });
    const camp = await seedPublishedCamp(tenant, onePlace);
    const ids = await sessionIds(tenant, onePlace.slug);
    const path = registerPath(tenant, onePlace.slug, ids['Only week']);
    await signUp(page, newUser('Early'));
    const late = await otherUser(browser, newUser('Late'));
    try {
      await late.goto(path);
      await ageBox(late).click();
      await page.goto(path);
      await ageBox(page).click();
      await registerButton(page).click();
      await expect(page).toHaveURL(`${baseURL}${camp}`, { timeout: 20_000 });

      await expect(alert(late)).toContainText('This session is full.');
      await expect(ageBox(late)).toHaveCount(0);
      await expect(late.getByRole('link', { name: 'Back to the camp page' })).toHaveAttribute(
        'href',
        camp,
      );
      await late.goto(camp);
      await expect(row(late, 'Only week')).toContainText('Full');
      await expect(row(late, 'Only week').locator('[data-slot="session-registered"]')).toHaveCount(
        0,
      );
    } finally {
      await late.context().close();
    }
  });
});

test.describe('the register form on a phone and offline', () => {
  test('keeps Register at the bottom edge once the form shows on a short phone screen, and in the flow at 1280px', async ({
    page,
  }, testInfo) => {
    const { tenant } = await seed();
    const ids = await sessionIds(tenant, ADULT.slug);
    await signUp(page, newUser('Phone'));
    const phone = testInfo.project.name === 'chromium-mobile';
    await page.goto(registerPath(tenant, ADULT.slug, ids['Week 1']));
    const footer = page.locator('[data-slot="form-footer"]');
    await expect(footer).toHaveCSS('position', phone ? 'sticky' : 'static');
    if (phone) {
      // A screen that ends 120px below the top of the form, so the form's own end is off screen.
      const formTop = (await page.locator('form').boundingBox())!.y;
      await page.setViewportSize({ width: 360, height: Math.round(formTop) + 120 });
      const form = (await page.locator('form').boundingBox())!;
      expect(form.y + form.height).toBeGreaterThan(page.viewportSize()!.height);
      await expect(registerButton(page)).toBeInViewport({ ratio: 1 });
      expect((await registerButton(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    } else {
      await expect(registerButton(page)).toBeInViewport({ ratio: 1 });
    }
    await expectAccessible(page);
    await screenshot(page, testInfo, '355-register-footer');
  });

  test('refuses to send while offline, keeps the ticked box, and registers once the connection is back', async ({
    page,
  }, testInfo) => {
    const { tenant, adult } = await seed();
    const ids = await sessionIds(tenant, ADULT.slug);
    await signUp(page, newUser('Offline'));
    await page.goto(registerPath(tenant, ADULT.slug, ids['Week 1']));
    await ageBox(page).click();
    await page.context().setOffline(true);
    try {
      await expect(registerButton(page)).toHaveAttribute('aria-disabled', 'true');
      await registerButton(page).click({ force: true });
      await expect(alert(page)).toContainText("You're offline");
      await expect(alert(page)).toBeFocused();
      await expect(ageBox(page)).toBeChecked();
      await expect(page).toHaveURL(/\/register\?session=/);
      await expectAccessible(page);
      await screenshot(page, testInfo, '355-register-offline');
    } finally {
      await page.context().setOffline(false);
    }
    await expect(registerButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${adult}`, { timeout: 20_000 });
    await expect(row(page, 'Week 1')).toContainText('11 places left');
  });
});
