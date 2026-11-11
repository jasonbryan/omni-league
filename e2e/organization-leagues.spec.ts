import { MAX_LEAGUE_NAME_LENGTH } from '../convex/lib/leagueInput';
import type { Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { checkReflow, REFLOW_WIDTH, expectAccessible, tabKey } from './support/a11y';
import { chipLabel, chooseChip } from './support/chip';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { failFirstAnswer } from './support/fail-first-answer';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { fetchRawHtml } from './support/raw-html';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import {
  controlsInTabOrder,
  expectWhollyAboveFooter,
  expectAtMostTwoLines,
  expectStatusOnTopOfButtonInStaticFooter,
  expectOnScreen,
  expectVisibleInFooter,
  footerHeight,
  PHONE,
  footerTabWalk,
  settleAfterFocusScroll,
  underTheFooter,
} from './support/sticky-footer';
import { expectLinkHeights } from './support/link-heights';
import { seedBatch } from './support/seed-batch';
import { newTenant, numberedLocations, seedTenant, type TenantSeed } from './support/tenant';
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

type Role = 'orgAdmin' | 'leagueOrganizer';

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
const leagueCount = (page: Page) =>
  main(page)
    .locator('[data-slot="overview-counts"]')
    .getByRole('link', { name: /leagues?$/ });

const DEFAULT_FORMAT: Record<string, string> = {
  'Beach volleyball': '4v4',
  Soccer: '7v7',
  Softball: '10v10',
};

async function createDraft(
  page: Page,
  league: { name: string; slug?: string; sport: string; locations: string[] },
) {
  await page.locator('#name').fill(league.name);
  if (league.slug !== undefined) await page.locator('#slug').fill(league.slug);
  await chooseChip(chipLabel(page, league.sport));
  await chooseChip(chipLabel(page, DEFAULT_FORMAT[league.sport]));
  for (const location of league.locations) {
    await page.getByRole('checkbox', { name: location }).click();
  }
  await submit(page).click();
}

test.describe('Leagues: creating a draft', () => {
  test('creates a draft: Draft in the list, the status next to the button, the form cleared, and nothing on the public page', async ({
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
    await chooseChip(chipLabel(page, 'Beach volleyball'));
    await expect(page.getByRole('radio', { name: '4v4' })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Pelican Shoals Sand Courts' }).click();
    await screenshot(page, testInfo, '66-leagues-filled');
    await submit(page).click();

    const status = form(page).getByRole('status').filter({ hasText: 'created as a draft' });
    await expect(status).toHaveText(
      /^Sunday Reverse Coed 4s created as a draft\.\s*Add the first season$/,
    );
    await expect(page.locator('#name')).toHaveValue('');
    await expect(page.locator('#slug')).toHaveValue('');
    await expect(page.getByRole('radio', { name: 'Beach volleyball' })).not.toBeChecked();
    await expect(submit(page)).toBeFocused();

    await expect(leagueRows(page)).toHaveCount(1);
    const row = leagueRows(page).first();
    await expect(row.locator('h3')).toHaveText('Sunday Reverse Coed 4s');
    await expect(row.locator('[data-slot="badge"]')).toHaveText(['Draft', 'Beach volleyball']);
    await expect(row.locator('[data-slot="league-division"]')).toHaveText('Coed · 4v4 · Rec');
    await expect(row).toContainText('Pelican Shoals Sand Courts');
    await screenshot(page, testInfo, '66-leagues-created');
    await expectAccessible(page);

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

  test('Slug follows the name until it is edited', VIEWPORT_AGNOSTIC, async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
    await page.goto(`${base}/leagues`);
    await page.locator('#name').fill('Sunday Reverse Coed 4s');
    await expect(page.locator('#slug')).toHaveValue('sunday-reverse-coed-4s');
    await page.locator('#name').fill('Men D Division');
    await expect(page.locator('#slug')).toHaveValue('men-d-division');
    await page.locator('#slug').fill('mens-d');
    await page.locator('#name').fill('Men D Division Slow-Pitch');
    await expect(page.locator('#slug')).toHaveValue('mens-d');
  });

  test('refuses a form submitted empty with every message, and creates nothing', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
    await page.goto(`${base}/leagues`);
    await submit(page).click();
    await expect(page.locator('#name-error')).toHaveText('Enter the league’s name.');
    await expect(page.locator('#slug-error')).toHaveText('Enter a web address for the league.');
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
    await chooseChip(chipLabel(page, 'Soccer'));
    await submit(page).click();
    await expect(page.locator('#format-error')).toBeVisible();
    await expect(page.getByRole('radio', { name: '4v4' })).toBeFocused();
    await chooseChip(chipLabel(page, '7v7'));
    await submit(page).click();
    await expect(page.locator('#locations-error')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Pelican Shoals Sand Courts' })).toBeFocused();
    await expect(page.getByText('No leagues yet')).toBeVisible();
  });

  test('an invalid slug shows the format message and creates nothing', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
    await page.goto(`${base}/leagues`);
    await page.locator('#name').fill('Fine');
    await chooseChip(chipLabel(page, 'Soccer'));
    await page.getByRole('checkbox', { name: 'Redfish Flats Fields' }).click();
    for (const slug of ['Bad Slug', 'ab', 'new']) {
      await page.locator('#slug').fill(slug);
      await submit(page).click();
      await expect(page.locator('#slug-error')).toContainText(
        'Use 3 to 60 lowercase letters and digits, with single hyphens between them. Some web addresses, like new, are reserved.',
      );
      await expect(page.locator('#slug')).toBeFocused();
    }
    await expect(page.getByText('No leagues yet')).toBeVisible();
  });

  test.describe('a slug used by a league of the organization', () => {
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
        'sand-4s is already taken. Choose another web address.',
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

  test('the same slug in another organization is allowed', VIEWPORT_AGNOSTIC, async ({ page }) => {
    const first = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
    await page.goto(`${first.base}/leagues`);
    await createDraft(page, {
      name: 'Shared Name',
      sport: 'Soccer',
      locations: ['Redfish Flats Fields'],
    });
    await expect(leagueRows(page)).toHaveCount(1);

    const { tenant: second, args } = newTenant({ name: 'E2E Leagues', locations: LOCATIONS });
    await seedBatch({
      tenant: args,
      memberships: [{ email: first.user.email, role: 'orgAdmin' }],
    });
    await page.goto(`/app/organizations/${second.slug}/leagues`);
    await createDraft(page, {
      name: 'Shared Name',
      sport: 'Soccer',
      locations: ['Redfish Flats Fields'],
    });
    await expect(leagueRows(page)).toHaveCount(1);
    await expect(page.locator('#slug-error')).toHaveCount(0);
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

  test('the form replacing the loading skeleton keeps the scroll where the user left it (360)', async ({
    page,
  }) => {
    test.skip(
      (page.viewportSize()?.width ?? 0) >= 1024,
      'the phone layout, where the form is below the list',
    );
    const { base } = await memberOf(page, 'orgAdmin', {
      locations: LOCATIONS,
      leagues: ['Coed 7v7 Rec', 'Sunday Reverse Coed 4s', 'Wednesday Coed Slow-Pitch'].map(
        (name) => ({ name, sport: 'soccer' as const, locations: [LOCATIONS[0].name] }),
      ),
    });
    const held = await holdQueries(page, ['locations:listForAdmin']);
    await page.goto(`${base}/leagues`);
    await expect(leagueRows(page)).toHaveCount(3);
    await expect(page.locator('[data-slot="create-league-skeleton"]')).toBeVisible();
    await expect.poll(() => held.isHolding()).toBe(true);
    const nearTheBottom = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight - window.innerHeight - 40);
      return window.scrollY;
    });
    expect(nearTheBottom).toBeGreaterThan(0);
    held.release();
    await expect(form(page)).toBeVisible();
    await expect(page.locator('[data-slot="create-league-skeleton"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(nearTheBottom);
  });

  test.describe('"Create a league" pressed before the locations load (360)', () => {
    test.beforeEach(({ page }) => {
      test.skip((page.viewportSize()?.width ?? 0) >= 1024, 'the link is hidden from 1024px');
    });

    const jump = (page: Page) => main(page).getByRole('link', { name: 'Create a league' });
    const section = (page: Page) => page.locator('#create-league');
    const headerTitle = (page: Page) => page.locator('header p.truncate');
    const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

    async function pressWithLocationsHeld(page: Page) {
      const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
      const held = await holdQueries(page, ['locations:listForAdmin']);
      await page.goto(`${base}/leagues`);
      await expect(page.locator('[data-slot="create-league-skeleton"]')).toBeVisible();
      await expect.poll(() => held.isHolding()).toBe(true);
      await jump(page).click();
      await expect(section(page)).toBeFocused();
      return held;
    }

    test('focuses Name once the locations arrive', async ({ page }) => {
      const held = await pressWithLocationsHeld(page);
      held.release();
      await expect(page.locator('#name')).toBeFocused();
    });

    test('a tap on the header title leaves Name unfocused and the page where it is', async ({
      page,
    }) => {
      const held = await pressWithLocationsHeld(page);
      await headerTitle(page).tap();
      const focusedAfterTap = await page.evaluateHandle(() => document.activeElement);
      const before = await scrollY(page);
      held.release();
      await expect(form(page)).toBeVisible();
      await expect(page.locator('#name')).not.toBeFocused();
      expect(
        await page.evaluate((element) => document.activeElement === element, focusedAfterTap),
      ).toBe(true);
      expect(await scrollY(page)).toBe(before);
    });

    test('a click on the form heading keeps the jump', async ({ page }) => {
      const held = await pressWithLocationsHeld(page);
      await page.locator('#create-league-heading').click();
      held.release();
      await expect(page.locator('#name')).toBeFocused();
    });

    test.describe('with the first answer failing', () => {
      test('the alert takes focus, and the form that replaces it gives focus to the section', async ({
        page,
      }) => {
        const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
        const failure = await failFirstAnswer(page, 'locations:listForAdmin');
        await page.goto(`${base}/leagues`);
        const alert = page
          .getByRole('alert')
          .filter({ hasText: 'The locations could not be loaded.' });
        await expect(alert).toBeVisible();
        await jump(page).click();
        await expect(alert).toBeFocused();

        await failure.reconnect();
        await expect(form(page)).toBeVisible();
        await expect(section(page)).toBeFocused();
        await expect(page.locator('#name')).not.toBeFocused();
      });
    });
  });
});

test.describe('Leagues: landing on #create-league', () => {
  const name = (page: Page) => page.locator('#name');
  const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
  // A wheel gesture can still scroll the page after the event, so the offset is read once it stops changing.
  const GESTURE_SETTLE_MS = 600;
  const settledScrollY = (page: Page) =>
    page.evaluate(async (settleMs) => {
      let last = -1;
      while (window.scrollY !== last) {
        last = window.scrollY;
        await new Promise((resolve) => setTimeout(resolve, settleMs));
      }
      return last;
    }, GESTURE_SETTLE_MS);
  const expectFocusOnPageOrMain = async (page: Page) =>
    expect
      .poll(() =>
        page.evaluate(
          () => document.activeElement === document.body || document.activeElement?.id === 'main',
        ),
      )
      .toBe(true);
  const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 1024;
  const LEAGUES = ['Coed 7v7 Rec', 'Sunday Reverse Coed 4s', 'Wednesday Coed Slow-Pitch'].map(
    (league) => ({ name: league, sport: 'soccer' as const, locations: [LOCATIONS[0].name] }),
  );

  test('opened directly, lands on Name, on screen, and passes axe', async ({ page }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS, leagues: LEAGUES });
    await page.goto(`${base}/leagues#create-league`);
    await expect(leagueRows(page)).toHaveCount(3);
    await expect(name(page)).toBeFocused();
    await expectOnScreen(page, name(page));
    await expect(page.locator('#name-error')).toHaveCount(0);
    await screenshot(page, testInfo, '635-create-league-landing');
    await expectAccessible(page);
  });

  test('without the fragment, scrolls nowhere and leaves focus on <main>', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS, leagues: LEAGUES });
    await page.goto(`${base}/leagues`);
    await expect(form(page)).toBeVisible();
    await expectFocusOnPageOrMain(page);
    expect(await scrollY(page)).toBe(0);
  });

  test('with the locations held, shows the skeleton with focus on <main>, then lands on Name', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS, leagues: LEAGUES });
    const held = await holdQueries(page, ['locations:listForAdmin']);
    await page.goto(`${base}/leagues#create-league`);
    await expect(page.locator('[data-slot="create-league-skeleton"]')).toBeVisible();
    await expect.poll(() => held.isHolding()).toBe(true);
    await expectFocusOnPageOrMain(page);
    held.release();
    await expect(name(page)).toBeFocused();
    await expectOnScreen(page, name(page));
  });

  test('an organization with no locations lands on "Go to Locations", on screen', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/leagues#create-league`);
    const link = page.locator('#create-league').getByRole('link', { name: 'Go to Locations' });
    await expect(link).toBeFocused();
    await expectOnScreen(page, link);
  });

  test('locations that could not be loaded land on the alert, on screen', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
    await failFirstAnswer(page, 'locations:listForAdmin');
    await page.goto(`${base}/leagues#create-league`);
    const alert = page.getByRole('alert').filter({ hasText: 'The locations could not be loaded.' });
    await expect(alert).toBeFocused();
    await expectOnScreen(page, alert);
  });

  test.describe('with the admin context held', () => {
    async function openHeld(page: Page) {
      const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS, leagues: LEAGUES });
      const held = await holdQueries(page, ['organizations:getAdminContext']);
      await page.goto(`${base}/leagues#create-league`);
      await expect.poll(() => held.isHolding()).toBe(true);
      return held;
    }

    async function expectStaysWhereTheUserLeftIt(page: Page, held: { release: () => void }) {
      const focused = await page.evaluateHandle(() => document.activeElement);
      const before = await settledScrollY(page);
      held.release();
      await expect(leagueRows(page)).toHaveCount(3);
      await expect(form(page)).toBeVisible();
      expect(await page.evaluate((element) => document.activeElement === element, focused)).toBe(
        true,
      );
      expect(await scrollY(page)).toBe(before);
      await expect(name(page)).not.toBeFocused();
    }

    test('Page Down cancels the landing', async ({ page }) => {
      const held = await openHeld(page);
      await page.keyboard.press('PageDown');
      await expectStaysWhereTheUserLeftIt(page, held);
    });

    test('a real mouse wheel cancels the landing', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'the wheel is sent through the Chromium protocol');
      const held = await openHeld(page);
      await page.evaluate(() => {
        (window as unknown as { wheels: number }).wheels = 0;
        document.addEventListener(
          'wheel',
          () => (window as unknown as { wheels: number }).wheels++,
          { capture: true, passive: true },
        );
      });
      const session = await page.context().newCDPSession(page);
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: 100,
        y: 300,
        deltaX: 0,
        deltaY: 200,
      });
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { wheels: number }).wheels))
        .toBeGreaterThan(0);
      await expectStaysWhereTheUserLeftIt(page, held);
    });
  });

  test.describe('with the locations held, on a phone', () => {
    test.beforeEach(({ page }) => {
      test.skip(!isPhone(page), 'a tap on the header title needs the touch layout');
    });

    async function openHeld(page: Page) {
      const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS, leagues: LEAGUES });
      const held = await holdQueries(page, ['locations:listForAdmin']);
      await page.goto(`${base}/leagues#create-league`);
      await expect(page.locator('[data-slot="create-league-skeleton"]')).toBeVisible();
      await expect.poll(() => held.isHolding()).toBe(true);
      return held;
    }

    test('a tap on the header title cancels the landing', async ({ page }) => {
      const held = await openHeld(page);
      await page.locator('header p.truncate').tap();
      const focused = await page.evaluateHandle(() => document.activeElement);
      const before = await scrollY(page);
      held.release();
      await expect(form(page)).toBeVisible();
      await expect(name(page)).not.toBeFocused();
      expect(await page.evaluate((element) => document.activeElement === element, focused)).toBe(
        true,
      );
      expect(await scrollY(page)).toBe(before);
    });

    test('a tap on the h1 text keeps the landing', async ({ page }) => {
      const held = await openHeld(page);
      await main(page).getByRole('heading', { level: 1, name: 'Leagues' }).tap();
      held.release();
      await expect(name(page)).toBeFocused();
    });
  });

  test('lands once: a later live update leaves focus where the user put it', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
    await page.goto(`${base}/leagues`);
    const opened = await page.context().newPage();
    await opened.setViewportSize(page.viewportSize()!);
    await opened.goto(`${base}/leagues#create-league`);
    await expect(name(opened)).toBeFocused();

    await opened.locator('#slug').focus();
    await createDraft(page, {
      name: 'Live Draft',
      sport: 'Soccer',
      locations: [LOCATIONS[0].name],
    });
    await expect(leagueRows(opened)).toHaveCount(1);
    await expect(opened.locator('#slug')).toBeFocused();
  });

  test('Back from a league page lands on Name again', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS, leagues: LEAGUES });
    await page.goto(`${base}/leagues#create-league`);
    await expect(name(page)).toBeFocused();

    await leagueRows(page).first().getByRole('link').first().click();
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Coed 7v7 Rec');

    await page.goBack();
    await expect(page).toHaveURL(`${baseURL}${base}/leagues#create-league`);
    await expect(leagueRows(page)).toHaveCount(3);
    await expect(name(page)).toBeFocused();
    await expectOnScreen(page, name(page));
  });

  for (const [label, role] of [
    ['a league organizer', 'leagueOrganizer'],
    ['a signed-in user with no membership', null],
  ] as const) {
    test(`${label} sees the no-access view with focus on <main> and no scroll`, async ({
      page,
    }) => {
      const user = newUser('Outsider');
      await signUp(page, user);
      const tenant = await seedTenant({ name: 'E2E Closed', locations: LOCATIONS });
      if (role) {
        await convexRun('testing:addMembership', {
          organizationSlug: tenant.slug,
          email: user.email,
          role,
        });
      }
      await page.goto(`/app/organizations/${tenant.slug}/leagues#create-league`);
      await expect(
        main(page).getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
      ).toBeVisible();
      await expectFocusOnPageOrMain(page);
      await expect(page.locator('#create-league')).toHaveCount(0);
      expect(await scrollY(page)).toBe(0);
    });
  }
});

