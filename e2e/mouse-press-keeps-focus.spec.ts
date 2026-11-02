import type { Locator, Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { chipLabel, chooseChip } from './support/chip';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { signUp } from './support/session';
import { seedTenant } from './support/tenant';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LOCATIONS = [
  { name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX 78382' },
  {
    name: 'Pelican Shoals Sand Courts',
    address: '2150 Pelican Shoals Dr, Corpus Christi, TX 78418',
  },
];
const SUNDAY = 'sunday-reverse-coed-4s';
const LEAGUES = [
  {
    name: 'Sunday Reverse Coed 4s',
    sport: 'beachVolleyball' as const,
    locations: ['Redfish Flats Fields'],
    division: {
      gender: 'coed' as const,
      playersPerSide: 4,
      level: 'bb' as const,
      ageGroup: 'adult' as const,
    },
  },
];

async function orgAdmin(page: Page) {
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenant({
    name: 'E2E Press',
    locations: LOCATIONS,
    leagues: LEAGUES,
  });
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });
  return { tenant, base: `/app/organizations/${tenant.slug}` };
}

const FRAMES = 2;

/**
 * A press whose release comes after the next frames: the error that leaving a field shows has
 * rendered by then. It presses 4 px below the top edge, so a button that moved by more than 4 px is
 * no longer under the pointer.
 */
async function pressThenRelease(page: Page, button: Locator): Promise<void> {
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 4);
  await page.mouse.down();
  await page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        const next = (left: number) =>
          requestAnimationFrame(() => (left === 1 ? resolve() : next(left - 1)));
        next(frames);
      }),
    FRAMES,
  );
  await page.mouse.up();
}

interface PressCase {
  name: string;
  /** Why the press test skips WebKit, where the focus after the press differs from Chromium's. */
  webkitSkip?: string;
  /** Opens the form and leaves an invalid value in a field that keeps focus. */
  prepare: (page: Page) => Promise<void>;
  button: (page: Page) => Locator;
  /** What the press does on the invalid value. */
  expectActed: (page: Page) => Promise<void>;
  /** Replaces the invalid value with a valid one, in the same focused field. */
  fix?: (page: Page) => Promise<void>;
  /** What the press does on the valid value, with focus on the target. */
  expectDone?: (page: Page) => Promise<void>;
}

const field = (page: Page, id: string) => page.locator(`#${id}`);

async function emptied(page: Page, id: string, first = 'x'): Promise<void> {
  await field(page, id).fill(first);
  await field(page, id).fill('');
}

async function shownOn(page: Page, id: string): Promise<void> {
  await expect(field(page, `${id}-error`)).toBeVisible();
  await expect(field(page, id)).toBeFocused();
}

const createLeagueForm = (page: Page) => page.locator('#create-league form');
const createSeasonForm = (page: Page) => page.locator('#create-season form');
const details = (page: Page) => page.locator('#details');
const savedStatus = (page: Page) => details(page).locator('[data-slot="save-status"]');
const locationForm = (page: Page) => page.locator('#locations-list form');
const editLocation = (page: Page, name: string) =>
  page.getByRole('button', { name: `Edit ${name}`, exact: true });

async function openEdit(page: Page): Promise<void> {
  const { base } = await orgAdmin(page);
  await page.goto(`${base}/locations`);
  await editLocation(page, 'Redfish Flats Fields').click();
  await expect(field(page, 'edit-name')).toBeFocused();
  await field(page, 'edit-name').fill(' ');
}

