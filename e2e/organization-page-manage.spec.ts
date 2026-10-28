import type { Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { convexRun } from './support/convex';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { screenshot } from './support/screenshot';
import { signUp } from './support/session';
import { dateFromToday, seedSeasons, seedTenant, type Tenant } from './support/tenant';
import { newUser } from './support/users';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

type Role = 'orgAdmin' | 'leagueOrganizer';

const VIEWER_IS_ORG_ADMIN = 'organizations:viewerIsOrgAdmin';

async function tenantWithoutOpenSeason(): Promise<Tenant> {
  return seedTenant({
    name: 'E2E Hero',
    locations: [{ name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' }],
    leagues: [{ name: 'Alpha League', sport: 'soccer', locations: ['Alpha Field'] }],
  });
}

async function tenantWithOpenSeason(): Promise<Tenant> {
  const tenant = await tenantWithoutOpenSeason();
  await seedSeasons(tenant, 'alpha-league', [
    {
      name: 'Open Season',
      slug: 'open-season',
      startDate: dateFromToday(30),
      endDate: dateFromToday(90),
      registrationDeadline: dateFromToday(10),
    },
  ]);
  return tenant;
}

async function signedInAs(page: Page, role: Role | null, tenant: Tenant): Promise<void> {
  const user = newUser('Manager');
  await signUp(page, user);
  if (role) {
    await convexRun('testing:addMembership', {
      organizationSlug: tenant.slug,
      email: user.email,
      role,
    });
  }
}

const manage = (page: Page) => page.getByRole('main').getByRole('link', { name: 'Manage' });

test.describe('organization page: Manage', () => {
  test('an org admin sees Manage after hydration, and it opens the admin Overview', async ({
    page,
  }) => {
    const tenant = await tenantWithoutOpenSeason();
    await signedInAs(page, 'orgAdmin', tenant);
    await page.goto(tenant.path);
    await expect(manage(page)).toBeVisible();
    await expect(manage(page)).toHaveAttribute('href', `/app/organizations/${tenant.slug}`);
    await manage(page).click();
    await expect(page).toHaveURL(`${baseURL}/app/organizations/${tenant.slug}`);
    await expect(
      page.getByRole('main').getByRole('heading', { level: 1, name: 'Overview' }),
    ).toBeVisible();
  });

  test('the raw HTML holds no Manage', RAW_HTTP, async ({ request }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium-desktop',
      'raw HTML does not depend on the viewport',
    );
    const tenant = await tenantWithoutOpenSeason();
    const { html } = await fetchRawHtml(request, tenant.path);
    expect(html).not.toMatch(/>\s*Manage\s*</);
    expect(html).toContain('data-hero-actions');
  });

  test.describe('a signed-in visitor who is not an org admin', () => {
    for (const [label, role] of [
      ['a non-member', null],
      ['a league organizer', 'leagueOrganizer'],
    ] as const) {
      test(`${label} sees no Manage`, async ({ page }) => {
        const tenant = await tenantWithoutOpenSeason();
        await signedInAs(page, role, tenant);
        const held = await holdQueries(page, [VIEWER_IS_ORG_ADMIN]);
        await page.goto(tenant.path);
        await expect.poll(() => held.isHolding()).toBe(true);
        held.release();
        await expect(page.getByRole('link', { name: /^Account:/ })).toBeVisible();
        await expect(manage(page)).toHaveCount(0);
      });
    }
  });

  for (const [label, seed] of [
    ['no season is open', tenantWithoutOpenSeason],
    ['a season is open', tenantWithOpenSeason],
  ] as const) {
    test(`Manage arriving after hydration does not move the first section under the hero when ${label}`, async ({
      page,
    }) => {
      const tenant = await seed();
      await signedInAs(page, 'orgAdmin', tenant);
      const held = await holdQueries(page, [VIEWER_IS_ORG_ADMIN]);
      await page.goto(tenant.path);
      await expect.poll(() => held.isHolding()).toBe(true);
      const underHero = page.locator('#registration-open-heading, #leagues-heading').first();
      await expect(underHero).toBeVisible();
      await expect(manage(page)).toHaveCount(0);
      const before = await underHero.boundingBox();

      held.release();
      await expect(manage(page)).toBeVisible();
      const after = await underHero.boundingBox();
      expect(after?.y).toBe(before?.y);
    });
  }

  test('matches the mockup for an org admin and passes the accessibility check', async ({
    page,
  }, testInfo) => {
    const tenant = await tenantWithoutOpenSeason();
    await signedInAs(page, 'orgAdmin', tenant);
    await page.goto(tenant.path);
    await expect(manage(page)).toBeVisible();
    const box = await manage(page).boundingBox();
    expect(box?.height).toBe(44);
    await expectAccessible(page);
    await screenshot(page, testInfo, 'organization-page-manage');
  });
});
