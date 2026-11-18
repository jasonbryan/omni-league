import { randomBytes } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { axeScan, checkReflow, describeViolations, expectAccessible } from './support/a11y';
import { tokensSettled } from './support/auth-tokens';
import { seedCamp } from './support/camp';
import { chipLabel, chooseChip } from './support/chip';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { failFirstAnswer } from './support/fail-first-answer';
import { failMutation } from './support/fail-mutation';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { dateFromToday, seedTenant, type TenantSeed } from './support/tenant';
import { seedTraining, seedTrainingClasses, setTrainingClassRegistered } from './support/training';
import {
  seedTrainingRegistration,
  seedTrainingWaitlistEntry,
} from './support/training-registrations';
import { newUser, seedUser, type TestUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const PELICAN = 'Pelican Shoals Sand Courts';
const LOCATIONS = [{ name: PELICAN, address: '2150 Pelican Shoals Dr, Corpus Christi, TX 78418' }];
const LEAGUES: NonNullable<TenantSeed['leagues']> = [
  { name: 'Sand 4s', sport: 'beachVolleyball', locations: [PELICAN] },
];
const DAY = 24 * 60 * 60 * 1000;

type Role = 'orgAdmin' | 'leagueOrganizer';

async function memberOf(page: Page, role: Role | null, seed: TenantSeed = {}) {
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenant({ name: 'E2E Training', locations: LOCATIONS, ...seed });
  if (role) {
    await convexRun('testing:addMembership', {
      organizationSlug: tenant.slug,
      email: user.email,
      role,
    });
  }
  return { user, tenant, base: `/app/organizations/${tenant.slug}` };
}

const main = (page: Page) => page.getByRole('main');
const form = (page: Page) => page.locator('#create-training form');
const submit = (page: Page) =>
  form(page).getByRole('button', { name: /^Create draft training program/ });
const rows = (page: Page) => page.locator('#training-list > li');

async function fillValid(page: Page, name: string) {
  await page.locator('#name').fill(name);
  await chooseChip(chipLabel(page, 'Beach volleyball'));
  await page.locator('#coach-name').fill('Dana Ruiz');
}

test.describe('Training: creating a draft', () => {
  test('an org admin creates a draft: it is listed as Draft with its coach, the status names it, and the form is cleared', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/training`);
    await expect(page).toHaveTitle(`Training | ${tenant.name} | Omni League`);
    await expect(page.getByText('No training yet')).toBeVisible();
    await expect(
      page.getByText('Create a training program, then schedule its classes.'),
    ).toBeVisible();
    await expect(page.getByRole('checkbox', { name: PELICAN })).toBeChecked();
    await screenshot(page, testInfo, 'training-empty');
    await expectAccessible(page);

    await fillValid(page, 'Tuesday Serving Clinic');
    await screenshot(page, testInfo, 'training-filled');
    await submit(page).click();

    const status = form(page).getByRole('status').filter({ hasText: 'created' });
    await expect(status).toHaveText('Tuesday Serving Clinic created.Schedule classes');
    await expect(page.locator('#name')).toHaveValue('');
    await expect(page.locator('#coach-name')).toHaveValue('');
    await expect(submit(page)).toBeFocused();

    await expect(rows(page)).toHaveCount(1);
    const row = rows(page).first();
    await expect(row.locator('h3')).toHaveText('Tuesday Serving Clinic');
    await expect(row.locator('h3 a')).toHaveAttribute(
      'href',
      `${base}/training/tuesday-serving-clinic`,
    );
    await expect(row.locator('[data-slot="badge"]')).toHaveText('Draft');
    await expect(row.locator('[data-slot="ages"]')).toHaveText('All ages');
    await expect(row.locator('[data-slot="coach"]')).toHaveText('Coach: Dana Ruiz');
    await screenshot(page, testInfo, 'training-created');
    await expectAccessible(page);
  });

  test('a minimum age alone is stored and listed as "16 or older"', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/training`);
    await fillValid(page, 'Adult Passing Clinic');
    await page.locator('#minimum-age').fill('16');
    await submit(page).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().locator('[data-slot="ages"]')).toHaveText('16 or older');
  });

  test(
    'ages from 12 to 9, and 3, show under the field on leaving it, and the error clears once fixed',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { base } = await memberOf(page, 'orgAdmin');
      await page.goto(`${base}/training`);
      await page.locator('#minimum-age').fill('12');
      await page.locator('#maximum-age').fill('9');
      await page.locator('#maximum-age').blur();
      await expect(page.locator('#maximum-age-error')).toHaveText(
        'The oldest age must be no lower than the youngest age, 12.',
      );
      await page.locator('#maximum-age').fill('14');
      await expect(page.locator('#maximum-age-error')).toHaveCount(0);

      await page.locator('#minimum-age').fill('3');
      await page.locator('#minimum-age').blur();
      await expect(page.locator('#minimum-age-error')).toHaveText(
        'Enter a whole number of years from 4 to 99, or leave it blank.',
      );
    },
  );

  test('an empty submit shows every required message, sends nothing, and leaves the ages alone', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/training`);
    await submit(page).click();
    await expect(page.locator('#name-error')).toBeVisible();
    await expect(page.locator('#coach-name-error')).toHaveText('Enter the coach’s name.');
    await expect(page.locator('#minimum-age-error')).toHaveCount(0);
    await expect(page.locator('#maximum-age-error')).toHaveCount(0);
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#name')).toBeFocused();
    await screenshot(page, testInfo, 'training-errors');
    await expectAccessible(page);
  });

  test('a web address held by a league, a camp, or a training program of the organization shows "is already taken" under Web address', async ({
    page,
  }) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin', { leagues: LEAGUES });
    await seedCamp(tenant, {
      name: 'Fall Break Camp',
      slug: 'fall-break-camp',
      locations: [PELICAN],
      minimumAge: 9,
      maximumAge: 14,
    });
    await page.goto(`${base}/training`);
    for (const [name, slug] of [
      ['Sand 4s', 'sand-4s'],
      ['Fall Break Camp', 'fall-break-camp'],
    ]) {
      await page.locator('#name').fill(name);
      await expect(page.locator('#slug-error')).toHaveText(
        `${slug} is already taken. Choose another web address.`,
      );
    }

    await page.locator('#name').fill('Tuesday Serving Clinic');
    await expect(page.locator('#slug-error')).toHaveCount(0);
    await fillValid(page, 'Tuesday Serving Clinic');
    await submit(page).click();
    await expect(rows(page)).toHaveCount(1);

    await page.locator('#name').fill('Tuesday Serving Clinic');
    await expect(page.locator('#slug-error')).toHaveText(
      'tuesday-serving-clinic is already taken. Choose another web address.',
    );
  });
});

test.describe('Training: loading', () => {
  test('the list and the form show skeletons while their answers are held, and the state passes the axe helper', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    const held = await holdQueries(page, [
      'trainings:listForOrganization',
      'locations:listForAdmin',
    ]);
    await page.goto(`${base}/training`);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading the training programs.' }),
    ).toBeAttached();
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading the locations.' }),
    ).toBeAttached();
    await expect(page.getByText('No training yet')).toHaveCount(0);
    await expect(form(page)).toHaveCount(0);
    await screenshot(page, testInfo, 'training-loading');
    await expectAccessible(page);

    held.release();
    await expect(page.getByText('No training yet')).toBeVisible();
    await expect(form(page)).toBeVisible();
  });
});

test.describe('Training: the failure states', () => {
  test('a list that fails to load shows the alert and passes the axe helper', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await failFirstAnswer(page, 'trainings:listForOrganization');
    await page.goto(`${base}/training`);
    const alert = page.locator('section[aria-labelledby="training-heading"] [role="alert"]');
    await expect(alert).toContainText('The training programs could not be loaded.');
    await screenshot(page, testInfo, 'training-load-error');
    await expectAccessible(page);
  });

  test('pressing Create offline shows the offline alert, keeps the input, and passes the axe helper', async ({
    page,
    context,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/training`);
    await fillValid(page, 'Tuesday Serving Clinic');
    await context.setOffline(true);
    await expect(submit(page)).toHaveAttribute('aria-disabled', 'true');
    // `force`: Playwright treats aria-disabled as not actionable, and the page must answer the press.
    await submit(page).click({ force: true });
    const alert = form(page).getByRole('alert');
    await expect(alert).toContainText("You're offline. Nothing was sent.");
    await expect(page.locator('#name')).toHaveValue('Tuesday Serving Clinic');
    await expect(page.locator('#coach-name')).toHaveValue('Dana Ruiz');
    await screenshot(page, testInfo, 'training-offline');
    await expectAccessible(page);
    await context.setOffline(false);
  });
});

