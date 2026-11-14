import type { Locator, Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { formatCalendarDate } from '../convex/lib/seasonInput';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { screenshot } from './support/screenshot';
import { otherUser, signUp } from './support/session';
import { expectOnScreen } from './support/sticky-footer';
import { dateFromToday, seedSeasons, seedTenant, type Tenant } from './support/tenant';
import { newUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LOCATIONS = [
  { name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX 78382' },
  {
    name: 'Pelican Shoals Sand Courts',
    address: '2150 Pelican Shoals Dr, Corpus Christi, TX 78418',
  },
];

const DAY = 24 * 60 * 60 * 1000;

const ATTENTION_LEAGUES: SeededLeague = [
  { name: 'Sunday Reverse Coed 4s', sport: 'beachVolleyball', locations: [] },
  { name: 'Coed 7v7 Rec', sport: 'soccer', locations: [] },
  { name: "Men's Over-30 11v11", sport: 'soccer', locations: [] },
];

/** Dated from the test clock, so the season keeps its phase as the test runs. */
const draftSeason = (name: string, slug: string, deadlineInDays: number) => ({
  name,
  slug,
  startDate: dateFromToday(deadlineInDays + 14),
  endDate: dateFromToday(deadlineInDays + 70),
  registrationDeadline: dateFromToday(deadlineInDays),
  status: 'draft' as const,
});

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

type Role = 'orgAdmin' | 'leagueOrganizer';

type SeededLeague = NonNullable<Parameters<typeof seedTenant>[0]>['leagues'];

async function memberOf(
  page: Page,
  role: Role | null,
  locations: { name: string; address: string }[] = [],
  leagues: SeededLeague = [],
) {
  const user = newUser('Admin');
  await signUp(page, user);
  return { user, ...(await seedFor(user.email, role, locations, leagues)) };
}

async function seedFor(
  email: string,
  role: Role | null,
  locations: { name: string; address: string }[],
  leagues: SeededLeague = [],
): Promise<{ tenant: Tenant; base: string }> {
  const tenant = await seedTenant({ name: 'E2E Admin', locations, leagues });
  if (role) {
    await convexRun('testing:addMembership', {
      organizationSlug: tenant.slug,
      email,
      role,
    });
  }
  return { tenant, base: `/app/organizations/${tenant.slug}` };
}

const main = (page: Page) => page.getByRole('main');
const nameField = (page: Page) => page.locator('#name');
const addressField = (page: Page) => page.locator('#address');
const addForm = (page: Page) => page.locator('#add-location form');
const addButton = (page: Page) => addForm(page).getByRole('button', { name: /^Add location/ });
const countLinks = (page: Page) => main(page).locator('[data-slot="overview-counts"] a');
const listRows = (page: Page) => page.locator('#locations-list > app-location-row');

async function openMenu(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const dialog = page.getByRole('dialog', { name: 'Navigation' });
  await expect(dialog.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  return dialog;
}

async function adminNav(page: Page, organizationName: string): Promise<Locator> {
  if (isDesktop(page)) {
    const nav = page.getByRole('navigation', { name: `${organizationName} admin` });
    await expect(nav).toBeVisible();
    return nav;
  }
  const dialog = await openMenu(page);
  return dialog.getByRole('navigation', { name: `${organizationName} admin` });
}

test.describe('the admin area: entry and navigation', () => {
  test('an org admin reaches Locations from /app through the sidebar and the navigation', async ({
    page,
  }) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin');
    await expect(page).toHaveURL(`${baseURL}/app`);
    const account = isDesktop(page) ? page : await openMenu(page);
    await account
      .getByRole('navigation', { name: 'Your account' })
      .getByRole('link', { name: tenant.name })
      .click();
    await expect(page).toHaveURL(`${baseURL}${base}`);
    await expect(page).toHaveTitle(`Overview | ${tenant.name} | Omni League`);
    await expect(main(page).getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();

    const nav = await adminNav(page, tenant.name);
    await nav.getByRole('link', { name: 'Locations' }).click();
    await expect(page).toHaveURL(`${baseURL}${base}/locations`);
    await expect(page).toHaveTitle(`Locations | ${tenant.name} | Omni League`);
    await expect(main(page).getByRole('heading', { level: 1, name: 'Locations' })).toBeVisible();
  });

  test('the sidebar (1280) or the menu sheet (360) lists the entries in order and marks the current one', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin', LOCATIONS);
    for (const [path, current] of [
      [base, 'Overview'],
      [`${base}/locations`, 'Locations'],
    ]) {
      await page.goto(path);
      await expect(main(page).getByRole('heading', { level: 1, name: current })).toBeVisible();
      const nav = await adminNav(page, tenant.name);
      await expect(nav.getByRole('link')).toHaveText([
        /Switch organization/,
        'Overview',
        /^Leagues\d*$/,
        'Tournaments',
        'Camps',
        /^Locations\d*$/,
        /^Staff\d*$/,
        'Details',
        'View public page',
      ]);
      await expect(nav.locator('[aria-current="page"]')).toHaveText(new RegExp(`^${current}\\d*$`));
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(nav.getByRole('link', { name: 'View public page' })).toHaveAttribute(
        'href',
        `/organizations/${tenant.slug}`,
      );
      await expect(nav.getByRole('link', { name: /Switch organization/ })).toHaveAttribute(
        'href',
        '/app',
      );
      if (!isDesktop(page)) {
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog', { name: 'Navigation' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused();
      } else {
        await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden();
        const column = page.locator('main').locator('xpath=../preceding-sibling::div[1]');
        expect((await column.boundingBox())?.width).toBe(256);
      }
    }
    await screenshot(page, testInfo, '65-locations-nav');
  });

  test('choosing an item in the sheet closes it and goes there (360)', async ({
    page,
  }, testInfo) => {
    test.skip(isDesktop(page), 'the phone sheet runs at 360px only');
    const { tenant, base } = await memberOf(page, 'orgAdmin');
    await page.goto(base);
    const nav = await adminNav(page, tenant.name);
    await screenshot(page, testInfo, '65-menu-open');
    await nav.getByRole('link', { name: 'Locations' }).click();
    await expect(page.getByRole('dialog', { name: 'Navigation' })).toHaveCount(0);
    await expect(page).toHaveURL(`${baseURL}${base}/locations`);
  });

  test(
    'a signed-out visitor is sent to sign-in with returnTo',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const slug = `e2e-${randomBytes(4).toString('hex')}`;
      await page.goto(`/app/organizations/${slug}/locations`);
      await expect(page).toHaveURL(/\/sign-in\?/);
      expect(new URL(page.url()).searchParams.get('returnTo')).toBe(
        `/app/organizations/${slug}/locations`,
      );
    },
  );
});

test.describe('the admin area: while the organization loads', () => {
  test('the loading skeleton pulses only while the visitor allows motion', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    const held = await holdQueries(page, ['organizations:getAdminContext']);
    await page.goto(base);
    await expect.poll(() => held.isHolding()).toBe(true);
    const bar = page.locator('app-admin-loading [data-slot="skeleton"]').first();
    const animationName = () => bar.evaluate((element) => getComputedStyle(element).animationName);

    await expect.poll(animationName).toBe('pulse');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(animationName).toBe('none');

    held.release();
    await expect(main(page).getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  });
});

test.describe('Overview', () => {
  test('a new organization shows 0 leagues, 0 locations, nothing to attend to, and the Get set up list, which leads to Locations', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(base);
    await expect(countLinks(page)).toHaveText(['0 leagues', '0 locations', '1 staff']);
    await expect(main(page).locator('dl')).toHaveCount(0);
    await expect(main(page).getByRole('region', { name: 'Needs your attention' })).toContainText(
      'Nothing needs your attention.',
    );
    await expect(main(page).getByRole('region', { name: 'Registration open' })).toContainText(
      'No season is open for registration.',
    );
    const setup = page.getByRole('region', { name: 'Get set up' });
    await expect(setup.getByRole('heading', { level: 3 })).toHaveText([
      'Add a location',
      'Create a league',
      'Publish the league',
      'Invite staff (optional)',
    ]);
    await screenshot(page, testInfo, '65-overview-new');
    await expectAccessible(page);
    await setup.getByRole('link', { name: 'Add a location' }).click();
    await expect(page).toHaveURL(`${baseURL}${base}/locations`);
  });

  test('the counts in the header link to their pages, and "Create a league" links to the create form', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin', LOCATIONS);
    await page.goto(base);
    await expect(countLinks(page)).toHaveText(['0 leagues', '2 locations', '1 staff']);
    await expect(countLinks(page).nth(0)).toHaveAttribute('href', `${base}/leagues`);
    await expect(countLinks(page).nth(1)).toHaveAttribute('href', `${base}/locations`);
    await expect(countLinks(page).nth(2)).toHaveAttribute('href', `${base}/staff`);
    await expect(main(page).getByRole('link', { name: 'Create a league' }).first()).toHaveAttribute(
      'href',
      `${base}/leagues#create-league`,
    );
  });

  test('the header "Create a league" lands on Name, on screen', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin', LOCATIONS);
    await page.goto(base);
    await main(page).getByRole('link', { name: 'Create a league' }).first().click();
    await expect(page).toHaveURL(`${baseURL}${base}/leagues#create-league`);
    await expect(nameField(page)).toBeFocused();
    await expectOnScreen(page, nameField(page));
  });

  test('the Get set up "Create a league" lands on Name, on screen', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin', LOCATIONS);
    await page.goto(base);
    const step = page.getByRole('region', { name: 'Get set up' });
    const link = step.getByRole('link', { name: 'Create a league' });
    await expect(link).toHaveAttribute('href', `${base}/leagues#create-league`);
    await link.click();
    await expect(page).toHaveURL(`${baseURL}${base}/leagues#create-league`);
    await expect(nameField(page)).toBeFocused();
    await expectOnScreen(page, nameField(page));
  });

  test('the league count and the sidebar count a published and a draft league, and only the published one needs a season', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin', LOCATIONS, [
      { name: 'Published Tuesday 4s', sport: 'beachVolleyball', locations: [LOCATIONS[0].name] },
      {
        name: 'Draft Thursday 4s',
        sport: 'beachVolleyball',
        locations: [LOCATIONS[0].name],
        status: 'draft',
      },
    ]);
    await page.goto(base);
    await expect(countLinks(page).first()).toHaveText('2 leagues');
    const attention = main(page).getByRole('region', { name: 'Needs your attention' });
    await expect(attention.getByRole('listitem')).toHaveCount(1);
    await expect(attention).toContainText('Published Tuesday 4s has no season');
    const nav = await adminNav(page, tenant.name);
    await expect(nav.getByRole('link', { name: /^Leagues/ })).toHaveText(/^Leagues2$/);
    if (!isDesktop(page)) {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Navigation' })).toHaveCount(0);
    }
    await screenshot(page, testInfo, '172-overview-leagues-count');
    await expectAccessible(page);
  });

  test('the count follows a location added on the Locations page', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/locations`);
    await nameField(page).fill('Mustang Courts');
    await addressField(page).fill('1 Mustang Way, Port Aransas, TX 78373');
    await addButton(page).click();
    await expect(listRows(page)).toHaveCount(1);
    // Through the navigation, so the page keeps its live connection.
    const tenantName = (await page.title()).split(' | ')[1];
    const nav = await adminNav(page, tenantName);
    await nav.getByRole('link', { name: 'Overview' }).click();
    await expect(countLinks(page).nth(1)).toHaveText('1 location');
  });

  test('Needs your attention lists two drafts by soonest deadline, a league with no season, and the pending invite, each with its action', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin', [], ATTENTION_LEAGUES);
    await seedSeasons(tenant, 'sunday-reverse-coed-4s', [
      draftSeason('Fall 2027', 'fall-2027', 20),
    ]);
    await seedSeasons(tenant, 'coed-7v7-rec', [draftSeason('Fall 2027', 'fall-2027', 10)]);
    await convexRun('testing:addInvite', {
      organizationSlug: tenant.slug,
      email: 'jamie.ortiz@example.test',
      role: 'orgAdmin',
      expiresAt: Date.now() + 14 * DAY,
    });
    await page.goto(base);

    const attention = main(page).getByRole('region', { name: 'Needs your attention' });
    const items = attention.getByRole('listitem');
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText('Fall 2027 is a draft');
    await expect(items.nth(0)).toContainText(
      "Coed 7v7 Rec · players can't see it until you publish it",
    );
    await expect(items.nth(1)).toContainText(
      "Sunday Reverse Coed 4s · players can't see it until you publish it",
    );
    await expect(items.nth(2)).toContainText("Men's Over-30 11v11 has no season");
    await expect(items.nth(3)).toContainText('1 staff invite is pending');
    await expect(items.nth(3)).toContainText(
      /jamie\.ortiz@example\.test · expires [A-Z][a-z]{2} \d{1,2}/,
    );
    await expect(attention.getByRole('link')).toHaveText([
      'Review Fall 2027, Coed 7v7 Rec',
      'Review Fall 2027, Sunday Reverse Coed 4s',
      "Create a season for Men's Over-30 11v11",
      'Open Staff',
    ]);
    await expect(
      attention.getByRole('heading', { level: 2, name: 'Needs your attention' }),
    ).toBeVisible();
    await expect(attention.locator('[data-slot="attention-count"] .sr-only')).toHaveText('4 items');
    await screenshot(page, testInfo, '254-overview-attention');
    await expectAccessible(page);

    await attention.getByRole('link', { name: 'Review Fall 2027, Coed 7v7 Rec' }).click();
    await expect(page).toHaveURL(`${baseURL}${base}/leagues/coed-7v7-rec`);
  });

  test('Create a season opens the create form of the league with no season', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin', [], ATTENTION_LEAGUES);
    await page.goto(base);
    await main(page).getByRole('link', { name: "Create a season for Men's Over-30 11v11" }).click();
    await expect(page).toHaveURL(`${baseURL}${base}/leagues/men-s-over-30-11v11#create-season`);
    await expect(page.getByRole('heading', { level: 2, name: 'Create a season' })).toBeInViewport();
  });

  test('Registration open lists the open seasons, soonest deadline first, with their deadlines', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin', [], ATTENTION_LEAGUES);
    const open = (name: string, slug: string, days: number) => ({
      ...draftSeason(name, slug, days),
      status: 'published' as const,
    });
    await seedSeasons(tenant, 'sunday-reverse-coed-4s', [open('Summer 2027', 'summer-2027', 15)]);
    await seedSeasons(tenant, 'coed-7v7-rec', [open('Summer 2027', 'summer-2027', 5)]);
    await page.goto(base);

    const section = main(page).getByRole('region', { name: 'Registration open' });
    await expect(section.getByRole('heading', { level: 2 })).toHaveText('Registration open');
    const rows = section.getByRole('listitem');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Coed 7v7 Rec · Summer 2027');
    await expect(rows.nth(0)).toContainText(`Closes ${formatCalendarDate(dateFromToday(5))}`);
    await expect(rows.nth(1)).toContainText('Sunday Reverse Coed 4s · Summer 2027');
    await expect(rows.nth(1)).toContainText(`Closes ${formatCalendarDate(dateFromToday(15))}`);
    await screenshot(page, testInfo, '254-overview-open');
    await expectAccessible(page);

    await rows.nth(0).getByRole('link').click();
    await expect(page).toHaveURL(`${baseURL}${base}/leagues/coed-7v7-rec/seasons/summer-2027`);
  });
});

