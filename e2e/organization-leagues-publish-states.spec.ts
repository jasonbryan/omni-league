// Publishing a draft league (#69), tester coverage beyond organization-leagues-publish.spec.ts, at
// 375px and 1280px: the dialog's semantics and axe in every state (confirm, Publishing, failure,
// result), the focus trap and Escape (also after a press on the scrim), the failure state through a
// held mutation, an offline press that sends nothing, a keyboard-only publish that leaves a visible
// focus ring on the result and moves the Overview tile, and two admins publishing the same league at
// once. Local backend only; the explicit widths run in the chromium-desktop project.
import type { Page, WebSocketRoute } from '@playwright/test';
import { axeScan, describeViolations } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { otherUser, signUp } from './support/session';
import { seedTenant } from './support/tenant';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'local backend only');

const LOCATIONS = [
  { name: 'Redfish Flats Fields', address: '880 Redfish Flats Ln, Rockport, TX 78382' },
  {
    name: 'Pelican Shoals Sand Courts',
    address: '2150 Pelican Shoals Dr, Corpus Christi, TX 78418',
  },
];
const LEAGUES = [
  { name: 'Coed 7v7 Rec', sport: 'soccer' as const, locations: ['Redfish Flats Fields'] },
  {
    name: 'Sunday Reverse Coed 4s',
    sport: 'beachVolleyball' as const,
    locations: ['Pelican Shoals Sand Courts'],
    status: 'draft' as const,
  },
  {
    name: 'Wednesday Coed Slow-Pitch',
    sport: 'softball' as const,
    locations: ['Redfish Flats Fields', 'Pelican Shoals Sand Courts'],
    status: 'draft' as const,
  },
];

async function admin(page: Page) {
  const user = newUser('States');
  await signUp(page, user);
  const tenant = await seedTenant({
    name: 'States Publish',
    locations: LOCATIONS,
    leagues: LEAGUES,
  });
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: user.email,
    role: 'orgAdmin',
  });
  return { user, tenant, base: `/app/organizations/${tenant.slug}` };
}

/** A viewport screenshot (the scrim is viewport-sized, so a full-page capture misleads). */
const shot = (page: Page, name: string) =>
  page.screenshot({
    path: `e2e/screenshots/${name}-${page.viewportSize()?.width}.png`,
    animations: 'disabled',
  });

const dialog = (page: Page) => page.getByRole('alertdialog');
const publishButton = (page: Page, league: string) =>
  page.getByRole('button', { name: `Publish ${league}` });
const result = (page: Page) =>
  page.getByRole('main').locator('section[aria-labelledby="leagues-heading"] [role="status"]');