test.describe('Training: a create the server fails', () => {
  test.use({ expectedConvexErrors: ['trainings:create'] });

  test('a create the server fails keeps the input, and the alert passes the axe helper', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await failMutation(page, 'trainings:create');
    await page.goto(`${base}/training`);
    await fillValid(page, 'Tuesday Serving Clinic');
    await submit(page).click();
    const alert = form(page).getByRole('alert');
    await expect(alert).toContainText('The training program could not be created.');
    await expect(page.locator('#name')).toHaveValue('Tuesday Serving Clinic');
    await expect(page.locator('#coach-name')).toHaveValue('Dana Ruiz');
    await screenshot(page, testInfo, 'training-create-error');
    await expectAccessible(page);
  });
});

test.describe('who may open Training', () => {
  function sentFrames(page: Page): string[] {
    const frames: string[] = [];
    page.on('websocket', (socket) => {
      socket.on('framesent', (frame) => {
        frames.push(String(frame.payload));
      });
    });
    return frames;
  }

  for (const [label, role] of [
    ['a league organizer of the organization', 'leagueOrganizer'],
    ['a signed-in user with no membership', null],
  ] as const) {
    test(
      `${label} sees the no-access view, and no training data is requested`,
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
        const { base } = await memberOf(page, role);
        const frames = sentFrames(page);
        await page.goto(`${base}/training`);
        await expect(
          main(page).getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
        ).toBeVisible();
        expect(frames.join('\n')).toContain('organizations:getAdminContext');
        expect(frames.join('\n')).not.toContain('trainings:listForOrganization');
      },
    );
  }

  test('the no-access view passes the axe helper', async ({ page }, testInfo) => {
    const { base } = await memberOf(page, null);
    await page.goto(`${base}/training`);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
    ).toBeVisible();
    await screenshot(page, testInfo, 'training-no-access');
    await expectAccessible(page);
  });
});

test.describe('the admin sidebar', () => {
  test(
    'lists Training under Programs, marked current on the Training page',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { tenant, base } = await memberOf(page, 'orgAdmin');
      await page.goto(`${base}/training`);
      const nav = page.getByRole('navigation', { name: `${tenant.name} admin` });
      const programs = nav.getByRole('list', { name: 'Programs' });
      await expect(programs.getByRole('link', { name: /^Training/ })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(programs.getByRole('link', { name: /^Camps/ })).toHaveAttribute(
        'href',
        `${base}/camps`,
      );
    },
  );
});

const SERVING = { name: 'Tuesday Serving Clinic', slug: 'tuesday-serving-clinic' };
const PASSING = { name: 'Adult Passing Clinic', slug: 'adult-passing-clinic' };

async function seedPrograms(tenant: Parameters<typeof seedTraining>[0]) {
  for (const program of [SERVING, PASSING]) {
    await seedTraining(tenant, { ...program, locations: [PELICAN], coachName: 'Dana Ruiz' });
  }
}

test.describe('Training: assigning a league organizer', () => {
  const invitePanel = (page: Page) => page.locator('#invite form');
  const pendingRows = (page: Page) => page.locator('#pending-list > li');

  test('the staff invite lists the training programs under their own heading, and one alone is a valid choice', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin', { leagues: LEAGUES });
    await seedPrograms(tenant);
    await page.goto(`${base}/staff`);
    await expect(main(page).getByRole('heading', { level: 1, name: 'Staff' })).toBeVisible();
    await expect(
      invitePanel(page).locator('fieldset#leagues + fieldset#training > legend'),
    ).toHaveText('Training programs');
    const group = page.getByRole('group', { name: 'Training programs' });
    await expect(group.getByRole('checkbox')).toHaveCount(2);
    await expect(group.getByRole('checkbox').first()).toHaveAccessibleName(PASSING.name);
    await screenshot(page, testInfo, 'staff-training-picker');
    await expectAccessible(page);

    await page.locator('#email').fill('dana@example.com');
    await page.getByRole('checkbox', { name: PASSING.name }).click();
    await invitePanel(page)
      .getByRole('button', { name: /^Create invite link/ })
      .click();
    await expect(page.getByRole('heading', { name: 'Invite link ready' })).toBeFocused();
    await expect(pendingRows(page).first()).toContainText(`League organizer for ${PASSING.name}`);
  });

  test('choosing nothing says to choose a league or training program, and creates nothing', async ({
    page,
  }) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin', { leagues: LEAGUES });
    await seedPrograms(tenant);
    await page.goto(`${base}/staff`);
    await page.locator('#email').fill('dana@example.com');
    await invitePanel(page)
      .getByRole('button', { name: /^Create invite link/ })
      .click();
    await expect(page.locator('#leagues-error')).toHaveText(
      'Choose at least one league or training program.',
    );
    await expect(pendingRows(page)).toHaveCount(0);
  });
});

async function signInWith(page: Page, user: TestUser) {
  const tokens = tokensSettled(page);
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await tokens;
}

test.describe('Training: an invited league organizer', () => {
  test('accepts an invite naming a league and a training program, and the program is linked in the organizer sidebar', async ({
    page,
    isMobile,
  }, testInfo) => {
    const tenant = await seedTenant({
      name: 'E2E Training Invite',
      locations: LOCATIONS,
      leagues: LEAGUES,
    });
    await seedPrograms(tenant);
    const user = await seedUser(newUser('Invitee'));
    const token = randomBytes(32).toString('base64url');
    await convexRun('testing:addInvite', {
      organizationSlug: tenant.slug,
      email: user.email,
      role: 'leagueOrganizer',
      leagueNames: ['Sand 4s'],
      trainingNames: [SERVING.name],
      expiresAt: Date.now() + 12 * DAY,
      token,
    });

    await page.goto(`/invites/accept#${token}`);
    await expect(page).toHaveURL(`${baseURL}/invites/accept`);
    await expect(
      main(page).getByText(
        'You’re invited to run leagues and training programs as a league organizer.',
      ),
    ).toBeVisible();
    await expect(main(page).locator('dl dt')).toHaveText([
      'Organization',
      'Role',
      'League',
      'Training program',
      'Expires',
    ]);
    await screenshot(page, testInfo, 'training-invite-signed-out');
    await expectAccessible(page);

    await main(page).getByRole('link', { name: 'Sign in' }).click();
    await signInWith(page, user);
    await expect(page).toHaveURL(`${baseURL}/invites/accept`);
    await main(page).getByRole('button', { name: 'Accept invite' }).click();
    await expect(main(page)).toContainText(
      `You’re a league organizer for Sand 4s and ${SERVING.name}.`,
    );
    await screenshot(page, testInfo, 'training-invite-accepted');
    await expectAccessible(page);

    await page.goto(`/app/organizations/${tenant.slug}/leagues/sand-4s`);
    if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click();
    const nav = page.getByRole('navigation', {
      name: `${tenant.name} leagues and training programs`,
    });
    const programs = nav.getByRole('list', { name: 'Your training programs' });
    await expect(programs).toBeVisible();
    await expect(programs.getByRole('listitem')).toHaveText([SERVING.name]);
    await expect(programs.getByRole('link')).toHaveAttribute(
      'href',
      `/app/organizations/${tenant.slug}/training/${SERVING.slug}`,
    );
    await expect(programs.locator('ng-icon[name="lucideDumbbell"]')).toHaveCount(1);
    await screenshot(page, testInfo, 'training-sidebar-rows');
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
  });
});

// Two weeks out, so the registration deadline can fall before the first class.
function firstTuesdayTwoWeeksOut(): string {
  for (let days = 14; ; days++) {
    const date = dateFromToday(days);
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 2) return date;
  }
}