test.describe('Leagues: defaults and the next step', () => {
  test('an organization with one location has it checked, again after a create, and the status links to the new league', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: [LOCATIONS[0]] });
    await page.goto(`${base}/leagues`);
    const only = page.getByRole('checkbox', { name: LOCATIONS[0].name });
    await expect(only).toBeChecked();

    // Name and Sport are enough: the location needs no tick.
    await page.locator('#name').fill('Sunday Reverse Coed 4s');
    await chooseChip(chipLabel(page, 'Beach volleyball'));
    await submit(page).click();

    const status = form(page).getByRole('status').filter({ hasText: 'created as a draft' });
    await expect(status).toContainText('Sunday Reverse Coed 4s created as a draft.');
    await expect(leagueRows(page).first()).toContainText(LOCATIONS[0].name);
    await expect(page.locator('#name')).toHaveValue('');
    await expect(only).toBeChecked();
    await screenshot(page, testInfo, '209-leagues-created-next-step');
    await expectAccessible(page);

    const next = status.getByRole('link', { name: 'Add the first season', exact: true });
    await expect(next).toHaveAttribute('href', `${base}/leagues/sunday-reverse-coed-4s`);
    await next.click();
    await expect(page).toHaveURL(`${base}/leagues/sunday-reverse-coed-4s`);
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
      'Sunday Reverse Coed 4s',
    );
  });

  test('with two locations none is checked', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
    await page.goto(`${base}/leagues`);
    await expect(form(page).getByRole('checkbox')).toHaveCount(2);
    await expect(form(page).getByRole('checkbox', { checked: true })).toHaveCount(0);
  });
});

