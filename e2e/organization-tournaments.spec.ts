import type { Browser, Page } from '@playwright/test';
import { axeScan, describeViolations, expectAccessible } from './support/a11y';
import { chipLabel, chooseChip } from './support/chip';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { failFirstAnswer } from './support/fail-first-answer';
import { failMutation } from './support/fail-mutation';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { screenshot } from './support/screenshot';
import { otherUser, signUp } from './support/session';
import { dateFromToday, seedTenant, type TenantSeed } from './support/tenant';
import { seedTournament } from './support/tournament';
import { newUser, seedUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LOCATIONS = [
  {
    name: 'Pelican Shoals Sand Courts',
    address: '2150 Pelican Shoals Dr, Corpus Christi, TX 78418',
  },
];

type Role = 'orgAdmin' | 'leagueOrganizer';

async function memberOf(page: Page, role: Role | null, seed: TenantSeed = {}) {
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenant({ name: 'E2E Tournaments', locations: LOCATIONS, ...seed });
  if (role) {
    await convexRun('testing:addMembership', {
      organizationSlug: tenant.slug,
      email: user.email,
      role,
    });
  }
  return { user, tenant, url: `/app/organizations/${tenant.slug}/tournaments` };
}

const main = (page: Page) => page.getByRole('main');
const form = (page: Page) => page.locator('#create-tournament form');
const submit = (page: Page) => form(page).getByRole('button', { name: /^Create draft tournament/ });
const rows = (page: Page) => page.locator('#tournaments-list > li');

async function fillValid(page: Page, name: string) {
  await page.locator('#name').fill(name);
  await chooseChip(chipLabel(page, 'Beach volleyball'));
  await chooseChip(chipLabel(page, '2v2'));
  await page.locator('#start-date').fill('2031-01-16');
  await page.locator('#end-date').fill('2031-01-17');
  await page.locator('#registration-deadline').fill('2031-01-09');
  await page.locator('#maximum-teams').fill('16');
}

test.describe('Tournaments: creating a draft', () => {
  test('an org admin creates a draft: it is listed as Draft, the status names it, and the form is cleared', async ({
    page,
  }, testInfo) => {
    const { tenant, url } = await memberOf(page, 'orgAdmin');
    await page.goto(url);
    await expect(page).toHaveTitle(`Tournaments | ${tenant.name} | Omni League`);
    await expect(page.getByText('No tournaments yet')).toBeVisible();
    await expect(
      page.getByText('Create a tournament to run a one-time event with a bracket.'),
    ).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Pelican Shoals Sand Courts' })).toBeChecked();
    await screenshot(page, testInfo, 'tournaments-empty');
    await expectAccessible(page);

    await fillValid(page, 'Winter Doubles Classic');
    await screenshot(page, testInfo, 'tournaments-filled');
    await submit(page).click();

    const status = form(page).getByRole('status').filter({ hasText: 'created' });
    await expect(status).toHaveText(
      'Winter Doubles Classic created. It stays a draft until you publish it.Open Winter Doubles Classic',
    );
    await expect(page.locator('#name')).toHaveValue('');
    await expect(page.locator('#maximum-teams')).toHaveValue('');
    await expect(submit(page)).toBeFocused();

    await expect(rows(page)).toHaveCount(1);
    const row = rows(page).first();
    await expect(row.locator('h3')).toHaveText('Winter Doubles Classic');
    await expect(row.locator('[data-slot="badge"]')).toHaveText('Draft');
    await expect(row).toContainText('Jan 16 – Jan 17, 2031');
    await screenshot(page, testInfo, 'tournaments-created');
    await expectAccessible(page);
  });

  test('a blank end date makes a one-day tournament', VIEWPORT_AGNOSTIC, async ({ page }) => {
    const { url } = await memberOf(page, 'orgAdmin');
    await page.goto(url);
    await fillValid(page, 'One Day Open');
    await page.locator('#end-date').fill('');
    await submit(page).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Jan 16, 2031');
  });

  test(
    'an end date before the start, a deadline after it, and a maximum outside 2 to 128 show under the field on leaving it',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { url } = await memberOf(page, 'orgAdmin');
      await page.goto(url);
      await page.locator('#start-date').fill('2031-01-16');
      await page.locator('#end-date').fill('2031-01-15');
      await page.locator('#registration-deadline').fill('2031-01-17');
      await page.locator('#maximum-teams').fill('129');
      await page.locator('#maximum-teams').blur();
      await expect(page.locator('#end-date-error')).toHaveText(
        'The end date must be on or after the start date.',
      );
      await expect(page.locator('#registration-deadline-error')).toHaveText(
        'The registration deadline must be on or before the start date, Jan 16, 2031.',
      );
      await expect(page.locator('#maximum-teams-error')).toHaveText(
        'Enter a whole number from 2 to 128.',
      );
      await page.locator('#maximum-teams').fill('128');
      await expect(page.locator('#maximum-teams-error')).toHaveCount(0);
    },
  );

  test('an empty submit shows every message and sends nothing', async ({ page }, testInfo) => {
    const { url } = await memberOf(page, 'orgAdmin');
    await page.goto(url);
    await submit(page).click();
    await expect(page.locator('#name-error')).toBeVisible();
    await expect(page.locator('#start-date-error')).toHaveText('Enter the start date.');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.locator('#name')).toBeFocused();
    await screenshot(page, testInfo, 'tournaments-errors');
    await expectAccessible(page);
  });

  test.describe('a web address held by a league or a tournament of the organization', () => {
    test('shows "is already taken" under Web address, for a league and for a tournament', async ({
      page,
    }) => {
      const { url } = await memberOf(page, 'orgAdmin', {
        leagues: [{ name: 'Sand 4s', sport: 'beachVolleyball', locations: [LOCATIONS[0].name] }],
      });
      await page.goto(url);
      await page.locator('#name').fill('Sand 4s');
      await expect(page.locator('#slug-error')).toHaveText(
        'sand-4s is already taken. Choose another web address.',
      );

      await page.locator('#name').fill('Winter Doubles Classic');
      await expect(page.locator('#slug-error')).toHaveCount(0);
      await fillValid(page, 'Winter Doubles Classic');
      await submit(page).click();
      await expect(rows(page)).toHaveCount(1);

      await page.locator('#name').fill('Winter Doubles Classic');
      await expect(page.locator('#slug-error')).toHaveText(
        'winter-doubles-classic is already taken. Choose another web address.',
      );
    });
  });
});