function classDate(week: number): string {
  const date = new Date(`${firstTuesdayTwoWeeksOut()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + week * 7);
  return date.toISOString().slice(0, 10);
}

function aDayThatIsNotTuesday(): string {
  for (let days = 15; ; days++) {
    const date = dateFromToday(days);
    if (new Date(`${date}T00:00:00Z`).getUTCDay() !== 2) return date;
  }
}

async function fillPattern(page: Page, first: string) {
  await chipLabel(page, 'Tuesday').click();
  await page.locator('#start-time').fill('18:00');
  await page.locator('#end-time').fill('19:00');
  await page.locator('#first-date').fill(first);
  await page.locator('#weeks').fill('8');
  await page.locator('#places-per-class').fill('12');
  await page.locator('#registration-deadline').fill(dateFromToday(7));
}

const classRows = (page: Page) => page.locator('#classes-list > li');
const scheduleSubmit = (page: Page) =>
  page.locator('#schedule form').getByRole('button', { name: /^Schedule classes/ });

async function openTraining(page: Page, role: Role | null = 'orgAdmin') {
  const member = await memberOf(page, role);
  await seedTraining(member.tenant, {
    ...SERVING,
    locations: [PELICAN],
    coachName: 'Dana Ruiz',
  });
  return { ...member, path: `${member.base}/training/${SERVING.slug}` };
}

test.describe('Training: scheduling the classes', () => {
  test('the success status links to the management page, and an org admin schedules 8 classes on consecutive Tuesdays', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/training`);
    await fillValid(page, 'Tuesday Serving Clinic');
    await submit(page).click();
    const next = form(page).getByRole('link', { name: 'Schedule classes' });
    await expect(next).toHaveAttribute('href', `${base}/training/tuesday-serving-clinic#schedule`);
    await next.click();

    await expect(page).toHaveURL(new RegExp(`/training/tuesday-serving-clinic#schedule$`));
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
      'Tuesday Serving Clinic',
    );
    await expect(page).toHaveTitle(`Tuesday Serving Clinic | ${tenant.name} | Omni League`);
    await expect(page.getByText('No classes yet')).toBeVisible();
    await expect(page.locator('#schedule #weekday input').first()).toBeFocused();
    await screenshot(page, testInfo, 'training-page-empty');
    await expectAccessible(page);

    const first = firstTuesdayTwoWeeksOut();
    await fillPattern(page, first);
    await screenshot(page, testInfo, 'training-page-filled');
    await scheduleSubmit(page).click();

    await expect(page.locator('[data-slot="class-status"]')).toHaveText('8 classes scheduled.');
    await expect(classRows(page)).toHaveCount(8);
    const dates = await classRows(page).locator('[data-slot="class-date"]').allTextContents();
    expect(dates).toEqual(
      Array.from({ length: 8 }, (_, week) => {
        const date = new Date(`${dateFromToday(0)}T00:00:00Z`);
        const offset = (new Date(`${first}T00:00:00Z`).getTime() - date.getTime()) / 86_400_000;
        const classDate = new Date(date.getTime() + (offset + week * 7) * 86_400_000);
        return classDate.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        });
      }),
    );
    await expect(classRows(page).first().locator('[data-slot="class-times"]')).toHaveText(
      '6 PM to 7 PM',
    );
    await expect(classRows(page).first().locator('[data-slot="class-registered"]')).toHaveText(
      '0 of 12 registered',
    );
    await expect(page.locator('#schedule')).toHaveCount(0);
    await expect(page.locator('[data-slot="pattern"]')).toContainText('Tuesdays, 6 PM to 7 PM');
    await screenshot(page, testInfo, 'training-page-scheduled');
    await expectAccessible(page);
    expect(await checkReflow(page)).toMatchObject({ passed: true });

    await page.reload();
    await expect(classRows(page)).toHaveCount(8);
    await expect(page.locator('#schedule')).toHaveCount(0);
  });

  test('a first date off the weekday and a deadline after the first class show under their fields, and the pattern is not sent', async ({
    page,
  }, testInfo) => {
    const { path } = await openTraining(page);
    await page.goto(path);
    await chipLabel(page, 'Tuesday').click();
    await page.locator('#first-date').fill(aDayThatIsNotTuesday());
    await page.locator('#first-date').blur();
    const offWeekday = page.locator('#first-date-error');
    await expect(offWeekday).toContainText('The first class must be on a Tuesday.');
    await page.locator('#start-time').fill('19:00');
    await page.locator('#end-time').fill('18:00');
    await page.locator('#end-time').blur();
    await expect(page.locator('#end-time-error')).toContainText('The end time must be after');
    await page.locator('#weeks').fill('53');
    await page.locator('#weeks').blur();
    await expect(page.locator('#weeks-error')).toContainText('from 1 to 52');
    await page.locator('#places-per-class').fill('201');
    await page.locator('#places-per-class').blur();
    await expect(page.locator('#places-per-class-error')).toContainText('from 1 to 200');
    await screenshot(page, testInfo, 'training-page-errors');
    await expectAccessible(page);
    await scheduleSubmit(page).click();
    await expect(classRows(page)).toHaveCount(0);
    await expect(page.getByText('No classes yet')).toBeVisible();
  });

  test('cancelling a class strikes it through with Undo, which brings it back', async ({
    page,
  }, testInfo) => {
    const { path } = await openTraining(page);
    await page.goto(path);
    await fillPattern(page, firstTuesdayTwoWeeksOut());
    await scheduleSubmit(page).click();
    await expect(classRows(page)).toHaveCount(8);

    const first = classRows(page).first();
    await first.getByRole('button', { name: /^Cancel/ }).click();
    const status = page.locator('[data-slot="class-status"]');
    await expect(status).toContainText('cancelled.');
    await expect(first).toHaveAttribute('data-status', 'cancelled');
    await expect(first.locator('[data-slot="badge"]')).toHaveText('Cancelled');
    await screenshot(page, testInfo, 'training-page-cancelled');
    await expectAccessible(page);

    await status.getByRole('button', { name: 'Undo' }).click();
    await expect(status).toContainText('restored.');
    await expect(first).toHaveAttribute('data-status', 'scheduled');
    await expect(first.getByRole('button', { name: /^Cancel/ })).toBeVisible();
  });
});

