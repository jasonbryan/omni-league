import type { Browser, Page } from '@playwright/test';
import { expectAccessible, tabKey } from './support/a11y';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { holdQueries } from './support/hold-queries';
import { otherUser, signUp } from './support/session';
import {
  controlsInTabOrder,
  expectWhollyAboveFooter,
  PHONE,
  settleAfterFocusScroll,
  footerTabWalk,
  underTheFooter,
} from './support/sticky-footer';
import { seedSeasons, seedTenant } from './support/tenant';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const SUNDAY = 'sunday-reverse-coed-4s';
const ORGANIZER_CONTEXT = 'leagues:getOrganizerContext';

async function openDetails(page: Page, role: 'orgAdmin' | 'leagueOrganizer' = 'orgAdmin') {
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenant({
    name: 'E2E League Details',
    locations: [{ name: 'North Beach Sand Courts', address: '4001 Beach Rd, Corpus Christi, TX' }],
    leagues: [
      {
        name: 'Sunday Reverse Coed 4s',
        sport: 'beachVolleyball',
        locations: ['North Beach Sand Courts'],
        division: { gender: 'coed', playersPerSide: 4, level: 'bb', ageGroup: 'adult' },
      },
      {
        name: 'Thursday Night Coed 2s',
        sport: 'beachVolleyball',
        locations: ['North Beach Sand Courts'],
        division: { gender: 'coed', playersPerSide: 2, level: 'b', ageGroup: 'adult' },
      },
    ],
  });
  await seedSeasons(tenant, SUNDAY, [
    {
      name: 'Summer 2027',
      slug: 'summer-2027',
      startDate: '2027-06-06',
      endDate: '2027-08-29',
      status: 'published',
    },
    {
      name: 'Fall 2027',
      slug: 'fall-2027',
      startDate: '2027-09-12',
      endDate: '2027-11-14',
      status: 'draft',
    },
  ]);
  if (role === 'orgAdmin') {
    await convexRun('testing:addMembership', {
      organizationSlug: tenant.slug,
      email: user.email,
      role,
    });
  } else {
    await convexRun('testing:addLeagueOrganizer', {
      organizationSlug: tenant.slug,
      email: user.email,
      leagueSlugs: [SUNDAY],
    });
  }
  const path = `/app/organizations/${tenant.slug}/leagues/${SUNDAY}`;
  await page.goto(path);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sunday Reverse Coed 4s' }),
  ).toBeVisible();
  return { tenant, path };
}

const details = (page: Page) => page.locator('#details');
const save = (page: Page) => details(page).getByRole('button', { name: 'Save changes' });
const status = (page: Page) => details(page).locator('[data-slot="save-status"]');
const chip = (page: Page, group: string, label: string) =>
  details(page).locator(`#details-${group}`).getByRole('radio', { name: label, exact: true });
const seasonRow = (page: Page, name: string) =>
  page.locator('#seasons-list > li').filter({ has: page.getByRole('heading', { name }) });

