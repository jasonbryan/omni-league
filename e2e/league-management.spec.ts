import { MAX_SEASON_NAME_LENGTH } from '../convex/lib/seasonInput';
import type { Locator, Page } from '@playwright/test';
import { checkReflow, REFLOW_WIDTH, expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { screenshot } from './support/screenshot';
import { otherUser, signUp } from './support/session';
import {
  controlsInTabOrder,
  expectAtMostTwoLines,
  expectStatusOnTopOfButtonInStaticFooter,
  expectVisibleInFooter,
  footerHeight,
  settleAfterFocusScroll,
  PHONE,
  footerTabWalk,
  underTheFooter,
} from './support/sticky-footer';
import { seedTenant, type TenantSeed } from './support/tenant';
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

const LEAGUES: NonNullable<TenantSeed['leagues']> = [
  {
    name: 'Coed 7v7 Rec',
    sport: 'soccer',
    locations: ['Redfish Flats Fields'],
    division: { gender: 'coed', playersPerSide: 7, level: 'rec', ageGroup: 'adult' },
  },
  {
    name: 'Sand 2s',
    sport: 'beachVolleyball',
    locations: ['Pelican Shoals Sand Courts'],
    division: { gender: 'coed', playersPerSide: 2, level: 'b', ageGroup: 'adult' },
  },
  {
    name: 'Draft Softball',
    sport: 'softball',
    locations: ['Redfish Flats Fields'],
    status: 'draft',
    division: { gender: 'coed', playersPerSide: 10, level: 'rec', ageGroup: 'adult' },
  },
  {
    name: 'Raised Sand 6s',
    sport: 'beachVolleyball',
    locations: ['Pelican Shoals Sand Courts'],
    division: {
      gender: 'coed',
      playersPerSide: 6,
      level: 'bb',
      ageGroup: 'adult',
      minimumRosterSize: 8,
    },
  },
];

const COED = 'coed-7v7-rec';
const SAND = 'sand-2s';
const SOFTBALL = 'draft-softball';
const RAISED = 'raised-sand-6s';

type Role = 'orgAdmin' | 'leagueOrganizer' | null;

async function memberOf(
  page: Page,
  role: Role,
  assigned: string[] = [COED],
  organizationName = 'E2E Seasons',
) {
  const user = newUser(role === 'orgAdmin' ? 'Admin' : 'Organizer');
  await signUp(page, user);
  const tenant = await seedTenant({
    name: organizationName,
    locations: LOCATIONS,
    leagues: LEAGUES,
  });
  if (role === 'orgAdmin') {
    await convexRun('testing:addMembership', {
      organizationSlug: tenant.slug,
      email: user.email,
      role,
    });
  } else if (role === 'leagueOrganizer') {
    await convexRun('testing:addLeagueOrganizer', {
      organizationSlug: tenant.slug,
      email: user.email,
      leagueSlugs: assigned,
    });
  }
  return { user, tenant, base: `/app/organizations/${tenant.slug}` };
}

const main = (page: Page) => page.getByRole('main');
const breadcrumb = (page: Page) => main(page).getByRole('navigation', { name: 'Breadcrumb' });
const form = (page: Page) => page.locator('#create-season form');
const submit = (page: Page) => form(page).getByRole('button', { name: /^Create draft season/ });
const rows = (page: Page) => page.locator('#seasons-list > li');
const fromLeague = (page: Page) => page.locator('section[aria-labelledby="from-league-heading"]');

async function fillFall2026(page: Page) {
  await page.locator('#name').fill('Fall 2026');
  await expect(page.locator('#slug')).toHaveValue('fall-2026');
  await page.locator('#start-date').fill('2026-09-01');
  await page.locator('#end-date').fill('2026-11-15');
  await page.locator('#registration-deadline').fill('2026-08-25');
}

test.describe('League management: an org admin', () => {
  test('creates Fall 2026 as a draft: listed as Draft with 7v7, the minimum, and the deadline', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/leagues/${COED}`);
    await expect(page).toHaveTitle(`Coed 7v7 Rec | ${tenant.name} | Omni League`);
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Coed 7v7 Rec');
    await expect(page.getByText('No seasons yet')).toBeVisible();
    await expect(page.locator('#create-season').getByRole('radio')).toHaveCount(0);
    await expect(page.locator('#minimum-roster-size')).toHaveCount(0);
    await expect(fromLeague(page).locator('[data-slot="season-division"]')).toHaveText(
      'Coed · 7v7 · Rec',
    );
    await expect(fromLeague(page).locator('[data-slot="season-minimum"]')).toHaveText(
      '7 players, set by the 7v7 format',
    );
    await screenshot(page, testInfo, '125-league-empty');
    await expectAccessible(page);

    await fillFall2026(page);
    await screenshot(page, testInfo, '125-league-filled');
    await submit(page).click();

    const status = form(page).getByRole('status').filter({ hasText: 'created as a draft' });
    await expect(status).toContainText('Fall 2026 created as a draft.');
    await expect(page.locator('#name')).toHaveValue('');
    await expect(submit(page)).toBeFocused();

    await expect(rows(page)).toHaveCount(1);
    const row = rows(page).first();
    await expect(row.locator('h3')).toHaveText('Fall 2026');
    await expect(row.locator('[data-slot="badge"]')).toHaveText(['Draft']);
    await expect(row).toContainText('Sep 1 – Nov 15, 2026');
    await expect(row).toContainText('Registration deadline Aug 25, 2026');
    await expect(row).toContainText('7v7 · at least 7 players');
    await screenshot(page, testInfo, '125-league-created');
    await expectAccessible(page);
  });

  test('a league with a raised minimum shows it and gives its seasons that minimum', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/leagues/${RAISED}`);
    await expect(fromLeague(page).locator('[data-slot="season-division"]')).toHaveText(
      'Coed · 6v6 · BB',
    );
    await expect(fromLeague(page).locator('[data-slot="season-minimum"]')).toHaveText(
      '8 players, raised for this league',
    );
    await fillFall2026(page);
    await submit(page).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('6v6 · at least 8 players');
  });

  test('a breadcrumb above the h1 links to the admin Overview and Leagues, and the league is the current page', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/leagues/${COED}`);
    const crumbs = breadcrumb(page);
    await expect(crumbs.getByRole('listitem')).toHaveText([tenant.name, 'Leagues', 'Coed 7v7 Rec']);
    await expect(crumbs.getByRole('link', { name: tenant.name })).toHaveAttribute('href', base);
    await expect(crumbs.getByRole('link', { name: 'Leagues' })).toHaveAttribute(
      'href',
      `${base}/leagues`,
    );
    await expect(crumbs.getByRole('link', { name: 'Coed 7v7 Rec' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const [crumbsBox, headingBox] = await Promise.all([
      crumbs.boundingBox(),
      main(page).getByRole('heading', { level: 1 }).boundingBox(),
    ]);
    expect(crumbsBox!.y).toBeLessThan(headingBox!.y);
    await screenshot(page, testInfo, '125-league-breadcrumb');
    await expectAccessible(page);

    await crumbs.getByRole('link', { name: 'Leagues' }).click();
    await expect(page).toHaveURL(`${base}/leagues`);
  });

  test('the breadcrumb stays on one line at 320px without a horizontal scroll, and axe finds nothing', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`${base}/leagues/${COED}`);
    await expect(breadcrumb(page)).toBeVisible();
    const touch = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
    const crumbsBox = await breadcrumb(page).boundingBox();
    expect(crumbsBox!.height).toBe(touch ? 44 : 20);
    const { clientWidth, scrollWidth } = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    await expectAccessible(page);
  });

  test('with a long organization name, only the names shorten: Leagues stays whole at 320 and 360px, with no horizontal scroll', async ({
    page,
  }) => {
    const { base } = await memberOf(
      page,
      'orgAdmin',
      [COED],
      'Gulf Coast Sport and Social Club of the Greater Bay Area',
    );
    await page.goto(`${base}/leagues/${COED}`);
    const leagues = breadcrumb(page).getByRole('link', { name: 'Leagues' }).locator('span');
    for (const width of [320, 360]) {
      await page.setViewportSize({ width, height: 640 });
      await expect(leagues).toBeVisible();
      const fit = await leagues.evaluate((label) => ({
        label: { scroll: label.scrollWidth, client: label.clientWidth },
        page: {
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        },
      }));
      expect(fit.label.scroll, `Leagues at ${width}px`).toBeLessThanOrEqual(fit.label.client);
      expect(fit.page.scroll, `page at ${width}px`).toBeLessThanOrEqual(fit.page.client);
    }
  });

  test('the link in the league block moves to the league details', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/leagues/${COED}`);
    await fromLeague(page).getByRole('link', { name: 'edit the league details' }).click();
    await expect(page.locator('#details')).toBeInViewport();
    await expect(page.locator('#details input').first()).toBeFocused();
  });

  test('a typed date is fully visible in every date field at 360, 1024, and 1280px', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    for (const width of [360, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/leagues/${COED}`);
      for (const id of ['start-date', 'end-date', 'registration-deadline']) {
        const input = page.locator(`#${id}`);
        await input.fill('2026-09-01');
        const { clientWidth, scrollWidth } = await input.evaluate((el) => ({
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
        }));
        expect(clientWidth, `#${id} at ${width}px`).toBeGreaterThanOrEqual(150);
        expect(scrollWidth, `#${id} at ${width}px`).toBeLessThanOrEqual(clientWidth);
      }
    }
  });

  test('refuses a deadline on the start date and an end before the start, then accepts the day before', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/leagues/${COED}`);
    await fillFall2026(page);
    await page.locator('#registration-deadline').fill('2026-09-01');
    await page.locator('#end-date').fill('2026-08-31');
    await submit(page).click();
    await expect(page.locator('#end-date-error')).toHaveText(
      'The end date must be on or after the start date.',
    );
    await expect(page.locator('#registration-deadline-error')).toHaveText(
      'The registration deadline must be before the start date, Sep 1, 2026.',
    );
    await expect(page.locator('#end-date')).toBeFocused();
    await expect(rows(page)).toHaveCount(0);

    await page.locator('#end-date').fill('2026-11-15');
    await page.locator('#registration-deadline').fill('2026-08-31');
    await submit(page).click();
    await expect(rows(page)).toHaveCount(1);
  });

  test.describe('the slug is used', () => {
    test.use({ expectedConvexErrors: ['seasons:create'] });

    test('shows the message with the slug, and the same slug in another league is allowed', async ({
      page,
    }) => {
      const { base } = await memberOf(page, 'orgAdmin');
      await page.goto(`${base}/leagues/${COED}`);
      await fillFall2026(page);
      await submit(page).click();
      await expect(rows(page)).toHaveCount(1);

      await fillFall2026(page);
      await submit(page).click();
      await expect(page.locator('#slug-error')).toHaveText(
        'fall-2026 is already used by another season of Coed 7v7 Rec. Choose another slug.',
      );
      await expect(page.locator('#slug')).toBeFocused();
      await expect(rows(page)).toHaveCount(1);

      await page.goto(`${base}/leagues/${SAND}`);
      await page.locator('#name').fill('Fall 2026');
      await page.locator('#start-date').fill('2026-09-01');
      await page.locator('#end-date').fill('2026-11-15');
      await page.locator('#registration-deadline').fill('2026-08-25');
      await submit(page).click();
      await expect(rows(page)).toHaveCount(1);
      await expect(rows(page).first()).toContainText('2v2 · at least 2 players');
    });
  });

  test('reaches the page from the Leagues list, and lists seasons newest start date first', async ({
    page,
  }) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin');
    for (const [slug, name, startDate, status] of [
      ['spring-2027', 'Spring 2027', '2027-03-03', 'published'],
      ['fall-2027', 'Fall 2027', '2027-09-08', 'draft'],
      ['summer-2027', 'Summer 2027', '2027-06-02', 'published'],
    ] as const) {
      await convexRun('testing:seedSeason', {
        organizationSlug: tenant.slug,
        leagueSlug: COED,
        name,
        slug,
        startDate,
        endDate: '2027-12-01',
        registrationDeadline: '2027-01-01',
        playersPerSide: 7,
        minimumRosterSize: 7,
        status,
      });
    }
    await page.goto(`${base}/leagues`);
    await page.getByRole('link', { name: 'Coed 7v7 Rec' }).click();
    await expect(page).toHaveURL(new RegExp(`${base}/leagues/${COED}$`));
    await expect(rows(page).locator('h3')).toHaveText(['Fall 2027', 'Summer 2027', 'Spring 2027']);
    await expect(rows(page).locator('[data-slot="badge"]')).toHaveText([
      'Draft',
      'Published',
      'Published',
    ]);
    if (page.viewportSize()!.width < 1024) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
    await expect(
      page
        .getByRole('navigation', { name: `${tenant.name} admin` })
        .last()
        .locator('[aria-current]'),
    ).toHaveText(/^Leagues\d*$/);
  });

  test('creates a season in a draft league', async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/leagues/${SOFTBALL}`);
    await expect(main(page).locator('h1 + div [data-slot="badge"]').first()).toHaveText('Draft');
    await page.locator('#name').fill('Fall 2026');
    await page.locator('#start-date').fill('2026-09-01');
    await page.locator('#end-date').fill('2026-11-15');
    await page.locator('#registration-deadline').fill('2026-08-25');
    await submit(page).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('10v10 · at least 10 players');
  });
});