test.describe('Tournaments: loading', () => {
  test('the list and the form show skeletons while their answers are held, and the state passes the axe helper', async ({
    page,
  }, testInfo) => {
    const { url } = await memberOf(page, 'orgAdmin');
    const held = await holdQueries(page, [
      'tournaments:listForOrganization',
      'locations:listForAdmin',
    ]);
    await page.goto(url);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading the tournaments.' }),
    ).toBeAttached();
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading the locations.' }),
    ).toBeAttached();
    await expect(page.getByText('No tournaments yet')).toHaveCount(0);
    await expect(form(page)).toHaveCount(0);
    await screenshot(page, testInfo, 'tournaments-loading');
    await expectAccessible(page);

    held.release();
    await expect(page.getByText('No tournaments yet')).toBeVisible();
    await expect(form(page)).toBeVisible();
  });
});

test.describe('Tournaments: the failure states', () => {
  test('a list that fails to load shows the alert and passes the axe helper', async ({
    page,
  }, testInfo) => {
    const { url } = await memberOf(page, 'orgAdmin');
    await failFirstAnswer(page, 'tournaments:listForOrganization');
    await page.goto(url);
    const alert = page.locator('section[aria-labelledby="tournaments-heading"] [role="alert"]');
    await expect(alert).toContainText('The tournaments could not be loaded.');
    await screenshot(page, testInfo, 'tournaments-load-error');
    await expectAccessible(page);
  });

  test('pressing Create offline shows the offline alert, keeps the input, and passes the axe helper', async ({
    page,
    context,
  }, testInfo) => {
    const { url } = await memberOf(page, 'orgAdmin');
    await page.goto(url);
    await fillValid(page, 'Winter Doubles Classic');
    await context.setOffline(true);
    await expect(submit(page)).toHaveAttribute('aria-disabled', 'true');
    // `force`: Playwright treats aria-disabled as not actionable, and the page must answer the press.
    await submit(page).click({ force: true });
    const alert = form(page).getByRole('alert');
    await expect(alert).toContainText("You're offline. Nothing was sent.");
    await expect(page.locator('#name')).toHaveValue('Winter Doubles Classic');
    await screenshot(page, testInfo, 'tournaments-offline');
    await expectAccessible(page);
    await context.setOffline(false);
  });
});

test.describe('Tournaments: a create the server fails', () => {
  test.use({ expectedConvexErrors: ['tournaments:create'] });

  test('a create the server fails keeps the input, and the alert passes the axe helper', async ({
    page,
  }, testInfo) => {
    const { url } = await memberOf(page, 'orgAdmin');
    await failMutation(page, 'tournaments:create');
    await page.goto(url);
    await fillValid(page, 'Winter Doubles Classic');
    await submit(page).click();
    const alert = form(page).getByRole('alert');
    await expect(alert).toContainText('The tournament could not be created.');
    await expect(page.locator('#name')).toHaveValue('Winter Doubles Classic');
    await screenshot(page, testInfo, 'tournaments-create-error');
    await expectAccessible(page);
  });
});

test.describe('who may open Tournaments', () => {
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
      `${label} sees the no-access view, and no tournament data is requested`,
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
        const { url } = await memberOf(page, role);
        const frames = sentFrames(page);
        await page.goto(url);
        await expect(
          main(page).getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
        ).toBeVisible();
        expect(frames.join('\n')).toContain('organizations:getAdminContext');
        expect(frames.join('\n')).not.toContain('tournaments:listForOrganization');
      },
    );
  }

  test('the no-access view passes the axe helper', async ({ page }, testInfo) => {
    const { url } = await memberOf(page, null);
    await page.goto(url);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
    ).toBeVisible();
    await screenshot(page, testInfo, 'tournaments-no-access');
    await expectAccessible(page);
  });
});

test.describe('the admin sidebar', () => {
  test(
    'groups Leagues and Tournaments under Programs, keeping the Leagues URL',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { tenant, url } = await memberOf(page, 'orgAdmin');
      await page.goto(url);
      const nav = page.getByRole('navigation', { name: `${tenant.name} admin` });
      const programs = nav.getByRole('list', { name: 'Programs' });
      await expect(programs.getByRole('link', { name: /^Tournaments/ })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(programs.getByRole('link', { name: /^Leagues/ })).toHaveAttribute(
        'href',
        `/app/organizations/${tenant.slug}/leagues`,
      );
    },
  );
});

