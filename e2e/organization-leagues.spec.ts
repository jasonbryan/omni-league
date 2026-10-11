// The Leagues page of the admin area and the Overview's league tile (#66):
// `/app/organizations/:slug/leagues`, a Client route behind sign-in (approved design
// design/mockups/66-69-organization-leagues.html; publishing is in organization-leagues-
// publish.spec.ts). Every test signs
// up its own user through the real form, then gives it a role in a seeded organization
// (`testing:addMembership`), so the tests need the local Convex backend and are skipped with
// E2E_BASE_URL set.
import type { Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { fetchRawHtml } from './support/raw-html';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { seedTenant, type TenantSeed } from './support/tenant';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LOCATIONS = [
  { name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX 78382' },
  {
    name: 'Pelican Shoals Sand Courts',
    address: '2150 Pelican Shoals Dr, Corpus Christi, TX 78418',
  },
];

type Role = 'orgAdmin' | 'leagueOrganizer';

/** Signs up a user and gives it `role` in a new seeded organization built from `seed`. */
async function memberOf(page: Page, role: Role | null, seed: TenantSeed = {}) {
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenant({ name: 'E2E Leagues', ...seed });
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
const form = (page: Page) => page.locator('#create-league form');
const submit = (page: Page) => form(page).getByRole('button', { name: /^Create draft league/ });
const leagueRows = (page: Page) => page.locator('#leagues-list > li');
const leagueTile = (page: Page) => main(page).locator('dl > div').filter({ hasText: 'Leagues' });

async function createDraft(
  page: Page,
  league: { name: string; slug?: string; sport: string; locations: string[] },
) {
  await page.locator('#name').fill(league.name);
  if (league.slug !== undefined) await page.locator('#slug').fill(league.slug);
  await page.getByRole('radio', { name: league.sport }).check();
  for (const location of league.locations) {
    await page.getByRole('checkbox', { name: location }).click();
  }
  await submit(page).click();
}

test.describe('Leagues: creating a draft', () => {
  test('creates a draft: Draft in the list, the status above the form, the form cleared, and nothing on the public page', async ({
    page,
    request,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
    await page.goto(`${base}/leagues`);
    await expect(page).toHaveTitle(`Leagues | ${tenant.name} | Omni League`);
    await expect(page.getByText('No leagues yet')).toBeVisible();
    await screenshot(page, testInfo, '66-leagues-empty');
    await expectAccessible(page);

    await page.locator('#name').fill('  Sunday Reverse Coed 4s ');
    await page.getByRole('radio', { name: 'Beach volleyball' }).check();
    await page.getByRole('checkbox', { name: 'Pelican Shoals Sand Courts' }).click();
    await screenshot(page, testInfo, '66-leagues-filled');
    await submit(page).click();

    const status = form(page).getByRole('status').filter({ hasText: 'created as a draft' });
    await expect(status).toContainText('Sunday Reverse Coed 4s created as a draft.');
    await expect(status).toContainText('Publish it when it’s ready for players to see.');
    await expect(page.locator('#name')).toHaveValue('');
    await expect(page.locator('#slug')).toHaveValue('');
    await expect(page.getByRole('radio', { name: 'Beach volleyball' })).not.toBeChecked();
    await expect(submit(page)).toBeFocused();

    await expect(leagueRows(page)).toHaveCount(1);
    const row = leagueRows(page).first();
    await expect(row.locator('h3')).toHaveText('Sunday Reverse Coed 4s');
    await expect(row.locator('[data-slot="badge"]')).toHaveText(['Draft', 'Beach volleyball']);
    await expect(row).toContainText('Pelican Shoals Sand Courts');
    await screenshot(page, testInfo, '66-leagues-created');
    await expectAccessible(page);

    // Not on the public page: the server-rendered HTML, and the hydrated page.
    const raw = await fetchRawHtml(request, tenant.path);
    expect(raw.status).toBe(200);
    expect(raw.html).not.toContain('Sunday Reverse Coed 4s');
    await page.goto(tenant.path);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText(tenant.name);
    await expect(page.locator('body')).not.toContainText('Sunday Reverse Coed 4s');
  });

  test('lists drafts and published leagues by name with status, sport, and locations', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin', {
      locations: LOCATIONS,
      leagues: [
        { name: 'Coed 7v7 Rec', sport: 'soccer', locations: ['Redfish Flats Fields'] },
        {
          name: 'Wednesday Coed Slow-Pitch',
          sport: 'softball',
          locations: ['Redfish Flats Fields', 'Pelican Shoals Sand Courts'],
          status: 'draft',
        },
      ],
    });
    await page.goto(`${base}/leagues`);
    await expect(leagueRows(page).locator('h3')).toHaveText([
      'Coed 7v7 Rec',
      'Wednesday Coed Slow-Pitch',
    ]);
    await expect(leagueRows(page).nth(0).locator('[data-slot="badge"]')).toHaveText([
      'Published',
      'Soccer',
    ]);
    await expect(leagueRows(page).nth(1).locator('[data-slot="badge"]')).toHaveText([
      'Draft',
      'Softball',
    ]);
    await expect(leagueRows(page).nth(1)).toContainText(
      'Redfish Flats Fields, Pelican Shoals Sand Courts',
    );
    await expect(leagueRows(page).nth(0).getByRole('button')).toHaveCount(0);
    await expect(leagueRows(page).nth(1).getByRole('button')).toHaveText(
      'Publish Wednesday Coed Slow-Pitch',
    );
    await screenshot(page, testInfo, '66-leagues-populated');
    await expectAccessible(page);
  });

  test('Slug follows the name until it is edited', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
    await page.goto(`${base}/leagues`);
    await page.locator('#name').fill('Sunday Reverse Coed 4s');
    await expect(page.locator('#slug')).toHaveValue('sunday-reverse-coed-4s');
    await page.locator('#name').fill('Men’s D Division');
    await expect(page.locator('#slug')).toHaveValue('men-s-d-division');
    await page.locator('#slug').fill('mens-d');
    await page.locator('#name').fill('Men’s D Division Slow-Pitch');
    await expect(page.locator('#slug')).toHaveValue('mens-d');
  });

  test('refuses a form submitted empty with every message, and creates nothing', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
    await page.goto(`${base}/leagues`);
    await submit(page).click();
    await expect(page.locator('#name-error')).toHaveText('Enter the league’s name.');
    await expect(page.locator('#slug-error')).toHaveText('Enter a slug for the league.');
    await expect(page.locator('#sport-error')).toHaveText('Choose a sport.');
    await expect(page.locator('#locations-error')).toHaveText('Choose at least one location.');
    await expect(page.locator('#name')).toBeFocused();
    await expect(page.locator('#name')).toHaveAttribute('aria-invalid', 'true');
    await screenshot(page, testInfo, '66-leagues-errors');
    await expectAccessible(page);

    await page.locator('#name').fill('Fine');
    await submit(page).click();
    await expect(page.locator('#name-error')).toHaveCount(0);
    await expect(page.locator('#sport-error')).toBeVisible();
    await page.getByRole('radio', { name: 'Soccer' }).check();
    await submit(page).click();
    await expect(page.locator('#locations-error')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Pelican Shoals Sand Courts' })).toBeFocused();
    await expect(page.getByText('No leagues yet')).toBeVisible();
  });

  test('an invalid slug shows the format message and creates nothing', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
    await page.goto(`${base}/leagues`);
    await page.locator('#name').fill('Fine');
    await page.getByRole('radio', { name: 'Soccer' }).check();
    await page.getByRole('checkbox', { name: 'Redfish Flats Fields' }).click();
    for (const slug of ['Bad Slug', 'ab', 'new']) {
      await page.locator('#slug').fill(slug);
      await submit(page).click();
      await expect(page.locator('#slug-error')).toContainText(
        'Use 3 to 60 lowercase letters and digits, with single hyphens between them. Some slugs, like new, are reserved.',
      );
      await expect(page.locator('#slug')).toBeFocused();
    }
    await expect(page.getByText('No leagues yet')).toBeVisible();
  });

  test.describe('a slug used by a league of the organization', () => {
    // The rejected mutation logs one console error, as for a taken organization slug (#64).
    test.use({ expectedConvexErrors: ['leagues:create'] });

    test('is refused with the slug named; the next slug works', async ({ page }, testInfo) => {
      const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
      await page.goto(`${base}/leagues`);
      await createDraft(page, {
        name: 'Sand 4s',
        sport: 'Beach volleyball',
        locations: ['Pelican Shoals Sand Courts'],
      });
      await expect(leagueRows(page)).toHaveCount(1);

      await createDraft(page, {
        name: 'Another Sand 4s',
        slug: 'sand-4s',
        sport: 'Beach volleyball',
        locations: ['Redfish Flats Fields'],
      });
      await expect(page.locator('#slug-error')).toHaveText(
        'sand-4s is already used by another league here. Choose another slug.',
      );
      await expect(page.locator('#slug')).toBeFocused();
      await expect(leagueRows(page)).toHaveCount(1);
      await screenshot(page, testInfo, '66-leagues-slug-taken');
      await expectAccessible(page);

      await page.locator('#slug').fill('sand-4s-b');
      await expect(page.locator('#slug-error')).toHaveCount(0);
      await submit(page).click();
      await expect(leagueRows(page)).toHaveCount(2);
    });
  });

  test('the same slug in another organization is allowed', async ({ page, browser }) => {
    const first = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
    await page.goto(`${first.base}/leagues`);
    await createDraft(page, {
      name: 'Shared Name',
      sport: 'Soccer',
      locations: ['Redfish Flats Fields'],
    });
    await expect(leagueRows(page)).toHaveCount(1);

    const other = await browser.newPage({ baseURL });
    try {
      const second = await memberOf(other, 'orgAdmin', { locations: LOCATIONS });
      await other.goto(`${second.base}/leagues`);
      await createDraft(other, {
        name: 'Shared Name',
        sport: 'Soccer',
        locations: ['Redfish Flats Fields'],
      });
      await expect(leagueRows(other)).toHaveCount(1);
      await expect(other.locator('#slug-error')).toHaveCount(0);
    } finally {
      await other.context().close();
    }
  });

  test('"Create a league" in the header jumps to the form and focuses it (360)', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
    await page.goto(`${base}/leagues`);
    const jump = main(page).getByRole('link', { name: 'Create a league' });
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      await expect(jump).toBeHidden();
      return;
    }
    await jump.click();
    await expect(page.locator('#name')).toBeFocused();
    await expect(page.locator('#name')).toBeInViewport();
  });
});