test.describe('League management: an assigned league organizer', () => {
  test('creates a season of their league, with their sidebar; another league of the organization is no access', async ({
    page,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'leagueOrganizer');
    await page.goto(`${base}/leagues/${COED}`);
    await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Coed 7v7 Rec');
    const nav = page.getByRole('navigation', { name: `${tenant.name} leagues` });
    if (page.viewportSize()!.width < 1024) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
    }
    await expect(nav.last().getByText('League organizer')).toBeVisible();
    await expect(nav.last().getByRole('link', { name: 'Coed 7v7 Rec' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    if (page.viewportSize()!.width < 1024) await page.keyboard.press('Escape');
    await screenshot(page, testInfo, '125-league-organizer');

    await fillFall2026(page);
    await submit(page).click();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first().locator('h3')).toHaveText('Fall 2026');

    await page.goto(`${base}/leagues/${SAND}`);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'You can’t manage this league' }),
    ).toBeVisible();
    await expect(page).toHaveTitle('No access | Omni League');
    await expect(page.locator('#create-season')).toHaveCount(0);
    await screenshot(page, testInfo, '125-league-no-access');
    await expectAccessible(page);
  });

  test('a breadcrumb reads Your organizations and the league, linking to /app, because the admin area is closed to them', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'leagueOrganizer');
    await page.goto(`${base}/leagues/${COED}`);
    const crumbs = breadcrumb(page);
    await expect(crumbs.getByRole('listitem')).toHaveText(['Your organizations', 'Coed 7v7 Rec']);
    await expect(crumbs.getByRole('link', { name: 'Your organizations' })).toHaveAttribute(
      'href',
      '/app',
    );
    await expect(crumbs.getByRole('link', { name: 'Coed 7v7 Rec' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expectAccessible(page);

    await crumbs.getByRole('link', { name: 'Your organizations' }).click();
    await expect(page).toHaveURL('/app');
  });

  test(
    'the sidebar lists every assigned league, drafts included, by name, and marks the one open',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { tenant, base } = await memberOf(page, 'leagueOrganizer', [COED, SAND, SOFTBALL]);
      await page.goto(`${base}/leagues/${SAND}`);
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Sand 2s');
      // The column is hidden below 1024px and the sheet is closed, so the checks read the element
      // wherever it is and do not depend on the screen.
      const leagues = page
        .getByRole('navigation', { name: `${tenant.name} leagues`, includeHidden: true })
        .first()
        .getByRole('list', { name: 'Your leagues', includeHidden: true })
        .getByRole('link', { includeHidden: true });
      const list = (name: string) => leagues.filter({ hasText: name });
      await expect(leagues).toHaveText(['Coed 7v7 Rec', 'Draft Softball', 'Sand 2s']);
      await expect(list('Sand 2s')).toHaveAttribute('aria-current', 'page');
      await expect(list('Coed 7v7 Rec')).not.toHaveAttribute('aria-current', /.*/);
      await expect(list('Draft Softball')).not.toHaveAttribute('aria-current', /.*/);
      await expect(list('Draft Softball')).toHaveAttribute('href', `${base}/leagues/${SOFTBALL}`);
      await page.goto((await list('Coed 7v7 Rec').getAttribute('href'))!);
      await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Coed 7v7 Rec');
      await expect(list('Coed 7v7 Rec')).toHaveAttribute('aria-current', 'page');
      await expect(list('Sand 2s')).not.toHaveAttribute('aria-current', /.*/);
    },
  );

  test('a draft league they are not assigned to is no access, not not found: they are staff', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'leagueOrganizer');
    await page.goto(`${base}/leagues/${SOFTBALL}`);
    await expect(
      main(page).getByRole('heading', { level: 1, name: 'You can’t manage this league' }),
    ).toBeVisible();
  });
});