const PELICAN = LOCATIONS[0].name;

async function managedBy(page: Page, role: Role | null) {
  const { user, tenant } = await memberOf(page, role);
  const publicPath = await seedTournament(tenant, {
    name: 'Winter Doubles Classic',
    slug: 'winter-doubles-classic',
    locations: [PELICAN],
    division: { gender: 'coed', playersPerSide: 2, level: 'open', ageGroup: 'adult' },
    startDate: dateFromToday(40),
    endDate: dateFromToday(41),
    registrationDeadline: dateFromToday(30),
    status: 'draft',
  });
  return {
    user,
    tenant,
    publicPath,
    managePath: `/app/organizations/${tenant.slug}/tournaments/winter-doubles-classic`,
  };
}

const publishDialog = (page: Page) => page.getByRole('alertdialog');
const publishButton = (page: Page) => main(page).getByRole('button', { name: 'Publish' });
const stateBadge = (page: Page) => main(page).locator('h1 + div [data-slot="badge"]').first();

test.describe('Tournaments: the management page and Publish', () => {
  test('an org admin publishes: Cancel changes nothing, Publish confirms, and the public page then answers 200', async ({
    page,
  }, testInfo) => {
    const { tenant, publicPath, managePath } = await managedBy(page, 'orgAdmin');
    await page.goto(managePath);
    await expect(page).toHaveTitle(`Winter Doubles Classic | ${tenant.name} | Omni League`);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'Winter Doubles Classic' }),
    ).toBeVisible();
    await expect(stateBadge(page)).toHaveText('Draft');
    await expect(main(page).getByText('Coed · 2v2 · Open')).toBeVisible();
    await expect(main(page).getByText(LOCATIONS[0].address)).toBeVisible();
    await screenshot(page, testInfo, 'tournament-draft');
    await expectAccessible(page);
    expect((await page.request.get(publicPath)).status()).toBe(404);

    await publishButton(page).click();
    await expect(publishDialog(page)).toContainText('Publish Winter Doubles Classic?');
    await expect(publishDialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
    await screenshot(page, testInfo, 'tournament-publish-dialog');
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    await publishDialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(publishDialog(page)).toHaveCount(0);
    await expect(publishButton(page)).toBeFocused();
    await expect(stateBadge(page)).toHaveText('Draft');
    expect((await page.request.get(publicPath)).status()).toBe(404);

    await publishButton(page).click();
    await publishDialog(page).getByRole('button', { name: 'Publish tournament' }).click();
    await expect(publishDialog(page)).toHaveCount(0);
    await expect(stateBadge(page)).toHaveText('Published');
    const notice = main(page).getByRole('status').filter({ hasText: 'is published.' });
    await expect(notice).toContainText('Winter Doubles Classic is published.');
    await expect(notice).toBeFocused();
    await expect(publishButton(page)).toHaveCount(0);
    await screenshot(page, testInfo, 'tournament-published');
    await expectAccessible(page);
    expect((await page.request.get(publicPath)).status()).toBe(200);

    await notice.getByRole('link', { name: 'View public page' }).click();
    await expect(page).toHaveURL(publicPath);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Winter Doubles Classic' }),
    ).toBeVisible();
    await expect(page.locator('#registration')).toContainText('Registration open · closes');
  });

  test('the Publish dialog traps Tab and Shift+Tab, and Escape closes it and returns focus to Publish', async ({
    page,
  }) => {
    const { managePath, publicPath } = await managedBy(page, 'orgAdmin');
    await page.goto(managePath);
    await publishButton(page).click();
    await expect(publishDialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
    const focusIsInDialog = () =>
      page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]'));
    for (const key of ['Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      expect(await focusIsInDialog()).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(publishDialog(page)).toHaveCount(0);
    await expect(publishButton(page)).toBeFocused();
    await expect(stateBadge(page)).toHaveText('Draft');
    expect((await page.request.get(publicPath)).status()).toBe(404);
  });

  test('a tournament created on the Tournaments page opens from its status', async ({ page }) => {
    const { tenant, url } = await memberOf(page, 'orgAdmin');
    await page.goto(url);
    await fillValid(page, 'Winter Doubles Classic');
    await submit(page).click();
    await form(page).getByRole('link', { name: 'Open Winter Doubles Classic' }).click();
    await expect(page).toHaveURL(`${url}/winter-doubles-classic`);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'Winter Doubles Classic' }),
    ).toBeVisible();
    await expect(stateBadge(page)).toHaveText('Draft');
    await expect(
      page
        .getByRole('navigation', { name: 'Breadcrumb' })
        .getByRole('link', { name: 'Tournaments', exact: true }),
    ).toHaveAttribute('href', `/app/organizations/${tenant.slug}/tournaments`);
  });

  test(
    'a row of the Tournaments list opens the tournament, and the sidebar keeps Tournaments current',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { tenant, managePath } = await managedBy(page, 'orgAdmin');
      await page.goto(`/app/organizations/${tenant.slug}/tournaments`);
      await rows(page).getByRole('link', { name: 'Winter Doubles Classic' }).click();
      await expect(page).toHaveURL(managePath);
      await expect(
        page
          .getByRole('navigation', { name: `${tenant.name} admin` })
          .getByRole('link', { name: /^Tournaments/ }),
      ).toHaveAttribute('aria-current', 'true');
    },
  );

  test('an unknown web address shows the not-found view', async ({ page }) => {
    const { tenant } = await managedBy(page, 'orgAdmin');
    await page.goto(`/app/organizations/${tenant.slug}/tournaments/no-such-tournament`);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible();
  });

  test('the page shows a skeleton with its status while the answer is held', async ({
    page,
  }, testInfo) => {
    const { managePath } = await managedBy(page, 'orgAdmin');
    const held = await holdQueries(page, ['tournaments:getForManagement']);
    await page.goto(managePath);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading the tournament.' }),
    ).toBeAttached();
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveCount(0);
    await screenshot(page, testInfo, 'tournament-loading');
    await expectAccessible(page);
    held.release();
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'Winter Doubles Classic' }),
    ).toBeVisible();
  });

  test.describe('a publish the server fails', () => {
    test.use({ expectedConvexErrors: ['tournaments:publish'] });

    test('shows the alert in the dialog, keeps the draft, and passes the axe helper', async ({
      page,
    }, testInfo) => {
      const { managePath, publicPath } = await managedBy(page, 'orgAdmin');
      await failMutation(page, 'tournaments:publish');
      await page.goto(managePath);
      await publishButton(page).click();
      await publishDialog(page).getByRole('button', { name: 'Publish tournament' }).click();
      const alert = publishDialog(page).getByRole('alert');
      await expect(alert).toContainText('The tournament could not be published.');
      await expect(alert).toBeFocused();
      await screenshot(page, testInfo, 'tournament-publish-error');
      expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
      expect((await page.request.get(publicPath)).status()).toBe(404);
    });
  });

  test('pressing Publish offline shows the offline alert and keeps the draft', async ({
    page,
    context,
  }) => {
    const { managePath, publicPath } = await managedBy(page, 'orgAdmin');
    await page.goto(managePath);
    await publishButton(page).click();
    await context.setOffline(true);
    const confirm = publishDialog(page).getByRole('button', { name: 'Publish tournament' });
    await expect(confirm).toHaveAttribute('aria-disabled', 'true');
    // `force`: Playwright treats aria-disabled as not actionable, and the page must answer the press.
    await confirm.click({ force: true });
    await expect(publishDialog(page).getByRole('alert')).toContainText(
      "You're offline. Nothing was sent.",
    );
    await context.setOffline(false);
    expect((await page.request.get(publicPath)).status()).toBe(404);
  });
});

