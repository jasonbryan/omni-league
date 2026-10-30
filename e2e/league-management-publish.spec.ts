import type { Page } from '@playwright/test';
import { axeScan, describeViolations, expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { overlayPanes } from './support/overlay';
import { fetchRawHtml } from './support/raw-html';
import { screenshot } from './support/screenshot';
import { otherUser, signUp } from './support/session';
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
  { name: 'Coed 7v7 Rec', sport: 'soccer', locations: ['Redfish Flats Fields'] },
  {
    name: 'Tuesday Coed Slow-Pitch',
    sport: 'softball',
    locations: ['Redfish Flats Fields'],
    status: 'draft',
  },
];

const COED = 'coed-7v7-rec';
const SLOW_PITCH = 'tuesday-coed-slow-pitch';

const SEASONS = [
  ['spring-2027', 'Spring 2027', '2027-03-03', '2027-05-12', '2027-02-17', 'draft'],
  ['summer-2027', 'Summer 2027', '2027-06-02', '2027-08-25', '2027-05-19', 'published'],
  ['fall-2027', 'Fall 2027', '2027-09-08', '2027-11-10', '2027-08-25', 'draft'],
] as const;

type Role = 'orgAdmin' | 'leagueOrganizer';

async function memberOf(page: Page, role: Role, assigned: string[] = [COED]) {
  const user = newUser(role === 'orgAdmin' ? 'Admin' : 'Organizer');
  await signUp(page, user);
  const tenant = await seedTenant({
    name: 'E2E Publish Season',
    locations: LOCATIONS,
    leagues: LEAGUES,
  });
  const memberships =
    role === 'orgAdmin'
      ? convexRun('testing:addMembership', {
          organizationSlug: tenant.slug,
          email: user.email,
          role,
        })
      : convexRun('testing:addLeagueOrganizer', {
          organizationSlug: tenant.slug,
          email: user.email,
          leagueSlugs: assigned,
        });
  const rows = [
    ...SEASONS.map((season) => [COED, season] as const),
    [SLOW_PITCH, SEASONS[0]] as const,
  ].map(([leagueSlug, [slug, name, startDate, endDate, registrationDeadline, status]]) =>
    convexRun('testing:seedSeason', {
      organizationSlug: tenant.slug,
      leagueSlug,
      name,
      slug,
      startDate,
      endDate,
      registrationDeadline,
      playersPerSide: leagueSlug === COED ? 7 : 10,
      minimumRosterSize: leagueSlug === COED ? 7 : 10,
      status,
    }),
  );
  await Promise.all([memberships, ...rows]);
  return { user, tenant, base: `/app/organizations/${tenant.slug}` };
}

const main = (page: Page) => page.getByRole('main');
const rows = (page: Page) => page.locator('#seasons-list > li');
const row = (page: Page, season: string) => rows(page).filter({ hasText: season });
const status = (page: Page, season: string) =>
  row(page, season).locator('[data-slot="badge"]').first();
const dialog = (page: Page) => page.getByRole('alertdialog');
const publishButton = (page: Page, season: string) =>
  page.getByRole('button', { name: `Publish ${season}` });
const result = (page: Page) =>
  main(page).locator('section[aria-labelledby="seasons-heading"] [role="status"]');
const note = (page: Page) =>
  main(page).locator('section[aria-labelledby="seasons-heading"] [data-slot="alert"]');

