import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
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
import { seedTraining } from './support/training';
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
    await page.locator('#first-date').fill(dateFromToday(15));
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
