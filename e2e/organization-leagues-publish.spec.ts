import type { Page } from '@playwright/test';
import { axeScan, describeViolations, expectAccessible } from './support/a11y';
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

const LEAGUES: NonNullable<TenantSeed['leagues']> = [
  { name: 'Coed 7v7 Rec', sport: 'soccer', locations: ['Redfish Flats Fields'] },
  {
    name: 'Sunday Reverse Coed 4s',
    sport: 'beachVolleyball',
    locations: ['Pelican Shoals Sand Courts'],
    status: 'draft',
  },
  {
    name: 'Wednesday Coed Slow-Pitch',
    sport: 'softball',
    locations: ['Redfish Flats Fields', 'Pelican Shoals Sand Courts'],
    status: 'draft',
  },
];

async function orgAdmin(page: Page, seed: TenantSeed = { locations: LOCATIONS, leagues: LEAGUES }) {
  const user = newUser('Admin');
  await signUp(page, user);
  const tenant = await seedTenant({ name: 'E2E Publish', ...seed });
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });
  return { user, tenant, base: `/app/organizations/${tenant.slug}` };
}

const main = (page: Page) => page.getByRole('main');
const rows = (page: Page) => page.locator('#leagues-list > li');
const row = (page: Page, league: string) => rows(page).filter({ hasText: league });
const status = (page: Page, league: string) =>
  row(page, league).locator('[data-slot="badge"]').first();
const dialog = (page: Page) => page.getByRole('alertdialog');
const publishButton = (page: Page, league: string) =>
  page.getByRole('button', { name: `Publish ${league}` });
const result = (page: Page) =>
  main(page).locator('section[aria-labelledby="leagues-heading"] [role="status"]');
const leagueTile = (page: Page) => main(page).locator('dl > div').filter({ hasText: 'Leagues' });