const CASES: PressCase[] = [
  {
    name: 'Create league',
    async prepare(page) {
      const { base } = await orgAdmin(page);
      await page.goto(`${base}/leagues`);
      await field(page, 'name').fill('Fine');
      await chooseChip(chipLabel(page, 'Soccer'));
      await page.getByRole('checkbox', { name: 'Redfish Flats Fields' }).click();
      await field(page, 'slug').fill('Bad Slug');
    },
    button: (page) => createLeagueForm(page).getByRole('button', { name: /^Create draft league/ }),
    expectActed: (page) => shownOn(page, 'slug'),
    fix: (page) => field(page, 'slug').fill('fine-league'),
    async expectDone(page) {
      await expect(page.locator('#leagues-list > li')).toHaveCount(1);
      await expect(
        createLeagueForm(page).getByRole('button', { name: /^Create draft league/ }),
      ).toBeFocused();
    },
  },
  {
    name: 'Create season',
    async prepare(page) {
      const { base } = await orgAdmin(page);
      await page.goto(`${base}/leagues/${SUNDAY}`);
      await field(page, 'name').fill('Fall 2026');
      await field(page, 'start-date').fill('2026-09-01');
      await field(page, 'end-date').fill('2026-11-15');
      await field(page, 'registration-deadline').fill('2026-08-25');
      await emptied(page, 'name', 'Fall 2026');
    },
    button: (page) => createSeasonForm(page).getByRole('button', { name: /^Create draft season/ }),
    expectActed: (page) => shownOn(page, 'name'),
    fix: (page) => field(page, 'name').fill('Fall 2026'),
    async expectDone(page) {
      await expect(page.locator('#seasons-list > li')).toHaveCount(1);
      await expect(
        createSeasonForm(page).getByRole('button', { name: /^Create draft season/ }),
      ).toBeFocused();
    },
  },
  {
    name: 'Save changes on league details',
    async prepare(page) {
      const { base } = await orgAdmin(page);
      await page.goto(`${base}/leagues/${SUNDAY}`);
      await emptied(page, 'league-name');
    },
    button: (page) => details(page).getByRole('button', { name: 'Save changes' }),
    expectActed: (page) => shownOn(page, 'league-name'),
    fix: (page) => field(page, 'league-name').fill('Sunday Sand'),
    async expectDone(page) {
      await expect(savedStatus(page)).toContainText('League details saved.');
      await expect(details(page).getByRole('button', { name: 'Save changes' })).toBeFocused();
    },
  },
  {
    name: 'Save on organization details',
    async prepare(page) {
      const { base } = await orgAdmin(page);
      await page.goto(`${base}/details`);
      await field(page, 'cityState').fill('a');
    },
    button: (page) => page.getByRole('button', { name: /^Sav(e|ing)/ }),
    expectActed: (page) => shownOn(page, 'cityState'),
    fix: (page) => field(page, 'cityState').fill('Austin, TX'),
    async expectDone(page) {
      const saved = page
        .getByRole('main')
        .getByRole('status')
        .filter({ hasText: /Details/ });
      await expect(saved).toContainText('Details saved.');
      await expect(saved).toBeFocused();
    },
  },
  {
    name: 'Create organization',
    async prepare(page) {
      await signUp(page, newUser('Create'));
      await page.goto('/app/organizations/new');
      await field(page, 'name').fill(`Press ${randomBytes(4).toString('hex')}`);
      await field(page, 'slug').fill('ab');
    },
    button: (page) => page.getByRole('button', { name: /Create organization/ }),
    expectActed: (page) => shownOn(page, 'slug'),
    fix: (page) => field(page, 'slug').fill(`press-${randomBytes(4).toString('hex')}`),
    async expectDone(page) {
      await expect(page).toHaveURL(/\/app\/organizations\/(?!new$)[^/]+$/);
    },
  },
  {
    name: 'Save changes on edit location',
    prepare: openEdit,
    button: (page) => locationForm(page).getByRole('button', { name: 'Save changes' }),
    expectActed: (page) => shownOn(page, 'edit-name'),
    fix: (page) => field(page, 'edit-name').fill('Redfish Renamed'),
    async expectDone(page) {
      await expect(locationForm(page)).toHaveCount(0);
      await expect(editLocation(page, 'Redfish Renamed')).toBeFocused();
    },
  },
  {
    name: 'Cancel on edit location',
    prepare: openEdit,
    button: (page) => locationForm(page).getByRole('button', { name: 'Cancel' }),
    async expectActed(page) {
      await expect(locationForm(page)).toHaveCount(0);
      await expect(editLocation(page, 'Redfish Flats Fields')).toBeFocused();
    },
  },
  {
    name: 'Add location',
    async prepare(page) {
      const { base } = await orgAdmin(page);
      await page.goto(`${base}/locations`);
      await emptied(page, 'name');
    },
    button: (page) =>
      page.locator('#add-location form').getByRole('button', { name: /^Add location/ }),
    expectActed: (page) => shownOn(page, 'name'),
  },
  {
    name: 'Create invite link',
    async prepare(page) {
      const { base } = await orgAdmin(page);
      await page.goto(`${base}/staff`);
      await emptied(page, 'email');
    },
    button: (page) =>
      page.locator('#invite form').getByRole('button', { name: /^Create invite link/ }),
    expectActed: (page) => shownOn(page, 'email'),
  },
  {
    name: 'Add level on the custom level panel',
    webkitSkip: 'WebKit moves focus to the league Name after the refused Add level',
    async prepare(page) {
      const { base } = await orgAdmin(page);
      await page.goto(`${base}/leagues`);
      await chooseChip(chipLabel(page, 'Beach volleyball'));
      await createLeagueForm(page).getByRole('button', { name: 'Add a custom level' }).click();
      await emptied(page, 'custom-level-name', 'Gold');
    },
    button: (page) => page.locator('#custom-level').getByRole('button', { name: 'Add level' }),
    expectActed: (page) => shownOn(page, 'custom-level-name'),
  },
  {
    name: 'Sign in',
    async prepare(page) {
      await page.goto('/sign-in');
      await field(page, 'password').fill('not-used-yet');
      await field(page, 'email').fill('not an email');
    },
    button: (page) => page.getByRole('button', { name: /^Sign in/ }),
    expectActed: (page) => shownOn(page, 'email'),
  },
  {
    name: 'Create account',
    async prepare(page) {
      await page.goto('/sign-up');
      await emptied(page, 'name');
    },
    button: (page) => page.getByRole('button', { name: /Create account/ }),
    expectActed: (page) => shownOn(page, 'name'),
  },
];