test.describe('Leagues: the create form on a phone', () => {
  test('the Create button stays at the bottom of the viewport while the form is taller than it', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: numberedLocations(3) });
    await page.setViewportSize(PHONE);
    await page.goto(`${base}/leagues`);
    await page.locator('#name').focus();
    expect((await form(page).boundingBox())!.height).toBeGreaterThan(PHONE.height);
    await expect(submit(page)).toBeInViewport({ ratio: 1 });
    const box = (await submit(page).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
    expect(box.y).toBeGreaterThan(PHONE.height - 80);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(submit(page)).toBeInViewport({ ratio: 1 });
  });

  test('Create pressed with Name empty focuses Name wholly above the sticky button', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: numberedLocations(3) });
    await page.setViewportSize(PHONE);
    await page.goto(`${base}/leagues`);
    await expect(form(page)).toBeVisible();

    await submit(page).click();

    await expect(page.locator('#name-error')).toBeVisible();
    await expectWhollyAboveFooter(page, page.locator('#name'));
  });

  test('Tab from the control before Name brings Name wholly above the sticky button', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: numberedLocations(3) });
    await page.setViewportSize(PHONE);
    await page.goto(`${base}/leagues`);
    await expect(form(page)).toBeVisible();
    await main(page).getByRole('link', { name: 'Create a league' }).focus();

    await page.keyboard.press(tabKey(page));

    await expectWhollyAboveFooter(page, page.locator('#name'));
  });

  test('a keyboard user Tabbing through every field never has one under the sticky button, as cleared Name and Slug show their errors (WCAG 2.4.11)', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: numberedLocations(3) });
    await page.setViewportSize(PHONE);
    await page.goto(`${base}/leagues`);
    await page.locator('#name').focus();
    // An untouched field shows no error when left, so Name is typed and cleared, which clears Slug.
    await page.keyboard.type('Sunday');
    await page.locator('#name').fill('');

    const seen = await footerTabWalk(page, { form: form(page), until: submit(page) });

    await expect(page.locator('#name-error')).toBeVisible();
    await expect(page.locator('#slug-error')).toBeVisible();
    expect(controlsInTabOrder(seen)).toEqual([
      'name',
      'slug',
      expect.stringMatching(/^sport/),
      'location-1',
      'location-2',
      'location-3',
      'BUTTON',
    ]);
    expect(underTheFooter(seen)).toEqual([]);
  });

  test('Create with every location unticked, pressed from the bottom of the form, focuses the first location box above the sticky button', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: numberedLocations(3) });
    await page.setViewportSize(PHONE);
    await page.goto(`${base}/leagues`);
    await page.locator('#name').fill('Sunday Reverse Coed 4s');
    await chooseChip(chipLabel(page, 'Beach volleyball'));
    await chooseChip(chipLabel(page, DEFAULT_FORMAT['Beach volleyball']));
    await expect(page.locator('#slug')).toHaveValue('sunday-reverse-coed-4s');
    for (const box of await page.getByRole('checkbox', { name: /^Location/ }).all()) {
      await expect(box).not.toBeChecked();
    }
    await form(page).evaluate((element) => element.scrollIntoView({ block: 'end' }));

    await submit(page).click();

    await expect(page.locator('#locations-error')).toBeVisible();
    await expectWhollyAboveFooter(page, page.locator('#location-1'));
  });

  test('Shift+Tab from the Create button back through the fields never leaves one under it', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: numberedLocations(6) });
    await page.setViewportSize(PHONE);
    await page.goto(`${base}/leagues`);
    await submit(page).focus();
    const back = `Shift+${tabKey(page)}`;

    for (let step = 0; step < 9; step++) {
      await page.keyboard.press(back);
      // WebKit scrolls to the newly focused control in a later frame, not as focus moves.
      await settleAfterFocusScroll(page);
      const clear = await page.evaluate(() => {
        const active = document.activeElement as HTMLElement;
        // A chip's radio is visually hidden: its label is what the user sees.
        const face = active.closest('label') ?? active;
        const rect = face.getBoundingClientRect();
        const footer = document.querySelector('[data-slot="form-footer"]')!.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return {
          control: active.id || active.tagName,
          visible: rect.top >= 0,
          above: rect.bottom <= footer.top,
          hit: !!hit && face.contains(hit),
        };
      });
      expect(clear, `step ${step + 1}`).toMatchObject({ visible: true, above: true, hit: true });
    }
  });

  test('every location, however far down, can be clicked once the page is scrolled to it', async ({
    page,
    browserName,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: numberedLocations(8) });
    await page.setViewportSize(PHONE);
    await page.goto(`${base}/leagues`);
    await page.locator('#name').focus();
    await expect(submit(page)).toBeInViewport({ ratio: 1 });
    // Playwright's mobile WebKit has no mouse wheel and no touch swipe, so the page scrolls by script.
    const swipeBy = (dy: number) =>
      browserName === 'webkit'
        ? page.evaluate((top) => window.scrollBy({ top, behavior: 'instant' }), dy)
        : page.mouse.wheel(0, dy);
    const pressAt = (x: number, y: number) =>
      browserName === 'webkit' ? page.touchscreen.tap(x, y) : page.mouse.click(x, y);

    for (let n = 1; n <= 8; n++) {
      const location = page.getByRole('checkbox', { name: `Location 0${n}` });
      // Scrolling by hand, as a thumb does, until the checkbox is clear of the sticky button.
      let box = (await location.boundingBox())!;
      const footerTop = (await form(page).locator('[data-slot="form-footer"]').boundingBox())!.y;
      for (let swipe = 0; swipe < 40 && !(box.y >= 0 && box.y + box.height <= footerTop); swipe++) {
        await swipeBy(box.y < 0 ? -80 : 80);
        await page.waitForTimeout(30);
        box = (await location.boundingBox())!;
      }
      expect(box.y, `Location 0${n} scrolled into view`).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height, `Location 0${n} above the button`).toBeLessThanOrEqual(footerTop);
      await pressAt(box.x + box.width / 2, box.y + box.height / 2);
      await expect(location).toBeChecked();
    }
  });

  test('at 1280px the button is in the flow, as before', async ({ page }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${base}/leagues`);
    const footer = form(page).locator('[data-slot="form-footer"]');
    const style = await footer.evaluate((element) => {
      const css = getComputedStyle(element);
      return { position: css.position, border: css.borderTopWidth, padding: css.paddingTop };
    });
    expect(style).toEqual({ position: 'static', border: '0px', padding: '0px' });
    await expect(submit(page)).toHaveCSS('width', `${(await footer.boundingBox())!.width}px`);
    await screenshot(page, testInfo, '209-leagues-form-desktop');
  });
});

test.describe('Leagues: the created status on a phone', () => {
  const SUNDAY = {
    name: 'Sunday Reverse Coed 4s',
    sport: 'Beach volleyball',
    locations: ['Location 01'],
  };
  const created = (page: Page, name = SUNDAY.name) =>
    form(page).getByRole('status').getByText(`${name} created as a draft.`);
  const nextStep = (page: Page) =>
    form(page).getByRole('status').getByRole('link', { name: 'Add the first season' });

  async function createFromTheBottom(page: Page, league = SUNDAY) {
    const { base } = await memberOf(page, 'orgAdmin', { locations: numberedLocations(3) });
    await page.setViewportSize(PHONE);
    await page.goto(`${base}/leagues`);
    await page.locator('#name').fill(league.name);
    await page.locator('#slug').fill('sunday-reverse-coed-4s');
    await chooseChip(chipLabel(page, league.sport));
    await chooseChip(chipLabel(page, DEFAULT_FORMAT[league.sport]));
    for (const location of league.locations) {
      await page.getByRole('checkbox', { name: location }).click();
    }
    await form(page).evaluate((element) => element.scrollIntoView({ block: 'end' }));
    await submit(page).click();
    await expect(created(page, league.name)).toBeAttached();
    return base;
  }

  test('Create pressed at the bottom of the form shows "<league> created as a draft." and "Add the first season" next to it, with focus kept on Create', async ({
    page,
  }) => {
    const base = await createFromTheBottom(page);

    await expectVisibleInFooter(page, created(page));
    await expectVisibleInFooter(page, nextStep(page));
    await expect(nextStep(page)).toHaveAttribute('href', `${base}/leagues/sunday-reverse-coed-4s`);
    await expect(submit(page)).toBeFocused();
  });

  test('the created status goes once the user types in Name', async ({ page }) => {
    await createFromTheBottom(page);

    await page.locator('#name').pressSequentially('S');

    await expect(created(page)).toHaveCount(0);
    await expect(nextStep(page)).toHaveCount(0);
  });

  test('with a 100-character name the title takes two lines, the footer stays within 200px, and "Add the first season" is 44px tall', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name === 'chromium-desktop',
      'the 44px touch-target height applies to a coarse pointer',
    );
    const name =
      'Sunday Reverse Coed Fours at Pelican Shoals with Late Starts, Short Rallies, and Sand That Stays Hot';
    expect(name).toHaveLength(MAX_LEAGUE_NAME_LENGTH);
    await createFromTheBottom(page, { ...SUNDAY, name });

    await expectVisibleInFooter(page, nextStep(page));
    await expectAtMostTwoLines(form(page).locator('[data-slot="created-title"]'));
    expect(await footerHeight(form(page))).toBeLessThanOrEqual(200);
    await expectLinkHeights(page, nextStep(page), 'touch');
  });

  test('with a 100-character name holding one 60-character word, the page does not scroll sideways at 320px and the title keeps to two lines', async ({
    page,
  }) => {
    const name = `${'W'.repeat(60)} Sunday Reverse Coed Fours at Pelican Shoals`.slice(
      0,
      MAX_LEAGUE_NAME_LENGTH,
    );
    await createFromTheBottom(page, { ...SUNDAY, name });

    expect(await checkReflow(page)).toMatchObject({ passed: true });

    await page.setViewportSize({ width: REFLOW_WIDTH, height: 640 });
    await expectAtMostTwoLines(form(page).locator('[data-slot="created-title"]'));
  });

  test('Tabbing through the cleared form from Name with the created status shown never leaves a control under the taller footer (WCAG 2.4.11)', async ({
    page,
  }) => {
    await createFromTheBottom(page);
    await page.locator('#name').focus();

    const seen = await footerTabWalk(page, { form: form(page), until: submit(page) });

    await expect(submit(page)).toBeFocused();
    await expect(created(page)).toBeVisible();
    expect(controlsInTabOrder(seen)).toEqual([
      'name',
      'slug',
      expect.stringMatching(/^sport/),
      'location-1',
      'location-2',
      'location-3',
      'A',
      'BUTTON',
    ]);
    expect(underTheFooter(seen)).toEqual([]);
  });

  test('with the created status shown, the page passes axe and does not scroll sideways at 320px', async ({
    page,
  }, testInfo) => {
    await createFromTheBottom(page);
    await screenshot(page, testInfo, '445-leagues-created-phone');
    await expectAccessible(page);
  });
});

test.describe('Leagues: the created status on wider screens', () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== 'chromium-desktop', 'each test sets its own width');
  });

  for (const width of [768, 1280]) {
    test(`at ${width}px the created status sits on top of Create in the footer`, async ({
      page,
    }, testInfo) => {
      const { base } = await memberOf(page, 'orgAdmin', { locations: LOCATIONS });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/leagues`);
      await createDraft(page, {
        name: 'Sunday Reverse Coed 4s',
        sport: 'Beach volleyball',
        locations: [LOCATIONS[1].name],
      });
      const status = form(page).getByRole('status').filter({ hasText: 'created as a draft' });
      await expect(status).toBeVisible();

      await expectStatusOnTopOfButtonInStaticFooter(form(page), status, submit(page));
      await screenshot(page, testInfo, '445-leagues-created');
    });
  }
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

