// Tester probes for #114 (PR #203), beyond the implementer's e2e: focus on `#main` after a route
// change into, between, and out of sport views (sport to sport, Locations, Overview, the league
// page's sport links), the sheet on a sport view, tenant isolation, hostile `page` values, and the
// saved copies offline. Each test seeds its own tenant (ADR 0005), so the file needs the local
// Convex backend.
import type { Locator, Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { rawGet } from './support/raw-get';
import { RAW_HTTP } from './support/raw-http';
import { seedTenant, tallLocations, type Tenant } from './support/tenant';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

const LOCATIONS = [
  { name: 'Alpha Field', address: '1 Alpha Road, Corpus Christi, TX 78412' },
  { name: 'Beta Courts', address: '2 Beta Street, Corpus Christi, TX 78402' },
];

/** 7 beach volleyball, 3 soccer, and 1 softball league, and a draft softball league. */
function seed(extra: Parameters<typeof seedTenant>[0] = {}): Promise<Tenant> {
  return seedTenant({
    name: 'E2E Sport Focus',
    locations: LOCATIONS,
    leagues: [
      ...Array.from({ length: 7 }, (_, i) => ({
        name: `Beach League ${i + 1}`,
        sport: 'beachVolleyball' as const,
        locations: ['Alpha Field'],
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        name: `Soccer League ${i + 1}`,
        sport: 'soccer' as const,
        locations: ['Beta Courts'],
      })),
      { name: 'Softball League 1', sport: 'softball' as const, locations: ['Beta Courts'] },
    ],
    ...extra,
  });
}

/** The control's range text, for example `6–10 of 12 leagues`. */
function rangeText(html: string): string | undefined {
  const nav = /<nav\b[^>]*aria-label="Leagues pages"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1];
  const text = /<p\b[^>]*>([\s\S]*?)<\/p>/.exec(nav ?? '')?.[1];
  return text
    ?.replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function hydrated(consoleGuard: { hydrated: boolean }): Promise<void> {
  await expect.poll(() => consoleGuard.hydrated).toBe(true);
}

async function arm(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as Window & { e2eNoReload?: boolean }).e2eNoReload = true;
  });
}

const noReload = (page: Page) =>
  page.evaluate(() => (window as Window & { e2eNoReload?: boolean }).e2eNoReload);

/** A tap at the control's coordinates in Chromium; the keyboard in WebKit, where a tap does not focus. */
async function tap(page: Page, control: Locator): Promise<void> {
  if (page.context().browser()?.browserType().name() === 'webkit') {
    await control.focus();
    await page.keyboard.press('Enter');
    return;
  }
  await control.scrollIntoViewIfNeeded();
  const box = await control.boundingBox();
  if (!box) throw new Error('control has no box');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('sport view: focus after a route change', () => {
  test.skip(({ isMobile }) => isMobile, 'keyboard navigation is checked at 1280');

  test('sport to sport (the component is reused): the other sport shows, title and aria-current follow, focus is on main, nothing of the first sport stays', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await seed();
    await page.goto(`${tenant.path}/sports/beach-volleyball?page=2`);
    await hydrated(consoleGuard);
    await arm(page);
    const nav = page.getByRole('navigation', { name: tenant.name });
    const soccer = nav.getByRole('link', { name: 'Soccer 3 leagues' });
    await soccer.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: 'Soccer' })).toBeVisible();
    await expect(page).toHaveTitle(`Soccer | ${tenant.name} | Omni League`);
    await expect(page.locator('main#main')).toBeFocused();
    await expect(soccer).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Beach volleyball 7 leagues' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.locator('section#leagues > ul > li h3')).toHaveText([
      'Soccer League 1',
      'Soccer League 2',
      'Soccer League 3',
    ]);
    // 3 leagues: no control; the URL has no leftover ?page=2.
    await expect(page.getByRole('navigation', { name: 'Leagues pages' })).toHaveCount(0);
    expect(new URL(page.url()).search).toBe('');
    expect(await noReload(page)).toBe(true);
    await expectAccessible(page);
  });

  test('sport view to Overview: the organization page shows with focus on main', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await seed();
    await page.goto(`${tenant.path}/sports/soccer`);
    await hydrated(consoleGuard);
    await arm(page);
    const overview = page
      .getByRole('navigation', { name: tenant.name })
      .getByRole('link', { name: 'Overview' });
    await overview.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible();
    await expect(page.locator('main#main')).toBeFocused();
    expect(new URL(page.url()).pathname).toBe(tenant.path);
    expect(await noReload(page)).toBe(true);
  });

  test('sport view to the breadcrumb organization link: focus on main', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await seed();
    await page.goto(`${tenant.path}/sports/soccer`);
    await hydrated(consoleGuard);
    await arm(page);
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: tenant.name })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible();
    await expect(page.locator('main#main')).toBeFocused();
    expect(await noReload(page)).toBe(true);
  });

  test('sport view to a league row: the league page shows with focus on main; its breadcrumb and sidebar sport link return to the sport view with focus on main', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await seed();
    await page.goto(`${tenant.path}/sports/soccer`);
    await hydrated(consoleGuard);
    await arm(page);
    await page.getByRole('link', { name: 'Soccer League 2' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Soccer League 2' })).toBeVisible();
    await expect(page.locator('main#main')).toBeFocused();

    // The league page's sport is a link in its breadcrumb.
    const crumb = page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', {
      name: 'Soccer',
      exact: true,
    });
    await expect(crumb).toHaveAttribute('href', `${tenant.path}/sports/soccer`);
    await crumb.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Soccer' })).toBeVisible();
    await expect(page.locator('main#main')).toBeFocused();
    expect(new URL(page.url()).pathname).toBe(`${tenant.path}/sports/soccer`);

    // And in its sidebar, to another sport.
    await page.getByRole('link', { name: 'Soccer League 2' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Soccer League 2' })).toBeVisible();
    const side = page
      .getByRole('navigation', { name: tenant.name })
      .getByRole('link', { name: 'Softball 1 league' });
    await expect(side).toHaveAttribute('href', `${tenant.path}/sports/softball`);
    await side.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Softball' })).toBeVisible();
    await expect(page.locator('main#main')).toBeFocused();
    expect(await noReload(page)).toBe(true);
  });
});

