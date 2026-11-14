import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { axeScan, describeViolations, expectAccessible } from './support/a11y';
import { tokensSettled } from './support/auth-tokens';
import { seedCamp, seedCampSession } from './support/camp';
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
import { seedTournament } from './support/tournament';
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
  const tenant = await seedTenant({ name: 'E2E Camps', locations: LOCATIONS, ...seed });
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
const form = (page: Page) => page.locator('#create-camp form');
const submit = (page: Page) => form(page).getByRole('button', { name: /^Create draft camp/ });
const rows = (page: Page) => page.locator('#camps-list > li');

async function fillValid(page: Page, name: string) {
  await page.locator('#name').fill(name);
  await chooseChip(chipLabel(page, 'Beach volleyball'));
  await page.locator('#minimum-age').fill('9');
  await page.locator('#maximum-age').fill('14');
}

test.describe('Camps: creating a draft', () => {
  test('an org admin creates a draft: it is listed as Draft with its ages, the status names it, and the form is cleared', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/camps`);
    await expect(page).toHaveTitle(`Camps | ${tenant.name} | Omni League`);
    await expect(page.getByText('No camps yet')).toBeVisible();
    await expect(page.getByText('Create a camp, then add its sessions.')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: PELICAN })).toBeChecked();
    await screenshot(page, testInfo, 'camps-empty');
    await expectAccessible(page);

    await fillValid(page, 'Junior Beach Volleyball Camp');
    await screenshot(page, testInfo, 'camps-filled');
    await submit(page).click();

    const status = form(page).getByRole('status').filter({ hasText: 'created' });
    await expect(status).toContainText('Junior Beach Volleyball Camp created.');
    await expect(status.getByRole('link', { name: 'Add sessions' })).toHaveAttribute(
      'href',
      `${base}/camps/junior-beach-volleyball-camp#add-session`,
    );
    await expect(page.locator('#name')).toHaveValue('');
    await expect(page.locator('#minimum-age')).toHaveValue('');
    await expect(submit(page)).toBeFocused();

    await expect(rows(page)).toHaveCount(1);
    const row = rows(page).first();
    await expect(row.locator('h3')).toHaveText('Junior Beach Volleyball Camp');
    await expect(row.locator('[data-slot="badge"]')).toHaveText('Draft');
    await expect(row).toContainText('Ages 9 to 14');
    await expect(row.locator('[data-slot="session-count"]')).toHaveText('No sessions yet');
    await screenshot(page, testInfo, 'camps-created');
    await expectAccessible(page);
  });

  test(
    'ages from 12 to 9, and 3, show under the field on leaving it, and the error clears once fixed',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { base } = await memberOf(page, 'orgAdmin');
      await page.goto(`${base}/camps`);
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
        'Enter a whole number of years from 4 to 99.',
      );
    },
  );

  test('an empty submit shows every message and sends nothing', async ({ page }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/camps`);
    await submit(page).click();
    await expect(page.locator('#name-error')).toBeVisible();
    await expect(page.locator('#minimum-age-error')).toHaveText(
      'Enter the youngest age, from 4 to 99.',
    );
    await expect(page.locator('#maximum-age-error')).toHaveText(
      'Enter the oldest age, from 4 to 99.',
    );
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#name')).toBeFocused();
    await screenshot(page, testInfo, 'camps-errors');
    await expectAccessible(page);
  });

  test('a web address held by a league, a tournament, or a camp of the organization shows "is already taken" under Web address', async ({
    page,
  }) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin', { leagues: LEAGUES });
    await seedTournament(tenant, {
      name: 'Winter Open',
      slug: 'winter-open',
      locations: [PELICAN],
      startDate: dateFromToday(40),
      endDate: dateFromToday(41),
      status: 'draft',
    });
    await page.goto(`${base}/camps`);
    for (const [name, slug] of [
      ['Sand 4s', 'sand-4s'],
      ['Winter Open', 'winter-open'],
    ]) {
      await page.locator('#name').fill(name);
      await expect(page.locator('#slug-error')).toHaveText(
        `${slug} is already taken. Choose another web address.`,
      );
    }

    await page.locator('#name').fill('Junior Beach Volleyball Camp');
    await expect(page.locator('#slug-error')).toHaveCount(0);
    await fillValid(page, 'Junior Beach Volleyball Camp');
    await submit(page).click();
    await expect(rows(page)).toHaveCount(1);

    await page.locator('#name').fill('Junior Beach Volleyball Camp');
    await expect(page.locator('#slug-error')).toHaveText(
      'junior-beach-volleyball-camp is already taken. Choose another web address.',
    );
  });
});

test.describe('Camps: loading', () => {
  test('the list and the form show skeletons while their answers are held, and the state passes the axe helper', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    const held = await holdQueries(page, ['camps:listForOrganization', 'locations:listForAdmin']);
    await page.goto(`${base}/camps`);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: 'Loading the camps.' })).toBeAttached();
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading the locations.' }),
    ).toBeAttached();
    await expect(page.getByText('No camps yet')).toHaveCount(0);
    await expect(form(page)).toHaveCount(0);
    await screenshot(page, testInfo, 'camps-loading');
    await expectAccessible(page);

    held.release();
    await expect(page.getByText('No camps yet')).toBeVisible();
    await expect(form(page)).toBeVisible();
  });
});

test.describe('Camps: the failure states', () => {
  test('a list that fails to load shows the alert and passes the axe helper', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await failFirstAnswer(page, 'camps:listForOrganization');
    await page.goto(`${base}/camps`);
    const alert = page.locator('section[aria-labelledby="camps-heading"] [role="alert"]');
    await expect(alert).toContainText('The camps could not be loaded.');
    await screenshot(page, testInfo, 'camps-load-error');
    await expectAccessible(page);
  });

  test('pressing Create offline shows the offline alert, keeps the input, and passes the axe helper', async ({
    page,
    context,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/camps`);
    await fillValid(page, 'Junior Beach Volleyball Camp');
    await context.setOffline(true);
    await expect(submit(page)).toHaveAttribute('aria-disabled', 'true');
    // `force`: Playwright treats aria-disabled as not actionable, and the page must answer the press.
    await submit(page).click({ force: true });
    const alert = form(page).getByRole('alert');
    await expect(alert).toContainText("You're offline. Nothing was sent.");
    await expect(page.locator('#name')).toHaveValue('Junior Beach Volleyball Camp');
    await expect(page.locator('#maximum-age')).toHaveValue('14');
    await screenshot(page, testInfo, 'camps-offline');
    await expectAccessible(page);
    await context.setOffline(false);
  });
});