test.describe('League management: league details', () => {
  test('an org admin changes the format to 6v6: draft Fall 2027 follows, published Summer 2027 keeps 4v4, and Undo returns both', async ({
    page,
  }, testInfo) => {
    await openDetails(page);
    await expect(details(page).getByRole('heading', { name: 'League details' })).toBeVisible();
    await expect(details(page).getByLabel('Name')).toHaveValue('Sunday Reverse Coed 4s');
    await expect(chip(page, 'format', '4v4')).toBeChecked();
    await expect(page.locator('#details-format-description')).toHaveText(
      'Players on each side, and so the minimum roster size. A change applies to new seasons; Summer 2027 keeps 4v4.',
    );
    await expect(seasonRow(page, 'Fall 2027')).toContainText('4v4 · at least 4 players');
    await screenshot(page, testInfo, '237-league-details');
    await expectAccessible(page);

    await chip(page, 'format', '6v6').check({ force: true });
    await save(page).click();

    await expect(status(page)).toContainText('League details saved.');
    await expect(status(page).getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(seasonRow(page, 'Fall 2027')).toContainText('6v6 · at least 6 players');
    await expect(seasonRow(page, 'Summer 2027')).toContainText('4v4 · at least 4 players');
    await expect(page.locator('[data-slot="league-division"]')).toHaveText('Coed · 6v6 · BB');
    await screenshot(page, testInfo, '237-league-details-saved');
    await expectAccessible(page);

    await status(page).getByRole('button', { name: 'Undo' }).click();
    await expect(status(page)).toContainText('Earlier details restored.');
    await expect(status(page).locator('[tabindex="-1"]')).toBeFocused();
    await expect(chip(page, 'format', '4v4')).toBeChecked();
    await expect(seasonRow(page, 'Fall 2027')).toContainText('4v4 · at least 4 players');
    await expect(seasonRow(page, 'Summer 2027')).toContainText('4v4 · at least 4 players');
    await expect(page.locator('[data-slot="league-division"]')).toHaveText('Coed · 4v4 · BB');
  });

  test('a renamed league shows its new name on the public league page and moves in the organization’s list', async ({
    page,
  }) => {
    const { tenant } = await openDetails(page);
    await details(page).getByLabel('Name').fill('Aardvark Sand');
    await save(page).click();
    await expect(status(page)).toContainText('League details saved.');
    await expect(page.getByRole('heading', { level: 1, name: 'Aardvark Sand' })).toBeVisible();

    await page.goto(`${tenant.path}/leagues/${SUNDAY}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Aardvark Sand' })).toBeVisible();
    await page.goto(tenant.path);
    await expect(page.getByRole('main').getByRole('heading', { level: 3 })).toHaveText([
      'Aardvark Sand',
      'Thursday Night Coed 2s',
      'North Beach Sand Courts',
    ]);
  });

  test('an empty name is refused under the field, keeps the other edits, and sends nothing', async ({
    page,
  }) => {
    await openDetails(page);
    await chip(page, 'format', '6v6').check({ force: true });
    await details(page).getByLabel('Name').fill('');
    await save(page).click();
    await expect(page.locator('#league-name-error')).toHaveText('Enter the league’s name.');
    await expect(details(page).getByLabel('Name')).toBeFocused();
    await expect(chip(page, 'format', '6v6')).toBeChecked();
    await expect(status(page)).toHaveText('');
  });

  test('a league organizer saves the details of their league, and sees no way to add a custom level', async ({
    page,
  }) => {
    await openDetails(page, 'leagueOrganizer');
    await expect(details(page).getByRole('button', { name: 'Add a custom level' })).toHaveCount(0);
    await details(page).getByLabel('Name').fill('Sunday Sand');
    await save(page).click();
    await expect(status(page)).toContainText('League details saved.');
    await expect(page.getByRole('heading', { level: 1, name: 'Sunday Sand' })).toBeVisible();
  });

  test.describe('a save from out-of-date details', () => {
    test.use({ expectedConvexErrors: ['leagues:update'] });

    test('an organizer whose form is out of date is refused after an org admin saves 6v6, and a second save keeps the admin’s 6v6', async ({
      page,
      browser,
    }, testInfo) => {
      const admin = newUser('Admin');
      const adminPage = await otherUser(browser, admin);
      try {
        const { tenant, path } = await openDetails(page, 'leagueOrganizer');
        await convexRun('testing:addMembership', {
          organizationSlug: tenant.slug,
          email: admin.email,
          role: 'orgAdmin',
        });
        const held = await holdQueries(page, [ORGANIZER_CONTEXT], { holdFromStart: false });
        await page.reload();
        await expect(details(page).getByLabel('Name')).toHaveValue('Sunday Reverse Coed 4s');
        held.holdNextAnswer();

        await adminPage.goto(path);
        await chip(adminPage, 'format', '6v6').check({ force: true });
        await save(adminPage).click();
        await expect(status(adminPage)).toContainText('League details saved.');
        await expect.poll(() => held.isHolding()).toBe(true);
        await expect(chip(page, 'format', '4v4')).toBeChecked();

        await details(page).getByLabel('Name').fill('Sunday Sand Coed 4s');
        await details(page).getByLabel('Name').blur();
        await save(page).click();

        const alert = details(page).locator('[data-slot="alert"]');
        await expect(alert).toContainText(
          'Someone else changed this league while you were editing.',
        );
        await expect(alert).toContainText('Check the details and save again.');
        await expect(alert).toHaveAttribute('role', 'alert');
        await expect(alert).toBeFocused();
        await expect(details(page).getByLabel('Name')).toHaveValue('Sunday Sand Coed 4s');
        await expect(chip(page, 'format', '6v6')).toBeChecked();
        await expect(page.locator('#league-name-error')).toHaveCount(0);
        await screenshot(page, testInfo, '322-league-details-changed');
        await expectAccessible(page);

        // A save resolves only once the held league query catches up.
        held.release();
        await save(page).click();
        await expect(status(page)).toContainText('League details saved.');
        await expect(alert).toHaveCount(0);

        await adminPage.reload();
        await expect(details(adminPage).getByLabel('Name')).toHaveValue('Sunday Sand Coed 4s');
        await expect(chip(adminPage, 'format', '6v6')).toBeChecked();
        await expect(
          page.getByRole('heading', { level: 1, name: 'Sunday Sand Coed 4s' }),
        ).toBeVisible();
      } finally {
        await adminPage.context().close();
      }
    });
  });

  test.describe('another organizer’s save, shown live', () => {
    const RENAME_NOTE = 'Someone else changed this to "6v6". The name you typed did not change it.';
    const notes = (page: Page) => details(page).locator('[data-slot="field-note"]');

    async function openWithAdmin(page: Page, browser: Browser) {
      const admin = newUser('Admin');
      const adminPage = await otherUser(browser, admin);
      const { tenant, path } = await openDetails(page, 'leagueOrganizer');
      await convexRun('testing:addMembership', {
        organizationSlug: tenant.slug,
        email: admin.email,
        role: 'orgAdmin',
      });
      await adminPage.goto(path);
      await expect(
        adminPage.getByRole('heading', { level: 1, name: 'Sunday Reverse Coed 4s' }),
      ).toBeVisible();
      return adminPage;
    }

    async function adminSavesSixes(adminPage: Page) {
      await chip(adminPage, 'format', '6v6').check({ force: true });
      await save(adminPage).click();
      await expect(status(adminPage)).toContainText('League details saved.');
    }

    test('a form with no edits shows the admin’s 6v6 without a reload, and saves with no refusal', async ({
      page,
      browser,
    }, testInfo) => {
      const adminPage = await openWithAdmin(page, browser);
      try {
        await expect(chip(page, 'format', '4v4')).toBeChecked();
        await adminSavesSixes(adminPage);

        await expect(chip(page, 'format', '6v6')).toBeChecked();
        await expect(notes(page)).toHaveCount(0);
        await expect(details(page).locator('[data-slot="alert"]')).toHaveCount(0);
        await expect(status(page)).toHaveText('');
        await screenshot(page, testInfo, '393-league-details-live');

        await save(page).click();
        await expect(status(page)).toContainText('League details saved.');
        await expect(details(page).locator('[data-slot="alert"]')).toHaveCount(0);
      } finally {
        await adminPage.context().close();
      }
    });

    test('an organizer who edited only Name keeps it, sees 6v6, and a save writes both', async ({
      page,
      browser,
    }) => {
      const adminPage = await openWithAdmin(page, browser);
      try {
        await details(page).getByLabel('Name').fill('Sunday Sand');
        await adminSavesSixes(adminPage);

        await expect(chip(page, 'format', '6v6')).toBeChecked();
        await expect(details(page).getByLabel('Name')).toHaveValue('Sunday Sand');
        await expect(notes(page)).toHaveCount(0);

        await save(page).click();
        await expect(status(page)).toContainText('League details saved.');
        await expect(details(page).locator('[data-slot="alert"]')).toHaveCount(0);

        await adminPage.reload();
        await expect(details(adminPage).getByLabel('Name')).toHaveValue('Sunday Sand');
        await expect(chip(adminPage, 'format', '6v6')).toBeChecked();
      } finally {
        await adminPage.context().close();
      }
    });

    test('a rename that states 4s leaves the admin’s 6v6 with a note under Format, and a save writes both', async ({
      page,
      browser,
    }, testInfo) => {
      const adminPage = await openWithAdmin(page, browser);
      try {
        await adminSavesSixes(adminPage);
        await expect(chip(page, 'format', '6v6')).toBeChecked();

        await details(page).getByLabel('Name').fill('Sunday Sand Coed 4s');
        await details(page).getByLabel('Name').blur();

        await expect(chip(page, 'format', '6v6')).toBeChecked();
        await expect(page.locator('#details-format-note')).toHaveText(RENAME_NOTE);
        await expect(page.locator('#details-format')).toHaveAttribute(
          'aria-describedby',
          /details-format-note/,
        );
        await expect(details(page).locator('[data-slot="note-announcement"]')).toHaveText(
          RENAME_NOTE,
        );
        await screenshot(page, testInfo, '393-league-details-note');
        await expectAccessible(page);

        await save(page).click();
        await expect(status(page)).toContainText('League details saved.');
        await expect(notes(page)).toHaveCount(0);
        await expect(
          page.getByRole('heading', { level: 1, name: 'Sunday Sand Coed 4s' }),
        ).toBeVisible();
        await expect(page.locator('[data-slot="league-division"]')).toHaveText('Coed · 6v6 · BB');
      } finally {
        await adminPage.context().close();
      }
    });
  });

  test('keeps Save in view on a phone while the form is taller than the screen', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'phone layout only');
    await openDetails(page);
    await page.getByRole('link', { name: 'Edit details' }).click();
    await details(page).getByLabel('Name').focus();
    await expect(save(page)).toBeInViewport();
    await screenshot(page, testInfo, '237-league-details-phone');
    await expectAccessible(page);
  });
});

test.describe('League management: league details on a phone', () => {
  const name = (page: Page) => details(page).locator('#league-name');
  const minimum = (page: Page) => details(page).locator('#details-minimum-roster-size');
  const form = (page: Page) => details(page).locator('form');

  async function openOnPhone(page: Page, role: 'orgAdmin' | 'leagueOrganizer' = 'orgAdmin') {
    await page.setViewportSize(PHONE);
    await openDetails(page, role);
    await details(page).getByRole('button', { name: 'Raise the minimum roster size' }).click();
    await expect(minimum(page)).toBeFocused();
  }

  for (const role of ['orgAdmin', 'leagueOrganizer'] as const) {
    test(`${role === 'orgAdmin' ? 'an org admin' : 'a league organizer'} Tabbing through every field never has one under the sticky button, as Name and Minimum roster size show their errors (WCAG 2.4.11)`, async ({
      page,
    }) => {
      await openOnPhone(page, role);
      await name(page).focus();
      await name(page).fill('');
      const toMinimum = await footerTabWalk(page, { form: form(page), until: minimum(page) });
      await minimum(page).fill('1');
      await page.keyboard.press(tabKey(page));
      const toSave = await footerTabWalk(page, { form: form(page), until: save(page) });
      const seen = [...toMinimum, ...toSave];

      await expect(details(page).locator('#league-name-error')).toBeVisible();
      await expect(details(page).locator('#details-minimum-roster-size-error')).toBeVisible();
      expect(controlsInTabOrder(seen)).toEqual([
        'league-name',
        expect.stringMatching(/^details-gender/),
        expect.stringMatching(/^details-format/),
        'details-minimum-roster-size',
        expect.stringMatching(/^details-level/),
        ...(role === 'orgAdmin' ? ['BUTTON'] : []),
        expect.stringMatching(/^details-age/),
        'BUTTON',
      ]);
      expect(underTheFooter(seen)).toEqual([]);
    });
  }

  const undo = (page: Page) => status(page).getByRole('button', { name: 'Undo' });

  async function saveWithStatusUnderFooter(page: Page) {
    await page.setViewportSize(PHONE);
    await openDetails(page);
    await name(page).fill('Sunday Sand');
    await save(page).click();
    await expect(status(page)).toContainText('League details saved.');
    await statusUnderFooter(page);
  }

  async function statusUnderFooter(page: Page) {
    await status(page).evaluate((element) => {
      const footer = element.closest('form')!.querySelector('[data-slot="form-footer"]')!;
      const box = element.getBoundingClientRect();
      const bar = footer.getBoundingClientRect();
      window.scrollBy({
        top: (box.top + box.bottom - bar.top - bar.bottom) / 2,
        behavior: 'instant',
      });
    });
    const place = await status(page).evaluate((element) => {
      const footer = element.closest('form')!.querySelector('[data-slot="form-footer"]')!;
      return {
        box: element.getBoundingClientRect().bottom,
        bar: footer.getBoundingClientRect().top,
      };
    });
    expect(place.box).toBeGreaterThan(place.bar);
  }

  test('Undo, reached by Shift+Tab while the save status is behind the sticky button, is above it', async ({
    page,
  }) => {
    await saveWithStatusUnderFooter(page);

    await page.keyboard.press(`Shift+${tabKey(page)}`);

    await expectWhollyAboveFooter(page, undo(page));
  });

  test('Undo focuses the restored status above the sticky button, even when it was behind it', async ({
    page,
  }) => {
    await saveWithStatusUnderFooter(page);
    await undo(page).focus();
    await settleAfterFocusScroll(page);
    await statusUnderFooter(page);

    await page.keyboard.press('Enter');

    await expect(status(page)).toContainText('Earlier details restored.');
    await expectWhollyAboveFooter(page, status(page).locator('[tabindex="-1"]'));
  });

  test('Save with a minimum below the format, pressed from the bottom of the form, focuses Minimum roster size above the sticky button', async ({
    page,
  }) => {
    await openOnPhone(page);
    await minimum(page).fill('1');
    await form(page).evaluate((element) => element.scrollIntoView({ block: 'end' }));

    await save(page).click();

    await expect(details(page).locator('#details-minimum-roster-size-error')).toBeVisible();
    await expectWhollyAboveFooter(page, minimum(page));
  });
});