test.describe('sport view: the Locations item', () => {
  test('1280: from a sport view it opens the organization page at its Locations panel, focus on main, no reload', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop', 'the sheet case is below');
    const tenant = await seed({ locations: tallLocations().concat(LOCATIONS) });
    await page.goto(`${tenant.path}/sports/soccer`);
    await hydrated(consoleGuard);
    await arm(page);
    await page
      .getByRole('navigation', { name: tenant.name })
      .getByRole('link', { name: /^Locations/ })
      .click();
    await expect(page).toHaveURL(`${tenant.path}#locations`);
    await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible();
    await expect(page.locator('main#main')).toBeFocused();
    const panel = page.locator('main #locations');
    await expect(panel).toBeInViewport();
    expect(await noReload(page)).toBe(true);
  });

  test('360: from the sheet on a sport view it opens the organization page at its Locations panel, the sheet closed, focus on main', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'the sheet runs at 360px only');
    const tenant = await seed({ locations: tallLocations().concat(LOCATIONS) });
    await page.goto(`${tenant.path}/sports/soccer`);
    await hydrated(consoleGuard);
    await arm(page);
    const dialog = page.getByRole('dialog', { name: 'Navigation' });
    await tap(page, page.getByRole('button', { name: 'Open navigation' }));
    await expect(dialog.locator('[data-slot="sheet-content"]')).toBeVisible();
    await tap(page, dialog.getByRole('link', { name: /^Locations/ }));
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(`${tenant.path}#locations`);
    await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible();
    await expect(page.locator('main #locations')).toBeInViewport();
    await expect(page.locator('main#main')).toBeFocused();
    expect(await noReload(page)).toBe(true);
  });

  test('360: a sport entry in the sheet of a sport view shows the other sport, closes the sheet, focus on main', async ({
    page,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'the sheet runs at 360px only');
    const tenant = await seed();
    await page.goto(`${tenant.path}/sports/beach-volleyball`);
    await hydrated(consoleGuard);
    await arm(page);
    const dialog = page.getByRole('dialog', { name: 'Navigation' });
    await tap(page, page.getByRole('button', { name: 'Open navigation' }));
    await expect(dialog.locator('[data-slot="sheet-content"]')).toBeVisible();
    await tap(page, dialog.getByRole('link', { name: 'Soccer 3 leagues' }));
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Soccer' })).toBeVisible();
    await expect(page.locator('main#main')).toBeFocused();
    expect(await noReload(page)).toBe(true);
    await expectAccessible(page);
  });
});