test.describe('Camps: a create the server fails', () => {
  test.use({ expectedConvexErrors: ['camps:create'] });

  test('a create the server fails keeps the input, and the alert passes the axe helper', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await failMutation(page, 'camps:create');
    await page.goto(`${base}/camps`);
    await fillValid(page, 'Junior Beach Volleyball Camp');
    await submit(page).click();
    const alert = form(page).getByRole('alert');
    await expect(alert).toContainText('The camp could not be created.');
    await expect(page.locator('#name')).toHaveValue('Junior Beach Volleyball Camp');
    await expect(page.locator('#minimum-age')).toHaveValue('9');
    await screenshot(page, testInfo, 'camps-create-error');
    await expectAccessible(page);
  });
});

test.describe('who may open Camps', () => {
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
      `${label} sees the no-access view, and no camp data is requested`,
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
        const { base } = await memberOf(page, role);
        const frames = sentFrames(page);
        await page.goto(`${base}/camps`);
        await expect(
          main(page).getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
        ).toBeVisible();
        expect(frames.join('\n')).toContain('organizations:getAdminContext');
        expect(frames.join('\n')).not.toContain('camps:listForOrganization');
      },
    );
  }

  test('the no-access view passes the axe helper', async ({ page }, testInfo) => {
    const { base } = await memberOf(page, null);
    await page.goto(`${base}/camps`);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
    ).toBeVisible();
    await screenshot(page, testInfo, 'camps-no-access');
    await expectAccessible(page);
  });
});

test.describe('the admin sidebar', () => {
  test(
    'lists Camps under Programs, marked current on the Camps page',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { tenant, base } = await memberOf(page, 'orgAdmin');
      await page.goto(`${base}/camps`);
      const nav = page.getByRole('navigation', { name: `${tenant.name} admin` });
      const programs = nav.getByRole('list', { name: 'Programs' });
      await expect(programs.getByRole('link', { name: /^Camps/ })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(programs.getByRole('link', { name: /^Tournaments/ })).toHaveAttribute(
        'href',
        `${base}/tournaments`,
      );
    },
  );
});

const JUNIOR = { name: 'Junior Beach Volleyball Camp', slug: 'junior-beach-volleyball-camp' };
const FALL = { name: 'Fall Break Camp', slug: 'fall-break-camp' };

async function seedCamps(tenant: Parameters<typeof seedCamp>[0]) {
  for (const camp of [JUNIOR, FALL]) {
    await seedCamp(tenant, { ...camp, locations: [PELICAN], minimumAge: 9, maximumAge: 14 });
  }
}

