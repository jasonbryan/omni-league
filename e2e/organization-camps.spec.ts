import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
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
    await expect(status).toHaveText('Junior Beach Volleyball Camp created.');
    await expect(page.locator('#name')).toHaveValue('');
    await expect(page.locator('#minimum-age')).toHaveValue('');
    await expect(submit(page)).toBeFocused();

    await expect(rows(page)).toHaveCount(1);
    const row = rows(page).first();
    await expect(row.locator('h3')).toHaveText('Junior Beach Volleyball Camp');
    await expect(row.locator('[data-slot="badge"]')).toHaveText('Draft');
    await expect(row).toContainText('Ages 9 to 14');
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
    await expect(camps.getByRole('link', { includeHidden: true })).toHaveCount(0);
  });
});