test.describe('League management: callers who may not open it', () => {
  test('an org admin of another organization gets no access to a published league', async ({
    page,
    browser,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    const intruder = await otherUser(browser, newUser('Intruder'));
    try {
      await intruder.goto(`${base}/leagues/${COED}`);
      await expect(
        intruder.getByRole('heading', { level: 1, name: 'You can’t manage this league' }),
      ).toBeVisible();
    } finally {
      await intruder.context().close();
    }
  });

  test('a signed-in non-member gets not found for a draft league, so its slug is not revealed', async ({
    page,
    browser,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    const stranger = await otherUser(browser, newUser('Stranger'));
    try {
      await stranger.goto(`${base}/leagues/${SOFTBALL}`);
      await expect(
        stranger.getByRole('heading', { level: 1, name: 'Page not found' }),
      ).toBeVisible();
    } finally {
      await stranger.context().close();
    }
  });

  test('an unknown league slug shows the not-found view and requests no season data', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    const sent: string[] = [];
    page.on('websocket', (socket) => {
      socket.on('framesent', (frame) => sent.push(String(frame.payload)));
    });
    await page.goto(`${base}/leagues/no-such-league`);
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page.locator('#create-season')).toHaveCount(0);
    await screenshot(page, testInfo, '125-league-not-found');
    await expectAccessible(page);
    expect(sent.some((frame) => frame.includes('leagues:getOrganizerContext'))).toBe(true);
    expect(sent.some((frame) => frame.includes('seasons:listForOrganizer'))).toBe(false);
  });
});