test.describe('Camps: assigning a league organizer', () => {
  const invitePanel = (page: Page) => page.locator('#invite form');
  const pendingRows = (page: Page) => page.locator('#pending-list > li');

  test('the staff invite lists the camps under their own heading, and a camp alone is a valid choice', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin', { leagues: LEAGUES });
    await seedCamps(tenant);
    await page.goto(`${base}/staff`);
    await expect(main(page).getByRole('heading', { level: 1, name: 'Staff' })).toBeVisible();
    await expect(
      invitePanel(page).locator('fieldset#leagues + fieldset#camps > legend'),
    ).toHaveText('Camps');
    const camps = page.getByRole('group', { name: 'Camps' });
    await expect(camps.getByRole('checkbox')).toHaveCount(2);
    await expect(camps.getByRole('checkbox').first()).toHaveAccessibleName(FALL.name);
    await screenshot(page, testInfo, 'staff-camps-picker');
    await expectAccessible(page);

    await page.locator('#email').fill('dana@example.com');
    await page.getByRole('checkbox', { name: FALL.name }).click();
    await invitePanel(page)
      .getByRole('button', { name: /^Create invite link/ })
      .click();
    await expect(page.getByRole('heading', { name: 'Invite link ready' })).toBeFocused();
    await expect(pendingRows(page).first()).toContainText(`League organizer for ${FALL.name}`);
  });

  test('choosing nothing says to choose a league or camp, and creates nothing', async ({
    page,
  }) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin', { leagues: LEAGUES });
    await seedCamps(tenant);
    await page.goto(`${base}/staff`);
    await page.locator('#email').fill('dana@example.com');
    await invitePanel(page)
      .getByRole('button', { name: /^Create invite link/ })
      .click();
    await expect(page.locator('#leagues-error')).toHaveText('Choose at least one league or camp.');
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

test.describe('Camps: an invited league organizer', () => {
  test('accepts an invite naming a league and a camp, and the camp is listed in the organizer sidebar', async ({
    page,
  }, testInfo) => {
    const tenant = await seedTenant({
      name: 'E2E Camp Invite',
      locations: LOCATIONS,
      leagues: LEAGUES,
    });
    await seedCamps(tenant);
    const user = await seedUser(newUser('Invitee'));
    const token = randomBytes(32).toString('base64url');
    await convexRun('testing:addInvite', {
      organizationSlug: tenant.slug,
      email: user.email,
      role: 'leagueOrganizer',
      leagueNames: ['Sand 4s'],
      campNames: [JUNIOR.name],
      expiresAt: Date.now() + 12 * DAY,
      token,
    });

    await page.goto(`/invites/accept#${token}`);
    await expect(page).toHaveURL(`${baseURL}/invites/accept`);
    await expect(
      main(page).getByText('You’re invited to run leagues and camps as a league organizer.'),
    ).toBeVisible();
    await expect(main(page).locator('dl dt')).toHaveText([
      'Organization',
      'Role',
      'League',
      'Camp',
      'Expires',
    ]);
    await screenshot(page, testInfo, 'camp-invite-signed-out');
    await expectAccessible(page);

    await main(page).getByRole('link', { name: 'Sign in' }).click();
    await signInWith(page, user);
    await expect(page).toHaveURL(`${baseURL}/invites/accept`);
    await main(page).getByRole('button', { name: 'Accept invite' }).click();
    await expect(main(page)).toContainText(
      `You’re a league organizer for Sand 4s and ${JUNIOR.name}.`,
    );
    await screenshot(page, testInfo, 'camp-invite-accepted');
    await expectAccessible(page);

    await page.goto(`/app/organizations/${tenant.slug}/leagues/sand-4s`);
    // The sidebar is the phone sheet's content below 1024px, so it is read hidden.
    const nav = page.getByRole('navigation', {
      name: `${tenant.name} leagues and camps`,
      includeHidden: true,
    });
    const camps = nav.getByRole('list', { name: 'Your camps', includeHidden: true });
    await expect(camps.getByRole('listitem', { includeHidden: true })).toHaveText([JUNIOR.name]);
    await expect(camps.getByRole('link', { includeHidden: true })).toHaveAttribute(
      'href',
      `/app/organizations/${tenant.slug}/camps/${JUNIOR.slug}`,
    );
  });

  test('the assigned camps are links with the tent icon that open their pages, and the sidebar passes the axe helper', async ({
    page,
    isMobile,
  }, testInfo) => {
    const tenant = await seedTenant({
      name: 'E2E Camp Rows',
      locations: LOCATIONS,
      leagues: LEAGUES,
    });
    await seedCamps(tenant);
    const user = await seedUser(newUser('Invitee'));
    const token = randomBytes(32).toString('base64url');
    await convexRun('testing:addInvite', {
      organizationSlug: tenant.slug,
      email: user.email,
      role: 'leagueOrganizer',
      leagueNames: ['Sand 4s'],
      campNames: [JUNIOR.name, FALL.name],
      expiresAt: Date.now() + 12 * DAY,
      token,
    });
    await page.goto(`/invites/accept#${token}`);
    await main(page).getByRole('link', { name: 'Sign in' }).click();
    await signInWith(page, user);
    await main(page).getByRole('button', { name: 'Accept invite' }).click();
    await expect(main(page)).toContainText('You’re a league organizer for');

    await page.goto(`/app/organizations/${tenant.slug}/leagues/sand-4s`);
    if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click();
    const nav = page.getByRole('navigation', { name: `${tenant.name} leagues and camps` });
    const camps = nav.getByRole('list', { name: 'Your camps' });
    await expect(camps).toBeVisible();
    await expect(camps.getByRole('listitem')).toHaveText([FALL.name, JUNIOR.name]);
    await expect(camps.getByRole('link')).toHaveText([FALL.name, JUNIOR.name]);
    await expect(camps.locator('ng-icon[name="lucideTent"]')).toHaveCount(2);
    await screenshot(page, testInfo, 'camp-sidebar-rows');
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);

    await camps.getByRole('link', { name: JUNIOR.name }).click();
    await expect(page).toHaveURL(
      `${baseURL}/app/organizations/${tenant.slug}/camps/${JUNIOR.slug}`,
    );
    await expect(main(page).getByRole('heading', { level: 1, name: JUNIOR.name })).toBeVisible();
    if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(
      page
        .getByRole('navigation', { name: `${tenant.name} leagues and camps` })
        .getByRole('link', { name: JUNIOR.name }),
    ).toHaveAttribute('aria-current', 'page');
  });
});

const campPage = (tenant: { slug: string }, slug = JUNIOR.slug) =>
  `/app/organizations/${tenant.slug}/camps/${slug}`;
const sessionsCard = (page: Page) => page.locator('#sessions');
const sessionRows = (page: Page) => page.locator('#sessions-list > li');
const addForm = (page: Page) => page.locator('#add-session form');
const addButton = (page: Page) => addForm(page).getByRole('button', { name: /^Add session/ });

async function fillSession(
  page: Page,
  session: { name: string; start: string; end: string; deadline: string },
) {
  await page.locator('#add-session #name').fill(session.name);
  await page.locator('#add-session #start-date').fill(session.start);
  await page.locator('#add-session #end-date').fill(session.end);
  await page.locator('#add-session #registration-deadline').fill(session.deadline);
}

const WEEK_1 = { name: 'Week 1', start: '2027-07-05', end: '2027-07-09', deadline: '2027-07-01' };
const WEEK_2 = { name: 'Week 2', start: '2027-07-12', end: '2027-07-16', deadline: '2027-07-08' };
const WEEK_3 = { name: 'Week 3', start: '2027-07-19', end: '2027-07-23', deadline: '2027-07-15' };

async function adminWithCamp(page: Page) {
  const admin = await memberOf(page, 'orgAdmin');
  await seedCamp(admin.tenant, { ...JUNIOR, locations: [PELICAN], minimumAge: 9, maximumAge: 14 });
  return { ...admin, camp: campPage(admin.tenant) };
}

test.describe('Camp sessions: opening the camp page', () => {
  test('Add sessions in the success status opens the camp page, and a new camp has no sessions', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/camps`);
    await fillValid(page, JUNIOR.name);
    await submit(page).click();
    await form(page).getByRole('link', { name: 'Add sessions' }).click();

    await expect(page).toHaveURL(`${baseURL}${campPage(tenant)}#add-session`);
    await expect(page).toHaveTitle(`${JUNIOR.name} | ${tenant.name} | Omni League`);
    await expect(main(page).getByRole('heading', { level: 1, name: JUNIOR.name })).toBeVisible();
    // The link lands on the form: Name has focus and the form is on screen, so a new camp needs no second press.
    await expect(page.locator('#add-session #name')).toBeFocused();
    await expect(page.locator('#add-session #name')).toBeInViewport();
    await expect(main(page).locator('h1 + div [data-slot="badge"]').first()).toHaveText('Draft');
    await expect(main(page).locator('#details')).toContainText('Ages 9 to 14');
    await expect(main(page).locator('#details')).toContainText(PELICAN);
    await expect(sessionsCard(page)).toContainText('No sessions yet');
    await screenshot(page, testInfo, 'camp-empty');
    await expectAccessible(page);
  });

  test('a camp page opened with #add-session lands on the form, and the empty state’s Add a session link does the same', async ({
    page,
  }) => {
    const { camp } = await adminWithCamp(page);
    await page.goto(`${camp}#add-session`);
    await expect(main(page).getByRole('heading', { level: 1, name: JUNIOR.name })).toBeVisible();
    await expect(page.locator('#add-session #name')).toBeFocused();
    await expect(page.locator('#add-session #name')).toBeInViewport();

    await page.goto(camp);
    await expect(sessionsCard(page)).toContainText('No sessions yet');
    const link = sessionsCard(page).getByRole('link', { name: 'Add a session' });
    await expect(link).toHaveAttribute('href', `${camp}#add-session`);
    await link.click();
    await expect(page.locator('#add-session #name')).toBeFocused();
    await expect(page.locator('#add-session #name')).toBeInViewport();
  });

  test('the camp’s name in the Camps list opens its page, and the breadcrumb leads back', async ({
    page,
  }) => {
    const { tenant, base } = await adminWithCamp(page);
    await page.goto(`${base}/camps`);
    await rows(page).first().getByRole('link', { name: JUNIOR.name }).click();
    await expect(page).toHaveURL(`${baseURL}${campPage(tenant)}`);
    const crumbs = main(page).getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Camps', exact: true })).toHaveAttribute(
      'href',
      `${base}/camps`,
    );
    await expect(crumbs.getByRole('link', { name: JUNIOR.name })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await crumbs.getByRole('link', { name: 'Camps', exact: true }).click();
    await expect(page).toHaveURL(`${baseURL}${base}/camps`);
  });
});

