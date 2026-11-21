import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import {
  changesOf,
  expectNoLineClippedOrSpilled,
  expectOwnRowGrowsOnce,
  heightSteps,
  recordRowFrames,
  TRAINING_CLASS_ROWS,
  TRAINING_SERIES_ROWS,
  topSteps,
} from './support/registered-rows';
import { screenshot } from './support/screenshot';
import { otherUser, signUp } from './support/session';
import { dateFromToday, seedTenant } from './support/tenant';
import {
  seedPublishedTraining,
  setTrainingClassRegistered,
  type PublishedTrainingSeed,
} from './support/training';
import {
  seedTrainingRegistration,
  seedTrainingWaitlistEntry,
} from './support/training-registrations';
import { newUser, seedUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const PLACE = 'North Beach Sand Courts';
const ADDRESS = '3500 Sandcourt Ln, Corpus Christi, TX 78402';
const FIRST_IN_DAYS = 14;
const MINE = 'trainingRegistrations:listMineForTraining';
const LONG = 'W'.repeat(60);

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

const classes = (firstInDays: number, deadlineInDays = firstInDays - 2) => ({
  weekday: weekdayOf(dateFromToday(firstInDays)),
  startTime: '18:00',
  endTime: '19:00',
  firstDate: dateFromToday(firstInDays),
  weeks: 3,
  placesPerClass: 12,
  registrationDeadline: dateFromToday(deadlineInDays),
});

function clinic(name: string, over: Partial<PublishedTrainingSeed> = {}): PublishedTrainingSeed {
  const token = randomBytes(3).toString('hex');
  return {
    name: `${name} ${token}`,
    slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${token}`,
    locations: [PLACE],
    coachName: 'Dana Ruiz',
    classes: classes(FIRST_IN_DAYS),
    ...over,
  };
}

async function seed() {
  const tenant = await seedTenant({
    name: 'E2E Training Registration',
    locations: [{ name: PLACE, address: ADDRESS }],
  });
  const programs = {
    adult: clinic('Adult Clinic', { minimumAge: 18, maximumAge: 99 }),
    youth: clinic('Youth Clinic', { minimumAge: 9, maximumAge: 17 }),
    mixed: clinic('Mixed Clinic', { minimumAge: 14, maximumAge: 30 }),
    older: clinic('Older Clinic', { minimumAge: 16 }),
    open: clinic('Open Clinic'),
    closed: clinic('Closed Clinic', { classes: classes(10, -1) }),
    full: clinic('Full Clinic', { minimumAge: 18 }),
    draft: clinic('Secret Draft Clinic', { status: 'draft' }),
  };
  const paths: Record<keyof typeof programs, string> = {} as never;
  for (const [key, program] of Object.entries(programs)) {
    paths[key as keyof typeof programs] = await seedPublishedTraining(tenant, program);
  }
  await setTrainingClassRegistered(
    tenant,
    programs.full.slug,
    dateFromToday(FIRST_IN_DAYS + 7),
    12,
  );
  return { tenant, programs, paths };
}

const registerPathOf = (publicPath: string) => `/app${publicPath}/register`;

const classRows = (page: Page) => page.locator('#classes li');
const registerLink = (page: Page) => page.getByRole('link', { name: 'Register for the series' });
const registeredLine = (page: Page) => page.locator('[data-slot="series-registered"]');
const ageBox = (page: Page) =>
  page.getByRole('checkbox', {
    name: /^(I am|.+ is) (\d+ to \d+ years old|\d+ or (older|younger))/,
  });
const childName = (page: Page) => page.getByRole('textbox', { name: "Child's name" });
const registerButton = (page: Page) => page.getByRole('button', { name: 'Register', exact: true });
const alert = (page: Page) => page.locator('main [data-slot="alert"]');
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function expectEveryClassPlacesLeft(page: Page, left: number) {
  await expect(classRows(page)).toHaveCount(3);
  for (const index of [0, 1, 2]) {
    await expect(classRows(page).nth(index).locator('[data-slot="class-places"]')).toHaveText(
      `${left} places left`,
    );
  }
}

test.describe('register for a training series', () => {
  test('a signed-in adult ticks the age box and registers for the series, which takes one place in every class and reads "You\'re registered"', async ({
    page,
  }, testInfo) => {
    const { paths } = await seed();
    await signUp(page, newUser('Adult'));
    await page.goto(paths.adult);
    await expectEveryClassPlacesLeft(page, 12);
    await expect(page.locator('[data-slot="series-status"]')).toHaveText('Registration open');
    await expectAccessible(page);
    await screenshot(page, testInfo, '362-training-open');

    await registerLink(page).click();
    await expect(page).toHaveURL(`${baseURL}${registerPathOf(paths.adult)}`);
    await expect(page.getByRole('heading', { level: 1, name: /^Adult Clinic/ })).toBeVisible();
    await expect(page.getByRole('group', { name: "Who's attending" })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Me' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'My child' })).toHaveCount(0);
    await expect(ageBox(page)).not.toBeChecked();
    await expect(page).toHaveTitle(/^Register for a training series \| Adult Clinic/);
    await expectAccessible(page);
    await screenshot(page, testInfo, '362-register-form');

    await registerButton(page).click();
    await expect(page.locator('#age-confirmed-error')).toHaveText('Confirm your age to continue.');
    await expect(ageBox(page)).toBeFocused();
    await expectAccessible(page);
    await screenshot(page, testInfo, '362-register-age-error');

    await ageBox(page).click();
    await expect(page.locator('#age-confirmed-error')).toHaveCount(0);
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${paths.adult}`, { timeout: 20_000 });
    await expect(registeredLine(page)).toHaveText("You're registered");
    await expectEveryClassPlacesLeft(page, 11);
    await expect(registerLink(page)).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '362-training-registered');

    // The register page was replaced in history, so Back does not return to it.
    await page.goBack();
    expect(page.url()).not.toContain('/register');

    await page.goto(registerPathOf(paths.adult));
    await expect(alert(page)).toContainText("You're registered for Adult Clinic");
    await expect(ageBox(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to the training page' })).toHaveAttribute(
      'href',
      paths.adult,
    );
    await expectAccessible(page);
  });

  test('a signed-out visitor who presses Register returns to the same register page after signing in', async ({
    page,
  }) => {
    const { paths } = await seed();
    await page.goto(paths.adult);
    await registerLink(page).click();
    await expect(page).toHaveURL(/\/sign-in\?/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(registerPathOf(paths.adult));

    await page.getByRole('main').getByRole('link', { name: 'Create an account' }).click();
    const user = newUser('Adult');
    await page.locator('#name').fill(user.name);
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.getByRole('checkbox', { name: 'I am 18 or older' }).click();
    await page.getByRole('button', { name: /Create account/ }).click();
    await expect(page).toHaveURL(`${baseURL}${registerPathOf(paths.adult)}`, { timeout: 20_000 });
    await expect(ageBox(page)).toBeVisible();
  });

  test('a program with no ages asks for no age box, and a program with one bound words it "or older"', async ({
    page,
  }, testInfo) => {
    const { paths } = await seed();
    await signUp(page, newUser('Plain'));
    await page.goto(registerPathOf(paths.older));
    await expect(ageBox(page)).toHaveAccessibleName(/^I am 16 or older on /);
    await expectAccessible(page);
    await screenshot(page, testInfo, '362-register-one-bound');

    await page.goto(registerPathOf(paths.open));
    await expect(registerButton(page)).toBeVisible();
    await expect(ageBox(page)).toHaveCount(0);
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${paths.open}`, { timeout: 20_000 });
    await expect(registeredLine(page)).toHaveText("You're registered");
    await expectEveryClassPlacesLeft(page, 11);
  });

  test('a closed series shows its reason with a link back and no form, and a full one offers its waitlist', async ({
    page,
  }, testInfo) => {
    const { paths } = await seed();
    await signUp(page, newUser('Late'));
    await page.goto(paths.closed);
    await expect(registerLink(page)).toHaveCount(0);
    await page.goto(registerPathOf(paths.closed));
    await expect(alert(page)).toContainText('Registration for this training program is closed.');
    await expect(alert(page)).toContainText('It closed on');
    await expect(page.locator('form')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to the training page' })).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '362-register-closed');

    await page.goto(paths.full);
    await expect(registerLink(page)).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Join the waitlist for the series' }),
    ).toBeVisible();
    await expect(page.locator('[data-slot="series-full"]')).toHaveText(
      'A class is full, so no place is left for the whole series.',
    );
    await page.goto(registerPathOf(paths.full));
    await expect(page.locator('form [role="note"]')).toContainText('A class is full.');
    await expect(page.getByRole('button', { name: 'Join the waitlist' })).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '362-register-full');
  });

  test('an unknown program, a draft, and another organization’s path show the not-found view', async ({
    page,
  }) => {
    const { tenant, paths } = await seed();
    await signUp(page, newUser('Lost'));
    for (const path of [
      `/app/organizations/${tenant.slug}/training/no-such-clinic/register`,
      registerPathOf(paths.draft),
      `/app/organizations/no-such-org/training/anything/register`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
      await expect(ageBox(page)).toHaveCount(0);
    }
    await expectAccessible(page);
  });

  test('refuses to send while offline, keeps the ticked box, and registers once the connection is back', async ({
    page,
  }, testInfo) => {
    const { paths } = await seed();
    await signUp(page, newUser('Offline'));
    await page.goto(registerPathOf(paths.adult));
    await ageBox(page).click();
    await page.context().setOffline(true);
    try {
      await expect(registerButton(page)).toHaveAttribute('aria-disabled', 'true');
      await registerButton(page).click({ force: true });
      await expect(alert(page)).toContainText("You're offline");
      await expect(alert(page)).toBeFocused();
      await expect(ageBox(page)).toBeChecked();
      await expectAccessible(page);
      await screenshot(page, testInfo, '362-register-offline');
    } finally {
      await page.context().setOffline(false);
    }
    await expect(registerButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${paths.adult}`, { timeout: 20_000 });
    await expectEveryClassPlacesLeft(page, 11);
  });

  test('keeps Register at the bottom edge once the form shows on a short phone screen, and in the flow at 1280px', async ({
    page,
  }, testInfo) => {
    const { paths } = await seed();
    await signUp(page, newUser('Phone'));
    const phone = testInfo.project.name === 'chromium-mobile';
    await page.goto(registerPathOf(paths.adult));
    const footer = page.locator('[data-slot="form-footer"]');
    await expect(footer).toHaveCSS('position', phone ? 'sticky' : 'static');
    if (phone) {
      // A screen that ends 120px below the top of the form, so the form's own end is off screen.
      const formTop = (await page.locator('form').boundingBox())!.y;
      await page.setViewportSize({ width: 360, height: Math.round(formTop) + 120 });
      await expect(registerButton(page)).toBeInViewport({ ratio: 1 });
      expect((await registerButton(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    } else {
      await expect(registerButton(page)).toBeInViewport({ ratio: 1 });
    }
    await expectAccessible(page);
  });
});

test.describe('a guardian registers a child', () => {
  test('registers "Maya R." with the box ticked, which takes one place in every class and reads "Maya R. is registered"', async ({
    page,
  }, testInfo) => {
    const { paths } = await seed();
    await signUp(page, newUser('Guardian'));
    await page.goto(paths.youth);
    await registerLink(page).click();
    await expect(page.getByRole('radio', { name: 'My child' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Me' })).toHaveCount(0);
    await expect(ageBox(page)).toHaveAccessibleName(/^My child is 9 to 17 years old on /);

    await childName(page).fill('  Maya   R. ');
    await expect(ageBox(page)).toHaveAccessibleName(/^Maya R\. is 9 to 17 years old on /);
    await registerButton(page).click();
    await expect(page.locator('#age-confirmed-error')).toHaveText(
      "Confirm Maya R.'s age to continue.",
    );
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${paths.youth}`, { timeout: 20_000 });
    await expect(registeredLine(page)).toHaveText('Maya R. is registered');
    await expectEveryClassPlacesLeft(page, 11);
    await expectAccessible(page);
    await screenshot(page, testInfo, '362-training-child-registered');
  });

  test('a program that admits both offers Me and My child, and a guardian registers both', async ({
    page,
  }) => {
    const { paths } = await seed();
    await signUp(page, newUser('Both'));
    await page.goto(registerPathOf(paths.mixed));
    await expect(page.getByRole('radio', { name: 'Me' })).toBeChecked();
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${paths.mixed}`, { timeout: 20_000 });

    await page.goto(registerPathOf(paths.mixed));
    await expect(page.getByRole('radio', { name: 'Me' })).toHaveCount(0);
    await childName(page).fill('Maya R.');
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${paths.mixed}`, { timeout: 20_000 });
    await expect(registeredLine(page)).toHaveText('You and Maya R. are registered');
    await expectEveryClassPlacesLeft(page, 10);
  });

  test('another account sees neither the child’s name nor the place as its own', async ({
    page,
    browser,
  }) => {
    const { paths } = await seed();
    await signUp(page, newUser('Guardian'));
    await page.goto(registerPathOf(paths.youth));
    await childName(page).fill('Maya R.');
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${paths.youth}`, { timeout: 20_000 });

    const other = await otherUser(browser, newUser('Other'));
    try {
      await other.goto(paths.youth);
      await expectEveryClassPlacesLeft(other, 11);
      await expect(registeredLine(other)).toHaveCount(0);
      await expect(other.locator('main')).not.toContainText('Maya');
    } finally {
      await other.context().close();
    }
  });
});

test.describe('a guardian registers the same child again', () => {
  test.use({ expectedConvexErrors: ['trainingRegistrations:register'] });

  test('with another case or spacing, the server refuses the same child under the name and takes no place', async ({
    page,
  }, testInfo) => {
    const { paths } = await seed();
    await signUp(page, newUser('Guardian'));
    await page.goto(registerPathOf(paths.youth));
    await childName(page).fill('Maya R.');
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${paths.youth}`, { timeout: 20_000 });

    await page.goto(registerPathOf(paths.youth));
    await childName(page).fill('  maya   r. ');
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page.locator('#minor-name-error')).toHaveText(
      'Maya R. is already registered for this training program.',
    );
    await expect(childName(page)).toBeFocused();
    await expect(childName(page)).toHaveValue('  maya   r. ');
    await expect(ageBox(page)).toBeChecked();
    await expectAccessible(page);
    await screenshot(page, testInfo, '362-register-child-duplicate');
    await page.goto(paths.youth);
    await expectEveryClassPlacesLeft(page, 11);
  });
});

test.describe('the training page when the viewer’s places arrive', () => {
  const WIDTHS = [320, 360, 1280] as const;
  const TOLERANCE = 0.5;
  const TWO_COLUMNS = 1280;
  const CLASSES_CARD = '#classes > div';

  const seriesRow = (page: Page) =>
    page
      .locator(TRAINING_SERIES_ROWS.rows)
      .filter({ has: page.locator('[data-slot="series-actions"]') });

  for (const width of WIDTHS) {
    test(`the series row grows once and nothing above it moves when a registered child with a 60-character name arrives at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      const { paths } = await seed();
      await signUp(page, newUser('Steady'));
      await page.goto(registerPathOf(paths.youth));
      await childName(page).fill(LONG);
      await ageBox(page).click();
      await registerButton(page).click();
      await expect(page).toHaveURL(`${baseURL}${paths.youth}`, { timeout: 20_000 });

      await expectOwnRowGrowsOnce(
        page,
        paths.youth,
        TRAINING_SERIES_ROWS,
        seriesRow(page),
        [MINE],
        [{ slot: 'series-registered', text: `${LONG} is registered` }],
        true,
        true,
        width === TWO_COLUMNS ? CLASSES_CARD : undefined,
      );
      await screenshot(page, testInfo, `362-training-child-arrived-${width}`);
    });
  }

  for (const width of [320, TWO_COLUMNS]) {
    test(`an adult’s line takes the place of the Register link and the series row keeps its height at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const { paths } = await seed();
      await signUp(page, newUser('Adult'));
      await page.goto(registerPathOf(paths.adult));
      await ageBox(page).click();
      await registerButton(page).click();
      await expect(page).toHaveURL(`${baseURL}${paths.adult}`, { timeout: 20_000 });

      await expectOwnRowGrowsOnce(
        page,
        paths.adult,
        TRAINING_SERIES_ROWS,
        seriesRow(page),
        [MINE],
        [{ slot: 'series-registered', text: "You're registered" }],
        false,
        false,
        width === TWO_COLUMNS ? CLASSES_CARD : undefined,
      );
    });
  }

  test('an adult’s line takes the place of the Register link and the row keeps its height', async ({
    page,
  }) => {
    const { paths } = await seed();
    await signUp(page, newUser('Adult'));
    await page.goto(registerPathOf(paths.adult));
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${paths.adult}`, { timeout: 20_000 });

    const held = await holdQueries(page, [MINE]);
    await page.goto(paths.adult);
    await expect.poll(() => held.isHolding()).toBe(true);
    const actions = page.locator('[data-slot="series-actions"]');
    await expect(registerLink(page)).toBeVisible();
    const before = (await actions.boundingBox())!;
    held.release();
    await expect(registeredLine(page)).toHaveText("You're registered");
    const after = (await actions.boundingBox())!;
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(TOLERANCE);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(TOLERANCE);
  });
});