test.describe('Leagues: no locations', () => {
  test('replaces the form with "Add a location first", links to Locations, and still lists the leagues', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/leagues`);
    await expect(page.getByText('Add a location first')).toBeVisible();
    await expect(
      page.getByText('Every league is held at one or more of your locations.'),
    ).toBeVisible();
    await expect(page.locator('#create-league form')).toHaveCount(0);
    await expect(page.getByText('No leagues yet')).toBeVisible();
    const link = page.locator('#create-league').getByRole('link', { name: 'Go to Locations' });
    await expect(link).toHaveAttribute('href', `${base}/locations`);
    await screenshot(page, testInfo, '66-leagues-no-locations');
    await expectAccessible(page);
    await link.click();
    await expect(page).toHaveURL(`${baseURL}${base}/locations`);
  });
});

test.describe('Overview: the Leagues tile and the checklist', () => {
  test('a new organization shows 0 and "None published yet" and the three steps; the sidebar lists Leagues', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin');
    await page.goto(base);
    await expect(leagueTile(page).locator('dd').first()).toHaveText('0');
    await expect(leagueTile(page).locator('dd').nth(1)).toHaveText('None published yet');
    const setup = page.getByRole('region', { name: 'Get set up' });
    await expect(setup.getByRole('heading', { level: 3 })).toHaveText([
      'Add a location',
      'Create a league',
      'Publish the league',
    ]);
    await screenshot(page, testInfo, '66-overview-new');
    await expectAccessible(page);
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      await expect(
        page.getByRole('navigation', { name: `${tenant.name} admin` }).getByRole('link'),
      ).toHaveText(['Overview', 'Locations', 'Leagues', 'Public page', 'Your organizations']);
    }
    await setup.getByRole('link', { name: 'Create a league' }).click();
    await expect(page).toHaveURL(`${baseURL}${base}/leagues`);
  });

  test('with only drafts the tile reads 0 and the list stays; with published leagues the tile counts them and the list is hidden', async ({
    page,
  }, testInfo) => {
    const drafts = await memberOf(page, 'orgAdmin', {
      locations: LOCATIONS,
      leagues: [
        {
          name: 'Draft One',
          sport: 'soccer',
          locations: ['Redfish Flats Fields'],
          status: 'draft',
        },
        {
          name: 'Draft Two',
          sport: 'soccer',
          locations: ['Redfish Flats Fields'],
          status: 'draft',
        },
      ],
    });
    await page.goto(drafts.base);
    await expect(leagueTile(page).locator('dd').first()).toHaveText('0');
    await expect(leagueTile(page).locator('dd').nth(1)).toHaveText('None published yet');
    await expect(page.getByRole('region', { name: 'Get set up' })).toBeVisible();

    const mixed = await seedTenant({
      name: 'E2E Mixed',
      locations: LOCATIONS,
      leagues: [
        { name: 'Pub One', sport: 'soccer', locations: ['Redfish Flats Fields'] },
        { name: 'Pub Two', sport: 'softball', locations: ['Redfish Flats Fields'] },
        {
          name: 'Draft One',
          sport: 'soccer',
          locations: ['Redfish Flats Fields'],
          status: 'draft',
        },
        {
          name: 'Draft Two',
          sport: 'soccer',
          locations: ['Redfish Flats Fields'],
          status: 'draft',
        },
      ],
    });
    await convexRun('testing:addMembership', {
      organizationSlug: mixed.slug,
      email: drafts.user.email,
      role: 'orgAdmin',
    });
    await page.goto(`/app/organizations/${mixed.slug}`);
    await expect(leagueTile(page).locator('dd').first()).toHaveText('2');
    await expect(leagueTile(page).locator('dd').nth(1)).toHaveText('On your public page');
    await expect(page.getByRole('region', { name: 'Get set up' })).toHaveCount(0);
    await screenshot(page, testInfo, '66-overview-published');
    await expectAccessible(page);
  });

  test('a league created on the Leagues page is a draft: the tile stays at 0', async ({ page }) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
    await page.goto(`${base}/leagues`);
    await createDraft(page, {
      name: 'Live One',
      sport: 'Soccer',
      locations: ['Redfish Flats Fields'],
    });
    await expect(leagueRows(page)).toHaveCount(1);
    // Through the navigation, so the page keeps its live connection.
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      await page
        .getByRole('navigation', { name: `${tenant.name} admin` })
        .getByRole('link', { name: 'Overview' })
        .click();
    } else {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await page
        .getByRole('dialog', { name: 'Navigation' })
        .getByRole('link', { name: 'Overview' })
        .click();
    }
    // A draft is not on the public page, so the tile does not count it.
    await expect(leagueTile(page).locator('dd').first()).toHaveText('0');
    await expect(leagueTile(page).locator('dd').nth(1)).toHaveText('None published yet');
    await expect(page.getByRole('region', { name: 'Get set up' })).toBeVisible();
  });
});

test.describe('who may open Leagues', () => {
  /** Every WebSocket message the page sends, so a test can show what it asked for. */
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
    test(`${label} sees the no-access view, and no league data is requested`, async ({
      page,
    }, testInfo) => {
      const user = newUser('Outsider');
      await signUp(page, user);
      const tenant = await seedTenant({
        name: 'E2E Closed',
        locations: LOCATIONS,
        leagues: [
          {
            name: 'Secret Draft',
            sport: 'soccer',
            locations: ['Redfish Flats Fields'],
            status: 'draft',
          },
        ],
      });
      if (role) {
        await convexRun('testing:addMembership', {
          organizationSlug: tenant.slug,
          email: user.email,
          role,
        });
      }
      const frames = sentFrames(page);
      await page.goto(`/app/organizations/${tenant.slug}/leagues`);
      await expect(
        main(page).getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
      ).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Secret Draft');
      expect(frames.join('\n')).toContain('organizations:getAdminContext');
      expect(frames.join('\n')).not.toContain('leagues:listForAdmin');
      await screenshot(page, testInfo, '66-leagues-no-access');
      await expectAccessible(page);
    });
  }

  test('an unknown slug shows the not-found view and requests no league data', async ({
    page,
  }, testInfo) => {
    await signUp(page, newUser('Lost'));
    const frames = sentFrames(page);
    await page.goto(`/app/organizations/does-not-exist-${randomBytes(3).toString('hex')}/leagues`);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible();
    expect(frames.join('\n')).toContain('organizations:getAdminContext');
    expect(frames.join('\n')).not.toContain('leagues:listForAdmin');
    await screenshot(page, testInfo, '66-leagues-not-found');
    await expectAccessible(page);
  });

  test('an org admin of another organization is refused', async ({ page, browser }) => {
    const owner = await memberOf(page, 'orgAdmin', {
      locations: LOCATIONS,
      leagues: [
        {
          name: 'Hidden Draft',
          sport: 'soccer',
          locations: ['Redfish Flats Fields'],
          status: 'draft',
        },
      ],
    });
    const intruder = await browser.newPage({ baseURL });
    try {
      await memberOf(intruder, 'orgAdmin');
      await intruder.goto(`${owner.base}/leagues`);
      await expect(
        intruder.getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
      ).toBeVisible();
      await expect(intruder.locator('body')).not.toContainText('Hidden Draft');
    } finally {
      await intruder.context().close();
    }
  });
});
