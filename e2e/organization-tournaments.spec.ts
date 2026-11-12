import type { Page } from '@playwright/test';
import { axeScan, describeViolations, expectAccessible } from './support/a11y';
import { chipLabel, chooseChip } from './support/chip';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { failFirstAnswer } from './support/fail-first-answer';
import { failMutation } from './support/fail-mutation';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { dateFromToday, seedTenant, type TenantSeed } from './support/tenant';
import { seedTournament } from './support/tournament';
import { newUser } from './support/users';
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