test.describe('long names and narrow screens', () => {
  test('a program with a long name stays inside the register page and the training page at 320px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const tenant = await seedTenant({
      name: 'E2E Training Long Name',
      locations: [{ name: PLACE, address: ADDRESS }],
    });
    const name = 'X'.repeat(90);
    const path = await seedPublishedTraining(tenant, {
      ...clinic('Long Name Clinic', { minimumAge: 18, maximumAge: 99 }),
      name,
    });
    await signUp(page, newUser('Narrow'));
    await page.goto(path);
    await expect(registerLink(page)).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.goto(registerPathOf(path));
    await expect(ageBox(page)).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectAccessible(page);
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, { timeout: 20_000 });
    await page.goto(registerPathOf(path));
    await expect(alert(page)).toContainText(`You're registered for ${name}`);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectAccessible(page);
  });
});

test.describe('a child with a long name is refused as a repeat', () => {
  test.use({ expectedConvexErrors: ['trainingRegistrations:register'] });

  test('the register page stays inside the card at 320px, with a 60-character child name in the age box and the refusal', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const { paths } = await seed();
    await signUp(page, newUser('Guardian'));
    await page.goto(registerPathOf(paths.youth));
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
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '362-register-long-name-320');

    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${paths.youth}`, { timeout: 20_000 });
    await page.goto(registerPathOf(paths.youth));
    await childName(page).fill(LONG.toLowerCase());
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page.locator('#minor-name-error')).toContainText(LONG);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectAccessible(page);
  });
});

const singleClasses = { ...classes(FIRST_IN_DAYS), allowSingleRegistration: true };

async function seedSingle() {
  const tenant = await seedTenant({
    name: 'E2E Training Single Class',
    locations: [{ name: PLACE, address: ADDRESS }],
  });
  const programs = {
    adult: clinic('Drop-in Adult Clinic', {
      minimumAge: 18,
      maximumAge: 99,
      classes: singleClasses,
    }),
    youth: clinic('Drop-in Youth Clinic', {
      minimumAge: 9,
      maximumAge: 17,
      classes: singleClasses,
    }),
    series: clinic('Series Only Clinic', { minimumAge: 18, maximumAge: 99 }),
  };
  const paths: Record<keyof typeof programs, string> = {} as never;
  for (const [key, program] of Object.entries(programs)) {
    paths[key as keyof typeof programs] = await seedPublishedTraining(tenant, program);
  }
  return { tenant, programs, paths };
}

const classRow = (page: Page, index: number) => page.locator('#classes li').nth(index);
const classLink = (page: Page, index: number) =>
  classRow(page, index).locator('a[data-slot="button"]');
const classRegisteredLine = (page: Page, index: number) =>
  classRow(page, index).locator('[data-slot="class-registered"]');
const classPlaces = (page: Page, index: number) =>
  classRow(page, index).locator('[data-slot="class-places"]');

async function classPathOf(page: Page, index: number): Promise<string> {
  const href = await classLink(page, index).getAttribute('href');
  expect(href).toMatch(/\/register\?class=/);
  return href!;
}

test.describe('register for one class', () => {
  test('a signed-in adult registers for one class, which takes a place in that class only and reads "You\'re registered" on its row', async ({
    page,
  }, testInfo) => {
    const { paths } = await seedSingle();
    await signUp(page, newUser('Dropin'));
    await page.goto(paths.adult);
    await expect(page.locator('#classes li')).toHaveCount(3);
    for (const index of [0, 1, 2]) {
      await expect(classLink(page, index)).toHaveText(/^Register for \w{3}, /);
    }
    await expect(registerLink(page)).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '363-training-classes-open');

    const href = await classPathOf(page, 1);
    await classLink(page, 1).click();
    await expect(page).toHaveURL(`${baseURL}${href}`);
    await expect(page).toHaveTitle(/^Register for a class \| Drop-in Adult Clinic/);
    await expect(
      page.locator('#main').getByText('Register for a class', { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('main dl > div').filter({ hasText: 'Places left' }).locator('dd'),
    ).toHaveText('12 places left');
    await expectAccessible(page);
    await screenshot(page, testInfo, '363-register-class-form');

    await registerButton(page).click();
    await expect(page.locator('#age-confirmed-error')).toHaveText('Confirm your age to continue.');
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${paths.adult}`, { timeout: 20_000 });

    await expect(classRegisteredLine(page, 1)).toHaveText("You're registered");
    await expect(classPlaces(page, 1)).toHaveText('11 places left');
    await expect(classPlaces(page, 0)).toHaveText('12 places left');
    await expect(classPlaces(page, 2)).toHaveText('12 places left');
    await expect(classLink(page, 1)).toHaveCount(0);
    await expect(classLink(page, 0)).toBeVisible();
    await expect(classLink(page, 2)).toBeVisible();
    await expect(registeredLine(page)).toHaveCount(0);
    await expect(registerLink(page)).toBeVisible();
    await expectAccessible(page);
    await screenshot(page, testInfo, '363-training-class-registered');

    // The register page was replaced in history, so Back does not return to it.
    await page.goBack();
    expect(page.url()).not.toContain('/register');

    await page.goto(href);
    await expect(alert(page)).toContainText("You're registered for");
    await expect(ageBox(page)).toHaveCount(0);
    await expectAccessible(page);
  });

  test('registering for the series replaces the single-class registrations, so each class counts the person once', async ({
    page,
  }) => {
    const { paths } = await seedSingle();
    await signUp(page, newUser('Upgrade'));
    for (const index of [0, 2]) {
      await page.goto(paths.adult);
      await classLink(page, index).click();
      await ageBox(page).click();
      await registerButton(page).click();
      await expect(page).toHaveURL(`${baseURL}${paths.adult}`, { timeout: 20_000 });
      await expect(classRegisteredLine(page, index)).toHaveText("You're registered");
    }
    await expect(classPlaces(page, 1)).toHaveText('12 places left');

    await registerLink(page).click();
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${paths.adult}`, { timeout: 20_000 });
    await expect(registeredLine(page)).toHaveText("You're registered");
    await expectEveryClassPlacesLeft(page, 11);
    await expect(page.locator('[data-slot="class-registered"]')).toHaveCount(0);
    await expect(page.locator('#classes a[data-slot="button"]')).toHaveCount(0);
  });

  test('a program that does not take a single class lists its classes with no Register link', async ({
    page,
  }) => {
    const { paths } = await seedSingle();
    await signUp(page, newUser('Series'));
    await page.goto(paths.series);
    await expect(page.locator('#classes li')).toHaveCount(3);
    await expect(page.locator('#classes a[data-slot="button"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="class-actions"]')).toHaveCount(0);
    await expect(registerLink(page)).toBeVisible();
  });

  test('a signed-out visitor who presses a class returns to that class after signing in', async ({
    page,
  }) => {
    const { paths } = await seedSingle();
    await page.goto(paths.adult);
    const href = await classPathOf(page, 2);
    await classLink(page, 2).click();
    await expect(page).toHaveURL(/\/sign-in\?/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(href);

    await page.getByRole('main').getByRole('link', { name: 'Create an account' }).click();
    const user = newUser('Adult');
    await page.locator('#name').fill(user.name);
    await page.locator('#email').fill(user.email);
    await page.locator('#password').fill(user.password);
    await page.getByRole('checkbox', { name: 'I am 18 or older' }).click();
    await page.getByRole('button', { name: /Create account/ }).click();
    await expect(page).toHaveURL(`${baseURL}${href}`, { timeout: 20_000 });
    await expect(ageBox(page)).toBeVisible();
  });

  test('an address that names no class of the program says the class is not open, with a link back', async ({
    page,
  }, testInfo) => {
    const { paths } = await seedSingle();
    await signUp(page, newUser('Stale'));
    await page.goto(`${registerPathOf(paths.adult)}?class=nonsense`);
    await expect(alert(page)).toContainText('This class is not open for registration.');
    await expect(ageBox(page)).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to the training page' })).toHaveAttribute(
      'href',
      paths.adult,
    );
    await expectAccessible(page);
    await screenshot(page, testInfo, '363-register-class-not-open');
  });
});

test.describe('the classes when the viewer’s places arrive', () => {
  const WIDTHS = [320, 360, 1280] as const;
  const TWO_COLUMNS = 1280;
  const DETAILS_LIST = '#details-heading + dl';

  for (const width of WIDTHS) {
    test(`the class row grows at most once and the rows below move only by that growth when a class a child with a 60-character name holds arrives at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      const { paths } = await seedSingle();
      await signUp(page, newUser('Steady'));
      await page.goto(paths.youth);
      await classLink(page, 0).click();
      await childName(page).fill(LONG);
      await ageBox(page).click();
      await registerButton(page).click();
      await expect(page).toHaveURL(`${baseURL}${paths.youth}`, { timeout: 20_000 });

      const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
      // At 1280px a touch screen's 44px row holds the wrapped line, so the row has no growth to record.
      const rowMustGrow = !(touch && width === TWO_COLUMNS);
      await expectOwnRowGrowsOnce(
        page,
        paths.youth,
        TRAINING_CLASS_ROWS,
        classRow(page, 0),
        [MINE],
        [{ slot: 'class-registered', text: `${LONG} is registered` }],
        rowMustGrow,
        rowMustGrow,
        width === TWO_COLUMNS ? DETAILS_LIST : undefined,
      );
      await screenshot(page, testInfo, `363-training-class-arrived-${width}`);
    });
  }

  for (const width of [320, TWO_COLUMNS]) {
    test(`an adult’s line takes the place of the class Register link and the class row keeps its height at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const { paths } = await seedSingle();
      await signUp(page, newUser('Dropin'));
      await page.goto(paths.adult);
      await classLink(page, 0).click();
      await ageBox(page).click();
      await registerButton(page).click();
      await expect(page).toHaveURL(`${baseURL}${paths.adult}`, { timeout: 20_000 });

      await expectOwnRowGrowsOnce(
        page,
        paths.adult,
        TRAINING_CLASS_ROWS,
        classRow(page, 0),
        [MINE],
        [{ slot: 'class-registered', text: "You're registered" }],
        false,
        false,
        width === TWO_COLUMNS ? DETAILS_LIST : undefined,
      );
    });
  }

  test('the register page for a class stays inside the card at 320px with a long program name', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const tenant = await seedTenant({
      name: 'E2E Training Single Long Name',
      locations: [{ name: PLACE, address: ADDRESS }],
    });
    const name = 'X'.repeat(90);
    const path = await seedPublishedTraining(tenant, {
      ...clinic('Long Name Drop-in', { minimumAge: 18, maximumAge: 99, classes: singleClasses }),
      name,
    });
    await signUp(page, newUser('Narrow'));
    await page.goto(path);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await classLink(page, 0).click();
    await expect(ageBox(page)).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '363-register-class-long-name-320');
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, { timeout: 20_000 });
    await expect(classRegisteredLine(page, 0)).toHaveText("You're registered");
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectAccessible(page);
  });
});

test.describe('the series when the last place of a class is the viewer’s own', () => {
  const CLASS_ONE_IN_DAYS = FIRST_IN_DAYS + 7;
  const fullNote = (page: Page) => page.locator('[data-slot="series-full"]');

  test('an adult whose single-class place fills a class still sees Register for the series and registers for it', async ({
    page,
  }) => {
    const { tenant, programs, paths } = await seedSingle();
    await setTrainingClassRegistered(
      tenant,
      programs.adult.slug,
      dateFromToday(CLASS_ONE_IN_DAYS),
      11,
    );
    await signUp(page, newUser('OwnLast'));
    await page.goto(paths.adult);
    await classLink(page, 1).click();
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${paths.adult}`, { timeout: 20_000 });
    await expect(classPlaces(page, 1)).toHaveText('Full');
    await expect(classRegisteredLine(page, 1)).toHaveText("You're registered");
    await expect(fullNote(page)).toHaveCount(0);
    await expect(registerLink(page)).toBeVisible();

    await registerLink(page).click();
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${paths.adult}`, { timeout: 20_000 });
    await expect(registeredLine(page)).toHaveText("You're registered");
    await expect(classPlaces(page, 0)).toHaveText('11 places left');
    await expect(classPlaces(page, 1)).toHaveText('Full');
    await expect(classPlaces(page, 2)).toHaveText('11 places left');
  });

  test('a signed-in adult who holds no place in a full class sees the full note and no series link', async ({
    page,
  }) => {
    const { tenant, programs, paths } = await seedSingle();
    await setTrainingClassRegistered(
      tenant,
      programs.adult.slug,
      dateFromToday(CLASS_ONE_IN_DAYS),
      12,
    );
    await signUp(page, newUser('Bystander'));
    await page.goto(paths.adult);
    await expect(classPlaces(page, 1)).toHaveText('Full');
    await expect(fullNote(page)).toBeVisible();
    await expect(registerLink(page)).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Join the waitlist for the series' }),
    ).toBeVisible();
  });

  test('a guardian whose child holds the last place of a class registers that child for the series', async ({
    page,
  }) => {
    const { tenant, programs, paths } = await seedSingle();
    await setTrainingClassRegistered(
      tenant,
      programs.youth.slug,
      dateFromToday(CLASS_ONE_IN_DAYS),
      11,
    );
    await signUp(page, newUser('GuardianLast'));
    await page.goto(paths.youth);
    await classLink(page, 1).click();
    await childName(page).fill('Maya R.');
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${paths.youth}`, { timeout: 20_000 });
    await expect(classPlaces(page, 1)).toHaveText('Full');
    await expect(classRegisteredLine(page, 1)).toHaveText('Maya R. is registered');
    await expect(fullNote(page)).toHaveCount(0);
    await expect(registerLink(page)).toBeVisible();

    await registerLink(page).click();
    await childName(page).fill('Maya R.');
    await ageBox(page).click();
    await registerButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${paths.youth}`, { timeout: 20_000 });
    await expect(registeredLine(page)).toHaveText('Maya R. is registered');
    await expect(classPlaces(page, 0)).toHaveText('11 places left');
    await expect(classPlaces(page, 1)).toHaveText('Full');
    await expect(classPlaces(page, 2)).toHaveText('11 places left');
    await expect(page.locator('[data-slot="class-registered"]')).toHaveCount(0);
  });
});

test.describe('the series waitlist', () => {
  const WAITING = 'trainingWaitlist:listMineForTraining';
  const SELF = { kind: 'self' } as const;
  const MAYA = { kind: 'minor', minorName: 'Maya R.' } as const;
  const waitingLines = (page: Page) => page.locator('[data-slot="series-waitlist"]');
  const joinLink = (page: Page) =>
    page.getByRole('link', { name: 'Join the waitlist for the series' });
  const joinButton = (page: Page) =>
    page.getByRole('button', { name: 'Join the waitlist', exact: true });

  /** One place in every class, held by another account, so every class is full. */
  async function fullSeries(over: Partial<PublishedTrainingSeed> = {}) {
    const tenant = await seedTenant({
      name: 'E2E Training Waitlist',
      locations: [{ name: PLACE, address: ADDRESS }],
    });
    const program = clinic('Waitlist Clinic', {
      classes: { ...classes(FIRST_IN_DAYS), placesPerClass: 1 },
      ...over,
    });
    const path = await seedPublishedTraining(tenant, program);
    const holder = await seedUser(newUser('Holder'));
    await seedTrainingRegistration(tenant, program.slug, holder, SELF);
    return { tenant, program, path };
  }

  test('a person joins the waitlist of a full series, and the training page reads their position, also after a reload', async ({
    page,
  }, testInfo) => {
    const { path, program } = await fullSeries({ minimumAge: 18, maximumAge: 99 });
    await signUp(page, newUser('Joiner'));
    await page.goto(path);
    await expect(classRows(page).first().locator('[data-slot="class-places"]')).toHaveText('Full');
    await expect(registerLink(page)).toHaveCount(0);
    await expect(waitingLines(page)).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '365-training-full');

    await joinLink(page).click();
    await expect(page).toHaveURL(`${baseURL}${registerPathOf(path)}`);
    await expect(page).toHaveTitle(
      new RegExp(`^Join the waitlist for a training series \\| ${program.name}`),
    );
    await expect(page.locator('form [role="note"]')).toContainText('A class is full.');
    await expect(page.getByRole('radio', { name: 'Me' })).toBeChecked();
    await expectAccessible(page);
    await screenshot(page, testInfo, '365-join-form');

    await joinButton(page).click();
    await expect(page.locator('#age-confirmed-error')).toHaveText('Confirm your age to continue.');
    await ageBox(page).click();
    await joinButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, { timeout: 20_000 });
    await expect(waitingLines(page)).toHaveText("You're on the waitlist, position 1");
    await expect(joinLink(page)).toHaveCount(0);
    await expect(registeredLine(page)).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '365-training-waiting');

    await page.reload();
    await expect(waitingLines(page)).toHaveText("You're on the waitlist, position 1");
    await page.goto(registerPathOf(path));
    await expect(alert(page)).toContainText(`You're on the waitlist for ${program.name}`);
    await expect(page.locator('form')).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '365-register-waiting');
  });

  for (const width of [320, 360, 1280]) {
    test(`a second person waits behind the first, and a guardian's child reads by name, with nothing scrolling sideways at ${width}px`, async ({
      page,
      browser,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const { path, program, tenant } = await fullSeries({ minimumAge: 9, maximumAge: 99 });
      const first = await otherUser(browser, newUser('First'));
      await first.goto(registerPathOf(path));
      await first.getByRole('radio', { name: 'Me' }).check();
      await ageBox(first).click();
      await joinButton(first).click();
      await expect(first).toHaveURL(`${baseURL}${path}`, { timeout: 20_000 });
      await expect(waitingLines(first)).toHaveText("You're on the waitlist, position 1");
      await first.context().close();

      const guardian = newUser('Guardian');
      await signUp(page, guardian);
      await page.goto(registerPathOf(path));
      await page.getByRole('radio', { name: 'My child' }).check();
      await childName(page).fill(LONG);
      await ageBox(page).click();
      await joinButton(page).click();
      await expect(page).toHaveURL(`${baseURL}${path}`, { timeout: 20_000 });
      await expect(waitingLines(page)).toHaveText(`${LONG} is on the waitlist, position 2`);
      await expect(joinLink(page)).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await expectAccessible(page);

      await seedTrainingWaitlistEntry(tenant, program.slug, guardian, MAYA);
      await page.reload();
      await expect(waitingLines(page)).toHaveText([
        `${LONG} is on the waitlist, position 2`,
        'Maya R. is on the waitlist, position 3',
      ]);
      for (const line of await waitingLines(page).all()) {
        const clipped = await line
          .locator('span')
          .evaluate(
            (span) =>
              span.scrollWidth > span.clientWidth + 1 || span.scrollHeight > span.clientHeight + 1,
          );
        expect(clipped).toBe(false);
      }
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await expectAccessible(page);
    });
  }

  test('a waiting entry holds the places: a series with places left reads Full, refuses a registration, and takes the next person into the waitlist', async ({
    page,
  }, testInfo) => {
    const tenant = await seedTenant({
      name: 'E2E Training Queue',
      locations: [{ name: PLACE, address: ADDRESS }],
    });
    const program = clinic('Queue Clinic');
    const path = await seedPublishedTraining(tenant, program);
    const earlier = await seedUser(newUser('Earlier'));
    await seedTrainingWaitlistEntry(tenant, program.slug, earlier, SELF);

    await signUp(page, newUser('Later'));
    await page.goto(path);
    for (const index of [0, 1, 2]) {
      await expect(classRows(page).nth(index).locator('[data-slot="class-places"]')).toHaveText(
        'Full',
      );
    }
    await expect(page.locator('[data-slot="series-full"]')).toHaveText(
      'People are waiting for a place, so no place is left for the whole series.',
    );
    await expect(registerLink(page)).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '365-training-queue');

    await joinLink(page).click();
    await joinButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, { timeout: 20_000 });
    await expect(waitingLines(page)).toHaveText("You're on the waitlist, position 2");
  });

  test('a series with a place in every class and no one waiting offers Register, and the waitlist is refused', async ({
    page,
  }) => {
    const tenant = await seedTenant({
      name: 'E2E Training Open',
      locations: [{ name: PLACE, address: ADDRESS }],
    });
    const path = await seedPublishedTraining(tenant, clinic('Open Queue Clinic'));
    await signUp(page, newUser('Early'));
    await page.goto(path);
    await expect(joinLink(page)).toHaveCount(0);
    await expect(registerLink(page)).toBeVisible();
    await page.goto(registerPathOf(path));
    await expect(registerButton(page)).toBeVisible();
    await expect(page.locator('form [role="note"]')).toHaveCount(0);
  });

  test('a person offline presses Join the waitlist: nothing is sent and the box stays ticked', async ({
    page,
  }) => {
    const { path } = await fullSeries({ minimumAge: 18, maximumAge: 99 });
    await signUp(page, newUser('Offline'));
    await page.goto(registerPathOf(path));
    await ageBox(page).click();
    await page.context().setOffline(true);
    try {
      await expect(joinButton(page)).toHaveAttribute('aria-disabled', 'true');
      await joinButton(page).click({ force: true });
      await expect(alert(page).filter({ hasText: "You're offline" })).toBeFocused();
      await expect(ageBox(page)).toBeChecked();
    } finally {
      await page.context().setOffline(false);
    }
    await expect(joinButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    await joinButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, { timeout: 20_000 });
    await expect(waitingLines(page)).toHaveText("You're on the waitlist, position 1");
  });

  test.describe('the training page rows when the waitlist answers after sign-in', () => {
    const seriesRow = (page: Page) =>
      page
        .locator(TRAINING_SERIES_ROWS.rows)
        .filter({ has: page.locator('[data-slot="series-actions"]') });

    const expectRowGrowsOnce = (page: Page, path: string, lines: string[]) =>
      expectOwnRowGrowsOnce(
        page,
        path,
        TRAINING_SERIES_ROWS,
        seriesRow(page),
        [WAITING],
        lines.map((text) => ({ slot: 'series-waitlist', text })),
        false,
        true,
        '#classes > div',
      );

    for (const width of [320, 360, 1280]) {
      test(`an adult, a child with a 60-character name, and two children arrive at ${width}px without moving the page above the series row`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 800 });
        const { tenant, program, path } = await fullSeries({ minimumAge: 9, maximumAge: 99 });
        const viewer = newUser('Waiting');
        await signUp(page, viewer);
        await seedTrainingWaitlistEntry(tenant, program.slug, viewer, SELF);
        await expectRowGrowsOnce(page, path, ["You're on the waitlist, position 1"]);

        await seedTrainingWaitlistEntry(tenant, program.slug, viewer, {
          kind: 'minor',
          minorName: LONG,
        });
        await expectRowGrowsOnce(page, path, [
          "You're on the waitlist, position 1",
          `${LONG} is on the waitlist, position 2`,
        ]);

        await seedTrainingWaitlistEntry(tenant, program.slug, viewer, MAYA);
        await expectRowGrowsOnce(page, path, [
          "You're on the waitlist, position 1",
          `${LONG} is on the waitlist, position 2`,
          'Maya R. is on the waitlist, position 3',
        ]);
      });
    }
  });
});