async function assignedTo(page: Page, tournamentSlugs: string[]) {
  const managed = await managedBy(page, null);
  await seedTournament(managed.tenant, {
    name: 'Spring Open',
    slug: 'spring-open',
    locations: [PELICAN],
    startDate: dateFromToday(80),
    endDate: dateFromToday(80),
    registrationDeadline: dateFromToday(70),
    status: 'draft',
  });
  await convexRun('testing:addLeagueOrganizer', {
    organizationSlug: managed.tenant.slug,
    email: managed.user.email,
    leagueSlugs: [],
    tournamentSlugs,
  });
  return managed;
}

test.describe('who may open a tournament’s management page', () => {
  for (const [label, role] of [
    ['a league organizer of the organization who is assigned no tournament', 'leagueOrganizer'],
    ['a signed-in user with no membership', null],
  ] as const) {
    test(`${label} sees the no-access view, and no tournament data reaches the page`, async ({
      page,
    }, testInfo) => {
      const { managePath } = await managedBy(page, role);
      const received: string[] = [];
      page.on('websocket', (socket) => {
        socket.on('framereceived', (frame) => {
          received.push(String(frame.payload));
        });
      });
      await page.goto(managePath);
      await expect(
        main(page).getByRole('heading', { level: 1, name: 'You can’t manage this tournament' }),
      ).toBeVisible();
      await expect(main(page).getByText('Winter Doubles Classic')).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: /admin$/ })).toHaveCount(0);
      expect(received.join('\n')).not.toContain('Pelican Shoals Sand Courts');
      await screenshot(page, testInfo, 'tournament-no-access');
      await expectAccessible(page);
    });
  }

  test('a league organizer assigned to another tournament only sees the no-access view, and Publish is refused', async ({
    page,
  }) => {
    const { managePath, publicPath } = await assignedTo(page, ['spring-open']);
    await page.goto(managePath);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'You can’t manage this tournament' }),
    ).toBeVisible();
    await expect(publishButton(page)).toHaveCount(0);
    expect((await page.request.get(publicPath)).status()).toBe(404);
  });

  test('an org admin of another organization sees the no-access view too', async ({ page }) => {
    const { user, managePath } = await managedBy(page, null);
    const other = await seedTenant({ name: 'E2E Other Tournaments', locations: LOCATIONS });
    await convexRun('testing:addMembership', {
      organizationSlug: other.slug,
      email: user.email,
      role: 'orgAdmin',
    });
    await page.goto(managePath);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'You can’t manage this tournament' }),
    ).toBeVisible();
  });

  test(
    'a signed-out visitor is sent to sign in, with the page as returnTo',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const tenant = await seedTenant({ name: 'E2E Signed Out', locations: LOCATIONS });
      const managePath = `/app/organizations/${tenant.slug}/tournaments/winter-doubles-classic`;
      await page.goto(managePath);
      await expect(page).toHaveURL(/\/sign-in\?/);
      expect(new URL(page.url()).searchParams.get('returnTo')).toBe(managePath);
    },
  );
});