test.describe('Camp sessions: adding', () => {
  test('a session added shows in date order with its places, and the form keeps the times and places', async ({
    page,
  }, testInfo) => {
    const { camp, base } = await adminWithCamp(page);
    await page.goto(camp);
    await page.locator('#add-session #daily-start-time').fill('09:00');
    await page.locator('#add-session #daily-end-time').fill('12:00');
    await page.locator('#add-session #places').fill('20');

    for (const week of [WEEK_3, WEEK_1, WEEK_2]) {
      await fillSession(page, week);
      await addButton(page).click();
      await expect(
        addForm(page).getByRole('status').filter({ hasText: 'Session added.' }),
      ).toBeVisible();
      await expect(page.locator('#add-session #name')).toHaveValue('');
      await expect(page.locator('#add-session #places')).toHaveValue('20');
      await expect(addButton(page)).toBeFocused();
    }

    await expect(sessionRows(page).locator('h3')).toHaveText(['Week 1', 'Week 2', 'Week 3']);
    const first = sessionRows(page).first();
    await expect(first.locator('[data-slot="session-places"]')).toHaveText('20 places');
    await expect(first.locator('[data-slot="session-dates"]')).toHaveText('Jul 5 – Jul 9, 2027');
    await expect(first.locator('[data-slot="session-times"]')).toHaveText('9 AM to 12 PM');
    await expect(first.locator('[data-slot="session-deadline"]')).toHaveText(
      'Registration closes Jul 1, 2027',
    );
    await screenshot(page, testInfo, 'camp-sessions');
    await expectAccessible(page);

    await page.goto(`${base}/camps`);
    await expect(rows(page).first().locator('[data-slot="session-count"]')).toHaveText(
      '3 sessions',
    );
  });

  test('a session with no times shows none, and one place is "1 place"', async ({ page }) => {
    const { camp } = await adminWithCamp(page);
    await page.goto(camp);
    await fillSession(page, WEEK_1);
    await page.locator('#add-session #places').fill('1');
    await addButton(page).click();
    const row = sessionRows(page).first();
    await expect(row.locator('[data-slot="session-places"]')).toHaveText('1 place');
    await expect(row.locator('[data-slot="session-times"]')).toHaveCount(0);
  });

  test(
    'an end before the start, and a deadline after it, show under the field on leaving it, and the server is not asked',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { camp } = await adminWithCamp(page);
      await page.goto(camp);
      await page.locator('#add-session #start-date').fill('2027-07-05');
      await page.locator('#add-session #end-date').fill('2027-07-04');
      await page.locator('#add-session #end-date').blur();
      await expect(page.locator('#add-session #end-date-error')).toHaveText(
        'The end date must be on or after the start date.',
      );
      await page.locator('#add-session #end-date').fill('2027-07-09');
      await expect(page.locator('#add-session #end-date-error')).toHaveCount(0);

      await page.locator('#add-session #registration-deadline').fill('2027-07-06');
      await page.locator('#add-session #registration-deadline').blur();
      await expect(page.locator('#add-session #registration-deadline-error')).toHaveText(
        'The registration deadline must be on or before the start date, Jul 5, 2027.',
      );
    },
  );

  test('an empty submit shows every message, focuses Name, and adds nothing', async ({
    page,
  }, testInfo) => {
    const { camp } = await adminWithCamp(page);
    await page.goto(camp);
    await addButton(page).click();
    await expect(page.locator('#add-session #name-error')).toBeVisible();
    await expect(page.locator('#add-session #places-error')).toHaveText(
      'Enter the number of places, from 1 to 500.',
    );
    await expect(page.locator('#add-session #name')).toBeFocused();
    await expect(sessionRows(page)).toHaveCount(0);
    await screenshot(page, testInfo, 'camp-session-errors');
    await expectAccessible(page);
  });

  test('a session starting before its end time is refused by the form, and one time alone asks for the other', async ({
    page,
  }) => {
    const { camp } = await adminWithCamp(page);
    await page.goto(camp);
    await fillSession(page, WEEK_1);
    await page.locator('#add-session #places').fill('20');
    await page.locator('#add-session #daily-start-time').fill('09:00');
    await addButton(page).click();
    await expect(page.locator('#add-session #daily-end-time-error')).toHaveText(
      'Enter the end time, or clear the start time.',
    );
    await page.locator('#add-session #daily-end-time').fill('08:00');
    await page.locator('#add-session #daily-end-time').blur();
    await expect(page.locator('#add-session #daily-end-time-error')).toContainText(
      'The end time must be after the start time, 9 AM.',
    );
  });
});