test.describe('the waitlist of one class', () => {
  const WAITING_CLASSES = 'trainingWaitlist:listMineForClasses';
  const SELF = { kind: 'self' } as const;
  const MAYA = { kind: 'minor', minorName: 'Maya R.' } as const;
  const SAM = { kind: 'minor', minorName: 'Sam R.' } as const;
  const FULL_CLASS = 1;
  const classWaitLines = (page: Page, index: number) =>
    classRow(page, index).locator('[data-slot="class-waitlist"]');
  const joinClassLink = (page: Page, index: number) =>
    classRow(page, index).getByRole('link', { name: /^Join the waitlist for / });
  const joinButton = (page: Page) =>
    page.getByRole('button', { name: 'Join the waitlist', exact: true });
  const classDay = (week: number) => dateFromToday(FIRST_IN_DAYS + week * 7);

  async function fullClass(over: Partial<PublishedTrainingSeed> = {}) {
    const tenant = await seedTenant({
      name: 'E2E Class Waitlist',
      locations: [{ name: PLACE, address: ADDRESS }],
    });
    const program = clinic('Class Waitlist Clinic', {
      classes: { ...singleClasses, placesPerClass: 1 },
      ...over,
    });
    const path = await seedPublishedTraining(tenant, program);
    const holder = await seedUser(newUser('Holder'));
    await seedTrainingRegistration(tenant, program.slug, holder, SELF, classDay(FULL_CLASS));
    return { tenant, program, path };
  }

  test('a person joins the waitlist of a full class, and the class reads "You\'re on the waitlist, position 1", also after a reload', async ({
    page,
  }, testInfo) => {
    const { path, program } = await fullClass({ minimumAge: 18, maximumAge: 99 });
    await signUp(page, newUser('Joiner'));
    await page.goto(path);
    await expect(classPlaces(page, FULL_CLASS)).toHaveText('Full');
    await expect(classLink(page, 0)).toHaveText(/^Register for /);
    await expect(classLink(page, FULL_CLASS)).toHaveText(/^Join the waitlist for \w{3}, /);
    await expect(classWaitLines(page, FULL_CLASS)).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '368-training-class-full');

    const href = await classPathOf(page, FULL_CLASS);
    await classLink(page, FULL_CLASS).click();
    await expect(page).toHaveURL(`${baseURL}${href}`);
    await expect(page).toHaveTitle(
      new RegExp(`^Join the waitlist for a class \\| ${program.name}`),
    );
    await expect(page.locator('form [role="note"]')).toContainText('This class is full.');
    await expect(page.getByRole('radio', { name: 'Me' })).toBeChecked();
    await expectAccessible(page);
    await screenshot(page, testInfo, '368-join-class-form');

    await joinButton(page).click();
    await expect(page.locator('#age-confirmed-error')).toHaveText('Confirm your age to continue.');
    await ageBox(page).click();
    await joinButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, { timeout: 20_000 });
    await expect(classWaitLines(page, FULL_CLASS)).toHaveText("You're on the waitlist, position 1");
    await expect(joinClassLink(page, FULL_CLASS)).toHaveCount(0);
    await expect(classWaitLines(page, 0)).toHaveCount(0);
    await expect(classLink(page, 0)).toHaveText(/^Register for /);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '368-training-class-waiting');

    await page.reload();
    await expect(classWaitLines(page, FULL_CLASS)).toHaveText("You're on the waitlist, position 1");
    await page.goto(href);
    await expect(alert(page)).toContainText("You're on the waitlist for ");
    await expect(page.locator('form')).toHaveCount(0);
    await expectAccessible(page);
    await screenshot(page, testInfo, '368-register-class-waiting');
  });

  test('a second person waits behind the first, and a guardian’s child reads by name', async ({
    page,
    browser,
  }) => {
    const { path, tenant, program } = await fullClass({ minimumAge: 9, maximumAge: 99 });
    const first = await otherUser(browser, newUser('First'));
    await first.goto(path);
    await classLink(first, FULL_CLASS).click();
    await first.getByRole('radio', { name: 'Me' }).check();
    await ageBox(first).click();
    await joinButton(first).click();
    await expect(first).toHaveURL(`${baseURL}${path}`, { timeout: 20_000 });
    await expect(classWaitLines(first, FULL_CLASS)).toHaveText(
      "You're on the waitlist, position 1",
    );
    await first.context().close();

    const guardian = newUser('Guardian');
    await signUp(page, guardian);
    await page.goto(path);
    await classLink(page, FULL_CLASS).click();
    await page.getByRole('radio', { name: 'My child' }).check();
    await childName(page).fill(LONG);
    await ageBox(page).click();
    await joinButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, { timeout: 20_000 });
    await expect(classWaitLines(page, FULL_CLASS)).toHaveText(
      `${LONG} is on the waitlist, position 2`,
    );
    await expect(joinClassLink(page, FULL_CLASS)).toBeVisible();

    await seedTrainingWaitlistEntry(tenant, program.slug, guardian, SAM, classDay(FULL_CLASS));
    await page.reload();
    await expect(classWaitLines(page, FULL_CLASS)).toHaveText([
      `${LONG} is on the waitlist, position 2`,
      'Sam R. is on the waitlist, position 3',
    ]);
  });

  test('a waiting entry holds the place: a class with a place left reads Full, refuses a registration, and takes the next person into the waitlist', async ({
    page,
  }, testInfo) => {
    const tenant = await seedTenant({
      name: 'E2E Class Queue',
      locations: [{ name: PLACE, address: ADDRESS }],
    });
    const program = clinic('Class Queue Clinic', { classes: singleClasses });
    const path = await seedPublishedTraining(tenant, program);
    const earlier = await seedUser(newUser('Earlier'));
    await seedTrainingWaitlistEntry(tenant, program.slug, earlier, SELF, classDay(1));

    await signUp(page, newUser('Later'));
    await page.goto(path);
    await expect(classPlaces(page, 0)).toHaveText('12 places left');
    await expect(classPlaces(page, 1)).toHaveText('Full');
    await expect(classLink(page, 0)).toHaveText(/^Register for /);
    await expect(classLink(page, 1)).toHaveText(/^Join the waitlist for /);
    await expectAccessible(page);
    await screenshot(page, testInfo, '368-training-class-queue');

    await classLink(page, 1).click();
    await joinButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, { timeout: 20_000 });
    await expect(classWaitLines(page, 1)).toHaveText("You're on the waitlist, position 2");
  });

  test('a class with a place free and no one waiting offers Register, and the class waitlist is refused', async ({
    page,
  }) => {
    const { path } = await fullClass();
    await signUp(page, newUser('Early'));
    await page.goto(path);
    const href = await classPathOf(page, 0);
    await expect(joinClassLink(page, 0)).toHaveCount(0);
    await page.goto(href);
    await expect(registerButton(page)).toBeVisible();
    await expect(page.locator('form [role="note"]')).toHaveCount(0);
  });

  test('a person who waits for the series is not offered a class waitlist, and a child still is', async ({
    page,
  }) => {
    const { path, tenant, program } = await fullClass({ minimumAge: 9, maximumAge: 99 });
    const viewer = newUser('Series waiter');
    await signUp(page, viewer);
    await seedTrainingWaitlistEntry(tenant, program.slug, viewer, SELF);
    await page.goto(path);
    await expect(page.locator('[data-slot="series-waitlist"]')).toHaveText(
      "You're on the waitlist, position 1",
    );
    await expect(joinClassLink(page, FULL_CLASS)).toBeVisible();
    await classLink(page, FULL_CLASS).click();
    await expect(page.getByRole('radio', { name: 'My child' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Me' })).toHaveCount(0);
  });

  test('a person offline presses Join the waitlist: nothing is sent and the box stays ticked', async ({
    page,
  }) => {
    const { path } = await fullClass({ minimumAge: 18, maximumAge: 99 });
    await signUp(page, newUser('Offline'));
    await page.goto(path);
    await classLink(page, FULL_CLASS).click();
    await ageBox(page).click();
    await page.context().setOffline(true);
    try {
      await expect(joinButton(page)).toHaveAttribute('aria-disabled', 'true');
      await joinButton(page).click({ force: true });
      await expect(alert(page).filter({ hasText: "You're offline" })).toBeFocused();
      await expect(ageBox(page)).toBeChecked();
    } finally {
      await page.context().setOffline(false);
    }
    await expect(joinButton(page)).not.toHaveAttribute('aria-disabled', 'true');
    await joinButton(page).click();
    await expect(page).toHaveURL(`${baseURL}${path}`, { timeout: 20_000 });
    await expect(classWaitLines(page, FULL_CLASS)).toHaveText("You're on the waitlist, position 1");
  });

  test.describe('the classes when the viewer’s class waitlist arrives', () => {
    const TOLERANCE = 0.5;

    // Only the waiting row grows, once, so the rows below it move once and the row above stays put.
    const expectRowGrowsOnce = (page: Page, path: string, lines: string[], width: number) =>
      expectOwnRowGrowsOnce(
        page,
        path,
        TRAINING_CLASS_ROWS,
        classRow(page, FULL_CLASS),
        [WAITING_CLASSES],
        lines.map((text) => ({ slot: 'class-waitlist', text })),
        false,
        true,
        width === 1280 ? '#details-heading + dl' : undefined,
        '#classes',
      );

    for (const width of [320, 360, 1280]) {
      test(`an adult, a child with a 60-character name, and two children arrive at ${width}px without moving the class above, and the row grows once`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 800 });
        const { tenant, program, path } = await fullClass({ minimumAge: 9, maximumAge: 99 });
        const viewer = newUser('Waiting');
        await signUp(page, viewer);
        const day = classDay(FULL_CLASS);
        await seedTrainingWaitlistEntry(tenant, program.slug, viewer, SELF, day);
        await expectRowGrowsOnce(page, path, ["You're on the waitlist, position 1"], width);
        await screenshot(page, testInfo, `368-class-arrived-adult-${width}`);

        await seedTrainingWaitlistEntry(
          tenant,
          program.slug,
          viewer,
          {
            kind: 'minor',
            minorName: LONG,
          },
          day,
        );
        await expectRowGrowsOnce(
          page,
          path,
          ["You're on the waitlist, position 1", `${LONG} is on the waitlist, position 2`],
          width,
        );

        await seedTrainingWaitlistEntry(tenant, program.slug, viewer, MAYA, day);
        await expectRowGrowsOnce(
          page,
          path,
          [
            "You're on the waitlist, position 1",
            `${LONG} is on the waitlist, position 2`,
            'Maya R. is on the waitlist, position 3',
          ],
          width,
        );
        await screenshot(page, testInfo, `368-class-arrived-children-${width}`);
      });
    }

    for (const width of [320, 360, 1280]) {
      test(`entries for two classes arrive at ${width}px: the class above stays, and each waiting row grows once`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({ width, height: 800 });
        const { tenant, program, path } = await fullClass({ minimumAge: 9, maximumAge: 99 });
        const viewer = newUser('Waiting twice');
        await signUp(page, viewer);
        const second = 2;
        await seedTrainingWaitlistEntry(tenant, program.slug, viewer, SELF, classDay(FULL_CLASS));
        await seedTrainingWaitlistEntry(
          tenant,
          program.slug,
          viewer,
          { kind: 'minor', minorName: LONG },
          classDay(FULL_CLASS),
        );
        await seedTrainingWaitlistEntry(tenant, program.slug, viewer, SELF, classDay(second));
        await seedTrainingWaitlistEntry(tenant, program.slug, viewer, MAYA, classDay(second));

        const held = await holdQueries(page, [WAITING_CLASSES]);
        await page.goto(path);
        await expect.poll(() => held.isHolding()).toBe(true);
        await expect(classRows(page)).toHaveCount(3);
        await expect(classWaitLines(page, FULL_CLASS)).toHaveCount(0);
        await expect(classWaitLines(page, second)).toHaveCount(0);
        const recorder = await recordRowFrames(page, TRAINING_CLASS_ROWS, ['#classes']);
        held.release();
        await expect(classWaitLines(page, FULL_CLASS)).toHaveText([
          "You're on the waitlist, position 1",
          `${LONG} is on the waitlist, position 2`,
        ]);
        await expect(classWaitLines(page, second)).toHaveText([
          "You're on the waitlist, position 1",
          'Maya R. is on the waitlist, position 2',
        ]);
        await page.waitForTimeout(700);
        const { rows, extras } = await recorder.stop();
        const row = (at: number) => changesOf(rows, at);
        const grown = (at: number) => row(at).at(-1)!.height - row(at)[0].height;
        expect(row(0), 'the class above moves or resizes').toHaveLength(1);
        expect(topSteps(row(1)), 'the first waiting row moves').toBe(0);
        expect(heightSteps(row(1)), 'the first waiting row grows once').toBeLessThanOrEqual(1);
        expect(heightSteps(row(2)), 'the second waiting row grows once').toBeLessThanOrEqual(1);
        expect(topSteps(row(2)), 'the second waiting row moves once').toBeLessThanOrEqual(1);
        for (const at of [1, 2]) {
          expect(grown(at), 'a waiting row shrinks').toBeGreaterThanOrEqual(-TOLERANCE);
        }
        expect(heightSteps(extras[0]), 'the card grows once').toBeLessThanOrEqual(1);
        for (const index of [FULL_CLASS, second]) {
          await expectNoLineClippedOrSpilled(page, TRAINING_CLASS_ROWS, classRow(page, index), 2);
        }
        expect(await overflow(page)).toBeLessThanOrEqual(0);
        await expectAccessible(page);
        await screenshot(page, testInfo, `368-two-classes-arrived-${width}`);
      });
    }

    test('the register page for a full class stays inside the card at 320px with a long program name and a long child name', async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: 320, height: 800 });
      const { path } = await fullClass({
        name: `Class Waitlist ${'W'.repeat(60)}`,
        minimumAge: 9,
        maximumAge: 99,
      });
      await signUp(page, newUser('Narrow'));
      await page.goto(path);
      await classLink(page, FULL_CLASS).click();
      await page.getByRole('radio', { name: 'My child' }).check();
      await childName(page).fill(LONG);
      await ageBox(page).click();
      await expect(page.locator('form [role="note"]')).toBeVisible();
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await expectAccessible(page);
      await screenshot(page, testInfo, '368-register-class-320');
    });
  });
});