test.describe('League management: the create-season form on a phone', () => {
  test('the Create button stays at the bottom of the viewport while the form is taller than it', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.setViewportSize(PHONE);
    await page.goto(`${base}/leagues/${COED}`);
    await page.locator('#name').focus();
    expect((await form(page).boundingBox())!.height).toBeGreaterThan(PHONE.height);
    await expect(submit(page)).toBeInViewport({ ratio: 1 });
    const box = (await submit(page).boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
    expect(box.y).toBeGreaterThan(PHONE.height - 80);

    await form(page).evaluate((el) => el.scrollIntoView({ block: 'end' }));
    await expect(submit(page)).toBeInViewport({ ratio: 1 });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(submit(page)).not.toBeInViewport();
  });

  for (const role of ['orgAdmin', 'leagueOrganizer'] as const) {
    test(`${role === 'orgAdmin' ? 'an org admin' : 'a league organizer'} Tabbing through every field never has one under the sticky button (WCAG 2.4.11)`, async ({
      page,
    }) => {
      const { base } = await memberOf(page, role);
      await page.setViewportSize(PHONE);
      await page.goto(`${base}/leagues/${COED}`);
      await page.locator('#name').focus();
      const seen = await footerTabWalk(page, { form: form(page), until: submit(page) });

      expect(controlsInTabOrder(seen)).toEqual([
        'name',
        'slug',
        'start-date',
        'end-date',
        'registration-deadline',
        'A',
        'BUTTON',
      ]);
      expect(underTheFooter(seen)).toEqual([]);
    });
  }
});