test.describe('Overview: the league count and the checklist', () => {
  test('a new organization shows "0 leagues" and the four steps; the sidebar lists Leagues', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin');
    await page.goto(base);
    await expect(leagueCount(page)).toHaveText('0 leagues');
    const setup = page.getByRole('region', { name: 'Get set up' });
    await expect(setup.getByRole('heading', { level: 3 })).toHaveText([
      'Add a location',
      'Create a league',
      'Publish the league',
      'Invite staff (optional)',
    ]);
    await screenshot(page, testInfo, '66-overview-new');
    await expectAccessible(page);
    if ((page.viewportSize()?.width ?? 0) >= 1024) {
      await expect(
        page.getByRole('navigation', { name: `${tenant.name} admin` }).getByRole('link'),
      ).toHaveText([
        /Switch organization/,
        'Overview',
        /^Leagues\d*$/,
        /^Locations\d*$/,
        /^Staff\d*$/,
        'Details',
        'View public page',
      ]);
    }
    await setup.getByRole('link', { name: 'Create a league' }).click();
    await expect(page).toHaveURL(`${baseURL}${base}/leagues#create-league`);
  });

  test('with only drafts the tile reads 2 and 2 drafts and the list stays; with published leagues it reads the published count and the list is hidden', async ({
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
    await expect(leagueCount(page)).toHaveText('2 leagues');
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
    await expect(leagueCount(page)).toHaveText('4 leagues');
    await expect(page.getByRole('region', { name: 'Get set up' })).toHaveCount(0);
    await screenshot(page, testInfo, '66-overview-published');
    await expectAccessible(page);
  });

  test('a league created on the Leagues page is a draft: the tile reads "1 draft" and the checklist stays', async ({
    page,
  }) => {
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
    await expect(leagueCount(page)).toHaveText('1 league');
    await expect(page.getByRole('region', { name: 'Get set up' })).toBeVisible();
  });
});