test.describe('Training: changing the places', () => {
  const seriesField = (page: Page) => page.getByLabel('Places for every upcoming class');
  const saveSeries = (page: Page) =>
    page.getByRole('button', { name: 'Save places for every upcoming class' });
  const seriesStatus = (page: Page) =>
    page.locator('[data-slot="all-places"] [data-slot="places-status"]');
  const rowField = (row: Locator) => row.getByLabel(/^Places for /);
  const saveRow = (row: Locator) => row.getByRole('button', { name: /^Save places for / });
  const rowStatus = (row: Locator) => row.locator('[data-slot="places-status"]');

  async function scheduled(page: Page) {
    const opened = await openTraining(page);
    await page.goto(opened.path);
    const first = firstTuesdayTwoWeeksOut();
    await fillPattern(page, first);
    await scheduleSubmit(page).click();
    await expect(classRows(page)).toHaveCount(8);
    return { ...opened, first };
  }

  const inDays = (date: string, days: number) =>
    new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);

  test('a class row takes new places with "Places saved." and Undo, and shows them in its count', async ({
    page,
  }, testInfo) => {
    await scheduled(page);
    const row = classRows(page).first();
    await expect(rowField(row)).toHaveValue('12');
    await rowField(row).fill('14');
    await saveRow(row).click();
    await expect(rowStatus(row)).toContainText('Places saved.');
    await expect(row.locator('[data-slot="class-registered"]')).toHaveText('0 of 14 registered');
    await screenshot(page, testInfo, 'training-places-saved');
    await expectAccessible(page);

    await rowStatus(row).getByRole('button', { name: 'Undo' }).click();
    await expect(rowStatus(row)).toContainText('Places restored.');
    await expect(row.locator('[data-slot="class-registered"]')).toHaveText('0 of 12 registered');
    await expect(rowField(row)).toHaveValue('12');
  });

  test('places below a class’s registered count show under its field on leaving it, and a cancelled class has no field', async ({
    page,
  }, testInfo) => {
    const { tenant, first } = await scheduled(page);
    await setTrainingClassRegistered(tenant, SERVING.slug, first, 5);
    const row = classRows(page).first();
    await expect(row.locator('[data-slot="class-registered"]')).toHaveText('5 of 12 registered');
    await rowField(row).fill('4');
    await rowField(row).blur();
    await expect(row.locator('[data-slot="field-error"]')).toHaveText(
      'Use at least 5 places. 5 are registered.',
    );
    await expect(rowField(row)).toHaveValue('4');
    await screenshot(page, testInfo, 'training-places-error');
    await expectAccessible(page);

    const second = classRows(page).nth(1);
    await second.getByRole('button', { name: /^Cancel/ }).click();
    await expect(second).toHaveAttribute('data-status', 'cancelled');
    await expect(second.getByLabel(/^Places for /)).toHaveCount(0);
  });

  test.describe('a series change the server refuses', () => {
    test.use({ expectedConvexErrors: ['trainingClasses:updateAllPlaces'] });

    test('Change places for every class sets them all, Undo brings each class’s own places back, and a class registered above them is refused with its date', async ({
      page,
    }, testInfo) => {
      const { tenant, first } = await scheduled(page);
      const third = classRows(page).nth(2);
      await rowField(third).fill('20');
      await saveRow(third).click();
      await expect(rowStatus(third)).toContainText('Places saved.');
      await setTrainingClassRegistered(tenant, SERVING.slug, inDays(first, 14), 15);
      await expect(third.locator('[data-slot="class-registered"]')).toHaveText(
        '15 of 20 registered',
      );

      await expect(
        page.getByRole('heading', { name: 'Change places for every class' }),
      ).toBeVisible();
      await seriesField(page).fill('14');
      await saveSeries(page).click();
      const date = await third.locator('[data-slot="class-date"]').innerText();
      await expect(page.locator('[data-slot="all-places"] [data-slot="field-error"]')).toHaveText(
        `${date} has 15 registered, so it needs at least 15 places. Nothing was changed.`,
      );
      await expect(seriesField(page)).toHaveValue('14');
      await expect(rowField(classRows(page).first())).toHaveValue('12');
      await screenshot(page, testInfo, 'training-places-series-refused');
      await expectAccessible(page);

      await seriesField(page).fill('16');
      await saveSeries(page).click();
      await expect(seriesStatus(page)).toContainText('Places saved for 8 classes.');
      for (const row of await classRows(page).all()) await expect(rowField(row)).toHaveValue('16');
      await screenshot(page, testInfo, 'training-places-series-saved');
      await expectAccessible(page);

      await seriesStatus(page).getByRole('button', { name: 'Undo' }).click();
      await expect(seriesStatus(page)).toContainText('Places restored for 8 classes.');
      await expect(rowField(classRows(page).first())).toHaveValue('12');
      await expect(rowField(third)).toHaveValue('20');
    });
  });

  test('pressing Save places offline shows the offline alert and keeps the text', async ({
    page,
    context,
  }, testInfo) => {
    await scheduled(page);
    const row = classRows(page).first();
    await rowField(row).fill('14');
    await context.setOffline(true);
    await expect(saveRow(row)).toHaveAttribute('aria-disabled', 'true');
    await saveRow(row).click({ force: true });
    await expect(row.getByRole('alert')).toContainText("You're offline. Nothing was sent.");
    await expect(rowField(row)).toHaveValue('14');
    await screenshot(page, testInfo, 'training-places-offline');
    await expectAccessible(page);
    await context.setOffline(false);
  });

  test.describe('a save the server fails', () => {
    test.use({ expectedConvexErrors: ['trainingClasses:updateAllPlaces'] });

    test('keeps the text, and the alert says what to do', async ({ page }, testInfo) => {
      const { path } = await openTraining(page);
      await failMutation(page, 'trainingClasses:updateAllPlaces');
      await page.goto(path);
      await fillPattern(page, firstTuesdayTwoWeeksOut());
      await scheduleSubmit(page).click();
      await expect(classRows(page)).toHaveCount(8);
      await seriesField(page).fill('14');
      await saveSeries(page).click();
      await expect(page.locator('[data-slot="all-places"]').getByRole('alert')).toContainText(
        'The places could not be saved.',
      );
      await expect(seriesField(page)).toHaveValue('14');
      await screenshot(page, testInfo, 'training-places-failed');
      await expectAccessible(page);
    });
  });
});

test.describe('Training: the management page states', () => {
  test('the classes and the form show skeletons while their answers are held, and the state passes the axe helper', async ({
    page,
  }, testInfo) => {
    const { path } = await openTraining(page);
    const held = await holdQueries(page, ['trainingClasses:listForTraining']);
    await page.goto(path);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading the classes.' }),
    ).toBeAttached();
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading the schedule.' }),
    ).toBeAttached();
    await expect(page.getByText('No classes yet')).toHaveCount(0);
    await screenshot(page, testInfo, 'training-page-loading');
    await expectAccessible(page);

    held.release();
    await expect(page.getByText('No classes yet')).toBeVisible();
    await expect(page.locator('#schedule form')).toBeVisible();
  });

  test('a class list that fails to load shows the alert and passes the axe helper', async ({
    page,
  }, testInfo) => {
    const { path } = await openTraining(page);
    await failFirstAnswer(page, 'trainingClasses:listForTraining');
    await page.goto(path);
    await expect(
      page
        .locator('#classes [role="alert"]')
        .filter({ hasText: 'The classes could not be loaded.' }),
    ).toBeVisible();
    await screenshot(page, testInfo, 'training-page-load-error');
    await expectAccessible(page);
  });

  test('pressing Schedule classes offline shows the offline alert, keeps the input, and passes the axe helper', async ({
    page,
    context,
  }, testInfo) => {
    const { path } = await openTraining(page);
    await page.goto(path);
    await fillPattern(page, firstTuesdayTwoWeeksOut());
    await context.setOffline(true);
    await expect(scheduleSubmit(page)).toHaveAttribute('aria-disabled', 'true');
    // `force`: Playwright treats aria-disabled as not actionable, and the page must answer the press.
    await scheduleSubmit(page).click({ force: true });
    await expect(page.locator('#schedule form').getByRole('alert')).toContainText(
      "You're offline. Nothing was sent.",
    );
    await expect(page.locator('#weeks')).toHaveValue('8');
    await screenshot(page, testInfo, 'training-page-offline');
    await expectAccessible(page);
    await context.setOffline(false);
  });
});

test.describe('Training: a schedule the server fails', () => {
  test.use({ expectedConvexErrors: ['trainingClasses:schedule'] });

  test('a schedule the server fails keeps the input, and the alert passes the axe helper', async ({
    page,
  }, testInfo) => {
    const { path } = await openTraining(page);
    await failMutation(page, 'trainingClasses:schedule');
    await page.goto(path);
    await fillPattern(page, firstTuesdayTwoWeeksOut());
    await scheduleSubmit(page).click();
    await expect(page.locator('#schedule form').getByRole('alert')).toContainText(
      'The classes could not be scheduled.',
    );
    await expect(page.locator('#weeks')).toHaveValue('8');
    await screenshot(page, testInfo, 'training-page-schedule-error');
    await expectAccessible(page);
  });
});

test.describe('who may open a training program', () => {
  test(
    'a league organizer not assigned to it sees the no-access view',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { path } = await openTraining(page, 'leagueOrganizer');
      await page.goto(path);
      await expect(
        main(page).getByRole('heading', {
          level: 1,
          name: 'You can’t manage this training program',
        }),
      ).toBeVisible();
    },
  );

  test('a league organizer assigned to it manages it, and the sidebar lists it as a link', async ({
    page,
    isMobile,
  }) => {
    const { tenant, user, path } = await openTraining(page, null);
    await convexRun('testing:addLeagueOrganizer', {
      organizationSlug: tenant.slug,
      email: user.email,
      leagueSlugs: [],
      trainingSlugs: [SERVING.slug],
    });
    await page.goto(path);
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(SERVING.name);
    await expect(page.locator('#schedule form')).toBeVisible();
    if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click();
    const programs = page
      .getByRole('navigation', { name: `${tenant.name} training programs` })
      .getByRole('list', { name: 'Your training programs' });
    await expect(programs.getByRole('link')).toHaveText([SERVING.name]);
    await expect(programs.getByRole('link')).toHaveAttribute('aria-current', 'page');
  });

  test('the no-access view passes the axe helper', async ({ page }, testInfo) => {
    const { path } = await openTraining(page, 'leagueOrganizer');
    await page.goto(path);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'You can’t manage this training program' }),
    ).toBeVisible();
    await screenshot(page, testInfo, 'training-page-no-access');
    await expectAccessible(page);
  });
});