test.describe('League management: the created status on a phone', () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== 'chromium-mobile', 'phone layout with a coarse pointer');
  });

  const created = (page: Page, name = 'Fall 2026') =>
    form(page).getByRole('status').getByText(`${name} created as a draft.`);

  async function createFromTheBottom(page: Page, name = 'Fall 2026') {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.setViewportSize(PHONE);
    await page.goto(`${base}/leagues/${COED}`);
    await fillFall2026(page);
    await page.locator('#name').fill(name);
    await page.locator('#slug').fill('fall-2026');
    await form(page).evaluate((element) => element.scrollIntoView({ block: 'end' }));
    await submit(page).click();
    await expect(created(page, name)).toBeAttached();
  }

  test('Create pressed at the bottom of the form shows "<season> created as a draft." next to it, with focus kept on Create', async ({
    page,
  }) => {
    await createFromTheBottom(page);

    await expectVisibleInFooter(page, created(page));
    await expect(submit(page)).toBeFocused();
  });

  test('the created status goes once the user types in Name', async ({ page }) => {
    await createFromTheBottom(page);

    await page.locator('#name').pressSequentially('S');

    await expect(created(page)).toHaveCount(0);
  });

  test('with a 100-character name the title takes two lines and the footer stays within 200px', async ({
    page,
  }) => {
    const name =
      'Fall 2026: Sunday Coed Sevens at Redfish Flats, with Late Kickoffs, Short Halves, and Long Playoffs.';
    expect(name).toHaveLength(MAX_SEASON_NAME_LENGTH);
    await createFromTheBottom(page, name);

    await expectVisibleInFooter(page, created(page, name));
    await expectAtMostTwoLines(created(page, name));
    expect(await footerHeight(form(page))).toBeLessThanOrEqual(200);
  });

  test('with a 100-character name holding one 60-character word, the page does not scroll sideways at 320px and the title keeps to two lines', async ({
    page,
  }) => {
    const name = `${'W'.repeat(60)} Session at Redfish Flats, Sundays and Late Kickoffs`.slice(
      0,
      MAX_SEASON_NAME_LENGTH,
    );
    await createFromTheBottom(page, name);

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
      'start-date',
      'end-date',
      'registration-deadline',
      'A',
      'BUTTON',
    ]);
    expect(underTheFooter(seen)).toEqual([]);
  });

  test('with the created status shown, the page passes axe and does not scroll sideways at 320px', async ({
    page,
  }, testInfo) => {
    await createFromTheBottom(page);
    await screenshot(page, testInfo, '445-league-season-created-phone');
    await expectAccessible(page);
  });
});

test.describe('League management: the created status on wider screens', () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== 'chromium-desktop', 'each test sets its own width');
  });

  for (const width of [768, 1280]) {
    test(`at ${width}px the created status sits on top of Create in the footer`, async ({
      page,
    }, testInfo) => {
      const { base } = await memberOf(page, 'orgAdmin');
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/leagues/${COED}`);
      await fillFall2026(page);
      await submit(page).click();
      const status = form(page).getByRole('status').filter({ hasText: 'created as a draft' });
      await expect(status).toBeVisible();

      await expectStatusOnTopOfButtonInStaticFooter(form(page), status, submit(page));
      await screenshot(page, testInfo, '445-league-season-created');
    });
  }
});

test.describe('League management: the page as the league arrives', () => {
  test('the h1 stays within 4px of the skeleton’s heading bar when the league loads', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    const held = await holdQueries(page, ['leagues:getOrganizerContext']);
    await page.goto(`${base}/leagues/${COED}`);
    await expect.poll(() => held.isHolding()).toBe(true);
    const skeleton = page.locator('app-league-loading');
    await expect(skeleton).toBeVisible();
    const headingBar = await skeleton.locator('div[aria-hidden="true"]').nth(1).boundingBox();

    held.release();
    const h1 = main(page).getByRole('heading', { level: 1, name: 'Coed 7v7 Rec' });
    await expect(h1).toBeVisible();
    const heading = await h1.boundingBox();
    expect(Math.abs(heading!.y - headingBar!.y)).toBeLessThanOrEqual(4);
  });
});

const createdStatus = (page: Page) => form(page).locator('[data-slot="created-status"]');
const publishNext = (page: Page, name = 'Fall 2026') =>
  createdStatus(page).getByRole('button', { name: `Publish season ${name}`, exact: true });
const showNext = (page: Page) =>
  createdStatus(page).getByRole('link', { name: 'Show it in Seasons', exact: true });
const rowTitle = (page: Page, slug: string) => page.locator(`#season-${slug} h3`);
const seasonsHeading = (page: Page) => page.locator('#seasons-heading');

async function expectOnScreen(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  await settleAfterFocusScroll(page);
  const place = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      inViewport:
        rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
      unobscured: !!hit && element.contains(hit),
    };
  });
  expect(place).toEqual({ inViewport: true, unobscured: true });
}