test.describe('League management: publishing a season', () => {
  test('confirming publishes it: Published in the list, the result announced and focused, and the dialog names the league and the deadline', async ({
    page,
    request,
  }, testInfo) => {
    const { tenant, base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/leagues/${COED}`);
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).locator('h3')).toHaveText(['Fall 2027', 'Summer 2027', 'Spring 2027']);
    await expect(publishButton(page, 'Summer 2027')).toHaveCount(0);
    await screenshot(page, testInfo, '126-seasons-draft-rows');
    await expectAccessible(page);
    await publishButton(page, 'Fall 2027').click();

    await expect(dialog(page)).toBeVisible();
    expect(await overlayPanes(page)).toEqual([{ inContainer: true, inPopover: false }]);
    await expect(dialog(page).getByRole('heading')).toHaveText('Publish Fall 2027?');
    await expect(dialog(page)).toContainText(
      'It will appear on Coed 7v7 Rec’s public page, and players can register until Aug 25, 2027. Seasons can’t be unpublished yet.',
    );
    await expect(dialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(dialog(page)).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('app-league-management')).toHaveAttribute('inert', '');
    await screenshot(page, testInfo, '126-publish-confirm');
    // The modal holds focus, so the page-wide Tab walk (which expects to leave the page) does not
    // apply: axe, and a Tab that cycles inside the dialog.
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
    await page.keyboard.press('Tab');
    await expect(dialog(page).getByRole('button', { name: 'Publish season' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog(page).getByRole('button', { name: 'Publish season' })).toBeFocused();

    await dialog(page).getByRole('button', { name: 'Publish season' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, 'Fall 2027')).toHaveText('Published');
    await expect(row(page, 'Fall 2027').getByRole('button')).toHaveCount(0);
    await expect(result(page)).toContainText('Fall 2027 is published.');
    await expect(result(page)).toContainText('It’s on the league’s public page now.');
    await expect(result(page)).toBeFocused();
    await expect(page.locator('app-league-management')).not.toHaveAttribute('inert', '');
    await expect(result(page).getByRole('link', { name: 'View public page' })).toHaveAttribute(
      'href',
      `/organizations/${tenant.slug}/leagues/${COED}`,
    );
    const [resultBox, listBox] = await Promise.all([
      result(page).boundingBox(),
      page.locator('#seasons-list').boundingBox(),
    ]);
    expect(resultBox!.y).toBeLessThan(listBox!.y);
    await screenshot(page, testInfo, '126-publish-done');
    await expectAccessible(page);

    await expect(publishButton(page, 'Spring 2027')).toBeVisible();
    const raw = await fetchRawHtml(request, tenant.path);
    expect(raw.html).not.toContain('Spring 2027');
  });

  test('Cancel and Escape leave it a draft, write nothing, and return focus to that row’s Publish button', async ({
    page,
  }) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/leagues/${COED}`);
    const button = publishButton(page, 'Spring 2027');
    await button.click();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(button).toBeFocused();

    await button.click();
    await expect(dialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(button).toBeFocused();

    await expect(status(page, 'Spring 2027')).toHaveText('Draft');
    await expect(result(page)).toHaveCount(0);
    await page.reload();
    await expect(status(page, 'Spring 2027')).toHaveText('Draft');
    await expect(status(page, 'Fall 2027')).toHaveText('Draft');
  });

  test('offline, the confirm button looks disabled and a press shows the offline alert in the dialog, focused', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/leagues/${COED}`);
    await publishButton(page, 'Fall 2027').click();
    await expect(dialog(page)).toBeVisible();
    await page.context().setOffline(true);
    try {
      const confirm = dialog(page).getByRole('button', { name: 'Publish season' });
      await expect(confirm).toHaveAttribute('aria-disabled', 'true');
      // Playwright treats aria-disabled as not actionable; the press must still be answered.
      await confirm.click({ force: true });
      const alert = dialog(page).locator('[data-slot="alert"]');
      await expect(alert).toContainText("You're offline. Nothing was sent.");
      await expect(alert).toContainText(
        "Fall 2027 is still a draft. Try again when you're connected.",
      );
      await expect(alert).toBeFocused();
      await screenshot(page, testInfo, '126-publish-offline');
    } finally {
      await page.context().setOffline(false);
    }
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(status(page, 'Fall 2027')).toHaveText('Draft');
  });

  test(
    'the league organizer assigned to the league publishes its season',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { base } = await memberOf(page, 'leagueOrganizer');
      await page.goto(`${base}/leagues/${COED}`);
      await publishButton(page, 'Fall 2027').click();
      await dialog(page).getByRole('button', { name: 'Publish season' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(status(page, 'Fall 2027')).toHaveText('Published');
      await expect(result(page)).toContainText('Fall 2027 is published.');
      await expect(status(page, 'Spring 2027')).toHaveText('Draft');
    },
  );
});

test.describe('League management: a draft league', () => {
  test(
    'an org admin sees "Publish the league first" with the link to the Leagues page, and no Publish button',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { base } = await memberOf(page, 'orgAdmin');
      await page.goto(`${base}/leagues/${SLOW_PITCH}`);
      await expect(rows(page)).toHaveCount(1);
      await expect(note(page)).toContainText('Publish the league first');
      await expect(note(page)).toContainText('Seasons of a draft league can’t be published.');
      const link = note(page).getByRole('link', {
        name: 'Publish Tuesday Coed Slow-Pitch in Leagues',
      });
      await expect(link).toHaveAttribute('href', `${base}/leagues`);
      await expect(page.getByRole('button', { name: /^Publish Spring 2027/ })).toHaveCount(0);
      await expect(row(page, 'Spring 2027').getByRole('button')).toHaveCount(0);

      await link.click();
      await expect(page).toHaveURL(new RegExp(`${base}/leagues$`));
      await expect(
        page.getByRole('button', { name: 'Publish Tuesday Coed Slow-Pitch' }),
      ).toBeVisible();
    },
  );

  test(
    'a league organizer sees "Ask an org admin to publish the league" with no link, and no Publish button',
    VIEWPORT_AGNOSTIC,
    async ({ page }) => {
      const { base } = await memberOf(page, 'leagueOrganizer', [COED, SLOW_PITCH]);
      await page.goto(`${base}/leagues/${SLOW_PITCH}`);
      await expect(rows(page)).toHaveCount(1);
      await expect(note(page)).toContainText('Ask an org admin to publish the league');
      await expect(note(page)).toContainText(
        'Seasons of a draft league can’t be published. You can create and prepare seasons until the league is published.',
      );
      await expect(note(page).getByRole('link')).toHaveCount(0);
      await expect(row(page, 'Spring 2027').getByRole('button')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Publish / })).toHaveCount(0);
    },
  );

  test('the note is accessible and the page has no Publish button, at both widths', async ({
    page,
  }, testInfo) => {
    const { base } = await memberOf(page, 'orgAdmin');
    await page.goto(`${base}/leagues/${SLOW_PITCH}`);
    await expect(note(page)).toContainText('Publish the league first');
    await screenshot(page, testInfo, '126-draft-league-admin');
    await expectAccessible(page);
  });
});

test.describe('League management: concurrent publishes', () => {
  test(
    'an org admin and a league organizer press Publish season for the same season at once: both finish, and it is Published once',
    VIEWPORT_AGNOSTIC,
    async ({ page, browser }) => {
      const { tenant, base } = await memberOf(page, 'orgAdmin');
      const colleague = newUser('Organizer');
      const second = await otherUser(browser, colleague);
      try {
        await convexRun('testing:addLeagueOrganizer', {
          organizationSlug: tenant.slug,
          email: colleague.email,
          leagueSlugs: [COED],
        });
        const pages = [page, second];
        for (const each of pages) {
          await each.goto(`${base}/leagues/${COED}`);
          await publishButton(each, 'Fall 2027').click();
          await expect(dialog(each)).toBeVisible();
        }
        await Promise.all(
          pages.map((each) => dialog(each).getByRole('button', { name: 'Publish season' }).click()),
        );
        for (const each of pages) {
          await expect(dialog(each)).toHaveCount(0);
          await expect(status(each, 'Fall 2027')).toHaveText('Published');
          await expect(result(each)).toContainText('Fall 2027 is published.');
          await expect(status(each, 'Spring 2027')).toHaveText('Draft');
        }
        await page.reload();
        await expect(status(page, 'Fall 2027')).toHaveText('Published');
        await expect(rows(page)).toHaveCount(3);
      } finally {
        await second.context().close();
      }
    },
  );
});