test.describe('Camp sessions: Delete and Undo', () => {
  test('Delete removes a session at once, and Undo brings it back unchanged', async ({
    page,
  }, testInfo) => {
    const { tenant } = await adminWithCamp(page);
    await seedCampSession(tenant, JUNIOR.slug, {
      name: 'Week 1',
      startDate: WEEK_1.start,
      endDate: WEEK_1.end,
      dailyStartTime: '09:00',
      dailyEndTime: '12:00',
      places: 20,
      registrationDeadline: WEEK_1.deadline,
    });
    await seedCampSession(tenant, JUNIOR.slug, {
      name: 'Week 2',
      startDate: WEEK_2.start,
      endDate: WEEK_2.end,
    });
    await page.goto(campPage(tenant));
    const first = sessionRows(page).first();
    const before = await first.innerText();
    await first.getByRole('button', { name: 'Delete Week 1' }).click();

    const status = sessionsCard(page).locator('[data-slot="session-status"]');
    await expect(status).toContainText('Week 1 deleted.');
    await expect(sessionRows(page).locator('h3')).toHaveText(['Week 2']);
    await expect(status.locator('[tabindex="-1"]')).toBeFocused();
    await screenshot(page, testInfo, 'camp-session-deleted');
    await expectAccessible(page);

    await status.getByRole('button', { name: 'Undo' }).click();
    await expect(status).toContainText('Week 1 restored.');
    await expect(sessionRows(page).locator('h3')).toHaveText(['Week 1', 'Week 2']);
    expect(await sessionRows(page).first().innerText()).toBe(before);
  });

  test('the Camps list follows each delete, and Undo brings the count back', async ({ page }) => {
    const { tenant, base } = await adminWithCamp(page);
    for (const week of [WEEK_1, WEEK_2]) {
      await seedCampSession(tenant, JUNIOR.slug, {
        name: week.name,
        startDate: week.start,
        endDate: week.end,
      });
    }
    const count = () => rows(page).first().locator('[data-slot="session-count"]');
    const status = sessionsCard(page).locator('[data-slot="session-status"]');
    await page.goto(`${base}/camps`);
    await expect(count()).toHaveText('2 sessions');

    await page.goto(campPage(tenant));
    await sessionRows(page).first().getByRole('button', { name: 'Delete Week 1' }).click();
    await expect(status).toContainText('Week 1 deleted.');
    await status.getByRole('button', { name: 'Undo' }).click();
    await expect(status).toContainText('Week 1 restored.');
    await page.goto(`${base}/camps`);
    await expect(count()).toHaveText('2 sessions');

    await page.goto(campPage(tenant));
    await sessionRows(page).first().getByRole('button', { name: 'Delete Week 1' }).click();
    await expect(status).toContainText('Week 1 deleted.');
    await page.goto(`${base}/camps`);
    await expect(count()).toHaveText('1 session');

    await page.goto(campPage(tenant));
    await sessionRows(page).first().getByRole('button', { name: 'Delete Week 2' }).click();
    await expect(sessionsCard(page)).toContainText('No sessions yet');
    await page.goto(`${base}/camps`);
    await expect(count()).toHaveText('No sessions yet');
  });

  test('a session with registrations shows its count and has no Delete', async ({
    page,
  }, testInfo) => {
    const { tenant } = await adminWithCamp(page);
    await seedCampSession(tenant, JUNIOR.slug, {
      name: 'Week 1',
      startDate: WEEK_1.start,
      endDate: WEEK_1.end,
      registeredCount: 4,
    });
    await seedCampSession(tenant, JUNIOR.slug, {
      name: 'Week 2',
      startDate: WEEK_2.start,
      endDate: WEEK_2.end,
    });
    await page.goto(campPage(tenant));
    const first = sessionRows(page).first();
    await expect(first.locator('[data-slot="session-registered"]')).toHaveText('4 registered');
    await expect(first.getByRole('button')).toHaveCount(0);
    await expect(
      sessionRows(page).nth(1).getByRole('button', { name: 'Delete Week 2' }),
    ).toBeVisible();
    await screenshot(page, testInfo, 'camp-session-registered');
    await expectAccessible(page);
  });
});

