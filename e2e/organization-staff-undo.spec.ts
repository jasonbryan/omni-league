// Undoing a revoked invite on the Staff page (#211, design/mockups/67-organization-staff.html,
// decision 7): the revoked status carries Undo, which `invites.restore` honours for 10 minutes
// after the revoke (the server enforces the window; its edges are Convex tests). Every test signs
// up its own org admin through the real form and seeds the invite with a known token
// (`testing:addInvite`), so the tests need the local Convex backend and are skipped with
// E2E_BASE_URL set.
import type { Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { seedTenant } from './support/tenant';
import { newUser } from './support/users';
import { VIEWPORT_AGNOSTIC } from './support/viewport-agnostic';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const DAY = 24 * 60 * 60 * 1000;
const LOCATIONS = [
  { name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX 78382' },
];
const LEAGUES = [
  { name: 'Coed 7v7 Rec', sport: 'soccer' as const, locations: ['Redfish Flats Fields'] },
];

const main = (page: Page) => page.getByRole('main');
const pendingRows = (page: Page) => page.locator('#pending-list > li');

/** An org admin signed in on `/staff` of a new organization holding one invite with a known token. */
async function openStaffWithInvite(page: Page, email: string) {
  const admin = newUser('Admin');
  await signUp(page, admin);
  const tenant = await seedTenant({ name: 'E2E Undo', locations: LOCATIONS, leagues: LEAGUES });
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: admin.email,
    role: 'orgAdmin',
  });
  const token = randomBytes(32).toString('base64url');
  await convexRun('testing:addInvite', {
    organizationSlug: tenant.slug,
    email,
    role: 'orgAdmin',
    expiresAt: Date.now() + 14 * DAY,
    token,
  });
  await page.goto(`/app/organizations/${tenant.slug}/staff`);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Staff' })).toBeVisible();
  await expect(pendingRows(page)).toHaveCount(1);
  return { tenant, token };
}

const revokeButton = (page: Page, email: string) =>
  page.getByRole('button', { name: `Revoke the invite to ${email}` });
const undoButton = (page: Page, email: string) =>
  page.getByRole('button', { name: `Undo revoking the invite to ${email}` });

/** Opens the invite link in another tab of the same browser and returns that tab's heading. */
async function inviteLinkHeading(page: Page, token: string) {
  const tab = await page.context().newPage();
  await tab.goto(`/invites/accept#${token}`);
  return { tab, heading: main(tab).getByRole('heading', { level: 1 }) };
}

test.describe('Staff: undoing a revoke', () => {
  test('Undo restores the invite: the row returns, the status takes focus, and the original link opens the accept page again', async ({
    page,
  }, testInfo) => {
    const email = 'dana@example.com';
    const { tenant, token } = await openStaffWithInvite(page, email);

    await revokeButton(page, email).click();
    const revoked = page.getByRole('status').filter({ hasText: `Invite to ${email} revoked.` });
    await expect(revoked).toBeFocused();
    await expect(undoButton(page, email)).toBeVisible();
    await expect(pendingRows(page)).toHaveCount(0);
    await screenshot(page, testInfo, '211-staff-undo-offered');
    await expectAccessible(page);

    const before = await inviteLinkHeading(page, token);
    await expect(before.heading).toHaveText('This invite link can’t be used');
    await before.tab.close();

    await undoButton(page, email).click();
    const restored = page
      .getByRole('status')
      .filter({ hasText: `Invite to ${email} restored. Its link works again.` });
    await expect(restored).toBeFocused();
    await expect(undoButton(page, email)).toHaveCount(0);
    await expect(pendingRows(page)).toHaveCount(1);
    await expect(pendingRows(page).first().locator('h3')).toHaveText(email);
    await screenshot(page, testInfo, '211-staff-restored');
    await expectAccessible(page);

    const after = await inviteLinkHeading(page, token);
    await expect(after.heading).toHaveText(`Join ${tenant.name}`);
    await after.tab.close();
  });

  test('a keyboard alone revokes an invite and then activates Undo (WCAG 2.1.1)', async ({
    page,
  }) => {
    const email = 'erin@example.com';
    const { tenant, token } = await openStaffWithInvite(page, email);

    // No pointer input from here on: focus the button, then Enter, Tab, and Space.
    await revokeButton(page, email).focus();
    await page.keyboard.press('Enter');
    const revoked = page.getByRole('status').filter({ hasText: `Invite to ${email} revoked.` });
    await expect(revoked).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(undoButton(page, email)).toBeFocused();
    await page.keyboard.press('Space');

    const restored = page.getByRole('status').filter({ hasText: `Invite to ${email} restored.` });
    await expect(restored).toBeFocused();
    await expect(pendingRows(page)).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(revokeButton(page, email)).toBeFocused();

    const link = await inviteLinkHeading(page, token);
    await expect(link.heading).toHaveText(`Join ${tenant.name}`);
    await link.tab.close();
  });

  test.describe('a refusal from the server', () => {
    test.use({ expectedConvexErrors: ['invites:restore'] });

    test(
      'a newer pending invite to the same address refuses Undo, says why, and leaves the first invite revoked',
      VIEWPORT_AGNOSTIC,
      async ({ page }) => {
        const email = 'dana@example.com';
        const { token } = await openStaffWithInvite(page, email);
        await revokeButton(page, email).click();
        await expect(undoButton(page, email)).toBeVisible();

        // The address is invited again while the first status is still up.
        await page.locator('#email').fill(email);
        await page.getByRole('radio', { name: 'Org admin' }).check();
        await page.getByRole('button', { name: /^Create invite link/ }).click();
        await expect(page.getByRole('heading', { name: 'Invite link ready' })).toBeVisible();

        await undoButton(page, email).click();
        const refused = page.getByRole('alert').filter({
          hasText: `Invite to ${email} could not be restored.`,
        });
        await expect(refused).toContainText(
          `${email} already has a newer pending invite, so the old link stays revoked.`,
        );
        await expect(undoButton(page, email)).toHaveCount(0);
        await expect(pendingRows(page)).toHaveCount(1);

        const link = await inviteLinkHeading(page, token);
        await expect(link.heading).toHaveText('This invite link can’t be used');
        await link.tab.close();
      },
    );
  });
});