const PELICAN_AND_REDFISH = [
  ...LOCATIONS,
  { name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX 78382' },
];

async function copyable(page: Page, role: Role | null = 'orgAdmin') {
  const { user, tenant } = await memberOf(page, role, { locations: PELICAN_AND_REDFISH });
  await seedTournament(tenant, {
    name: 'Gulf Coast Beach Open',
    slug: 'gulf-coast-beach-open',
    locations: ['Redfish Flats Fields'],
    division: { gender: 'coed', playersPerSide: 2, level: 'open', ageGroup: 'adult' },
    startDate: dateFromToday(40),
    endDate: dateFromToday(41),
    registrationDeadline: dateFromToday(30),
    maximumTeams: 12,
  });
  const tournaments = `/app/organizations/${tenant.slug}/tournaments`;
  return {
    user,
    tenant,
    tournaments,
    managePath: `${tournaments}/gulf-coast-beach-open`,
    copyPath: `${tournaments}?copyOf=gulf-coast-beach-open#create-tournament`,
  };
}

const copyLink = (page: Page) => main(page).getByRole('link', { name: 'Copy to a new tournament' });
const copyNote = (page: Page) => form(page).locator('[data-slot="copy-note"]');

test.describe('Tournaments: copying one to run it again', () => {
  test('Copy opens the form filled with blank dates and the next free address, and creating it adds a new draft', async ({
    page,
  }, testInfo) => {
    const { tournaments, managePath } = await copyable(page);
    await page.goto(managePath);
    await expect(copyLink(page)).toBeVisible();
    await screenshot(page, testInfo, 'tournament-copy-action');
    await expectAccessible(page);

    await copyLink(page).click();
    await expect(page).toHaveURL(`${tournaments}?copyOf=gulf-coast-beach-open#create-tournament`);
    await expect(page.locator('#name')).toHaveValue('Gulf Coast Beach Open');
    await expect(page.locator('#slug')).toHaveValue('gulf-coast-beach-open-2');
    await expect(chipLabel(page, 'Beach volleyball').getByRole('radio')).toBeChecked();
    await expect(chipLabel(page, '2v2').getByRole('radio')).toBeChecked();
    await expect(chipLabel(page, 'Open').getByRole('radio')).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Redfish Flats Fields' })).toBeChecked();
    await expect(
      page.getByRole('checkbox', { name: 'Pelican Shoals Sand Courts' }),
    ).not.toBeChecked();
    await expect(page.locator('#maximum-teams')).toHaveValue('12');
    for (const id of ['#start-date', '#end-date', '#registration-deadline']) {
      await expect(page.locator(id)).toHaveValue('');
    }
    await expect(copyNote(page)).toContainText('Copied from Gulf Coast Beach Open.');
    await screenshot(page, testInfo, 'tournament-copy-form');
    await expectAccessible(page);

    await submit(page).click();
    await expect(page.locator('#start-date-error')).toHaveText('Enter the start date.');
    await expect(page.locator('#start-date')).toBeFocused();
    await expect(rows(page)).toHaveCount(1);

    await page.locator('#start-date').fill('2031-06-12');
    await page.locator('#end-date').fill('2031-06-13');
    await page.locator('#registration-deadline').fill('2031-06-05');
    await submit(page).click();
    await expect(form(page).getByRole('status').filter({ hasText: 'created' })).toHaveText(
      'Gulf Coast Beach Open created. It stays a draft until you publish it.Open Gulf Coast Beach Open',
    );
    await expect(rows(page)).toHaveCount(2);
    const added = rows(page).filter({ hasText: 'Jun 12 – Jun 13, 2031' });
    await expect(added.locator('[data-slot="badge"]')).toHaveText('Draft');
    await expect(rows(page).filter({ hasText: 'Published' })).toHaveCount(1);
    await screenshot(page, testInfo, 'tournament-copy-created');
    await expectAccessible(page);

    await form(page).getByRole('link', { name: 'Open Gulf Coast Beach Open' }).click();
    await expect(page).toHaveURL(`${tournaments}/gulf-coast-beach-open-2`);
    await expect(stateBadge(page)).toHaveText('Draft');
    await expect(main(page).getByText('Up to 12 teams')).toBeVisible();
    await expect(main(page).getByText('Redfish Flats Fields')).toBeVisible();
  });

  test(
    'a copy stays off the organization page as a draft and, once published, is listed under Tournaments with the source’s sport',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { tenant, copyPath } = await copyable(page);
      const section = page.locator('#tournaments');
      const names = section.locator(':scope > ul > li h3');
      await page.goto(copyPath);
      await page.locator('#start-date').fill('2031-06-12');
      await page.locator('#registration-deadline').fill('2031-06-05');
      await submit(page).click();
      await expect(rows(page)).toHaveCount(2);
      await expect(
        rows(page).filter({ hasText: 'Jun 12, 2031' }).locator('[data-slot="badge"]'),
      ).toHaveText('Draft');

      await page.goto(`/organizations/${tenant.slug}`);
      await expect(names).toHaveText(['Gulf Coast Beach Open']);

      await page.goto(`/app/organizations/${tenant.slug}/tournaments/gulf-coast-beach-open-2`);
      await publishButton(page).click();
      await publishDialog(page).getByRole('button', { name: 'Publish tournament' }).click();
      await expect(stateBadge(page)).toHaveText('Published');

      await page.goto(`/organizations/${tenant.slug}`);
      await expect(names).toHaveText(['Gulf Coast Beach Open', 'Gulf Coast Beach Open']);
      const copy = section.locator(':scope > ul > li').nth(1);
      await expect(copy).toContainText('Beach volleyball');
      await expect(copy).toContainText('Jun 12, 2031');
      expect(
        (
          await page.request.get(
            `/organizations/${tenant.slug}/tournaments/gulf-coast-beach-open-2`,
          )
        ).status(),
      ).toBe(200);
    },
  );

  test(
    'a web address that is another organization’s tournament or unknown opens the form empty',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { tournaments } = await copyable(page);
      const other = await seedTenant({ name: 'E2E Other Org', locations: LOCATIONS });
      await seedTournament(other, {
        name: 'Other Open',
        slug: 'other-open',
        locations: [PELICAN],
        startDate: dateFromToday(40),
        endDate: dateFromToday(40),
      });
      for (const slug of ['other-open', 'no-such-tournament']) {
        await page.goto(`${tournaments}?copyOf=${slug}#create-tournament`);
        await expect(form(page)).toBeVisible();
        await expect(page.locator('#name')).toHaveValue('');
        await expect(page.locator('#slug')).toHaveValue('');
        await expect(copyNote(page)).toHaveCount(0);
        await expect(page.locator('#create-tournament').getByRole('alert')).toHaveCount(0);
      }
    },
  );

  test('the form shows a skeleton while the source is held, and the state passes the axe helper', async ({
    page,
  }, testInfo) => {
    const { copyPath } = await copyable(page);
    const held = await holdQueries(page, ['tournaments:getForCopy']);
    await page.goto(copyPath);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading the tournament to copy.' }),
    ).toBeAttached();
    await expect(form(page)).toHaveCount(0);
    await screenshot(page, testInfo, 'tournament-copy-loading');
    await expectAccessible(page);

    held.release();
    await expect(form(page)).toBeVisible();
    await expect(page.locator('#name')).toHaveValue('Gulf Coast Beach Open');
  });

  test('a source that fails to load opens the form empty with an alert that passes the axe helper', async ({
    page,
  }, testInfo) => {
    const { copyPath } = await copyable(page);
    await failFirstAnswer(page, 'tournaments:getForCopy');
    await page.goto(copyPath);
    const alert = page.locator('#create-tournament').getByRole('alert');
    await expect(alert).toContainText('The tournament to copy could not be loaded.');
    await expect(form(page)).toBeVisible();
    await expect(page.locator('#name')).toHaveValue('');
    await screenshot(page, testInfo, 'tournament-copy-error');
    await expectAccessible(page);
  });

  test(
    'a league organizer opening the copy address sees the no-access view and no Copy action',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { copyPath, managePath } = await copyable(page, 'leagueOrganizer');
      for (const [path, heading] of [
        [copyPath, 'You can’t manage this organization'],
        [managePath, 'You can’t manage this tournament'],
      ]) {
        await page.goto(path);
        await expect(main(page).getByRole('heading', { level: 1, name: heading })).toBeVisible();
        await expect(copyLink(page)).toHaveCount(0);
        await expect(form(page)).toHaveCount(0);
      }
    },
  );
});