test.describe('Camp sessions: loading and failure states', () => {
  test('the camp and the sessions show skeletons while their answers are held', async ({
    page,
  }, testInfo) => {
    const { camp } = await adminWithCamp(page);
    const held = await holdQueries(page, ['camps:getForManagement']);
    await page.goto(camp);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(page.getByRole('status').filter({ hasText: 'Loading the camp.' })).toBeAttached();
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveCount(0);
    await screenshot(page, testInfo, 'camp-loading');
    await expectAccessible(page);
    held.release();
    await expect(main(page).getByRole('heading', { level: 1, name: JUNIOR.name })).toBeVisible();
  });

  test('the sessions held back show their own skeleton inside the card', async ({
    page,
  }, testInfo) => {
    const { camp } = await adminWithCamp(page);
    const held = await holdQueries(page, ['campSessions:listForCamp']);
    await page.goto(camp);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(
      sessionsCard(page).getByRole('status').filter({ hasText: 'Loading the sessions.' }),
    ).toBeAttached();
    await expect(page.locator('#add-session form')).toBeVisible();
    await screenshot(page, testInfo, 'camp-sessions-loading');
    await expectAccessible(page);
    held.release();
    await expect(sessionsCard(page)).toContainText('No sessions yet');
  });

  test('a sessions list that fails to load shows the alert, and the form stays', async ({
    page,
  }, testInfo) => {
    const { camp } = await adminWithCamp(page);
    await failFirstAnswer(page, 'campSessions:listForCamp');
    await page.goto(camp);
    await expect(sessionsCard(page).getByRole('alert')).toContainText(
      'The sessions could not be loaded.',
    );
    await expect(addForm(page)).toBeVisible();
    await screenshot(page, testInfo, 'camp-sessions-load-error');
    await expectAccessible(page);
  });

  test('pressing Add session offline shows the offline alert and keeps every field', async ({
    page,
    context,
  }, testInfo) => {
    const { camp } = await adminWithCamp(page);
    await page.goto(camp);
    await fillSession(page, WEEK_1);
    await page.locator('#add-session #places').fill('20');
    await context.setOffline(true);
    await expect(addButton(page)).toHaveAttribute('aria-disabled', 'true');
    // `force`: Playwright treats aria-disabled as not actionable, and the page must answer the press.
    await addButton(page).click({ force: true });
    await expect(addForm(page).getByRole('alert')).toContainText(
      "You're offline. Nothing was sent.",
    );
    await expect(page.locator('#add-session #name')).toHaveValue('Week 1');
    await expect(page.locator('#add-session #places')).toHaveValue('20');
    await screenshot(page, testInfo, 'camp-session-offline');
    await expectAccessible(page);
    await context.setOffline(false);
  });

  test.describe('an add the server fails', () => {
    test.use({ expectedConvexErrors: ['campSessions:add'] });

    test('keeps every field and the alert says what to do', async ({ page }, testInfo) => {
      const { camp } = await adminWithCamp(page);
      await failMutation(page, 'campSessions:add');
      await page.goto(camp);
      await fillSession(page, WEEK_1);
      await page.locator('#add-session #places').fill('20');
      await addButton(page).click();
      await expect(addForm(page).getByRole('alert')).toContainText(
        'The session could not be added.',
      );
      await expect(page.locator('#add-session #name')).toHaveValue('Week 1');
      await expect(page.locator('#add-session #start-date')).toHaveValue(WEEK_1.start);
      await expect(page.locator('#add-session #end-date')).toHaveValue(WEEK_1.end);
      await expect(page.locator('#add-session #registration-deadline')).toHaveValue(
        WEEK_1.deadline,
      );
      await expect(page.locator('#add-session #places')).toHaveValue('20');
      await screenshot(page, testInfo, 'camp-session-add-error');
      await expectAccessible(page);
    });
  });
});