test.describe('Locations', () => {
  test('lists the locations by name with an Edit button each, and the empty state', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin', LOCATIONS);
    await page.goto(`${base}/locations`);
    await expect(listRows(page)).toHaveCount(2);
    await expect(listRows(page).locator('h3')).toHaveText([
      'Pelican Shoals Sand Courts',
      'Redfish Flats Fields',
    ]);
    await expect(page.getByRole('button', { name: 'Edit Redfish Flats Fields' })).toBeVisible();
    await screenshot(page, testInfo, '65-locations');
    await expectAccessible(page);
  });

  test('no locations yet: the empty state and the form', async ({ page }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/locations`);
    await expect(page.getByText('No locations yet')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Add a location' })).toBeVisible();
    await screenshot(page, testInfo, '65-locations-empty');
    await expectAccessible(page);
  });

  test('"Add location" in the header jumps to the form and focuses it (360)', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin', LOCATIONS);
    await page.goto(`${base}/locations`);
    const jump = main(page).getByRole('link', { name: 'Add location' });
    if (isDesktop(page)) {
      await expect(jump).toBeHidden();
      return;
    }
    await expect(jump).toBeVisible();
    await jump.click();
    await expect(nameField(page)).toBeFocused();
    await expect(nameField(page)).toBeInViewport();
    await expect(page.getByRole('heading', { level: 2, name: 'Add a location' })).toBeInViewport();
  });

  test('adds a location: the status above the form, the form cleared, the list and the public page show it', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/locations`);
    await nameField(page).fill('  Mustang Courts ');
    await addressField(page).fill('1 Mustang Way, Port Aransas, TX 78373');
    await addButton(page).click();

    const status = addForm(page).getByRole('status').filter({ hasText: 'added' });
    await expect(status).toContainText('Mustang Courts added.');
    await expect(status).toContainText('It’s on your public page now.');
    await expect(nameField(page)).toHaveValue('');
    await expect(addressField(page)).toHaveValue('');
    await expect(addButton(page)).toBeFocused();
    await expect(listRows(page)).toHaveCount(1);
    await expect(listRows(page).first()).toContainText('Mustang Courts');
    await screenshot(page, testInfo, '65-locations-added');
    await expectAccessible(page);

    await page.goto(`/organizations/${tenant.slug}`);
    const publicLocation = page.locator('#location-1');
    await expect(publicLocation.locator('h3')).toHaveText('Mustang Courts');
    await expect(publicLocation).toContainText('1 Mustang Way, Port Aransas, TX 78373');
  });

  test(
    'a location added on one tab appears live on another',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { base } = await memberOf(page, 'orgAdmin');
      await page.goto(`${base}/locations`);
      await expect(page.getByText('No locations yet')).toBeVisible();
      const secondDevice = await page.context().newPage();
      await secondDevice.goto(`${base}/locations`);
      await secondDevice.locator('#name').fill('Second Tab Field');
      await secondDevice.locator('#address').fill('2 Tab Way');
      await secondDevice
        .locator('#add-location')
        .getByRole('button', { name: /^Add location/ })
        .click();
      await expect(listRows(page)).toHaveCount(1);
      await expect(listRows(page).first()).toContainText('Second Tab Field');
      await secondDevice.close();
    },
  );

  test('refuses empty, whitespace-only, and too-long values with the field messages, and adds nothing', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/locations`);
    await addButton(page).click();
    await expect(page.locator('#name-error')).toHaveText('Enter the location’s name.');
    await expect(page.locator('#address-error')).toHaveText('Enter the location’s address.');
    await expect(nameField(page)).toBeFocused();
    await expect(nameField(page)).toHaveAttribute('aria-invalid', 'true');
    await screenshot(page, testInfo, '65-locations-add-errors');
    await expectAccessible(page);

    await nameField(page).fill('   ');
    await addressField(page).fill(' \t ');
    await addButton(page).click();
    await expect(page.locator('#name-error')).toHaveText('Enter the location’s name.');
    await expect(page.locator('#address-error')).toHaveText('Enter the location’s address.');
    // The form moves focus to Name once it has rendered. Filling before then lets that focus land
    // between two fills, and the second value goes into Name.
    await expect(nameField(page)).toBeFocused();

    await nameField(page).fill('n'.repeat(101));
    await addressField(page).fill('a'.repeat(201));
    await addButton(page).click();
    await expect(page.locator('#name-error')).toHaveText(
      'Use 100 characters or fewer. This name has 101.',
    );
    await expect(page.locator('#address-error')).toHaveText(
      'Use 200 characters or fewer. This address has 201.',
    );
    await expect(nameField(page)).toBeFocused();
    await expect(page.getByText('No locations yet')).toBeVisible();
    await expect(listRows(page)).toHaveCount(0);
  });

  test('edits a location in place: the public page shows the new name, "saved" is above the list, focus returns to Edit', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin', LOCATIONS);
    await page.goto(`${base}/locations`);
    const edit = page.getByRole('button', { name: 'Edit Redfish Flats Fields' });
    await edit.click();
    const form = page.locator('#locations-list form');
    await expect(form.getByRole('heading', { name: 'Edit location' })).toBeVisible();
    await expect(page.locator('#edit-name')).toBeFocused();
    await expect(page.locator('#edit-name')).toHaveValue('Redfish Flats Fields');
    await expect(page.locator('#edit-address')).toHaveValue(LOCATIONS[0].address);
    await screenshot(page, testInfo, '65-locations-edit');

    await page.locator('#edit-name').fill('Redfish Flats Soccer Fields');
    await form.getByRole('button', { name: 'Save changes' }).click();
    const saved = page.locator('section[aria-labelledby="locations-heading"]').getByRole('status');
    await expect(saved).toHaveText('Redfish Flats Soccer Fields saved.');
    await expect(form).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Edit Redfish Flats Soccer Fields' }),
    ).toBeFocused();
    await screenshot(page, testInfo, '65-locations-saved');
    await expectAccessible(page);

    await page.goto(`/organizations/${tenant.slug}`);
    await expect(
      page.getByRole('main').locator('h3').filter({ hasText: 'Soccer Fields' }),
    ).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText('Redfish Flats Fields');
  });

  test('Cancel and Escape restore the row and return focus to Edit; refused edits show the field messages', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin', LOCATIONS);
    await page.goto(`${base}/locations`);
    const edit = page.getByRole('button', { name: 'Edit Pelican Shoals Sand Courts' });
    await edit.click();
    await page.locator('#edit-name').fill('Changed');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#locations-list form')).toHaveCount(0);
    await expect(edit).toBeFocused();
    await expect(listRows(page).first()).toContainText('Pelican Shoals Sand Courts');

    await edit.click();
    // The form takes focus when it has rendered; Escape before that would reach the button.
    await expect(page.locator('#edit-name')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#locations-list form')).toHaveCount(0);
    await expect(edit).toBeFocused();

    await edit.click();
    // Fill only once the form has taken focus: it would land between the two fills.
    await expect(page.locator('#edit-name')).toBeFocused();
    await page.locator('#edit-name').fill(' ');
    await page.locator('#edit-address').fill('');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.locator('#edit-name-error')).toHaveText('Enter the location’s name.');
    await expect(page.locator('#edit-address-error')).toHaveText('Enter the location’s address.');
    await expect(page.locator('#edit-name')).toBeFocused();
    await screenshot(page, testInfo, '65-locations-edit-errors');
    await expectAccessible(page);
  });
});

test.describe('who may open the admin area', () => {
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
    test(`${label} sees the no-access view on every admin path, and no location data is requested`, async ({
      page,
      isMobile,
    }) => {
      const user = newUser('Outsider');
      await signUp(page, user);
      const { tenant, base } = await seedFor(user.email, role, LOCATIONS);
      const frames = sentFrames(page);
      for (const path of [`${base}/locations`, base]) {
        await page.goto(path);
        await expect(
          main(page).getByRole('heading', {
            level: 1,
            name: 'You can’t manage this organization',
          }),
        ).toBeVisible();
        await expect(page).toHaveTitle('You can’t manage this organization | Omni League');
        await expect(main(page)).toContainText(
          'Only its org admins can open the admin area. If you should have access, ask one of them to invite you as an org admin.',
        );
        const adminNavigation = page.getByRole('navigation', { name: `${tenant.name} admin` });
        await expect(adminNavigation).toHaveCount(0);
        const menu = page.getByRole('button', { name: 'Open navigation' });
        if (isMobile) {
          await menu.tap();
          const sheet = page.getByRole('dialog', { name: 'Navigation' });
          await expect(sheet.getByRole('navigation', { name: 'Your account' })).toBeVisible();
          await expect(adminNavigation).toHaveCount(0);
          await page.keyboard.press('Escape');
          await expect(sheet).toHaveCount(0);
        } else {
          await expect(menu).toHaveCount(0);
        }
        await expect(page.locator('body')).not.toContainText(LOCATIONS[0].name);
        // The home sidebar lists the organizations this user belongs to, so the page itself is checked.
        await expect(main(page)).not.toContainText(tenant.name);
      }
      expect(frames.join('\n')).toContain('organizations:getAdminContext');
      expect(frames.join('\n')).not.toContain('locations:listForAdmin');
      await main(page).getByRole('link', { name: 'Go to your organizations' }).click();
      await expect(page).toHaveURL(`${baseURL}/app`);
    });
  }

  test('the no-access view is saved as a screenshot and passes the axe helper', async ({
    page,
  }, testInfo) => {
    const user = newUser('Outsider');
    await signUp(page, user);
    const { base } = await seedFor(user.email, null, LOCATIONS);
    await page.goto(`${base}/locations`);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
    ).toBeVisible();
    await screenshot(page, testInfo, '65-no-access');
    await expectAccessible(page);
  });

  test(
    'an unknown slug shows the not-found view with no other request',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      await signUp(page, newUser('Lost'));
      const frames = sentFrames(page);
      await page.goto('/app/organizations/does-not-exist/locations');
      await expect(
        main(page).getByRole('heading', { level: 1, name: 'Page not found' }),
      ).toBeVisible();
      await expect(main(page).getByRole('link', { name: 'Go to the home page' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: /admin$/ })).toHaveCount(0);
      expect(frames.join('\n')).toContain('organizations:getAdminContext');
      expect(frames.join('\n')).not.toContain('locations:listForAdmin');
    },
  );

  test('the not-found view is saved as a screenshot and passes the axe helper', async ({
    page,
  }, testInfo) => {
    await signUp(page, newUser('Lost'));
    await page.goto('/app/organizations/does-not-exist/locations');
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible();
    await screenshot(page, testInfo, '65-not-found');
    await expectAccessible(page);
  });

  test(
    'an org admin of another organization is refused: no access, nothing written',
    VIEWPORT_AGNOSTIC,
    async ({ page, browser }) => {
      const owner = await memberOf(page, 'orgAdmin', LOCATIONS);
      const user = newUser('Intruder');
      const intruder = await otherUser(browser, user);
      try {
        const mine = await seedFor(user.email, 'orgAdmin', []);
        expect(mine.base).not.toBe(owner.base);
        await intruder.goto(`${owner.base}/locations`);
        await expect(
          intruder.getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
        ).toBeVisible();
        await expect(intruder.locator('body')).not.toContainText(LOCATIONS[0].name);
      } finally {
        await intruder.context().close();
      }
      await page.goto(`${owner.base}/locations`);
      await expect(listRows(page)).toHaveCount(2);
    },
  );
});
