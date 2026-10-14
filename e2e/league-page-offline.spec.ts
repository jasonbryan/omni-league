import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { numberedSeasons, seedSeasons, seedTenant } from './support/tenant';

test.describe('public league page offline', () => {
  test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: needs the local Convex backend');

  test('saved pages open offline from the page control, with the saved-copy note', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    const tenant = await seedTenant({
      name: 'E2E League Offline',
      locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
      leagues: [{ name: 'Offline League', sport: 'beachVolleyball', locations: ['Alpha Field'] }],
    });
    await seedSeasons(tenant, 'offline-league', [
      ...numberedSeasons(12),
      {
        name: 'Draft Season',
        slug: 'draft-season',
        startDate: '2030-01-01',
        endDate: '2030-03-01',
        status: 'draft',
      },
    ]);
    const path = `${tenant.path}/leagues/offline-league`;
    const rows = page.locator('section#seasons > ul > li h3');
    const pages = page.getByRole('navigation', { name: 'Seasons pages' });
    const note = page.locator('app-saved-copy-note');
    const dump = async (label: string) =>
      testInfo.attach(label, {
        body: JSON.stringify({
          url: page.url(),
          rows: await rows.allInnerTexts(),
          // The not-saved view has no list or control, so read them only when they are there.
          busy: await page.locator('[aria-busy="true"]').count(),
          range: (await pages.count()) > 0 ? await pages.locator('p').innerText() : null,
          note: await note.count(),
          notSaved: await page.locator('app-not-saved-view').count(),
          h1: await page.locator('main h1').allInnerTexts(),
        }),
        contentType: 'application/json',
      });

    await page.goto(path);
    await expect(rows).toHaveText([
      'Season 12',
      'Season 11',
      'Season 10',
      'Season 09',
      'Season 08',
    ]);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await pages.getByRole('link', { name: 'Page 2' }).click();
    await expect(rows).toHaveText([
      'Season 07',
      'Season 06',
      'Season 05',
      'Season 04',
      'Season 03',
    ]);
    await expect(note).toHaveCount(0);

    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await expect(rows).toHaveText([
      'Season 07',
      'Season 06',
      'Season 05',
      'Season 04',
      'Season 03',
    ]);
    await pages.getByRole('link', { name: 'Page 1' }).click();
    await expect(rows).toHaveText([
      'Season 12',
      'Season 11',
      'Season 10',
      'Season 09',
      'Season 08',
    ]);
    await expect(note).toBeVisible();
    await expect(page.getByText('Draft Season')).toHaveCount(0);
    await dump('offline-page-1');

    // A page never viewed has no saved copy: as on a fresh load offline, the not-saved view shows,
    // not the previous page's rows under `?page=3`.
    await pages.getByRole('link', { name: 'Page 3' }).click();
    await expect(page.locator('app-not-saved-view')).toBeVisible({ timeout: 3_000 });
    await expect(rows).toHaveCount(0);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(pages).toHaveCount(0);
    await expect(page.locator('app-not-saved-view a')).toHaveAttribute('href', `${path}?page=3`);
    await dump('offline-page-3-unsaved');

    await context.setOffline(false);
  });
});