test.describe('who may open Leagues', () => {
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
      `${label} sees the no-access view, and no league data is requested`,
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
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
      },
    );
  }

  test('the no-access view is saved as a screenshot and passes the axe helper', async ({
    page,
  }, testInfo) => {
    await signUp(page, newUser('Outsider'));
    const tenant = await seedTenant({ name: 'E2E Closed', locations: LOCATIONS });
    await page.goto(`/app/organizations/${tenant.slug}/leagues`);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'You can’t manage this organization' }),
    ).toBeVisible();
    await screenshot(page, testInfo, '66-leagues-no-access');
    await expectAccessible(page);
  });

  test(
    'an unknown slug shows the not-found view and requests no league data',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      await signUp(page, newUser('Lost'));
      const frames = sentFrames(page);
      await page.goto(
        `/app/organizations/does-not-exist-${randomBytes(3).toString('hex')}/leagues`,
      );
      await expect(
        main(page).getByRole('heading', { level: 1, name: 'Page not found' }),
      ).toBeVisible();
      expect(frames.join('\n')).toContain('organizations:getAdminContext');
      expect(frames.join('\n')).not.toContain('leagues:listForAdmin');
    },
  );

  test('the not-found view is saved as a screenshot and passes the axe helper', async ({
    page,
  }, testInfo) => {
    await signUp(page, newUser('Lost'));
    await page.goto(`/app/organizations/does-not-exist-${randomBytes(3).toString('hex')}/leagues`);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeVisible();
    await screenshot(page, testInfo, '66-leagues-not-found');
    await expectAccessible(page);
  });

  test(
    'an org admin of another organization is refused',
    VIEWPORT_AGNOSTIC,
    async ({ page, browser }) => {
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
    },
  );
});

test.describe('Leagues: Men and Women divisions', () => {
  test('the list shows Men or Women in each division label, never the possessive', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin', {
      locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
      leagues: [
        {
          name: 'Men Over-30 11v11',
          sport: 'soccer',
          locations: ['Alpha Field'],
          division: { gender: 'mens', playersPerSide: 11, level: 'rec', ageGroup: 'over30' },
        },
        {
          name: 'Women 7v7 Intermediate',
          sport: 'soccer',
          locations: ['Alpha Field'],
          division: {
            gender: 'womens',
            playersPerSide: 7,
            level: 'intermediate',
            ageGroup: 'adult',
          },
        },
      ],
    });
    await page.goto(`${base}/leagues`);
    await expect(leagueRows(page).locator('[data-slot="league-division"]')).toHaveText([
      'Men · 11v11 · Rec · 30+',
      'Women · 7v7 · Intermediate',
    ]);
    await expect(main(page)).not.toContainText(/men['’]s/i);
    await expectAccessible(page);
    await screenshot(page, testInfo, '545-admin-leagues');
  });
});