/** Holds every `leagues:publish` mutation the page sends, and counts the ones sent. */
async function holdPublish(page: Page) {
  const state = {
    held: [] as { requestId: number }[],
    mutationsSent: [] as string[],
    ws: null as WebSocketRoute | null,
    server: null as WebSocketRoute | null,
    hold: true,
  };
  await page.routeWebSocket(/127\.0\.0\.1:3210/, (ws) => {
    const server = ws.connectToServer();
    state.ws = ws;
    state.server = server;
    ws.onMessage((message) => {
      const text = typeof message === 'string' ? message : message.toString();
      try {
        const parsed = JSON.parse(text) as { type?: string; udfPath?: string; requestId?: number };
        if (parsed.type === 'Mutation') {
          state.mutationsSent.push(parsed.udfPath ?? '?');
          if (parsed.udfPath === 'leagues:publish' && state.hold) {
            state.held.push({ requestId: parsed.requestId! });
            return;
          }
        }
      } catch {
        // not JSON: pass on
      }
      server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });
  return state;
}

for (const width of [375, 1280]) {
  test.describe(`width ${width}`, () => {
    test.use({ viewport: { width, height: 800 } });

    test.describe('held mutation', () => {
      test.use({ expectedConvexErrors: ['leagues:publish'] });

      test('dialog states: axe, focus trap, Escape, scrim press, held and failed publish', async ({
        page,
      }, testInfo) => {
        test.skip(testInfo.project.name !== 'chromium-desktop', 'the width is set here');
        const { base } = await admin(page);
        const control = await holdPublish(page);
        await page.goto(`${base}/leagues`);
        await expect(page.locator('#leagues-list > li')).toHaveCount(3);
        await shot(page, '69t-list');
        expect(describeViolations((await axeScan(page)).violations)).toEqual([]);

        const trigger = publishButton(page, 'Sunday Reverse Coed 4s');
        await trigger.focus();
        await page.keyboard.press('Enter');
        await expect(dialog(page)).toBeVisible();
        // Semantics of the dialog.
        const semantics = await dialog(page).evaluate((element) => {
          const labelledby = element.getAttribute('aria-labelledby');
          const describedby = element.getAttribute('aria-describedby');
          return {
            role: element.getAttribute('role'),
            modal: element.getAttribute('aria-modal'),
            name: labelledby ? document.getElementById(labelledby)?.textContent?.trim() : null,
            description: describedby
              ? document.getElementById(describedby)?.textContent?.trim()
              : null,
            left: element.getBoundingClientRect().left,
            right: element.getBoundingClientRect().right,
            width: element.getBoundingClientRect().width,
          };
        });
        expect(semantics.role).toBe('alertdialog');
        expect(semantics.modal).toBe('true');
        expect(semantics.name).toBe('Publish Sunday Reverse Coed 4s?');
        expect(semantics.description).toContain('It will appear on your public page');
        // The alertdialog container has the dialog's own box, inside the viewport.
        expect(semantics.width).toBeGreaterThan(0);
        expect(semantics.left).toBeGreaterThanOrEqual(0);
        expect(semantics.right).toBeLessThanOrEqual(width);
        // Everything outside the overlay is hidden from assistive technology while it is open.
        await expect(page.locator('app-root')).toHaveAttribute('aria-hidden', 'true');
        await expect(dialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
        await shot(page, '69t-confirm');
        expect(describeViolations((await axeScan(page)).violations)).toEqual([]);

        // Focus trap: many Tabs and Shift+Tabs never leave the dialog.
        const inside = () =>
          page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]'));
        for (let i = 0; i < 8; i++) {
          await page.keyboard.press('Tab');
          expect(await inside(), `Tab ${i}`).toBe(true);
        }
        for (let i = 0; i < 8; i++) {
          await page.keyboard.press('Shift+Tab');
          expect(await inside(), `Shift+Tab ${i}`).toBe(true);
        }

        // A press on the scrim does not close it. Focus is on the page for a moment, and Tab goes
        // into the dialog, never to the shell behind it; Escape still closes it afterwards.
        await page.mouse.click(2, 2);
        await expect(dialog(page)).toBeVisible();
        await page.keyboard.press('Tab');
        expect(await inside(), 'Tab after a scrim press').toBe(true);
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await expect(trigger).toBeFocused();

        // Publishing: held mutation, "Publishing…", dialog stays, Escape and Cancel do nothing.
        await trigger.click();
        await dialog(page).getByRole('button', { name: 'Publish league' }).click();
        await expect(dialog(page).getByRole('button', { name: /Publishing/ })).toBeVisible();
        expect(control.held).toHaveLength(1);
        await shot(page, '69t-publishing');
        expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
        await page.keyboard.press('Escape');
        // Cancel is aria-disabled while the call is out, so the press is forced past Playwright's
        // enabled check.
        const cancel = dialog(page).getByRole('button', { name: 'Cancel' });
        await expect(cancel).toHaveAttribute('aria-disabled', 'true');
        await cancel.click({ force: true });
        await expect(dialog(page)).toBeVisible();
        // A second press while publishing sends nothing more.
        await dialog(page)
          .getByRole('button', { name: /Publishing/ })
          .click({ force: true });
        expect(control.held).toHaveLength(1);

        // Failure: the server answers the held mutation with an error.
        control.ws!.send(
          JSON.stringify({
            type: 'MutationResponse',
            requestId: control.held[0].requestId,
            success: false,
            result: 'Server Error',
            logLines: [],
          }),
        );
        const alert = dialog(page).locator('[data-slot="alert"]');
        await expect(alert).toContainText('The league could not be published.');
        await expect(alert).toBeFocused();
        await shot(page, '69t-error');
        expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await expect(
          page.locator('#leagues-list > li').filter({ hasText: 'Sunday' }),
        ).toContainText('Draft');

        // Success: release the mutation (new try, not held).
        control.hold = false;
        await trigger.click();
        await dialog(page).getByRole('button', { name: 'Publish league' }).click();
        await expect(result(page)).toContainText('Sunday Reverse Coed 4s is published.');
        await expect(result(page)).toBeFocused();
        await shot(page, '69t-published');
        expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
      });
    });

    test('an offline press sends nothing', async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium-desktop', 'the width is set here');
      const { base } = await admin(page);
      const control = await holdPublish(page);
      control.hold = false;
      await page.goto(`${base}/leagues`);
      await publishButton(page, 'Sunday Reverse Coed 4s').click();
      await expect(dialog(page)).toBeVisible();
      const before = control.mutationsSent.length;
      await page.context().setOffline(true);
      const confirm = dialog(page).getByRole('button', { name: 'Publish league' });
      await expect(confirm).toHaveAttribute('aria-disabled', 'true');
      await confirm.click({ force: true });
      await confirm.press('Enter');
      await expect(dialog(page).locator('[data-slot="alert"]')).toContainText('offline');
      await page.waitForTimeout(500);
      expect(control.mutationsSent.slice(before)).toEqual([]);
      await shot(page, '69t-offline');
      await page.context().setOffline(false);
    });
  });
}

test('two admins publish the same league at once: it is counted once', async ({
  browser,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'one project is enough');
  const { tenant, base } = await admin(page);
  const second = newUser('States2');
  const pageTwo = await otherUser(browser, second);
  await convexRun('testing:addMembership', {
    organizationSlug: tenant.slug,
    email: second.email,
    role: 'orgAdmin',
  });
  try {
    await Promise.all([page.goto(`${base}/leagues`), pageTwo.goto(`${base}/leagues`)]);
    for (const p of [page, pageTwo]) {
      await publishButton(p, 'Sunday Reverse Coed 4s').click();
      await expect(dialog(p)).toBeVisible();
    }
    await Promise.all(
      [page, pageTwo].map((p) => dialog(p).getByRole('button', { name: 'Publish league' }).click()),
    );
    for (const p of [page, pageTwo]) {
      await expect(p.locator('#leagues-list > li').filter({ hasText: 'Sunday' })).toContainText(
        'Published',
        { timeout: 15_000 },
      );
    }
    // The public page: 2 published leagues (Coed 7v7 Rec, Sunday), 1 beach volleyball league.
    const visitor = await browser.newPage({ baseURL });
    await visitor.goto(tenant.path);
    await expect(visitor.locator('body')).toContainText('Sunday Reverse Coed 4s');
    await visitor.close();
    const counts = await convexRun('organizations:getPublicPage', { slug: tenant.slug });
    expect(counts).toMatchObject({ leagueCount: 2, locationCount: 2, sportCount: 2 });
    const sports = (
      counts as { sports: { key: string; leagueCount: number; locationCount: number }[] }
    ).sports;
    expect(sports.find((s) => s.key === 'beachVolleyball')).toMatchObject({
      leagueCount: 1,
      locationCount: 1,
    });
    expect(sports.find((s) => s.key === 'soccer')).toMatchObject({
      leagueCount: 1,
      locationCount: 1,
    });
  } finally {
    await pageTwo.context().close();
  }
});

for (const width of [375, 1280]) {
  test(`keyboard-only publish at ${width}: the result has a visible focus ring, and the Overview moves`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'the width is set here');
    await page.setViewportSize({ width, height: 800 });
    const { tenant, base } = await admin(page);
    const tile = page.getByRole('main').locator('dl > div').filter({ hasText: 'Leagues' });
    await page.goto(base);
    await expect(tile.locator('dd').first()).toHaveText('3');
    await expect(tile.locator('dd').nth(1)).toHaveText('1 published, 2 drafts');
    await expect(page.getByRole('region', { name: 'Get set up' })).toHaveCount(0);

    await page.goto(`${base}/leagues`);
    await publishButton(page, 'Sunday Reverse Coed 4s').focus();
    await page.keyboard.press('Enter');
    await expect(dialog(page).getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(result(page)).toBeFocused();
    const ring = await result(page).evaluate((element) => ({
      focusVisible: element.matches(':focus-visible'),
      outline: getComputedStyle(element).outlineStyle,
    }));
    expect(ring).toEqual({ focusVisible: true, outline: 'solid' });
    await page.keyboard.press('Tab');
    await expect(result(page).getByRole('link', { name: 'View public page' })).toBeFocused();

    await page.goto(base);
    await expect(tile.locator('dd').first()).toHaveText('3');
    await expect(tile.locator('dd').nth(1)).toHaveText('2 published, 1 draft');
    expect(tenant.name).toContain('States Publish');
    expect(describeViolations((await axeScan(page)).violations)).toEqual([]);
  });
}