test.describe('the registered lines with a long email or a long name made of words', () => {
  const NAMES = {
    email: 'maya.richardson.longname@very-long-subdomain.example.org',
    words: 'Alexandria Bartholomew Montgomery-Featherstonehaugh III',
  };

  for (const [kind, name] of Object.entries(NAMES)) {
    for (const width of [320, 360, 1280]) {
      test(`the series line for a ${kind} name is whole and the page keeps its layout at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 800 });
        const { paths } = await seed();
        await signUp(page, newUser('Steady'));
        await page.goto(registerPathOf(paths.youth));
        await childName(page).fill(name);
        await ageBox(page).click();
        await registerButton(page).click();
        await expect(page).toHaveURL(`${baseURL}${paths.youth}`, { timeout: 20_000 });

        await expectOwnRowGrowsOnce(
          page,
          paths.youth,
          TRAINING_SERIES_ROWS,
          page
            .locator(TRAINING_SERIES_ROWS.rows)
            .filter({ has: page.locator('[data-slot="series-actions"]') }),
          [MINE],
          [{ slot: 'series-registered', text: `${name} is registered` }],
          false,
          true,
          width === 1280 ? '#classes > div' : undefined,
        );
      });

      test(`the class line for a ${kind} name is whole and the page keeps its layout at ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 800 });
        const { paths } = await seedSingle();
        await signUp(page, newUser('Steady'));
        await page.goto(paths.youth);
        await classLink(page, 0).click();
        await childName(page).fill(name);
        await ageBox(page).click();
        await registerButton(page).click();
        await expect(page).toHaveURL(`${baseURL}${paths.youth}`, { timeout: 20_000 });

        await expectOwnRowGrowsOnce(
          page,
          paths.youth,
          TRAINING_CLASS_ROWS,
          classRow(page, 0),
          [MINE],
          [{ slot: 'class-registered', text: `${name} is registered` }],
          false,
          true,
          width === 1280 ? '#details-heading + dl' : undefined,
        );
      });
    }
  }
});
