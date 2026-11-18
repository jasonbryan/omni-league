import { expectAccessible, tabKey } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { seedTenant } from './support/tenant';
import { topBarFind } from './support/top-bar-find';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const PHONE_SCREENSHOT_WIDTH = 375;
const MAX_TABS_TO_THE_BAR = 5;

test.describe('find a program: entry points by keyboard', () => {
  test('the empty state of an organization with no league links to /programs, passes axe, and does not scroll at 320px', async ({
    page,
  }, testInfo) => {
    const tenant = await seedTenant();
    if (testInfo.project.name === 'chromium-mobile') {
      await page.setViewportSize({ width: PHONE_SCREENSHOT_WIDTH, height: 800 });
    }
    await page.goto(tenant.path);
    const link = page.getByRole('main').getByRole('link', { name: 'Find another program' });
    await expect(link).toBeVisible();
    await screenshot(page, testInfo, 'organization-no-league-find-another-program');
    await expectAccessible(page);

    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${baseURL}/programs`);
  });

  test('Tab reaches the top bar search, and Enter opens /programs with the typed words', async ({
    page,
  }) => {
    const tenant = await seedTenant();
    await page.goto(tenant.path);
    const find = page.locator(topBarFind(page));
    for (let presses = 0; presses < MAX_TABS_TO_THE_BAR; presses++) {
      if (await find.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press(tabKey(page));
    }
    await expect(find).toBeFocused();

    const isField = (await find.evaluate((el) => el.tagName)) === 'INPUT';
    if (isField) await page.keyboard.type('coed');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${baseURL}/programs${isField ? '?q=coed' : ''}`);
    await expect(page.getByRole('banner').getByRole('searchbox')).toHaveCount(0);
  });
});