test.describe('Training: the first class date against today', () => {
  const dayName = (date: string) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

  test('a first date before today is refused under the first date and creates no class, and today itself schedules', async ({
    page,
  }, testInfo) => {
    const { path } = await openTraining(page);
    await page.goto(path);
    const yesterday = dateFromToday(-1);
    await chipLabel(page, dayName(yesterday)).click();
    await page.locator('#first-date').fill(yesterday);
    await page.locator('#first-date').blur();
    await expect(page.locator('#first-date-error')).toContainText('The first class must be today,');
    await page.locator('#start-time').fill('18:00');
    await page.locator('#end-time').fill('19:00');
    await page.locator('#weeks').fill('2');
    await page.locator('#places-per-class').fill('12');
    await page.locator('#registration-deadline').fill(yesterday);
    await scheduleSubmit(page).click();
    await expect(page.locator('#first-date-error')).toBeVisible();
    await expect(classRows(page)).toHaveCount(0);
    await screenshot(page, testInfo, 'training-page-first-date-past');
    await expectAccessible(page);

    const today = dateFromToday(0);
    await chipLabel(page, dayName(today)).click();
    await page.locator('#first-date').fill(today);
    await page.locator('#registration-deadline').fill(today);
    await expect(page.locator('#first-date-error')).toHaveCount(0);
    await scheduleSubmit(page).click();
    await expect(page.locator('[data-slot="class-status"]')).toHaveText('2 classes scheduled.');
    await expect(classRows(page)).toHaveCount(2);
  });
});

test.describe('Training: names with no break', () => {
  const UNBROKEN = 'Wolfeschlegelsteinhausenbergerdorff'.repeat(3).slice(0, 100);

  test('a long program, coach, and location name wrap, and nothing scrolls sideways at 320px', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin', {
      locations: [{ name: UNBROKEN, address: UNBROKEN }],
    });
    await seedTraining(tenant, {
      name: UNBROKEN,
      slug: 'long-names',
      locations: [UNBROKEN],
      coachName: UNBROKEN,
    });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`${base}/training/long-names`);
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(UNBROKEN);
    await expect(page.getByText('No classes yet')).toBeVisible();
    await screenshot(page, testInfo, 'training-page-long-names-empty');
    await expectAccessible(page);

    await page.locator('#weeks').fill('53');
    await page.locator('#weeks').blur();
    await expect(page.locator('#weeks-error')).toBeVisible();
    await screenshot(page, testInfo, 'training-page-long-names-errors');
    expect(await checkReflow(page)).toMatchObject({ passed: true });

    await page.locator('#weeks').fill('');
    await fillPattern(page, firstTuesdayTwoWeeksOut());
    await scheduleSubmit(page).click();
    await expect(classRows(page)).toHaveCount(8);
    await classRows(page)
      .first()
      .getByRole('button', { name: /^Cancel/ })
      .click();
    await expect(classRows(page).first()).toHaveAttribute('data-status', 'cancelled');
    await screenshot(page, testInfo, 'training-page-long-names-scheduled');
    await expectAccessible(page);
    expect(await checkReflow(page)).toMatchObject({ passed: true });
  });
});