test.describe('Leagues: publishing a draft (#69)', () => {
  test('confirming publishes it: Published in the list, the result announced and focused, and the league on the public page, live and in the raw HTML', async ({
    page,
    request,
    browser,
  }, testInfo) => {
    const { tenant, base } = await orgAdmin(page);
    const visitor = await browser.newPage({ baseURL });
    try {
      await visitor.goto(tenant.path);
      await expect(visitor.locator('body')).toContainText('Coed 7v7 Rec');
      await expect(visitor.locator('body')).not.toContainText('Sunday Reverse Coed 4s');
      expect((await fetchRawHtml(request, tenant.path)).html).not.toContain(
        'Sunday Reverse Coed 4s',
      );

      await page.goto(`${base}/leagues`);
      await expect(rows(page)).toHaveCount(3);
      await screenshot(page, testInfo, '69-leagues-draft-rows');
      await expectAccessible(page);
      await publishButton(page, 'Sunday Reverse Coed 4s').click();

      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page).getByRole('heading')).toHaveText('Publish Sunday Reverse Coed 4s?');
      await expect(dialog(page)).toContainText(
        'It will appear on your public page. Leagues can’t be unpublished yet.',
      );
      await expect(dialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
      await expect(dialog(page)).toHaveAttribute('aria-modal', 'true');
      await expect(page.locator('app-admin-leagues')).toHaveAttribute('inert', '');
      const scrim = await page.locator('.cdk-overlay-backdrop').evaluate((element) => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, filter: style.backdropFilter };
      });
      const sheetScrim = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.className = 'bg-foreground/50';
        document.body.append(probe);
        const color = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return color;
      });
      expect(scrim.background).toBe(sheetScrim);
      expect(['none', '']).toContain(scrim.filter);
      await screenshot(page, testInfo, '69-publish-confirm');
      // The modal holds focus, so the page-wide Tab walk (which expects to leave the page) does not
      // apply: axe, and a Tab that cycles inside the dialog.
      expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
      await page.keyboard.press('Tab');
      await expect(dialog(page).getByRole('button', { name: 'Publish league' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(dialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();

      await dialog(page).getByRole('button', { name: 'Publish league' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(status(page, 'Sunday Reverse Coed 4s')).toHaveText('Published');
      await expect(row(page, 'Sunday Reverse Coed 4s').getByRole('button')).toHaveCount(0);
      await expect(result(page)).toContainText('Sunday Reverse Coed 4s is published.');
      await expect(result(page)).toContainText('It’s on your public page now.');
      await expect(result(page)).toBeFocused();
      await expect(page.locator('app-admin-leagues')).not.toHaveAttribute('inert', '');
      await expect(result(page).getByRole('link', { name: 'View public page' })).toHaveAttribute(
        'href',
        tenant.path,
      );
      const [resultBox, listBox] = await Promise.all([
        result(page).boundingBox(),
        page.locator('#leagues-list').boundingBox(),
      ]);
      expect(resultBox!.y).toBeLessThan(listBox!.y);
      await screenshot(page, testInfo, '69-publish-done');
      await expectAccessible(page);

      await expect(publishButton(page, 'Wednesday Coed Slow-Pitch')).toBeVisible();

      await expect(visitor.locator('body')).toContainText('Sunday Reverse Coed 4s');
      await expect(visitor.locator('body')).not.toContainText('Wednesday Coed Slow-Pitch');
      const raw = await fetchRawHtml(request, tenant.path);
      expect(raw.html).toContain('Sunday Reverse Coed 4s');
      expect(raw.html).not.toContain('Wednesday Coed Slow-Pitch');
    } finally {
      await visitor.context().close();
    }
  });

  test('Cancel and Escape leave it a draft, write nothing, and return focus to that row’s Publish button', async ({
    page,
    request,
  }) => {
    const { tenant, base } = await orgAdmin(page);
    await page.goto(`${base}/leagues`);
    const button = publishButton(page, 'Wednesday Coed Slow-Pitch');
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

    await expect(status(page, 'Wednesday Coed Slow-Pitch')).toHaveText('Draft');
    await expect(result(page)).toHaveCount(0);
    expect((await fetchRawHtml(request, tenant.path)).html).not.toContain(
      'Wednesday Coed Slow-Pitch',
    );
  });

  test('offline, the confirm button looks disabled and a press shows the offline alert in the dialog, focused', async ({
    page,
  }, testInfo) => {
    const { base } = await orgAdmin(page);
    await page.goto(`${base}/leagues`);
    await publishButton(page, 'Sunday Reverse Coed 4s').click();
    await expect(dialog(page)).toBeVisible();
    await page.context().setOffline(true);
    try {
      const confirm = dialog(page).getByRole('button', { name: 'Publish league' });
      await expect(confirm).toHaveAttribute('aria-disabled', 'true');
      // Playwright treats aria-disabled as not actionable; the press must still be answered.
      await confirm.click({ force: true });
      const alert = dialog(page).locator('[data-slot="alert"]');
      await expect(alert).toContainText("You're offline. Nothing was sent.");
      await expect(alert).toBeFocused();
      await screenshot(page, testInfo, '69-publish-error');
    } finally {
      await page.context().setOffline(false);
    }
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(status(page, 'Sunday Reverse Coed 4s')).toHaveText('Draft');
  });

  test('publishing the first league moves the Overview tile from "1 draft" to "1 published" and hides "Get set up"', async ({
    page,
  }) => {
    const { tenant, base } = await orgAdmin(page, {
      locations: LOCATIONS,
      leagues: [LEAGUES[1]],
    });
    await page.goto(base);
    await expect(leagueTile(page).locator('dd').first()).toHaveText('1');
    await expect(leagueTile(page).locator('dd').nth(1)).toHaveText('1 draft');
    await expect(page.getByRole('region', { name: 'Get set up' })).toBeVisible();

    // Through the navigation, so the page keeps its live connection.
    const openSection = async (section: string) => {
      if ((page.viewportSize()?.width ?? 0) >= 1024) {
        await page
          .getByRole('navigation', { name: `${tenant.name} admin` })
          .getByRole('link', { name: section })
          .click();
      } else {
        await page.getByRole('button', { name: 'Open navigation' }).click();
        await page
          .getByRole('dialog', { name: 'Navigation' })
          .getByRole('link', { name: section })
          .click();
      }
    };
    await openSection('Leagues');
    await publishButton(page, 'Sunday Reverse Coed 4s').click();
    await dialog(page).getByRole('button', { name: 'Publish league' }).click();
    await expect(result(page)).toBeFocused();
    await openSection('Overview');
    await expect(leagueTile(page).locator('dd').first()).toHaveText('1');
    await expect(leagueTile(page).locator('dd').nth(1)).toHaveText('1 published');
    await expect(page.getByRole('region', { name: 'Get set up' })).toHaveCount(0);
  });
});