async function createFall2026(page: Page, name = 'Fall 2026') {
  await fillFall2026(page);
  await page.locator('#name').fill(name);
  await page.locator('#slug').fill('fall-2026');
  await submit(page).click();
}

async function onCoarseHeight(target: Locator): Promise<number> {
  return (await target.boundingBox())!.height;
}

test.describe('League management: the next step in the created status on a phone', () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== 'chromium-mobile', 'phone layout with a coarse pointer');
  });

  async function createIn(page: Page, league: string, name = 'Fall 2026') {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.setViewportSize(PHONE);
    await page.goto(`${base}/leagues/${league}`);
    await form(page).evaluate((element) => element.scrollIntoView({ block: 'end' }));
    await createFall2026(page, name);
    await expect(createdStatus(page)).toContainText(`${name} created as a draft.`);
    return base;
  }

  test('a published league shows Publish season named for the season, 44px tall, visible in the footer, with Create still focused', async ({
    page,
  }, testInfo) => {
    await createIn(page, COED);

    await expectVisibleInFooter(page, publishNext(page));
    await expect(publishNext(page)).toHaveAttribute('aria-haspopup', 'dialog');
    expect(await onCoarseHeight(publishNext(page))).toBeGreaterThanOrEqual(44);
    await expect(submit(page)).toBeFocused();
    await expect(showNext(page)).toHaveCount(0);
    await screenshot(page, testInfo, '446-created-publish-season-phone');
    await expectAccessible(page);
  });

  test('a draft league shows Show it in Seasons, 44px tall, visible in the footer, to the new row', async ({
    page,
  }, testInfo) => {
    const base = await createIn(page, SOFTBALL);

    await expectVisibleInFooter(page, showNext(page));
    await expect(showNext(page)).toHaveAttribute(
      'href',
      `${base}/leagues/${SOFTBALL}#season-fall-2026`,
    );
    expect(await onCoarseHeight(showNext(page))).toBeGreaterThanOrEqual(44);
    await expect(createdStatus(page).getByRole('button')).toHaveCount(0);
    await screenshot(page, testInfo, '446-created-show-in-seasons-phone');
    await expectAccessible(page);
  });

  test('pressing Show it in Seasons by tap puts the new row’s title on screen with focus', async ({
    page,
  }) => {
    await createIn(page, SOFTBALL);
    await showNext(page).click();
    await expect(rowTitle(page, 'fall-2026')).toBeFocused();
    await expectOnScreen(page, rowTitle(page, 'fall-2026'));
  });

  test('pressing Show it in Seasons by Enter puts the new row’s title on screen with focus', async ({
    page,
  }) => {
    await createIn(page, SOFTBALL);
    await showNext(page).focus();
    await page.keyboard.press('Enter');
    await expect(rowTitle(page, 'fall-2026')).toBeFocused();
    await expectOnScreen(page, rowTitle(page, 'fall-2026'));
  });

  test('with a 100-character name and either action at 44px, the footer stays within 200px', async ({
    page,
  }) => {
    const name =
      'Fall 2026: Sunday Coed Sevens at Redfish Flats, with Late Kickoffs, Short Halves, and Long Playoffs.';
    expect(name).toHaveLength(MAX_SEASON_NAME_LENGTH);
    await createIn(page, COED, name);
    await expectVisibleInFooter(page, publishNext(page, name));
    expect(await footerHeight(form(page))).toBeLessThanOrEqual(200);
  });

  test('with a 100-character name and Show it in Seasons, the footer stays within 200px', async ({
    page,
  }) => {
    const name =
      'Fall 2026: Sunday Coed Sevens at Redfish Flats, with Late Kickoffs, Short Halves, and Long Playoffs.';
    await createIn(page, SOFTBALL, name);
    await expectVisibleInFooter(page, showNext(page));
    expect(await footerHeight(form(page))).toBeLessThanOrEqual(200);
  });

  for (const league of [COED, SOFTBALL]) {
    test(`Tabbing through the cleared form in ${league} with its action shown never leaves a control under the footer`, async ({
      page,
    }) => {
      await createIn(page, league);
      await page.locator('#name').focus();
      const seen = await footerTabWalk(page, { form: form(page), until: submit(page) });
      await expect(submit(page)).toBeFocused();
      expect(controlsInTabOrder(seen)).toEqual([
        'name',
        'slug',
        'start-date',
        'end-date',
        'registration-deadline',
        'A',
        'BUTTON',
      ]);
      expect(underTheFooter(seen)).toEqual([]);
    });
  }

  test('the status and its action go once the user types in Name', async ({ page }) => {
    await createIn(page, COED);
    await page.locator('#name').pressSequentially('S');
    await expect(createdStatus(page)).toBeEmpty();
  });

  test('with either action shown, there is no horizontal scroll at 320px', async ({ page }) => {
    await createIn(page, SOFTBALL);
    expect(await checkReflow(page)).toMatchObject({ passed: true });
  });
});