test.describe('Training: who registered', () => {
  const MAYA = { kind: 'minor', minorName: 'Maya R.' } as const;
  const SELF = { kind: 'self' } as const;
  const LIST = 'trainingRegistrations:listForClass';
  const toggleOf = (row: Locator) => row.getByRole('button', { name: /registered in / });
  const registrantsOf = (row: Locator) => row.locator('app-training-registrants');
  // Against the page, not the viewport, which the scrolling that a check does moves.
  const box = (locator: Locator) =>
    locator.evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x: x + window.scrollX, y: y + window.scrollY, width, height };
    });

  async function classesWith(page: Page, role: Role | null = 'orgAdmin', placesPerClass?: number) {
    const admin = await memberOf(page, role);
    await seedTraining(admin.tenant, { ...SERVING, locations: [PELICAN], coachName: 'Dana Ruiz' });
    await seedTrainingClasses(admin.tenant, SERVING.slug, {
      weekday: 2,
      startTime: '18:00',
      endTime: '19:00',
      firstDate: firstTuesdayTwoWeeksOut(),
      weeks: 3,
      registrationDeadline: dateFromToday(7),
      allowSingleRegistration: true,
      ...(placesPerClass !== undefined && { placesPerClass }),
    });
    return { ...admin, path: `${admin.base}/training/${SERVING.slug}` };
  }

  test('series and single-class registrants show marked, a minor with the guardian’s name and email, and the list passes the axe helper', async ({
    page,
  }, testInfo) => {
    const { tenant, path } = await classesWith(page);
    const player = await seedUser(newUser('Player'));
    const guardian = await seedUser(newUser('Guardian'));
    await seedTrainingRegistration(tenant, SERVING.slug, player, SELF);
    await seedTrainingRegistration(tenant, SERVING.slug, guardian, MAYA, firstTuesdayTwoWeeksOut());
    await page.goto(path);
    const [first, second] = [classRows(page).nth(0), classRows(page).nth(1)];
    await expect(toggleOf(first)).toHaveText(/^2 of 12 registered in /);
    await expect(toggleOf(second)).toHaveText(/^1 of 12 registered in /);
    await expect(toggleOf(first)).toHaveAttribute('aria-expanded', 'false');

    await toggleOf(first).click();
    await expect(toggleOf(first)).toHaveAttribute('aria-expanded', 'true');
    const rows = registrantsOf(first).locator('tbody tr');
    await expect(rows).toHaveCount(2);
    const maya = rows.filter({ hasText: 'Maya R.' });
    await expect(maya.locator('[data-slot="registrant-kind"]')).toHaveText('This class');
    await expect(maya.getByRole('rowheader')).toContainText(
      `Guardian: ${guardian.name}, ${guardian.email}`,
    );
    const series = rows.filter({ hasText: player.name });
    await expect(series.locator('[data-slot="registrant-kind"]')).toHaveText('Series');
    await expect(series).not.toContainText('Guardian');
    await expect(maya.getByRole('cell').last()).toHaveText(/[A-Z][a-z]{2} \d{1,2}, \d{4}/);
    await expect(toggleOf(first)).toBeFocused();
    await screenshot(page, testInfo, 'training-registrants');
    await expectAccessible(page);

    await toggleOf(second).click();
    const secondRows = registrantsOf(second).locator('tbody tr');
    await expect(secondRows).toHaveCount(1);
    await expect(secondRows.locator('[data-slot="registrant-kind"]')).toHaveText('Series');
    await expect(secondRows).toContainText(player.name);
    await toggleOf(first).click();
    await expect(registrantsOf(first)).toHaveCount(0);
  });

  test('a class no one registered for says so', async ({ page }, testInfo) => {
    const { path } = await classesWith(page);
    await page.goto(path);
    await toggleOf(classRows(page).first()).click();
    await expect(registrantsOf(classRows(page).first())).toHaveText('No one has registered yet.');
    await screenshot(page, testInfo, 'training-registrants-empty');
    await expectAccessible(page);
  });

  test('a cancelled class shows its count as text, with no list to open', async ({ page }) => {
    const { path } = await classesWith(page);
    await page.goto(path);
    const first = classRows(page).first();
    await first.getByRole('button', { name: /^Cancel/ }).click();
    await expect(first).toHaveAttribute('data-status', 'cancelled');
    await expect(first.locator('[data-slot="class-registered"]')).toHaveText('0 of 12 registered');
    await expect(first.getByRole('button', { name: /registered in / })).toHaveCount(0);
  });

  interface Who {
    name: string;
    minor?: string;
  }

  async function heldList(page: Page, who: Who[]) {
    const { tenant, path } = await classesWith(page);
    for (const { name, minor } of who) {
      const person = await seedUser({ ...newUser('Person'), name });
      await seedTrainingRegistration(
        tenant,
        SERVING.slug,
        person,
        minor === undefined ? SELF : { kind: 'minor', minorName: minor },
      );
    }
    const held = await holdQueries(page, [LIST], { watchFromStart: false });
    await page.goto(path);
    await expect(classRows(page)).toHaveCount(3);
    held.watchNewSubscriptions();
    const first = classRows(page).first();
    await toggleOf(first).click();
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(registrantsOf(first).locator('tbody tr')).toHaveCount(who.length);
    const measure = async () => ({
      date: await box(first.locator('[data-slot="class-date"]')),
      toggle: await box(toggleOf(first)),
      places: await box(first.getByLabel(/^Places for /)),
      panel: await box(registrantsOf(first)),
      next: await box(classRows(page).nth(1)),
    });
    const loading = await measure();
    const release = async () => {
      held.release();
      await expect(registrantsOf(first).getByRole('region')).toBeVisible();
      return measure();
    };
    return { loading, release, first };
  }

  const expectAboveAndBesideStill = (
    loaded: { date: object; toggle: object; places: object; panel: { y: number } },
    loading: { date: object; toggle: object; places: object; panel: { y: number } },
  ) => {
    expect(loaded.date).toEqual(loading.date);
    expect(loaded.toggle).toEqual(loading.toggle);
    expect(loaded.places).toEqual(loading.places);
    expect(loaded.panel.y).toBe(loading.panel.y);
  };

  test('the list takes the room of its skeleton: nothing above or beside it moves, and the rows below stay put', async ({
    page,
  }, testInfo) => {
    const { loading, release } = await heldList(page, [
      { name: 'Pat Lee' },
      { name: 'Sam Ito' },
      { name: 'Ana Roe' },
    ]);
    await screenshot(page, testInfo, 'training-registrants-loading');
    await expectAccessible(page);
    const loaded = await release();
    expectAboveAndBesideStill(loaded, loading);
    expect(Math.abs(loaded.panel.height - loading.panel.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(loaded.next.y - loading.next.y)).toBeLessThanOrEqual(1);
    await screenshot(page, testInfo, 'training-registrants-loaded');
  });

  test('a minor’s guardian line fits its row, so nothing above, beside, or below the list moves when it answers', async ({
    page,
  }, testInfo) => {
    const { loading, release } = await heldList(page, [
      { name: 'Pat Lee' },
      { name: 'Gail Wu', minor: 'Maya R.' },
      { name: 'Sam Ito' },
    ]);
    const loaded = await release();
    expectAboveAndBesideStill(loaded, loading);
    await screenshot(page, testInfo, 'training-registrants-minor-loaded');
    expect(Math.abs(loaded.panel.height - loading.panel.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(loaded.next.y - loading.next.y)).toBeLessThanOrEqual(1);
  });

  test('a class that holds more registrations than its places lists every one, and the count matches the list', async ({
    page,
  }) => {
    const { tenant, path } = await classesWith(page, 'orgAdmin', 5);
    const guardian = await seedUser(newUser('Guardian'));
    const names = Array.from(
      { length: 12 },
      (_, index) => `Child ${String(index + 1).padStart(2, '0')}`,
    );
    for (const minorName of names) {
      await seedTrainingRegistration(tenant, SERVING.slug, guardian, { kind: 'minor', minorName });
    }
    await page.goto(path);
    const first = classRows(page).first();
    await expect(toggleOf(first)).toHaveText(/^12 of 5 registered in /);
    await toggleOf(first).click();
    await expect(registrantsOf(first).locator('tbody tr')).toHaveCount(12);
    await expect(registrantsOf(first).locator('tbody tr').first()).toContainText('Child 01');
    await expect(registrantsOf(first).locator('tbody tr').last()).toContainText('Child 12');
  });

  const WITH_MINORS: Who[] = [
    { name: 'Pat Lee' },
    { name: 'Gail Wu', minor: 'Maya R.' },
    {
      name: 'Gwendolyn'.repeat(6),
      minor: 'Wolfeschlegelsteinhausenbergerdorff'.repeat(2).slice(0, 60),
    },
  ];

  for (const width of [320, 360, 1280]) {
    test(`minors’ rows at ${width}px: nothing above, beside, or below the list moves when it answers`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      const { loading, release } = await heldList(page, WITH_MINORS);
      const loaded = await release();
      expectAboveAndBesideStill(loaded, loading);
      expect(Math.abs(loaded.panel.height - loading.panel.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(loaded.next.y - loading.next.y)).toBeLessThanOrEqual(1);
    });
  }

  test('at 320px a wide list scrolls inside its own region by keyboard, and the page does not scroll sideways', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const { release, first } = await heldList(page, WITH_MINORS);
    await release();
    const region = registrantsOf(first).getByRole('region', { name: /^Registrants of / });
    const widths = () =>
      region.evaluate((element) => ({
        regionScroll: element.scrollWidth,
        regionClient: element.clientWidth,
        pageScroll: document.documentElement.scrollWidth,
        pageClient: document.documentElement.clientWidth,
      }));
    const before = await widths();
    expect(before.regionScroll).toBeGreaterThan(before.regionClient);
    expect(before.pageScroll).toBeLessThanOrEqual(before.pageClient);
    await region.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    const after = await widths();
    expect(after.pageScroll).toBeLessThanOrEqual(after.pageClient);
  });

  test('a class with no registrations holds the same room while it loads as its message does', async ({
    page,
  }) => {
    const { path } = await classesWith(page);
    const held = await holdQueries(page, [LIST], { watchFromStart: false });
    await page.goto(path);
    await expect(classRows(page)).toHaveCount(3);
    held.watchNewSubscriptions();
    const first = classRows(page).first();
    await toggleOf(first).click();
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(
      registrantsOf(first).getByRole('status').filter({ hasText: 'Loading the registrants.' }),
    ).toBeAttached();
    const loading = await box(registrantsOf(first));
    const nextLoading = await box(classRows(page).nth(1));
    held.release();
    await expect(registrantsOf(first)).toHaveText('No one has registered yet.');
    const loaded = await box(registrantsOf(first));
    expect(Math.abs(loaded.height - loading.height)).toBeLessThanOrEqual(1);
    expect(Math.abs((await box(classRows(page).nth(1))).y - nextLoading.y)).toBeLessThanOrEqual(1);
  });

  test('a list the server fails shows the alert with Try again and the rest of the page stays', async ({
    page,
  }, testInfo) => {
    const { path } = await classesWith(page);
    await failFirstAnswer(page, LIST);
    await page.goto(path);
    await toggleOf(classRows(page).first()).click();
    const panel = registrantsOf(classRows(page).first());
    await expect(panel.getByRole('alert')).toContainText('The registrants could not be loaded.');
    await expect(panel.getByRole('link', { name: 'Try again' })).toBeVisible();
    await expect(page.locator('#classes-list')).toBeVisible();
    await screenshot(page, testInfo, 'training-registrants-error');
    await expectAccessible(page);
  });

  test('opened offline, the list says it will load when connected', async ({
    page,
    context,
  }, testInfo) => {
    const { path } = await classesWith(page);
    await page.goto(path);
    await expect(classRows(page)).toHaveCount(3);
    await context.setOffline(true);
    await toggleOf(classRows(page).first()).click();
    await expect(registrantsOf(classRows(page).first()).getByRole('status')).toHaveText(
      "You're offline. The registrants will load when you’re connected.",
    );
    await screenshot(page, testInfo, 'training-registrants-offline');
    await expectAccessible(page);
    await context.setOffline(false);
  });

  test('a long name and a long guardian email stay inside the list at 320px, and the row above does not move', async ({
    page,
  }, testInfo) => {
    const { tenant, path } = await classesWith(page);
    const base = newUser('Guardian');
    const guardian = await seedUser({
      ...base,
      name: 'Gwendolyn'.repeat(6),
      email: `e2e-a-very-long-guardian-address-${base.email}`,
    });
    const unbroken = 'Wolfeschlegelsteinhausenbergerdorff'.repeat(2).slice(0, 60);
    await seedTrainingRegistration(tenant, SERVING.slug, guardian, {
      kind: 'minor',
      minorName: unbroken,
    });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(path);
    const first = classRows(page).first();
    const before = {
      date: await box(first.locator('[data-slot="class-date"]')),
      toggle: await box(toggleOf(first)),
    };
    await toggleOf(first).click();
    const region = registrantsOf(first).getByRole('region', {
      name: /^Registrants of /,
    });
    await expect(region).toContainText(unbroken);
    await expect(region).toContainText(guardian.email);
    expect(await box(first.locator('[data-slot="class-date"]'))).toEqual(before.date);
    expect(await box(toggleOf(first))).toEqual(before.toggle);
    const sizes = await region.evaluate((element) => ({
      regionScroll: element.scrollWidth,
      regionClient: element.clientWidth,
      pageScroll: document.documentElement.scrollWidth,
      pageClient: document.documentElement.clientWidth,
    }));
    expect(sizes.regionScroll).toBeGreaterThan(sizes.regionClient);
    expect(sizes.pageScroll).toBeLessThanOrEqual(sizes.pageClient);
    await screenshot(page, testInfo, 'training-registrants-long-names');
    await expectAccessible(page);
    expect(await checkReflow(page)).toMatchObject({ passed: true });
  });

  test('a league organizer assigned to the training program sees the list', async ({
    page,
  }, testInfo) => {
    const { tenant, user, path } = await classesWith(page, null);
    await convexRun('testing:addLeagueOrganizer', {
      organizationSlug: tenant.slug,
      email: user.email,
      leagueSlugs: [],
      trainingSlugs: [SERVING.slug],
    });
    const player = await seedUser(newUser('Player'));
    await seedTrainingRegistration(tenant, SERVING.slug, player, SELF);
    await page.goto(path);
    await toggleOf(classRows(page).first()).click();
    await expect(registrantsOf(classRows(page).first()).locator('tbody tr')).toContainText(
      player.name,
    );
    await screenshot(page, testInfo, 'training-registrants-organizer');
  });
});