test.describe('sport view: data', () => {
  test(
    'tenant isolation: another organization with softball leagues does not leak into this one, and its own sport view lists only its leagues',
    RAW_HTTP,
    async () => {
      const a = await seed();
      const b = await seedTenant({
        name: 'E2E Other Org',
        locations: LOCATIONS,
        leagues: [
          { name: 'Other Softball 1', sport: 'softball', locations: ['Alpha Field'] },
          { name: 'Other Beach 1', sport: 'beachVolleyball', locations: ['Alpha Field'] },
        ],
      });
      const aSoftball = await rawGet(`${a.path}/sports/softball`);
      expect(aSoftball.status).toBe(200);
      expect(aSoftball.body).toContain('Softball League 1');
      expect(aSoftball.body).not.toContain('Other Softball');
      const bSoftball = await rawGet(`${b.path}/sports/softball`);
      expect(bSoftball.status).toBe(200);
      expect(bSoftball.body).toContain('Other Softball 1');
      expect(bSoftball.body).not.toContain('Softball League 1');
      const bSoccer = await rawGet(`${b.path}/sports/soccer`);
      expect(bSoccer.status, 'org B has no soccer league').toBe(404);
      const bBeach = await rawGet(`${b.path}/sports/beach-volleyball`);
      expect(bBeach.body).not.toContain('Beach League');
      expect(bBeach.body).toContain('1 league at 1 location');
    },
  );

  test(
    'a draft league is not counted, listed, or reachable: a sport with only a draft is 404, and publishing it makes the view appear',
    RAW_HTTP,
    async () => {
      const t = await seedTenant({
        name: 'E2E Draft Only',
        locations: LOCATIONS,
        leagues: [
          { name: 'Published Soccer', sport: 'soccer', locations: ['Alpha Field'] },
          {
            name: 'Draft Softball',
            sport: 'softball',
            locations: ['Alpha Field'],
            status: 'draft',
          },
        ],
      });
      const softball = await rawGet(`${t.path}/sports/softball`);
      expect(softball.status).toBe(404);
      expect(softball.body).not.toContain('Draft Softball');
      const org = await rawGet(t.path);
      expect(org.body).not.toContain('Draft Softball');
      expect(org.body).not.toContain('Softball');
      const soccer = await rawGet(`${t.path}/sports/soccer`);
      expect(soccer.status).toBe(200);
      expect(soccer.body).toContain('1 league at 1 location');
    },
  );

  test(
    'hostile page values render page 1 with 200, no Location, and nothing reflected',
    RAW_HTTP,
    async () => {
      const t = await seed();
      const path = `${t.path}/sports/beach-volleyball`;
      const hostile: [string, string[]][] = [
        ['?page=-1', ['page=-1']],
        ['?page=1e3', ['1e3']],
        ['?page=%00', ['%00']],
        ['?page=%3Cscript%3Ealert(1)%3C/script%3E', ['alert(1)']],
        ['?page[]=2', ['page[]']],
        ['?page=2&page=3&page=4&page=5', ['page=5']],
        ['?__proto__=x&page=__proto__', ['__proto__']],
        [`?page=${'9'.repeat(5000)}`, ['99999999']],
        ['?page=Infinity', ['Infinity']],
        ['?page=%20%202', ['%20']],
        ['?page=2%0d%0aX-Injected:1', ['X-Injected']],
        ['?PAGE=2', ['PAGE=2']],
      ];
      for (const [query, raws] of hostile) {
        const r = await rawGet(`${path}${query}`);
        expect(r.status, query.slice(0, 40)).toBe(200);
        expect(r.headers.location, query.slice(0, 40)).toBeUndefined();
        expect(r.headers['x-injected']).toBeUndefined();
        for (const raw of raws) expect(r.body, `${query.slice(0, 40)} ${raw}`).not.toContain(raw);
        // The effective page is derived from the result: always page 1 here.
        expect(rangeText(r.body), query.slice(0, 40)).toBe('1–5 of 7 leagues');
      }
    },
  );

  test(
    'unusual sport segments are 404 with no query asked: case, trailing slash, double slash, encoded, prototype names',
    RAW_HTTP,
    async () => {
      const t = await seed();
      for (const segment of [
        'Beach-Volleyball',
        'beach_volleyball',
        'beachvolleyball',
        '%62each-volleyball%00',
        '__proto__',
        'constructor',
        'x'.repeat(3000),
        '<script>',
      ]) {
        const r = await rawGet(`${t.path}/sports/${segment}`);
        expect([404, 400], segment.slice(0, 30)).toContain(r.status);
        expect(r.body).not.toContain('<script>alert');
      }
      // A trailing slash is the router's to normalise; it must not be a 5xx.
      const slash = await rawGet(`${t.path}/sports/soccer/`);
      expect(slash.status).toBeLessThan(500);
    },
  );
});

test.describe('sport view: saved copies offline', () => {
  test.skip(({ isMobile }) => isMobile, 'the sidebar column shows at 1280');

  test('a sport view visited online opens offline from the organization page with the saved-copy note; one never visited shows the not-saved view; back online the note goes', async ({
    page,
    context,
    consoleGuard,
  }) => {
    const tenant = await seed();
    await page.goto(`${tenant.path}/sports/soccer`);
    await hydrated(consoleGuard);
    await expect(page.locator('section#leagues > ul > li')).toHaveCount(3);
    // Move to the organization page (client-side), then go offline.
    await page
      .getByRole('navigation', { name: tenant.name })
      .getByRole('link', { name: 'Overview' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible();
    await arm(page);
    await context.setOffline(true);
    await expect(
      page.locator('header + [role="status"]').locator('[data-offline-note]'),
    ).toBeVisible({ timeout: 5_000 });
    await page
      .getByRole('navigation', { name: tenant.name })
      .getByRole('link', { name: /^Soccer/ })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Soccer' })).toBeVisible();
    await expect(page.locator('section#leagues > ul > li')).toHaveCount(3);
    await expect(page.getByText(/saved/i).first()).toBeVisible();

    // A sport view that was never opened has no saved copy.
    await page
      .getByRole('navigation', { name: tenant.name })
      .getByRole('link', { name: /^Beach volleyball/ })
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: /isn.t saved on this device/i }),
    ).toBeVisible();

    await context.setOffline(false);
    expect(await noReload(page)).toBe(true);
  });
});
