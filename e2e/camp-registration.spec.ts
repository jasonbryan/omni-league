import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { seedPublishedCamp } from './support/camp';
import { seedCampRegistration, seedCampWaitlistEntry } from './support/camp-registrations';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
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

const MIXED = {
  name: 'Open Ages Camp',
  slug: 'open-ages-camp',
  locations: [PLACE],
  minimumAge: 14,
  maximumAge: 30,
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
    sessions: [
      week('Week 1', 30, 23),
      { ...week('Full week', 37, 30, 1), registeredCount: 1 },
      week('Later week', 44, 37),
    ],
  });
  const mixed = await seedPublishedCamp(tenant, {
    ...MIXED,
    sessions: [week('Week 1', 30, 23)],
  });
  const draft = await seedPublishedCamp(tenant, {
    ...ADULT,
    name: 'Secret Draft Camp',
    slug: 'secret-draft-camp',
    sessions: [week('Week 1', 30, 23)],
    status: 'draft',
  });
  return { tenant, adult, youth, mixed, draft };
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
const ageBox = (page: Page) =>
  page.getByRole('checkbox', { name: /^(I am|.+ is) \d+ to \d+ years old/ });
const childName = (page: Page) => page.getByRole('textbox', { name: "Child's name" });
const registerButton = (page: Page) => page.getByRole('button', { name: 'Register', exact: true });
const joinButton = (page: Page) =>
  page.getByRole('button', { name: 'Join the waitlist', exact: true });
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
    await expect(row(page, 'Last place').getByRole('link', { name: /^Register/ })).toHaveCount(0);
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

  test('a closed session and an unknown one show their reason with a link back and no form', async ({
    page,
  }, testInfo) => {
    const { tenant, adult } = await seed();
    const ids = await sessionIds(tenant, ADULT.slug);
    await page.goto(adult);
    await expect(row(page, 'Last place')).toContainText('Full');
    await expect(row(page, 'Last place').getByRole('link')).toHaveCount(1);
    await expect(
      row(page, 'Last place').getByRole('link', { name: 'Join the waitlist for Last place' }),
    ).toBeVisible();
    await expect(row(page, 'Closed week').getByRole('link')).toHaveCount(0);

    await signUp(page, newUser('Late'));
    const cases = [
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

test.describe('a guardian registers a child', () => {
  test('registers "Maya R." with the box ticked, which takes one place and reads "Maya R. is registered"', async ({
    page,
  }, testInfo) => {
    const { tenant, youth } = await seed();
    const ids = await sessionIds(tenant, YOUTH.slug);
    await signUp(page, newUser('Guardian'));
    await page.goto(youth);
    await row(page, 'Week 1').getByRole('link', { name: 'Register for Week 1' }).click();
    await expect(page).toHaveURL(`${baseURL}${registerPath(tenant, YOUTH.slug, ids['Week 1'])}`);

    await expect(page.getByRole('radio', { name: 'My child' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Me' })).toHaveCount(0);
    await expect(childName(page)).toBeVisible();
    await expect(ageBox(page)).toHaveAccessibleName(/^My child is 9 to 17 years old on /);
    await expectAccessible(page);
    await screenshot(page, testInfo, '356-register-child-form');

    await childName(page).fill('Maya R.');
    await expect(ageBox(page)).toHaveAccessibleName(/^Maya R\. is 9 to 17 years old on .+\.$/);
    await registerButton(page).click();
    await expect(page.locator('#age-confirmed-error')).toHaveText(
      "Confirm Maya R.'s age to continue.",
    );
    await expect(ageBox(page)).toBeFocused();
    await expectAccessible(page);
    await screenshot(page, testInfo, '356-register-child-age-error');

    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${youth}`, { timeout: 20_000 });
    await expect(row(page, 'Week 1').locator('[data-slot="session-registered"]')).toHaveText(
      'Maya R. is registered',
    );
    await expect(row(page, 'Week 1')).toContainText('11 places left');
    await expect(
      row(page, 'Week 1').getByRole('link', { name: 'Register for Week 1' }),
    ).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '356-camp-child-registered');
  });

  test('registers a second child, and the one line names both in the order registered', async ({
    page,
  }) => {
    const { tenant, youth } = await seed();
    const ids = await sessionIds(tenant, YOUTH.slug);
    await signUp(page, newUser('Guardian'));
    for (const name of ['Maya R.', 'Leo R.']) {
      await page.goto(registerPath(tenant, YOUTH.slug, ids['Week 1']));
      await childName(page).fill(name);
      await ageBox(page).click();
      await registerButton(page).click();
      await expect(page).toHaveURL(`${baseURL}${youth}`, { timeout: 20_000 });
    }
    await expect(row(page, 'Week 1').locator('[data-slot="session-registered"]')).toHaveText(
      'Maya R. and Leo R. are registered',
    );
    await expect(row(page, 'Week 1')).toContainText('10 places left');
  });

  test('checks the name on leaving it and on submit, and keeps what was typed', async ({
    page,
  }, testInfo) => {
    const { tenant } = await seed();
    const ids = await sessionIds(tenant, YOUTH.slug);
    await signUp(page, newUser('Guardian'));
    await page.goto(registerPath(tenant, YOUTH.slug, ids['Week 1']));
    await childName(page).fill('x'.repeat(61));
    await ageBox(page).focus();
    await expect(page.locator('#minor-name-error')).toHaveText(
      'Use 60 characters or fewer. This name has 61.',
    );
    await expectAccessible(page);
    await screenshot(page, testInfo, '356-register-child-name-error');
    await childName(page).fill('');
    await registerButton(page).click();
    await expect(page.locator('#minor-name-error')).toHaveText("Enter your child's name.");
    await expect(childName(page)).toBeFocused();
    await childName(page).fill('Maya R.');
    await expect(page.locator('#minor-name-error')).toHaveCount(0);
  });

  test('a camp whose youngest age is 18 offers only Me and no child', async ({
    page,
  }, testInfo) => {
    const { tenant } = await seed();
    const ids = await sessionIds(tenant, ADULT.slug);
    await signUp(page, newUser('Adult'));
    await page.goto(registerPath(tenant, ADULT.slug, ids['Week 1']));
    await expect(page.getByRole('radio', { name: 'Me' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'My child' })).toHaveCount(0);
    await expect(childName(page)).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '356-register-adults-only');
  });

  test('a camp that admits both offers Me and My child, and My child asks for the name', async ({
    page,
  }, testInfo) => {
    const { tenant, mixed } = await seed();
    const ids = await sessionIds(tenant, MIXED.slug);
    await signUp(page, newUser('Both'));
    await page.goto(registerPath(tenant, MIXED.slug, ids['Week 1']));
    await expect(page.getByRole('radio', { name: 'Me' })).toBeChecked();
    await expect(childName(page)).toHaveCount(0);
    await page.getByRole('radio', { name: 'My child' }).check();
    await expect(childName(page)).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '356-register-both-child');

    await childName(page).fill('Maya R.');
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${mixed}`, { timeout: 20_000 });

    await row(page, 'Week 1').getByRole('link', { name: 'Register for Week 1' }).click();
    await expect(page.getByRole('radio', { name: 'Me' })).toBeChecked();
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${mixed}`, { timeout: 20_000 });
    await expect(row(page, 'Week 1').locator('[data-slot="session-registered"]')).toHaveText(
      'You and Maya R. are registered',
    );

    await row(page, 'Week 1').getByRole('link', { name: 'Register for Week 1' }).click();
    await expect(page.getByRole('radio', { name: 'My child' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Me' })).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '356-register-both-self-held');
  });

  test('another account sees neither the child’s name nor the place as its own', async ({
    page,
    browser,
  }) => {
    const { tenant, youth } = await seed();
    const ids = await sessionIds(tenant, YOUTH.slug);
    await signUp(page, newUser('Guardian'));
    await page.goto(registerPath(tenant, YOUTH.slug, ids['Week 1']));
    await childName(page).fill('Maya R.');
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${youth}`, { timeout: 20_000 });

    const other = await otherUser(browser, newUser('Other'));
    try {
      await other.goto(youth);
      await expect(row(other, 'Week 1')).toContainText('11 places left');
      await expect(other.locator('main')).not.toContainText('Maya');
      await expect(row(other, 'Week 1').locator('[data-slot="session-registered"]')).toHaveCount(0);
    } finally {
      await other.context().close();
    }
    const signedOut = await browser.newContext();
    try {
      const visitor = await signedOut.newPage();
      await visitor.goto(youth);
      await expect(visitor.locator('main')).not.toContainText('Maya');
    } finally {
      await signedOut.close();
    }
  });
});

test.describe('a 60-character name without spaces', () => {
  const LONG = 'W'.repeat(60);

  test('stays inside the card on the register page and the camp page at 360px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const { tenant, youth } = await seed();
    const ids = await sessionIds(tenant, YOUTH.slug);
    await signUp(page, newUser('Guardian'));
    await page.goto(registerPath(tenant, YOUTH.slug, ids['Week 1']));
    await childName(page).fill(LONG);
    await registerButton(page).click();
    await expect(page.locator('#age-confirmed-error')).toHaveText(
      `Confirm ${LONG}'s age to continue.`,
    );
    const insideCard = async (selector: string) => {
      const card = (await page.locator('[data-slot="card"]').first().boundingBox())!;
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.x + box.width, selector).toBeLessThanOrEqual(card.x + card.width + 0.5);
    };
    await insideCard('label[for="age-confirmed"]');
    await insideCard('#age-confirmed-error');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
    await expectAccessible(page);

    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${youth}`, { timeout: 20_000 });
    const line = row(page, 'Week 1').locator('[data-slot="session-registered"]');
    await expect(line).toHaveText(`${LONG} is registered`);
    await expectNoLineClippedOrSpilled(page, 'Week 1', 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
    await expectAccessible(page);
  });
});

test.describe('a guardian registers the same child again', () => {
  test.use({ expectedConvexErrors: ['campRegistrations:register'] });

  test('with another case or spacing, the server refuses it under the name and takes no place', async ({
    page,
  }, testInfo) => {
    const { tenant, youth } = await seed();
    const ids = await sessionIds(tenant, YOUTH.slug);
    const path = registerPath(tenant, YOUTH.slug, ids['Week 1']);
    await signUp(page, newUser('Guardian'));
    await page.goto(path);
    await childName(page).fill('Maya R.');
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${youth}`, { timeout: 20_000 });

    await page.goto(path);
    await childName(page).fill('  maya   r. ');
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page.locator('#minor-name-error')).toHaveText(
      'Maya R. is already registered for this session.',
    );
    await expect(childName(page)).toBeFocused();
    await expect(childName(page)).toHaveValue('  maya   r. ');
    await expect(ageBox(page)).toBeChecked();
    await expectAccessible(page);
    await screenshot(page, testInfo, '356-register-child-duplicate');
    await page.goto(youth);
    await expect(row(page, 'Week 1')).toContainText('11 places left');
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

  test('a form left open while the last place goes turns into the waitlist form, keeps the ticked box, and takes nothing', async ({
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
      await expect(joinButton(late)).toBeVisible();
      await expect(registerButton(late)).toHaveCount(0);
      await expect(ageBox(late)).toBeChecked();
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

const BOX_TOLERANCE = 0.5;
const LINE_SELECTOR = '[data-slot="session-registered"], [data-slot="session-waitlist"]';

type LineSlot = 'session-registered' | 'session-waitlist';

interface RowLine {
  slot: LineSlot;
  text: string;
}

const lineIn = (page: Page, sessionName: string, slot: LineSlot) =>
  row(page, sessionName).locator(`[data-slot="${slot}"]`);

/** Measures the drawn boxes: a line that is clipped or leaves its row fails here, whatever its text says. */
async function expectNoLineClippedOrSpilled(page: Page, sessionName: string, count: number) {
  const lines = await row(page, sessionName).evaluate((li, selector) => {
    const slack = 0.5;
    const actions = li.querySelector('[data-slot="session-actions"]')!.getBoundingClientRect();
    const before = [...li.children]
      .filter((child) => child.getAttribute('data-slot') !== 'session-actions')
      .map((child) => child.getBoundingClientRect().bottom);
    const rowBox = li.getBoundingClientRect();
    const links = [...li.querySelectorAll('[data-slot="session-actions"] > a')].map((link) =>
      link.getBoundingClientRect(),
    );
    return [...li.querySelectorAll(selector)].map((line) => {
      const text = line.querySelector('span')!;
      const textBox = text.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
      return {
        clippedHeight: text.scrollHeight > text.clientHeight + 1,
        clippedWidth: text.scrollWidth > text.clientWidth + 1,
        clamped: getComputedStyle(text).webkitLineClamp !== 'none',
        ellipsis: getComputedStyle(text).textOverflow === 'ellipsis',
        hidden: getComputedStyle(text).overflow !== 'visible',
        lines: Math.round(textBox.height / lineHeight),
        outsideActions:
          textBox.top < actions.top - slack ||
          textBox.bottom > actions.bottom + slack ||
          textBox.left < actions.left - slack ||
          textBox.right > actions.right + slack,
        outsideRow:
          textBox.top < rowBox.top - slack ||
          textBox.bottom > rowBox.bottom + slack ||
          textBox.right > rowBox.right + slack,
        overlapsLineAbove: actions.top < Math.max(...before) - slack,
        overlapsLink: links.some(
          (link) =>
            textBox.left < link.right - slack &&
            textBox.right > link.left + slack &&
            textBox.top < link.bottom - slack &&
            textBox.bottom > link.top + slack,
        ),
        linkOutsideRow: links.some((link) => link.right > rowBox.right + slack),
      };
    });
  }, LINE_SELECTOR);
  expect(lines).toHaveLength(count);
  for (const line of lines) {
    expect(line.clippedHeight, 'clipped in height').toBe(false);
    expect(line.clippedWidth, 'clipped in width').toBe(false);
    expect(line.clamped, 'line clamp').toBe(false);
    expect(line.ellipsis, 'text-overflow ellipsis').toBe(false);
    expect(line.hidden, 'hidden overflow').toBe(false);
    expect(line.outsideActions, 'outside the actions row').toBe(false);
    expect(line.outsideRow, 'outside the session row').toBe(false);
    expect(line.overlapsLineAbove, 'on the line above').toBe(false);
    expect(line.overlapsLink, 'on the Register or Join link').toBe(false);
    expect(line.linkOutsideRow, 'the link leaves the session row').toBe(false);
    expect(line.lines).toBeGreaterThanOrEqual(1);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    'page scrolls sideways',
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
}

/**
 * Holds the caller's answers, lets the rows draw, then releases them and records every frame's box of every row. The caller's own
 * row grows at most once, nothing above it moves, and the rows below move only by that growth, once.
 */
async function expectOwnRowGrowsOnce(
  page: Page,
  camp: string,
  sessionName: string,
  answers: string[],
  lines: RowLine[],
  mustGrow: boolean,
): Promise<void> {
  const held = await holdQueries(page, answers);
  await page.goto(camp);
  await expect.poll(() => held.isHolding()).toBe(true);
  const own = row(page, sessionName);
  await expect(own.locator('[data-slot="session-actions"]')).toBeVisible();
  await expect(own.locator(LINE_SELECTOR)).toHaveCount(0);
  await page.evaluate(() => {
    interface Box {
      top: number;
      height: number;
    }
    const rows = [...document.querySelectorAll('#sessions li')];
    const state = {
      stop: false,
      changes: [] as { row: number; top: number; height: number }[],
      pageHeights: [] as number[],
    };
    const last: (Box | undefined)[] = [];
    const sampleRows = () => {
      rows.forEach((li, index) => {
        const box = li.getBoundingClientRect();
        const now = { top: box.top + window.scrollY, height: box.height };
        const before = last[index];
        if (
          !before ||
          Math.abs(before.top - now.top) > 0.5 ||
          Math.abs(before.height - now.height) > 0.5
        ) {
          last[index] = now;
          state.changes.push({ row: index, ...now });
        }
      });
      state.pageHeights.push(document.documentElement.scrollHeight);
      if (!state.stop) requestAnimationFrame(sampleRows);
    };
    sampleRows();
    (window as unknown as { __rowRecorder: typeof state }).__rowRecorder = state;
  });

  held.release();
  for (const slot of ['session-registered', 'session-waitlist'] as const) {
    const texts = lines.filter((line) => line.slot === slot).map((line) => line.text);
    if (texts.length > 0) await expect(lineIn(page, sessionName, slot)).toHaveText(texts);
  }
  // A growth that is still coming would show within these frames.
  await page.waitForTimeout(700);
  const record = await page.evaluate(() => {
    const state = (
      window as unknown as {
        __rowRecorder: {
          stop: boolean;
          changes: { row: number; top: number; height: number }[];
          pageHeights: number[];
        };
      }
    ).__rowRecorder;
    state.stop = true;
    return { changes: state.changes, pageHeights: state.pageHeights };
  });
  const index = await own.evaluate((li) =>
    [...document.querySelectorAll('#sessions li')].indexOf(li),
  );
  const rowCount = new Set(record.changes.map((change) => change.row)).size;
  const byRow = (at: number) => record.changes.filter((change) => change.row === at);
  const baseline = (at: number) => byRow(at)[0];
  const final = (at: number) => byRow(at).at(-1)!;
  expect(rowCount).toBeGreaterThan(index);

  const ownGrowth = final(index).height - baseline(index).height;
  const ownHeights = byRow(index).filter(
    (change, at, all) => at > 0 && Math.abs(change.height - all[at - 1].height) > BOX_TOLERANCE,
  );
  expect(ownHeights.length, 'the own row changes height at most once').toBeLessThanOrEqual(1);
  if (mustGrow) expect(ownGrowth, 'the own row grows').toBeGreaterThan(BOX_TOLERANCE);
  expect(ownGrowth).toBeGreaterThanOrEqual(-BOX_TOLERANCE);

  for (let at = 0; at < index; at++) {
    expect(byRow(at), `row ${at} above the caller's row never moves or resizes`).toHaveLength(1);
  }
  for (let at = index + 1; at < rowCount; at++) {
    const changes = byRow(at);
    expect(changes.length, `row ${at} below moves at most once`).toBeLessThanOrEqual(2);
    expect(
      Math.abs(final(at).top - baseline(at).top - ownGrowth),
      `row ${at} below moves by the growth and no more`,
    ).toBeLessThanOrEqual(BOX_TOLERANCE);
    expect(
      Math.abs(final(at).height - baseline(at).height),
      `row ${at} below keeps its height`,
    ).toBeLessThanOrEqual(BOX_TOLERANCE);
  }
  expect(
    Math.abs(record.pageHeights.at(-1)! - record.pageHeights[0] - ownGrowth),
    'the page grows by the growth and no more',
  ).toBeLessThanOrEqual(BOX_TOLERANCE);
  await expectNoLineClippedOrSpilled(page, sessionName, lines.length);
  await expectAccessible(page);
}

test.describe('the camp page rows when the viewer’s places arrive', () => {
  const WIDTHS = [360, 1280] as const;
  const TOLERANCE = 0.5;
  const CASES = [
    { title: 'an adult for an adult camp', camp: ADULT, kind: 'adult', line: "You're registered" },
    {
      title: 'a guardian’s child for a youth camp',
      camp: YOUTH,
      kind: 'child',
      line: 'Maya R. is registered',
    },
    {
      title: 'a guardian’s child for a camp for 14 to 30',
      camp: MIXED,
      kind: 'child',
      line: 'Maya R. is registered',
    },
    {
      title: 'an adult for a camp for 14 to 30',
      camp: MIXED,
      kind: 'adult',
      line: "You're registered",
    },
  ] as const;

  for (const { title, camp, kind, line } of CASES) {
    for (const width of WIDTHS) {
      test(`keep their place and height for ${title} at ${width}px`, async ({ page }, testInfo) => {
        const coarse = testInfo.project.name === 'chromium-mobile';
        await page.setViewportSize({ width, height: 800 });
        const seeded = await seed();
        const campPath = {
          [ADULT.slug]: seeded.adult,
          [YOUTH.slug]: seeded.youth,
          [MIXED.slug]: seeded.mixed,
        }[camp.slug];
        const ids = await sessionIds(seeded.tenant, camp.slug);
        await signUp(page, newUser('Steady'));
        await page.goto(campPath);
        const link = row(page, 'Week 1').getByRole('link', { name: 'Register for Week 1' });
        await expect(link).toBeVisible();
        expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(coarse);

        const layout = () =>
          page.evaluate(() => ({
            page: document.documentElement.scrollHeight,
            rows: [...document.querySelectorAll('#sessions li')].map((li) => {
              const box = li.getBoundingClientRect();
              return { top: box.top + window.scrollY, height: box.height };
            }),
          }));
        const actions = row(page, 'Week 1').locator('[data-slot="session-actions"]');
        const before = await layout();
        const actionsBefore = (await actions.boundingBox())!;

        // Another tab of the same person registers, so this page changes in place.
        const other = await page.context().newPage();
        await other.goto(registerPath(seeded.tenant, camp.slug, ids['Week 1']));
        if (kind === 'child') {
          if (camp.slug === MIXED.slug)
            await other.getByRole('radio', { name: 'My child' }).check();
          await childName(other).fill('Maya R.');
        }
        await ageBox(other).click();
        await registerButton(other).click();
        await expect(other).toHaveURL(`${baseURL}${campPath}`, { timeout: 20_000 });
        const registered = row(page, 'Week 1').locator('[data-slot="session-registered"]');
        await expect(registered).toHaveText(line);
        await expect(row(page, 'Week 1')).toContainText('11 places left');

        const after = await layout();
        expect(Math.abs(after.page - before.page)).toBeLessThanOrEqual(TOLERANCE);
        expect(after.rows).toHaveLength(before.rows.length);
        after.rows.forEach((box, index) => {
          expect(
            Math.abs(box.top - before.rows[index].top),
            `row ${index} top`,
          ).toBeLessThanOrEqual(TOLERANCE);
          expect(
            Math.abs(box.height - before.rows[index].height),
            `row ${index} height`,
          ).toBeLessThanOrEqual(TOLERANCE);
        });
        const actionsAfter = (await actions.boundingBox())!;
        expect(Math.abs(actionsAfter.height - actionsBefore.height)).toBeLessThanOrEqual(TOLERANCE);
        expect(Math.abs(actionsAfter.y - actionsBefore.y)).toBeLessThanOrEqual(TOLERANCE);
        await expectAccessible(page);
      });
    }
  }
});

test.describe('the camp page rows when a guardian’s children answer after sign-in', () => {
  const WIDTHS = [320, 360, 1280] as const;
  const TOLERANCE = 0.5;
  const LONG = 'W'.repeat(60);
  const CHILDREN: { title: string; names: string[]; line: string }[] = [
    { title: 'one child with a 60-character name', names: [LONG], line: `${LONG} is registered` },
    {
      title: 'two children, one with a 60-character name',
      names: ['Maya R.', LONG],
      line: `Maya R. and ${LONG} are registered`,
    },
    {
      title: 'two children with short names',
      names: ['Maya R.', 'Leo R.'],
      line: 'Maya R. and Leo R. are registered',
    },
    {
      title: 'three children, one with a 60-character name',
      names: ['Maya R.', LONG, 'Zoe R.'],
      line: `Maya R., ${LONG}, and Zoe R. are registered`,
    },
  ];

  async function registerChild(
    page: Page,
    path: string,
    camp: string,
    name: string,
  ): Promise<void> {
    await page.goto(path);
    await childName(page).fill(name);
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${camp}`, { timeout: 20_000 });
  }

  const layout = (page: Page) =>
    page.evaluate(() => ({
      page: document.documentElement.scrollHeight,
      rows: [...document.querySelectorAll('#sessions li')].map((li) => {
        const box = li.getBoundingClientRect();
        return { top: box.top + window.scrollY, height: box.height };
      }),
    }));

  async function expectRowsStay(
    page: Page,
    camp: string,
    answers: string[],
    line: string,
  ): Promise<void> {
    const held = await holdQueries(page, answers);
    await page.goto(camp);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(
      row(page, 'Week 1').getByRole('link', { name: 'Register for Week 1' }),
    ).toBeVisible();
    const before = await layout(page);

    held.release();
    const registered = row(page, 'Week 1').locator('[data-slot="session-registered"]');
    await expect(registered).toHaveText(line);
    const after = await layout(page);
    expect(after.rows).toHaveLength(before.rows.length);
    expect(Math.abs(after.page - before.page), 'page height').toBeLessThanOrEqual(TOLERANCE);
    after.rows.forEach((box, index) => {
      expect(Math.abs(box.top - before.rows[index].top), `row ${index} top`).toBeLessThanOrEqual(
        TOLERANCE,
      );
    });
  }

  for (const width of WIDTHS) {
    test(`on a youth camp, the sessions below stay where they were when the children’s lines arrive at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      const { tenant, youth } = await seed();
      const ids = await sessionIds(tenant, YOUTH.slug);
      const path = registerPath(tenant, YOUTH.slug, ids['Week 1']);
      await signUp(page, newUser('Guardian'));
      await registerChild(page, path, youth, 'Maya R.');

      await expectRowsStay(
        page,
        youth,
        ['campRegistrations:listMyMinorsForCamp'],
        'Maya R. is registered',
      );
      await expectAccessible(page);
      await screenshot(page, testInfo, `356-camp-children-arrived-${width}`);
    });

    for (const { title, names, line } of CHILDREN) {
      test(`${title} share one row with Register, which grows once with nothing above it moving at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 800 });
        const { tenant, youth } = await seed();
        const ids = await sessionIds(tenant, YOUTH.slug);
        const path = registerPath(tenant, YOUTH.slug, ids['Week 1']);
        await signUp(page, newUser('Guardian'));
        for (const name of names) await registerChild(page, path, youth, name);

        await expectOwnRowGrowsOnce(
          page,
          youth,
          'Week 1',
          ['campRegistrations:listMyMinorsForCamp'],
          [{ slot: 'session-registered', text: line }],
          width <= 360 && names.includes(LONG),
        );
        await expect(
          row(page, 'Week 1').getByRole('link', { name: 'Register for Week 1' }),
        ).toBeVisible();
      });
    }

    test(`on a camp that admits both, the guardian’s row grows at most once and nothing above it moves when the lines arrive at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const { tenant, mixed } = await seed();
      const ids = await sessionIds(tenant, MIXED.slug);
      const path = registerPath(tenant, MIXED.slug, ids['Week 1']);
      await signUp(page, newUser('Both'));
      await page.goto(path);
      await ageBox(page).click();
      await registerButton(page).click();
      await expect(page).toHaveURL(`${baseURL}${mixed}`, { timeout: 20_000 });
      await registerChild(page, path, mixed, 'Maya R.');

      // Two lines need 42px, which a touch screen's 44px row holds and a mouse's 36px row does not.
      await expectOwnRowGrowsOnce(
        page,
        mixed,
        'Week 1',
        ['campRegistrations:listMineForCamp', 'campRegistrations:listMyMinorsForCamp'],
        [{ slot: 'session-registered', text: 'You and Maya R. are registered' }],
        false,
      );
    });
  }
});

test.describe('the waitlist of a full session', () => {
  const FULL_WEEK = 'Full week';
  const waitingLine = (page: Page) =>
    row(page, FULL_WEEK).locator('[data-slot="session-waitlist"]');

  async function join(page: Page, path: string, name: string) {
    await page.goto(path);
    await childName(page).fill(name);
    await ageBox(page).click();
    await joinButton(page).click();
  }

  test('a guardian joins for "Maya R.", which takes no place, and the camp page reads her position, also after a reload', async ({
    page,
  }, testInfo) => {
    const { tenant, youth } = await seed();
    const ids = await sessionIds(tenant, YOUTH.slug);
    const path = registerPath(tenant, YOUTH.slug, ids[FULL_WEEK]);
    await signUp(page, newUser('Guardian'));
    await page.goto(youth);
    await expect(row(page, FULL_WEEK)).toContainText('Full');
    await expect(row(page, FULL_WEEK).getByRole('link', { name: /^Register/ })).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '358-camp-full');

    await row(page, FULL_WEEK)
      .getByRole('link', { name: 'Join the waitlist for Full week' })
      .click();
    await expect(page).toHaveURL(`${baseURL}${path}`);
    await expect(alert(page)).toContainText('This session is full.');
    await expect(registerButton(page)).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'My child' })).toBeChecked();
    await expect(ageBox(page)).toHaveAccessibleName(/^My child is 9 to 17 years old on /);
    await expectAccessible(page);
    await screenshot(page, testInfo, '358-join-form');

    await childName(page).fill('Maya R.');
    await joinButton(page).click();
    await expect(page.locator('#age-confirmed-error')).toHaveText(
      "Confirm Maya R.'s age to continue.",
    );
    await expect(ageBox(page)).toBeFocused();
    await expectAccessible(page);
    await screenshot(page, testInfo, '358-join-age-error');

    await ageBox(page).click();
    await joinButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${youth}`, { timeout: 20_000 });
    await expect(waitingLine(page)).toHaveText('Maya R. is on the waitlist, position 1');
    await expect(row(page, FULL_WEEK)).toContainText('Full');
    await expect(row(page, FULL_WEEK).locator('[data-slot="session-registered"]')).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '358-camp-waiting');

    await page.reload();
    await expect(waitingLine(page)).toHaveText('Maya R. is on the waitlist, position 1');
    await expectAccessible(page);

    // The register page was replaced in history, so Back does not return to it.
    await page.goBack();
    expect(page.url()).not.toContain('/register');
  });

  test('the next person is at position 2, and another account sees neither name nor position', async ({
    page,
    browser,
  }) => {
    const { tenant, youth } = await seed();
    const ids = await sessionIds(tenant, YOUTH.slug);
    const path = registerPath(tenant, YOUTH.slug, ids[FULL_WEEK]);
    await signUp(page, newUser('First'));
    await join(page, path, 'Maya R.');
    await expect(page).toHaveURL(`${baseURL}${youth}`, { timeout: 20_000 });

    const second = await otherUser(browser, newUser('Second'));
    try {
      await join(second, path, 'Leo R.');
      await expect(second).toHaveURL(`${baseURL}${youth}`, { timeout: 20_000 });
      await expect(waitingLine(second)).toHaveText('Leo R. is on the waitlist, position 2');
      await expect(waitingLine(page)).toHaveText('Maya R. is on the waitlist, position 1');
      await expect(second.locator('main')).not.toContainText('Maya');
    } finally {
      await second.context().close();
    }
    const signedOut = await browser.newContext();
    try {
      const visitor = await signedOut.newPage();
      await visitor.goto(youth);
      await expect(row(visitor, FULL_WEEK)).toContainText('Full');
      await expect(
        row(visitor, FULL_WEEK).getByRole('link', { name: /^Join the waitlist/ }),
      ).toBeVisible();
      await expect(visitor.locator('main')).not.toContainText('Maya');
      await expect(visitor.locator('main')).not.toContainText('position');
    } finally {
      await signedOut.close();
    }
  });

  test('an adult who waits sees the waitlist card instead of the form, and the camp page names her', async ({
    page,
  }, testInfo) => {
    const { tenant, adult } = await seed();
    const ids = await sessionIds(tenant, ADULT.slug);
    const path = registerPath(tenant, ADULT.slug, ids['Last place']);
    await signUp(page, newUser('Adult'));
    await page.goto(path);
    await expect(alert(page)).toContainText('This session is full.');
    await expect(page.getByRole('radio', { name: 'Me' })).toBeChecked();
    await ageBox(page).click();
    await joinButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${adult}`, { timeout: 20_000 });
    await expect(row(page, 'Last place').locator('[data-slot="session-waitlist"]')).toHaveText(
      'You are on the waitlist, position 1',
    );
    await expect(row(page, 'Last place').getByRole('link')).toHaveCount(0);

    await page.goto(path);
    await expect(alert(page)).toContainText("You're on the waitlist for Last place.");
    await expect(ageBox(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to the camp page' })).toHaveAttribute(
      'href',
      adult,
    );
    await expectAccessible(page);
    await screenshot(page, testInfo, '358-register-waiting');
  });

  test.describe('the same child twice', () => {
    test.use({ expectedConvexErrors: ['campWaitlist:join'] });

    test('with another case or spacing, the server refuses it under the name and adds no second entry', async ({
      page,
    }, testInfo) => {
      const { tenant, youth } = await seed();
      const ids = await sessionIds(tenant, YOUTH.slug);
      const path = registerPath(tenant, YOUTH.slug, ids[FULL_WEEK]);
      await signUp(page, newUser('Guardian'));
      await join(page, path, 'Maya R.');
      await expect(page).toHaveURL(`${baseURL}${youth}`, { timeout: 20_000 });

      await join(page, path, '  maya   r. ');
      await expect(page.locator('#minor-name-error')).toHaveText(
        'Maya R. is already on the waitlist for this session.',
      );
      await expect(childName(page)).toBeFocused();
      await expect(childName(page)).toHaveValue('  maya   r. ');
      await expect(ageBox(page)).toBeChecked();
      await expectAccessible(page);
      await screenshot(page, testInfo, '358-join-duplicate');
      await page.goto(youth);
      await expect(waitingLine(page)).toHaveCount(1);
    });
  });

  test('offline, the Join button refuses to send, keeps the ticked box, and joins once the connection is back', async ({
    page,
  }, testInfo) => {
    const { tenant, youth } = await seed();
    const ids = await sessionIds(tenant, YOUTH.slug);
    await signUp(page, newUser('Offline'));
    await page.goto(registerPath(tenant, YOUTH.slug, ids[FULL_WEEK]));
    await childName(page).fill('Maya R.');
    await ageBox(page).click();
    await page.context().setOffline(true);
    try {
      await expect(joinButton(page)).toHaveAttribute('aria-disabled', 'true');
      await joinButton(page).click({ force: true });
      await expect(page.locator('main [data-slot="alert"][role="alert"]')).toContainText(
        "You're offline",
      );
      await expect(page.locator('main [data-slot="alert"][role="alert"]')).toBeFocused();
      await expect(ageBox(page)).toBeChecked();
      await expectAccessible(page);
      await screenshot(page, testInfo, '358-join-offline');
    } finally {
      await page.context().setOffline(false);
    }
    await expect(joinButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    await joinButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${youth}`, { timeout: 20_000 });
    await expect(waitingLine(page)).toHaveText('Maya R. is on the waitlist, position 1');
  });

  test('on a phone the waitlist form keeps Join the waitlist at the bottom edge, and in the flow at 1280px', async ({
    page,
  }, testInfo) => {
    const { tenant } = await seed();
    const ids = await sessionIds(tenant, YOUTH.slug);
    await signUp(page, newUser('Phone'));
    const phone = testInfo.project.name === 'chromium-mobile';
    await page.goto(registerPath(tenant, YOUTH.slug, ids[FULL_WEEK]));
    await expect(page.locator('[data-slot="form-footer"]')).toHaveCSS(
      'position',
      phone ? 'sticky' : 'static',
    );
    if (phone) {
      await expect(joinButton(page)).toBeInViewport({ ratio: 1 });
      expect((await joinButton(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('the camp page rows when the waitlist answers after sign-in', () => {
  const WIDTHS = [320, 360, 1280] as const;
  const TOLERANCE = 0.5;
  const WAITING = 'campWaitlist:listMineForCamp';
  const MAYA = { kind: 'minor', minorName: 'Maya R.' } as const;
  const LEO = { kind: 'minor', minorName: 'Leo R.' } as const;
  const SAM = { kind: 'minor', minorName: 'Sam R.' } as const;

  const layout = (page: Page) =>
    page.evaluate(() => ({
      page: document.documentElement.scrollHeight,
      rows: [...document.querySelectorAll('#sessions li')].map((li) => {
        const box = li.getBoundingClientRect();
        return { top: box.top + window.scrollY, height: box.height };
      }),
    }));

  async function expectRowsStay(
    page: Page,
    camp: string,
    sessionName: string,
    line: string,
    /** The row grows with its lines at the one moment they arrive, so the rows below it move once. */
    grows = false,
  ): Promise<void> {
    const held = await holdQueries(page, [WAITING]);
    await page.goto(camp);
    await expect.poll(() => held.isHolding()).toBe(true);
    const actions = row(page, sessionName).locator('[data-slot="session-actions"]');
    await expect(actions).toBeVisible();
    const before = await layout(page);
    const actionsBefore = (await actions.boundingBox())!;

    held.release();
    await expect(row(page, sessionName).locator('[data-slot="session-waitlist"]')).toHaveText(line);
    const after = await layout(page);
    expect(after.rows).toHaveLength(before.rows.length);
    const index = await row(page, sessionName).evaluate((li) =>
      [...document.querySelectorAll('#sessions li')].indexOf(li),
    );
    after.rows.forEach((box, at) => {
      if (at <= index || !grows) {
        expect(Math.abs(box.top - before.rows[at].top), `row ${at} top`).toBeLessThanOrEqual(
          TOLERANCE,
        );
      }
      if (!grows) {
        expect(
          Math.abs(box.height - before.rows[at].height),
          `row ${at} height`,
        ).toBeLessThanOrEqual(TOLERANCE);
      }
    });
    if (!grows) {
      expect(Math.abs(after.page - before.page), 'page height').toBeLessThanOrEqual(TOLERANCE);
      const actionsAfter = (await actions.boundingBox())!;
      expect(Math.abs(actionsAfter.height - actionsBefore.height)).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(actionsAfter.y - actionsBefore.y)).toBeLessThanOrEqual(TOLERANCE);
    }
    await expectNoLineClippedOrSpilled(page, sessionName, 1);
    await expectAccessible(page);
  }

  for (const width of WIDTHS) {
    test(`a waiting child: the caller's row grows at most once, nothing above it moves, and the rows below move only by that growth at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const { tenant, youth } = await seed();
      const ids = await sessionIds(tenant, YOUTH.slug);
      await signUp(page, newUser('Guardian'));
      await page.goto(registerPath(tenant, YOUTH.slug, ids['Full week']));
      await childName(page).fill('Maya R.');
      await ageBox(page).click();
      await joinButton(page).click();
      await expect(page).toHaveURL(`${baseURL}${youth}`, { timeout: 20_000 });

      // Beside the Join link the line needs 3 lines at 320px, and 2 lines fit the row at 360px and 1280px.
      await expectOwnRowGrowsOnce(
        page,
        youth,
        'Full week',
        [WAITING],
        [{ slot: 'session-waitlist', text: 'Maya R. is on the waitlist, position 1' }],
        width === 320,
      );
    });

    test(`an adult on the waitlist: the row keeps its height when the Join link gives way to the line at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const { tenant, adult } = await seed();
      const ids = await sessionIds(tenant, ADULT.slug);
      await signUp(page, newUser('Adult'));
      await page.goto(registerPath(tenant, ADULT.slug, ids['Last place']));
      await ageBox(page).click();
      await joinButton(page).click();
      await expect(page).toHaveURL(`${baseURL}${adult}`, { timeout: 20_000 });

      await expectRowsStay(page, adult, 'Last place', 'You are on the waitlist, position 1');
    });

    test(`a registered child and a waiting child (the demo guardian): the caller's row grows at most once, and only the rows below move at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      const { tenant, youth } = await seed();
      const guardian = newUser('Guardian');
      await signUp(page, guardian);
      await seedCampRegistration(tenant, YOUTH.slug, 'Full week', guardian, SAM);
      await seedCampWaitlistEntry(tenant, YOUTH.slug, 'Full week', guardian, MAYA);
      await expectOwnRowGrowsOnce(
        page,
        youth,
        'Full week',
        [WAITING],
        [
          { slot: 'session-registered', text: 'Sam R. is registered' },
          { slot: 'session-waitlist', text: 'Maya R. is on the waitlist, position 1' },
        ],
        width <= 360,
      );
      await screenshot(page, testInfo, '358-camp-registered-and-waiting');
    });

    test(`two waiting children: the caller's row grows at most once, and only the rows below move at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      const { tenant, youth } = await seed();
      const guardian = newUser('Guardian');
      await signUp(page, guardian);
      await seedCampWaitlistEntry(tenant, YOUTH.slug, 'Full week', guardian, MAYA);
      await seedCampWaitlistEntry(tenant, YOUTH.slug, 'Full week', guardian, LEO);
      await expectOwnRowGrowsOnce(
        page,
        youth,
        'Full week',
        [WAITING],
        [
          { slot: 'session-waitlist', text: 'Maya R. is on the waitlist, position 1' },
          { slot: 'session-waitlist', text: 'Leo R. is on the waitlist, position 2' },
        ],
        width <= 360,
      );
      await screenshot(page, testInfo, '358-camp-two-waiting');
    });
  }

  test('the registered and waiting lines wait for the last answer and arrive together', async ({
    page,
  }) => {
    const { tenant, youth } = await seed();
    const guardian = newUser('Guardian');
    await signUp(page, guardian);
    await seedCampRegistration(tenant, YOUTH.slug, 'Full week', guardian, SAM);
    await seedCampWaitlistEntry(tenant, YOUTH.slug, 'Full week', guardian, MAYA);
    const held = await holdQueries(page, [WAITING]);
    await page.goto(youth);
    await expect.poll(() => held.isHolding()).toBe(true);
    const full = row(page, 'Full week');
    await expect(full.getByRole('link', { name: 'Join the waitlist for Full week' })).toBeVisible();
    await expect(full.locator('[data-slot="session-registered"]')).toHaveCount(0);
    await expect(full.locator('[data-slot="session-waitlist"]')).toHaveCount(0);

    held.release();
    await expect(full.locator('[data-slot="session-registered"]')).toHaveText(
      'Sam R. is registered',
    );
    await expect(full.locator('[data-slot="session-waitlist"]')).toHaveCount(1);
  });
});

test.describe('a child whose name has no break in it', () => {
  test.use({ expectedConvexErrors: ['campWaitlist:join'] });

  const UNBROKEN = 'Wolfeschlegelsteinhausenbergerdorff'.repeat(2).slice(0, 60);
  const overflow = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  test('stays inside the camp page and the register page at 320px', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const { tenant, youth } = await seed();
    const ids = await sessionIds(tenant, YOUTH.slug);
    const path = registerPath(tenant, YOUTH.slug, ids['Full week']);
    await signUp(page, newUser('Guardian'));
    await page.goto(path);
    await childName(page).fill(UNBROKEN);
    await joinButton(page).click();
    await expect(page.locator('#age-confirmed-error')).toContainText(UNBROKEN);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, 'camp-waitlist-register-long-name-error');

    await ageBox(page).click();
    await joinButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${youth}`, { timeout: 20_000 });
    const line = row(page, 'Full week').locator('[data-slot="session-waitlist"]');
    await expect(line).toHaveText(`${UNBROKEN} is on the waitlist, position 1`);
    await expectNoLineClippedOrSpilled(page, 'Full week', 1);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, 'camp-waitlist-camp-long-name');

    await page.goto(path);
    await childName(page).fill(UNBROKEN);
    await ageBox(page).click();
    await joinButton(page).click();
    await expect(page.locator('#minor-name-error')).toContainText(UNBROKEN);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, 'camp-waitlist-register-long-name-duplicate');
  });
});