test.describe('Training: the series waitlist', () => {
  const MAYA = { kind: 'minor', minorName: 'Maya R.' } as const;
  const SELF = { kind: 'self' } as const;
  const LIST = 'trainingWaitlist:listForTraining';
  const UNBROKEN = 'Wolfeschlegelsteinhausenbergerdorff'.repeat(2).slice(0, 60);
  const panel = (page: Page) => page.locator('app-training-waitlist');
  const listRegion = (page: Page) => panel(page).getByRole('region', { name: /^Waitlist of / });
  const waitingRows = (page: Page) => panel(page).locator('tbody tr');
  const promoteButton = (page: Page) => panel(page).getByRole('button', { name: /^Promote/ });
  const box = (locator: Locator) =>
    locator.evaluate((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x: x + window.scrollX, y: y + window.scrollY, width, height };
    });

  /** A published program whose every class holds `held` of `places`, so a series with `held` equal to `places` is full. */
  async function waitingProgram(page: Page, places: number) {
    const admin = await memberOf(page, 'orgAdmin');
    await seedTraining(admin.tenant, { ...SERVING, locations: [PELICAN], coachName: 'Dana Ruiz' });
    await seedTrainingClasses(admin.tenant, SERVING.slug, {
      weekday: 2,
      startTime: '18:00',
      endTime: '19:00',
      firstDate: firstTuesdayTwoWeeksOut(),
      weeks: 3,
      registrationDeadline: dateFromToday(7),
      allowSingleRegistration: true,
      placesPerClass: places,
    });
    await convexRun('testing:publishSeededTraining', {
      organizationSlug: admin.tenant.slug,
      trainingSlug: SERVING.slug,
    });
    const holder = await seedUser(newUser('Holder'));
    await seedTrainingRegistration(admin.tenant, SERVING.slug, holder, SELF);
    return { ...admin, path: `${admin.base}/training/${SERVING.slug}` };
  }

  test('an org admin sees who waits, in the order they joined, a child with the guardian’s name and email, and the section passes the axe helper', async ({
    page,
  }, testInfo) => {
    const { tenant, path } = await waitingProgram(page, 1);
    const player = await seedUser(newUser('Player'));
    const guardian = await seedUser(newUser('Guardian'));
    await seedTrainingWaitlistEntry(tenant, SERVING.slug, player, SELF);
    await seedTrainingWaitlistEntry(tenant, SERVING.slug, guardian, MAYA);
    await page.goto(path);
    await expect(waitingRows(page)).toHaveCount(2);
    await expect(panel(page).locator('[data-slot="waitlist-count"]')).toHaveText('2 waiting');
    await expect(waitingRows(page).nth(0)).toContainText(player.name);
    await expect(waitingRows(page).nth(1)).toContainText('Maya R.');
    await expect(waitingRows(page).nth(1).getByRole('rowheader')).toContainText(
      `Guardian: ${guardian.name}, ${guardian.email}`,
    );
    await expect(waitingRows(page).locator('[data-slot="waiting-kind"]')).toHaveText([
      'Series',
      'Series',
    ]);
    await screenshot(page, testInfo, '365-waitlist');
    await expectAccessible(page);
  });

  test('a section with no one waiting says so', async ({ page }, testInfo) => {
    const { path } = await waitingProgram(page, 1);
    await page.goto(path);
    await expect(panel(page).locator('[data-slot="waitlist-empty"]')).toHaveText(
      'No one is waiting.',
    );
    await screenshot(page, testInfo, '365-waitlist-empty');
    await expectAccessible(page);
  });

  test('a draft program has no waitlist section', async ({ page }) => {
    const admin = await memberOf(page, 'orgAdmin');
    await seedTraining(admin.tenant, { ...SERVING, locations: [PELICAN], coachName: 'Dana Ruiz' });
    await page.goto(`${admin.base}/training/${SERVING.slug}`);
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(SERVING.name);
    await expect(panel(page)).toHaveCount(0);
  });

  test('Promote is dimmed while a class is full, and pressing it says how to make a place, in an alert that takes focus', async ({
    page,
  }, testInfo) => {
    const { tenant, path } = await waitingProgram(page, 1);
    const player = await seedUser(newUser('Player'));
    await seedTrainingWaitlistEntry(tenant, SERVING.slug, player, SELF);
    await page.goto(path);
    await expect(promoteButton(page)).toHaveAttribute('aria-disabled', 'true');
    await expect(panel(page).locator('[data-slot="promote-hint"]')).toBeVisible();
    await expect(panel(page).locator('[data-slot="promote-hint"]')).toHaveText(
      'Promote needs a free place: in every class for the series, in its class for one class. Raise the places first if one is full.',
    );
    await promoteButton(page).click({ force: true });
    const result = panel(page).getByRole('alert');
    await expect(result).toContainText(`${player.name} could not be given a place.`);
    await expect(result).toContainText('No place is free in every class. Raise the places first.');
    await expect(result).toBeFocused();
    await expect(waitingRows(page)).toHaveCount(1);
    await screenshot(page, testInfo, '365-waitlist-refused');
    await expectAccessible(page);
  });

  test('with a place in every class, Promote registers the first person for the series at once, and the list and counts follow', async ({
    page,
  }, testInfo) => {
    const { tenant, path } = await waitingProgram(page, 2);
    const player = await seedUser(newUser('Player'));
    const guardian = await seedUser(newUser('Guardian'));
    await seedTrainingWaitlistEntry(tenant, SERVING.slug, player, SELF);
    await seedTrainingWaitlistEntry(tenant, SERVING.slug, guardian, MAYA);
    await page.goto(path);
    await expect(
      classRows(page)
        .first()
        .getByRole('button', { name: /registered in / }),
    ).toHaveText(/^1 of 2 registered in /);
    await expect(promoteButton(page)).toHaveCount(2);
    await expect(promoteButton(page).first()).not.toHaveAttribute('aria-disabled', 'true');
    await expect(promoteButton(page).first()).toHaveAccessibleName(`Promote ${player.name}`);
    await expect(promoteButton(page).nth(1)).toHaveAttribute('aria-disabled', 'true');
    await promoteButton(page).first().click();
    const result = panel(page).getByRole('status').filter({ hasText: 'has a place' });
    await expect(result).toContainText(
      `${player.name} has a place. Registered for every class of ${SERVING.name}.`,
    );
    await expect(result).toBeFocused();
    await expect(waitingRows(page)).toHaveCount(1);
    await expect(waitingRows(page).first()).toContainText('Maya R.');
    await expect(
      classRows(page)
        .first()
        .getByRole('button', { name: /registered in / }),
    ).toHaveText(/^2 of 2 registered in /);
    await expect(promoteButton(page)).toHaveAttribute('aria-disabled', 'true');
    await screenshot(page, testInfo, '365-waitlist-promoted');
    await expectAccessible(page);
  });

  test('a league organizer assigned to the training program sees the waitlist', async ({
    page,
  }) => {
    const admin = await memberOf(page, null);
    await seedTraining(admin.tenant, { ...SERVING, locations: [PELICAN], coachName: 'Dana Ruiz' });
    await seedTrainingClasses(admin.tenant, SERVING.slug, {
      weekday: 2,
      startTime: '18:00',
      endTime: '19:00',
      firstDate: firstTuesdayTwoWeeksOut(),
      weeks: 3,
      registrationDeadline: dateFromToday(7),
      placesPerClass: 1,
    });
    await convexRun('testing:publishSeededTraining', {
      organizationSlug: admin.tenant.slug,
      trainingSlug: SERVING.slug,
    });
    await convexRun('testing:addLeagueOrganizer', {
      organizationSlug: admin.tenant.slug,
      email: admin.user.email,
      leagueSlugs: [],
      trainingSlugs: [SERVING.slug],
    });
    const player = await seedUser(newUser('Player'));
    await seedTrainingWaitlistEntry(admin.tenant, SERVING.slug, player, SELF);
    await page.goto(`${admin.base}/training/${SERVING.slug}`);
    await expect(waitingRows(page)).toHaveCount(1);
  });

  test('a list the server fails shows the alert with Try again and the rest of the page stays', async ({
    page,
  }, testInfo) => {
    const { path } = await waitingProgram(page, 1);
    await failFirstAnswer(page, LIST);
    await page.goto(path);
    await expect(panel(page).getByRole('alert')).toContainText('The waitlist could not be loaded.');
    await expect(panel(page).getByRole('link', { name: 'Try again' })).toBeVisible();
    await expect(page.locator('#classes-list')).toBeVisible();
    await screenshot(page, testInfo, '365-waitlist-error');
    await expectAccessible(page);
  });

  const UNBROKEN_CHILD = { kind: 'minor', minorName: UNBROKEN } as const;
  const WAITING_PEOPLE = [
    { owner: 'player', participant: SELF },
    { owner: 'guardian', participant: MAYA },
    { owner: 'guardian', participant: UNBROKEN_CHILD },
    { owner: 'player', participant: SELF, week: 1 },
    { owner: 'guardian', participant: MAYA, week: 1 },
    { owner: 'guardian', participant: UNBROKEN_CHILD, week: 2 },
  ] as const;

  for (const width of [320, 360, 1280]) {
    test(`the list takes the room of its skeleton at ${width}px, with minors and a long email: nothing above it moves and the section keeps its height`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      const { tenant, path } = await waitingProgram(page, 1);
      const base = newUser('Guardian');
      const guardian = await seedUser({
        ...base,
        name: 'Gwendolyn'.repeat(6),
        email: `e2e-a-very-long-guardian-address-${base.email}`,
      });
      const player = await seedUser(newUser('Player'));
      for (const person of WAITING_PEOPLE) {
        await seedTrainingWaitlistEntry(
          tenant,
          SERVING.slug,
          person.owner === 'player' ? player : guardian,
          person.participant,
          'week' in person ? classDate(person.week) : undefined,
        );
      }
      const held = await holdQueries(page, [LIST]);
      await page.goto(path);
      await expect.poll(() => held.isHolding()).toBe(true);
      await expect(classRows(page)).toHaveCount(3);
      await expect(waitingRows(page)).toHaveCount(WAITING_PEOPLE.length);
      const measure = async () => ({
        classes: await box(page.locator('#classes')),
        section: await box(panel(page).locator('section')),
        heading: await box(panel(page).locator('h2')),
        page: await page.evaluate(() => document.documentElement.scrollHeight),
      });
      const loading = await measure();
      await screenshot(page, testInfo, `365-waitlist-loading-${width}`);
      await expectAccessible(page);
      held.release();
      await expect(listRegion(page)).toBeVisible();
      await expect(panel(page)).toContainText(guardian.email);
      const loaded = await measure();
      expect(loaded.classes).toEqual(loading.classes);
      expect(loaded.heading.y).toBe(loading.heading.y);
      expect(Math.abs(loaded.section.y - loading.section.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(loaded.section.height - loading.section.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(loaded.page - loading.page)).toBeLessThanOrEqual(1);
      const region = listRegion(page);
      const sizes = await region.evaluate((element) => ({
        pageScroll: document.documentElement.scrollWidth,
        pageClient: document.documentElement.clientWidth,
        promote: element.querySelector('button')!.getBoundingClientRect().right,
        regionRight: element.getBoundingClientRect().right,
      }));
      expect(sizes.pageScroll).toBeLessThanOrEqual(sizes.pageClient);
      expect(sizes.promote).toBeLessThanOrEqual(sizes.regionRight + 1);
      await screenshot(page, testInfo, `365-waitlist-loaded-${width}`);
      await expectAccessible(page);
      if (width === 320) expect(await checkReflow(page)).toMatchObject({ passed: true });
    });
  }

  test('a class entry and a series entry wait in one list, each marked, and Promote goes to the one a place can serve', async ({
    page,
  }, testInfo) => {
    const { tenant, path } = await waitingProgram(page, 1);
    const player = await seedUser(newUser('Player'));
    const guardian = await seedUser(newUser('Guardian'));
    await seedTrainingWaitlistEntry(tenant, SERVING.slug, player, SELF);
    await seedTrainingWaitlistEntry(tenant, SERVING.slug, guardian, MAYA, classDate(1));
    await setTrainingClassRegistered(tenant, SERVING.slug, classDate(1), 0);
    await page.goto(path);
    await expect(waitingRows(page)).toHaveCount(2);
    await expect(waitingRows(page).locator('[data-slot="waiting-kind"]')).toHaveText([
      'Series',
      'This class',
    ]);
    await expect(waitingRows(page).nth(0).locator('[data-slot="waiting-class"]')).toHaveCount(0);
    await expect(waitingRows(page).nth(1).locator('[data-slot="waiting-class"]')).toHaveText(
      /^\w{3} \d{1,2}$/,
    );
    await expect(promoteButton(page)).toHaveCount(2);
    await expect(promoteButton(page).nth(0)).toHaveAttribute('aria-disabled', 'true');
    await expect(promoteButton(page).nth(1)).not.toHaveAttribute('aria-disabled', 'true');
    await screenshot(page, testInfo, '368-waitlist-mixed');
    await expectAccessible(page);

    await promoteButton(page).nth(0).click({ force: true });
    await expect(panel(page).getByRole('alert')).toContainText(
      `${player.name} could not be given a place. No place is free in every class. Raise the places first.`,
    );

    await promoteButton(page).nth(1).click();
    const result = panel(page).getByRole('status').filter({ hasText: 'has a place' });
    await expect(result).toContainText(`Maya R. has a place. Registered for `);
    await expect(result).toContainText(`of ${SERVING.name}.`);
    await expect(result).toBeFocused();
    await expect(waitingRows(page)).toHaveCount(1);
    await expect(waitingRows(page).first()).toContainText(player.name);
    await expect(
      classRows(page)
        .nth(1)
        .getByRole('button', { name: /registered in / }),
    ).toHaveText(/^1 of 1 registered in /);
    await screenshot(page, testInfo, '368-waitlist-mixed-promoted');
    await expectAccessible(page);
  });

  test('a row that has its place but is not the next says to give the places to the one who joined first', async ({
    page,
  }) => {
    const { tenant, path } = await waitingProgram(page, 1);
    const first = await seedUser(newUser('First'));
    const second = await seedUser(newUser('Second'));
    await seedTrainingWaitlistEntry(tenant, SERVING.slug, first, SELF, classDate(0));
    await seedTrainingWaitlistEntry(tenant, SERVING.slug, second, SELF, classDate(0));
    await setTrainingClassRegistered(tenant, SERVING.slug, classDate(0), 0);
    await page.goto(path);
    await expect(promoteButton(page)).toHaveCount(2);
    await expect(promoteButton(page).nth(0)).not.toHaveAttribute('aria-disabled', 'true');
    await promoteButton(page).nth(1).click({ force: true });
    await expect(panel(page).getByRole('alert')).toContainText(
      `${second.name} could not be given a place. Give the places to the person who joined first.`,
    );
  });

  test('a class that people wait for offers no Cancel and says it has a waitlist', async ({
    page,
  }, testInfo) => {
    const { tenant, path } = await waitingProgram(page, 1);
    const guardian = await seedUser(newUser('Guardian'));
    await seedTrainingWaitlistEntry(tenant, SERVING.slug, guardian, MAYA, classDate(1));
    await page.goto(path);
    await expect(classRows(page)).toHaveCount(3);
    await expect(classRows(page).nth(1).locator('[data-slot="class-required"]')).toHaveText(
      'Has registrations',
    );
    await setTrainingClassRegistered(tenant, SERVING.slug, classDate(1), 0);
    await expect(classRows(page).nth(1).locator('[data-slot="class-required"]')).toHaveText(
      'Has a waitlist',
    );
    await expect(
      classRows(page)
        .nth(1)
        .getByRole('button', { name: /^Cancel/ }),
    ).toHaveCount(0);
    await screenshot(page, testInfo, '368-class-has-waitlist');
    await expectAccessible(page);
  });

  test('a section with no one waiting holds the same room while it loads as its message does', async ({
    page,
  }) => {
    const { path } = await waitingProgram(page, 1);
    const held = await holdQueries(page, [LIST]);
    await page.goto(path);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(classRows(page)).toHaveCount(3);
    const loading = await box(panel(page).locator('section'));
    held.release();
    await expect(panel(page).locator('[data-slot="waitlist-empty"]')).toBeVisible();
    const loaded = await box(panel(page).locator('section'));
    expect(Math.abs(loaded.height - loading.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(loaded.y - loading.y)).toBeLessThanOrEqual(1);
  });
});
