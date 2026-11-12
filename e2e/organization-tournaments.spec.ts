import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { chipLabel, chooseChip } from './support/chip';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { seedTenant, type TenantSeed } from './support/tenant';
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
      'Winter Doubles Classic created. It stays a draft until you publish it.',
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