test.describe('who may open a camp’s page', () => {
  function sentFrames(page: Page): string[] {
    const frames: string[] = [];
    page.on('websocket', (socket) => {
      socket.on('framesent', (frame) => {
        frames.push(String(frame.payload));
      });
    });
    return frames;
  }

  const noAccess = (page: Page) =>
    main(page).getByRole('heading', { level: 1, name: 'You can’t manage this camp' });

  async function organizerOf(page: Page, campSlugs: string[]) {
    const { user, tenant } = await memberOf(page, null);
    await seedCamps(tenant);
    await convexRun('testing:addLeagueOrganizer', {
      organizationSlug: tenant.slug,
      email: user.email,
      leagueSlugs: [],
      campSlugs,
    });
    return tenant;
  }

  test('a league organizer assigned to the camp opens it with the organizer sidebar, and adds a session', async ({
    page,
    isMobile,
  }, testInfo) => {
    const tenant = await organizerOf(page, [JUNIOR.slug]);
    await page.goto(campPage(tenant));
    await expect(main(page).getByRole('heading', { level: 1, name: JUNIOR.name })).toBeVisible();
    const crumbs = main(page).getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Your organizations' })).toHaveAttribute(
      'href',
      '/app',
    );
    if (isMobile) await page.getByRole('button', { name: 'Open navigation' }).click();
    const nav = page.getByRole('navigation', { name: `${tenant.name} camps` });
    await expect(nav.getByRole('link', { name: JUNIOR.name })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('link', { name: FALL.name })).toHaveCount(0);
    if (isMobile) await page.keyboard.press('Escape');
    await screenshot(page, testInfo, 'camp-organizer');
    await expectAccessible(page);

    await fillSession(page, WEEK_1);
    await page.locator('#add-session #places').fill('20');
    await addButton(page).click();
    await expect(sessionRows(page).locator('h3')).toHaveText(['Week 1']);
  });

  for (const [label, role] of [
    ['a league organizer assigned another camp', 'organizer'],
    ['a signed-in user with no membership', null],
  ] as const) {
    test(
      `${label} sees the no-access view, and no camp data is requested`,
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
        const tenant =
          role === 'organizer'
            ? await organizerOf(page, [FALL.slug])
            : await memberOf(page, null).then(async (member) => {
                await seedCamps(member.tenant);
                return member.tenant;
              });
        const frames = sentFrames(page);
        await page.goto(campPage(tenant));
        await expect(noAccess(page)).toBeVisible();
        expect(frames.join('\n')).toContain('camps:getForManagement');
        expect(frames.join('\n')).not.toContain('campSessions:listForCamp');
      },
    );
  }

  test('the no-access view passes the axe helper', async ({ page }, testInfo) => {
    const { tenant } = await memberOf(page, null);
    await seedCamps(tenant);
    await page.goto(campPage(tenant));
    await expect(noAccess(page)).toBeVisible();
    await screenshot(page, testInfo, 'camp-no-access');
    await expectAccessible(page);
  });

  test('an org admin of another organization sees the no-access view', async ({ page }) => {
    await memberOf(page, 'orgAdmin');
    const other = await seedTenant({ name: 'E2E Other Camps', locations: LOCATIONS });
    await seedCamps(other);
    await page.goto(campPage(other));
    await expect(noAccess(page)).toBeVisible();
  });

  test(
    'a signed-out visitor is sent to sign in, with the camp page as returnTo',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const tenant = await seedTenant({ name: 'E2E Camps Signed Out', locations: LOCATIONS });
      await seedCamps(tenant);
      await page.goto(campPage(tenant));
      await expect(page).toHaveURL(/\/sign-in\?/);
      expect(new URL(page.url()).searchParams.get('returnTo')).toBe(campPage(tenant));
    },
  );

  test('another organization’s camp slug under this organization is not found', async ({
    page,
  }, testInfo) => {
    const { tenant } = await memberOf(page, 'orgAdmin');
    const other = await seedTenant({ name: 'E2E Other Camps', locations: LOCATIONS });
    await seedCamp(other, { ...FALL, locations: [PELICAN], minimumAge: 9, maximumAge: 14 });
    await page.goto(campPage(tenant, FALL.slug));
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible();
    await screenshot(page, testInfo, 'camp-not-found');
    await expectAccessible(page);
  });
});