test.describe('an assigned league organizer', () => {
  test('manages and publishes the tournament, with the organizer sidebar and a breadcrumb they can follow', async ({
    page,
  }, testInfo) => {
    const { tenant, managePath, publicPath } = await assignedTo(page, ['winter-doubles-classic']);
    await page.goto(managePath);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'Winter Doubles Classic' }),
    ).toBeVisible();
    await expect(stateBadge(page)).toHaveText('Draft');
    await expect(copyLink(page)).toHaveCount(0);
    const crumbs = main(page).getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs.getByRole('link', { name: 'Your organizations' })).toHaveAttribute(
      'href',
      '/app',
    );
    await expect(crumbs.getByRole('link', { name: 'Winter Doubles Classic' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The sidebar is the phone sheet's content below 1024px, so it is read hidden.
    const nav = page.getByRole('navigation', {
      name: `${tenant.name} tournaments`,
      includeHidden: true,
    });
    const mine = nav.getByRole('list', { name: 'Your tournaments', includeHidden: true });
    await expect(mine.getByRole('link', { includeHidden: true })).toHaveCount(1);
    await expect(
      mine.getByRole('link', { name: 'Winter Doubles Classic', includeHidden: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Staff', includeHidden: true })).toHaveCount(0);
    await screenshot(page, testInfo, 'tournament-organizer');
    await expectAccessible(page);

    await publishButton(page).click();
    await publishDialog(page).getByRole('button', { name: 'Publish tournament' }).click();
    await expect(stateBadge(page)).toHaveText('Published');
    expect((await page.request.get(publicPath)).status()).toBe(200);
  });

  test('cannot open the admin area, and Home links to their tournament', async ({ page }) => {
    const { tenant, managePath } = await assignedTo(page, ['winter-doubles-classic']);
    await page.goto(`/app/organizations/${tenant.slug}/tournaments`);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
    ).toBeVisible();
    await page.goto('/app');
    await expect(
      page.getByRole('link', { name: tenant.name, includeHidden: true }).first(),
    ).toHaveAttribute('href', managePath);
  });
});

test.describe('Tournaments: editing the details', () => {
  const editForm = (page: Page) => page.locator('#edit-details form');
  const field = (page: Page, id: string) => page.locator(`#details-${id}`);
  const saveButton = (page: Page) => editForm(page).getByRole('button', { name: /^Save changes/ });
  const saveStatus = (page: Page) => editForm(page).locator('[data-slot="save-status"]');
  const undoButton = (page: Page) => editForm(page).getByRole('button', { name: 'Undo' });

  async function publishedWithTeams(page: Page, teams: number) {
    const { user, tenant } = await memberOf(page, 'orgAdmin');
    const publicPath = await seedTournament(tenant, {
      name: 'Gulf Coast Beach Open',
      slug: 'gulf-coast-beach-open',
      locations: [PELICAN],
      startDate: dateFromToday(40),
      endDate: dateFromToday(41),
      registrationDeadline: dateFromToday(30),
      maximumTeams: 4,
    });
    for (let i = 1; i <= teams; i++) await seedTournamentTeam(tenant, i);
    return {
      user,
      tenant,
      publicPath,
      managePath: `/app/organizations/${tenant.slug}/tournaments/gulf-coast-beach-open`,
    };
  }

  async function seedTournamentTeam(tenant: { slug: string }, index: number) {
    const captain = await seedUser(newUser(`Captain ${index}`));
    await convexRun('testing:seedTournamentTeam', {
      organizationSlug: tenant.slug,
      tournamentSlug: 'gulf-coast-beach-open',
      name: `Team ${index}`,
      captainEmail: captain.email,
    });
  }

  async function register(browser: Browser, tenant: { slug: string }, name: string) {
    const captain = await otherUser(browser, newUser('Captain'));
    await captain.goto(
      `/app/organizations/${tenant.slug}/tournaments/gulf-coast-beach-open/register`,
    );
    await captain.locator('#team-name').fill(name);
    await captain.getByRole('button', { name: 'Register team' }).click();
    await expect(captain.getByRole('heading', { level: 1, name })).toBeVisible();
    await captain.context().close();
  }

  test('an org admin raises the maximum from 4 to 6, and two more teams register', async ({
    page,
    browser,
  }, testInfo) => {
    const { tenant, publicPath, managePath } = await publishedWithTeams(page, 4);
    await page.goto(publicPath);
    await expect(page.locator('#registration').locator('p').first()).toHaveText('Full');

    await page.goto(managePath);
    await expect(field(page, 'maximum-teams')).toHaveValue('4');
    await expect(field(page, 'start-date')).toHaveValue(dateFromToday(40));
    await expect(editForm(page).locator('[data-slot="structure"]')).toHaveText(/Bracket only/);
    await screenshot(page, testInfo, 'tournament-edit-details');
    await expectAccessible(page);

    await field(page, 'maximum-teams').fill('6');
    await chooseChip(chipLabel(page, '3 sets'));
    await saveButton(page).click();
    await expect(saveStatus(page)).toContainText('Details saved.');
    await expect(undoButton(page)).toBeVisible();
    await expect(main(page).locator('dl')).toContainText('Up to 6 teams');
    await screenshot(page, testInfo, 'tournament-edit-details-saved');
    await expectAccessible(page);

    await page.goto(publicPath);
    await expect(page.locator('#registration')).toContainText('Registration open');
    await register(browser, tenant, 'Fifth Team');
    await register(browser, tenant, 'Sixth Team');
    await page.reload();
    await expect(page.locator('#registration').locator('p').first()).toHaveText('Full');
  });

  test('a maximum below the team count shows under the field on leaving it, and the form sends nothing', async ({
    page,
  }, testInfo) => {
    const { managePath } = await publishedWithTeams(page, 3);
    await page.goto(managePath);
    await field(page, 'maximum-teams').fill('2');
    await field(page, 'maximum-teams').blur();
    await expect(page.locator('#details-maximum-teams-error')).toHaveText(
      '3 teams are registered. Enter 3 or more.',
    );
    await saveButton(page).click();
    await expect(field(page, 'maximum-teams')).toBeFocused();
    await expect(saveStatus(page)).toHaveText('');
    await screenshot(page, testInfo, 'tournament-edit-details-error');
    await expectAccessible(page);
    await field(page, 'maximum-teams').fill('3');
    await expect(page.locator('#details-maximum-teams-error')).toHaveCount(0);
  });

  test(
    'an end date before the start and a deadline after it show under their fields',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { managePath } = await publishedWithTeams(page, 0);
      await page.goto(managePath);
      await field(page, 'end-date').fill(dateFromToday(39));
      await field(page, 'end-date').blur();
      await field(page, 'registration-deadline').fill(dateFromToday(41));
      await field(page, 'registration-deadline').blur();
      await expect(page.locator('#details-end-date-error')).toHaveText(
        'The end date must be on or after the start date.',
      );
      await expect(page.locator('#details-registration-deadline-error')).toContainText(
        'The registration deadline must be on or before the start date',
      );
    },
  );

  test.describe('an Undo the server refuses', () => {
    test.use({ expectedConvexErrors: ['tournaments:undoUpdateDetails'] });

    test('Undo brings the earlier values back, and is refused with the reason once teams fill the earlier maximum', async ({
      page,
    }, testInfo) => {
      const { tenant, managePath } = await publishedWithTeams(page, 3);
      await page.goto(managePath);
      await field(page, 'maximum-teams').fill('6');
      await saveButton(page).click();
      await expect(saveStatus(page)).toContainText('Details saved.');
      await undoButton(page).click();
      await expect(saveStatus(page)).toContainText('Earlier details restored.');
      await expect(saveStatus(page).locator('[tabindex="-1"]')).toBeFocused();
      await expect(field(page, 'maximum-teams')).toHaveValue('4');

      await field(page, 'maximum-teams').fill('6');
      await saveButton(page).click();
      await expect(undoButton(page)).toBeVisible();
      await seedTournamentTeam(tenant, 4);
      await seedTournamentTeam(tenant, 5);
      await seedTournamentTeam(tenant, 6);
      await undoButton(page).click();
      await expect(saveStatus(page)).toContainText('6 teams are registered. Enter 6 or more.');
      await expect(field(page, 'maximum-teams')).toHaveValue('6');
      await screenshot(page, testInfo, 'tournament-edit-details-undo-refused');
      await expectAccessible(page);
    });
  });

  test.describe('a save refused as out of date', () => {
    test.use({ expectedConvexErrors: ['tournaments:updateDetails'] });

    test('a form loaded before another editor saved is refused with the alert, and saving again works', async ({
      page,
    }, testInfo) => {
      const { managePath } = await publishedWithTeams(page, 0);
      await page.goto(managePath);
      const held = await holdQueries(page, ['tournaments:getForManagement']);
      await page.reload();
      await expect.poll(() => held.isHolding()).toBe(true);
      held.release();
      await expect(field(page, 'maximum-teams')).toHaveValue('4');
      await field(page, 'maximum-teams').fill('9');
      await convexRun('testing:setTournamentMaximumTeams', {
        organizationSlug: managePath.split('/')[3],
        tournamentSlug: 'gulf-coast-beach-open',
        maximumTeams: 12,
      });
      await expect(page.getByRole('main').getByText('Up to 12 teams')).toBeVisible();
      await expect(field(page, 'maximum-teams')).toHaveValue('9');
      await saveButton(page).click();
      const alert = editForm(page).getByRole('alert');
      await expect(alert).toContainText(
        'Someone else changed this tournament while you were editing.',
      );
      await expect(alert).toBeFocused();
      await expect(field(page, 'maximum-teams')).toHaveValue('9');
      await screenshot(page, testInfo, 'tournament-edit-details-changed');
      await expectAccessible(page);
      await saveButton(page).click();
      await expect(saveStatus(page)).toContainText('Details saved.');
      await expect(main(page).locator('dl')).toContainText('Up to 9 teams');
    });
  });

  test.describe('a save the server fails', () => {
    test.use({ expectedConvexErrors: ['tournaments:updateDetails'] });

    test('keeps every field, shows the alert, and passes the axe helper', async ({
      page,
    }, testInfo) => {
      const { managePath } = await publishedWithTeams(page, 0);
      await failMutation(page, 'tournaments:updateDetails');
      await page.goto(managePath);
      await field(page, 'maximum-teams').fill('8');
      await saveButton(page).click();
      const alert = editForm(page).getByRole('alert');
      await expect(alert).toContainText('The tournament details could not be saved.');
      await expect(alert).toBeFocused();
      await expect(field(page, 'maximum-teams')).toHaveValue('8');
      await screenshot(page, testInfo, 'tournament-edit-details-failed');
      await expectAccessible(page);
    });
  });

  test('pressing Save offline shows the offline alert and keeps every field', async ({
    page,
    context,
  }, testInfo) => {
    const { managePath } = await publishedWithTeams(page, 0);
    await page.goto(managePath);
    await field(page, 'maximum-teams').fill('8');
    await context.setOffline(true);
    await expect(saveButton(page)).toHaveAttribute('aria-disabled', 'true');
    // `force`: Playwright treats aria-disabled as not actionable, and the page must answer the press.
    await saveButton(page).click({ force: true });
    await expect(editForm(page).getByRole('alert')).toContainText(
      "You're offline. Nothing was sent.",
    );
    await expect(field(page, 'maximum-teams')).toHaveValue('8');
    await screenshot(page, testInfo, 'tournament-edit-details-offline');
    await expectAccessible(page);
    await context.setOffline(false);
  });

  test('a soccer tournament offers no sets per game', VIEWPORT_AGNOSTIC, async ({ page }) => {
    const { tenant } = await memberOf(page, 'orgAdmin');
    await seedTournament(tenant, {
      name: 'Kick Off Cup',
      slug: 'kick-off-cup',
      sport: 'soccer',
      locations: [PELICAN],
      division: { gender: 'coed', playersPerSide: 7, level: 'rec', ageGroup: 'adult' },
      startDate: dateFromToday(40),
      endDate: dateFromToday(40),
      registrationDeadline: dateFromToday(30),
    });
    await page.goto(`/app/organizations/${tenant.slug}/tournaments/kick-off-cup`);
    await expect(field(page, 'maximum-teams')).toBeVisible();
    await expect(editForm(page).getByText('Sets per game')).toHaveCount(0);
  });
});