test.describe('League management: the next step on wider screens', () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== 'chromium-desktop', 'each test sets its own width');
  });

  for (const width of [768, 1280]) {
    for (const [league, action] of [
      [COED, publishNext],
      [SOFTBALL, showNext],
    ] as const) {
      test(`at ${width}px the ${league === COED ? 'Publish season button' : 'link'} sits in the footer above Create`, async ({
        page,
      }, testInfo) => {
        const { base } = await memberOf(page, 'orgAdmin');
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${base}/leagues/${league}`);
        await createFall2026(page);
        await expect(action(page)).toBeVisible();

        await expectStatusOnTopOfButtonInStaticFooter(
          form(page),
          createdStatus(page),
          submit(page),
        );
        await screenshot(page, testInfo, `446-created-next-step-${league}`);
      });
    }
  }
});

interface QueryChange {
  type: string;
  queryId: number;
  udfPath?: string;
}

const changesOf = (message: string | Buffer): QueryChange[] =>
  (JSON.parse(String(message)) as { modifications?: QueryChange[] }).modifications ?? [];

async function failSeasonsList(page: Page): Promise<void> {
  await page.routeWebSocket(/\/api\/[^/]+\/sync$/, (ws) => {
    const server = ws.connectToServer();
    const lists = new Set<number>();
    ws.onMessage((message) => {
      for (const change of changesOf(message)) {
        if (change.type === 'Add' && change.udfPath === 'seasons:listForOrganizer') {
          lists.add(change.queryId);
        }
      }
      server.send(message);
    });
    server.onMessage((message) => {
      const frame = JSON.parse(String(message)) as { modifications?: QueryChange[] };
      if (!frame.modifications?.some((change) => lists.has(change.queryId))) {
        ws.send(message);
        return;
      }
      const failed = frame.modifications.map((change) =>
        lists.has(change.queryId)
          ? { type: 'QueryFailed', queryId: change.queryId, errorMessage: 'down', logLines: [] }
          : change,
      );
      ws.send(JSON.stringify({ ...frame, modifications: failed }));
    });
  });
}

test.describe('League management: the link to a new season', () => {
  test.describe('with the list failing', () => {
    test('pressing Show it in Seasons puts the Seasons heading on screen with focus, and the error shows under it', async ({
      page,
    }) => {
      const { base } = await memberOf(page, 'orgAdmin');
      await failSeasonsList(page);
      await page.goto(`${base}/leagues/${SOFTBALL}`);
      await expect(page.getByText('The seasons could not be loaded.')).toBeVisible();
      await createFall2026(page);
      await showNext(page).click();
      await expect(seasonsHeading(page)).toBeFocused();
      await expectOnScreen(page, seasonsHeading(page));
      await expect(page.getByText('The seasons could not be loaded.')).toBeVisible();
    });

    test('a #season-… address lands on the Seasons heading', async ({ page }) => {
      const { base } = await memberOf(page, 'orgAdmin');
      await failSeasonsList(page);
      await page.goto(`${base}/leagues/${SOFTBALL}#season-fall-2026`);
      await expect(page.getByText('The seasons could not be loaded.')).toBeVisible();
      await expect(seasonsHeading(page)).toBeFocused();
      await expectOnScreen(page, seasonsHeading(page));
    });
  });

  test('a #season-… address opened in a new page lands on the row’s title once the list loads, and a later list update leaves focus where the user put it', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/leagues/${SOFTBALL}`);
    await createFall2026(page);
    await expect(rows(page)).toHaveCount(1);

    const opened = await page.context().newPage();
    await opened.setViewportSize(page.viewportSize()!);
    await opened.goto(`${base}/leagues/${SOFTBALL}#season-fall-2026`);
    await expect(rowTitle(opened, 'fall-2026')).toBeFocused();
    await expectOnScreen(opened, rowTitle(opened, 'fall-2026'));

    await opened.locator('#name').focus();
    await page.locator('#name').fill('Fall 2027');
    await page.locator('#slug').fill('fall-2027');
    await page.locator('#start-date').fill('2027-09-01');
    await page.locator('#end-date').fill('2027-11-15');
    await page.locator('#registration-deadline').fill('2027-08-25');
    await submit(page).click();
    await expect(rows(opened)).toHaveCount(2);
    await expect(opened.locator('#name')).toBeFocused();
  });

  test('a #season-… address with a slug no row has lands on the Seasons heading', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/leagues/${SOFTBALL}#season-nope`);
    await expect(rows(page)).toHaveCount(0);
    await expect(seasonsHeading(page)).toBeFocused();
    await expectOnScreen(page, seasonsHeading(page));
  });

  for (const [fragment, field] of [
    ['details', '#league-name'],
    ['create-season', '#name'],
  ] as const) {
    test(`#${fragment} opened directly lands on its field once the league loads, never on the Seasons heading`, async ({
      page,
    }, testInfo) => {
      const { base } = await memberOf(page, 'orgAdmin');
      await page.goto(`${base}/leagues/${SOFTBALL}`);
      await createFall2026(page);
      await expect(rows(page)).toHaveCount(1);
      const opened = await page.context().newPage();
      await opened.setViewportSize(page.viewportSize()!);
      await opened.goto(`${base}/leagues/${SOFTBALL}#${fragment}`);
      await expect(rows(opened)).toHaveCount(1);
      await expect(opened.locator(field)).toBeFocused();
      await expectOnScreen(opened, opened.locator(field));
      await expect(seasonsHeading(opened)).not.toBeFocused();
      await screenshot(opened, testInfo, `447-${fragment}-direct`);
    });

    test(`#${fragment} opened directly lands the same way for a league organizer`, async ({
      page,
    }) => {
      const { base } = await memberOf(page, 'leagueOrganizer');
      await page.goto(`${base}/leagues/${COED}#${fragment}`);
      await expect(page.locator(field)).toBeFocused();
      await expectOnScreen(page, page.locator(field));
    });

    test(`a user scroll (Page Down) before the league loads cancels the landing on #${fragment}`, async ({
      page,
    }) => {
      const { base } = await memberOf(page, 'orgAdmin');
      const held = await holdQueries(page, ['leagues:getOrganizerContext']);
      await page.goto(`${base}/leagues/${COED}#${fragment}`);
      await expect.poll(() => held.isHolding()).toBe(true);
      await page.keyboard.press('PageDown');
      held.release();
      await expect(page.getByRole('heading', { level: 1, name: 'Coed 7v7 Rec' })).toBeVisible();
      await expect(page.locator(field)).not.toBeFocused();
    });

    test(`a real mouse wheel before the league loads cancels the landing on #${fragment}`, async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== 'chromium', 'the wheel is sent through the Chromium protocol');
      const { base } = await memberOf(page, 'orgAdmin');
      const held = await holdQueries(page, ['leagues:getOrganizerContext']);
      await page.goto(`${base}/leagues/${COED}#${fragment}`);
      await expect.poll(() => held.isHolding()).toBe(true);
      await page.evaluate(() => {
        (window as unknown as { wheels: number }).wheels = 0;
        document.addEventListener(
          'wheel',
          () => (window as unknown as { wheels: number }).wheels++,
          {
            capture: true,
            passive: true,
          },
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
      held.release();
      await expect(page.getByRole('heading', { level: 1, name: 'Coed 7v7 Rec' })).toBeVisible();
      await expect(page.locator(field)).not.toBeFocused();
    });

    test(`#${fragment} landed page has no accessibility violations`, async ({ page }) => {
      const { base } = await memberOf(page, 'orgAdmin');
      await page.goto(`${base}/leagues/${COED}#${fragment}`);
      await expect(page.locator(field)).toBeFocused();
      await expectAccessible(page);
    });

    test(`#${fragment} lands once: a later live update leaves focus where the user put it`, async ({
      page,
    }) => {
      const { base } = await memberOf(page, 'orgAdmin');
      await page.goto(`${base}/leagues/${SOFTBALL}`);
      const opened = await page.context().newPage();
      await opened.setViewportSize(page.viewportSize()!);
      await opened.goto(`${base}/leagues/${SOFTBALL}#${fragment}`);
      await expect(opened.locator(field)).toBeFocused();

      await opened.locator(fragment === 'details' ? '#name' : '#league-name').focus();
      await createFall2026(page);
      await expect(rows(opened)).toHaveCount(1);
      await expect(opened.locator(fragment === 'details' ? '#name' : '#league-name')).toBeFocused();
    });
  }

  test(
    'published from a second page, a draft league’s created status offers Publish season in place of Show it in Seasons',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { base } = await memberOf(page, 'orgAdmin');
      await page.goto(`${base}/leagues/${SOFTBALL}`);
      await createFall2026(page);
      await expect(showNext(page)).toBeVisible();

      const second = await page.context().newPage();
      await second.goto(`${base}/leagues`);
      await second.getByRole('button', { name: 'Publish Draft Softball' }).click();
      await second.getByRole('alertdialog').getByRole('button', { name: 'Publish league' }).click();
      await expect(second.getByRole('alertdialog')).toHaveCount(0);

      await expect(publishNext(page)).toBeVisible();
      await expect(showNext(page)).toHaveCount(0);
    },
  );

  test('every row has an id from its slug', VIEWPORT_AGNOSTIC, async ({ page }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/leagues/${COED}`);
    await createFall2026(page);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toHaveAttribute('id', 'season-fall-2026');
  });
});