test.describe('a mouse press is not lost when leaving a field shows its error', () => {
  for (const press of CASES) {
    test(`${press.name}: a press held across two frames still acts`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name === 'webkit-mobile' && !!press.webkitSkip, press.webkitSkip);
      await press.prepare(page);
      await pressThenRelease(page, press.button(page));
      await press.expectActed(page);
    });

    if (!press.fix || !press.expectDone) continue;
    const { fix, expectDone } = press;
    test(`${press.name}: a press on a valid value acts and ends on the target`, async ({
      page,
    }, testInfo) => {
      test.skip(
        testInfo.project.name === 'webkit-mobile' && press.name === 'Create league',
        'WebKit focuses the Format chip after the league is created',
      );
      await press.prepare(page);
      await fix(page);
      await pressThenRelease(page, press.button(page));
      await expectDone(page);
    });
  }

  test('Undo on league details restores the earlier details and focuses the status, with an unchosen Maps to left', async ({
    page,
  }) => {
    const { base } = await orgAdmin(page);
    await page.goto(`${base}/leagues/${SUNDAY}`);
    await field(page, 'league-name').fill('Sunday Sand');
    await details(page).getByRole('button', { name: 'Save changes' }).click();
    const undo = savedStatus(page).getByRole('button', { name: 'Undo' });
    await expect(undo).toBeVisible();
    await details(page).getByRole('button', { name: 'Add a custom level' }).click();
    await field(page, 'custom-level-maps').focus();

    await pressThenRelease(page, undo);

    await expect(savedStatus(page)).toContainText('Earlier details restored.');
    await expect(savedStatus(page).locator('[tabindex="-1"]')).toBeFocused();
    await expect(field(page, 'league-name')).toHaveValue('Sunday Reverse Coed 4s');
  });
});

test.describe('a tap on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'a tap needs the touch project');

  test('on Create league moves focus out of the field and creates the league', async ({ page }) => {
    const { base } = await orgAdmin(page);
    await page.goto(`${base}/leagues`);
    await field(page, 'name').fill('Tapped');
    await chooseChip(chipLabel(page, 'Soccer'));
    await page.getByRole('checkbox', { name: 'Redfish Flats Fields' }).click();
    await field(page, 'slug').fill('tapped');
    await createLeagueForm(page)
      .getByRole('button', { name: /^Create draft league/ })
      .tap();
    await expect(page.locator('#leagues-list > li')).toHaveCount(1);
    await expect(field(page, 'slug')).not.toBeFocused();
  });

  test('on Save changes moves focus out of the field and saves the details', async ({ page }) => {
    const { base } = await orgAdmin(page);
    await page.goto(`${base}/leagues/${SUNDAY}`);
    await field(page, 'league-name').fill('Tapped League');
    await details(page).getByRole('button', { name: 'Save changes' }).tap();
    await expect(savedStatus(page)).toContainText('League details saved.');
    await expect(field(page, 'league-name')).not.toBeFocused();
  });
});

test.describe('keyboard and validation timing', () => {
  test('Tab out of an invalid field shows its error, and Enter in a field submits', async ({
    page,
  }) => {
    const { base } = await orgAdmin(page);
    await page.goto(`${base}/leagues/${SUNDAY}`);
    await emptied(page, 'league-name');
    await page.keyboard.press('Tab');
    await expect(field(page, 'league-name-error')).toBeVisible();
    await field(page, 'league-name').fill('Sunday Sand');
    await page.keyboard.press('Enter');
    await expect(savedStatus(page)).toContainText('League details saved.');
  });

  test('Enter and Space on the focused Save changes button submit', async ({ page }) => {
    const { base } = await orgAdmin(page);
    await page.goto(`${base}/leagues/${SUNDAY}`);
    const save = details(page).getByRole('button', { name: 'Save changes' });
    await field(page, 'league-name').fill('Enter League');
    await save.focus();
    await page.keyboard.press('Enter');
    await expect(savedStatus(page)).toContainText('League details saved.');
    await field(page, 'league-name').fill('Space League');
    await save.focus();
    await page.keyboard.press('Space');
    await expect(savedStatus(page)).toContainText('League details saved.');
    await expect(field(page, 'league-name')).toHaveValue('Space League');
  });
});
