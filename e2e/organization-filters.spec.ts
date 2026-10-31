import type { Page, TestInfo } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { baseURL, remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { holdQueries } from './support/hold-queries';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import {
  dateFromToday,
  numberedLocations,
  seedSeasons,
  seedTenant,
  type DivisionSeed,
  type Tenant,
} from './support/tenant';

const NO_SEED = 'E2E_BASE_URL is set: no local Convex backend to seed a tenant';
const ORIGIN = new URL(baseURL).origin;

const isDesktop = (testInfo: TestInfo) => testInfo.project.name === 'chromium-desktop';

const LOCATIONS = numberedLocations(6);

const beach = (
  name: string,
  gender: DivisionSeed['gender'],
  playersPerSide: number,
  level: DivisionSeed['level'],
) => ({
  name,
  sport: 'beachVolleyball' as const,
  locations: [LOCATIONS[0].name],
  division: { gender, playersPerSide, level, ageGroup: 'adult' as const },
});

const LEAGUES = [
  beach('Monday Coed 4s', 'coed', 4, 'bb'),
  beach('Wednesday Reverse Coed 4s', 'coed', 4, 'b'),
  beach('Saturday Coed 6s', 'coed', 6, 'rec'),
  beach('Friday Coed 6s', 'coed', 6, 'b'),
  beach("Sunday Women's 6s", 'womens', 6, 'a'),
  beach("Tuesday Women's 2s", 'womens', 2, 'a'),
  beach("Thursday Men's 4s", 'mens', 4, 'aa'),
];

const openSeason = (name: string) => ({
  name,
  slug: 'summer',
  startDate: dateFromToday(20),
  endDate: dateFromToday(80),
  registrationDeadline: dateFromToday(10),
});

/** The seven beach volleyball leagues, six locations so Locations has two pages, and two open seasons. */
async function filterTenant(): Promise<Tenant> {
  const tenant = await seedTenant({ name: 'E2E Filters', locations: LOCATIONS, leagues: LEAGUES });
  await Promise.all([
    seedSeasons(tenant, 'monday-coed-4s', [openSeason('Monday Summer')]),
    seedSeasons(tenant, 'saturday-coed-6s', [openSeason('Saturday Summer')]),
  ]);
  return tenant;
}

const plainText = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** From the end of the tag holding `start` to `end`. */
const between = (html: string, start: string, end: string): string => {
  const at = html.indexOf(start);
  if (at < 0) return '';
  const content = html.indexOf('>', at) + 1;
  return html.slice(content, html.indexOf(end, content));
};

const leagueRows = (html: string): string[] =>
  [...between(html, 'id="leagues"', '</section>').matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map(
    ([, inner]) => plainText(inner),
  );

const filterForm = (html: string) => between(html, 'aria-label="Filter leagues"', '</form>');

const countOf = (html: string): string => {
  const form = filterForm(html);
  const status = form.slice(form.indexOf('role="status"'));
  return plainText(status.slice(status.indexOf('>') + 1, status.indexOf('</p>')));
};

const hrefsIn = (html: string): string[] =>
  [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map(([, href]) =>
    href.replaceAll('&amp;', '&').replace(ORIGIN, ''),
  );

function metaName(html: string, name: string): string | undefined {
  const tag = new RegExp(`<meta\\b[^>]*\\bname="${name}"[^>]*>`).exec(html)?.[0];
  return tag ? /\bcontent="([^"]*)"/.exec(tag)?.[1] : undefined;
}

const canonicalOf = (html: string): string | undefined =>
  /<link\b[^>]*\brel="canonical"[^>]*\bhref="([^"]*)"/.exec(html)?.[1];

test.describe('organization filters: raw server HTML', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test(
    'coed 4v4 lists two leagues with pills, the count, Clear all, noindex, and the unfiltered canonical',
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const tenant = await filterTenant();
      const { status, html } = await fetchRawHtml(request, `${tenant.path}?gender=coed&format=4v4`);
      expect(status).toBe(200);
      expect(leagueRows(html)).toEqual(['Monday Coed 4s', 'Wednesday Reverse Coed 4s']);
      const pills = between(html, 'aria-label="Active filters"', '</ul>');
      expect(plainText(pills)).toBe(
        'Gender: Coed : remove the gender filter 4v4 : remove the format filter',
      );
      expect(hrefsIn(pills)).toEqual([`${tenant.path}?format=4v4`, `${tenant.path}?gender=coed`]);
      expect(countOf(html)).toBe('2 of 7 leagues');
      expect(plainText(filterForm(html))).toContain('Clear all');
      expect(metaName(html, 'robots')).toBe('noindex');
      expect(canonicalOf(html)).toBe(`${ORIGIN}${tenant.path}`);
    },
  );

  test(
    "4v4 or 6v6 reads 6 of 7 over two pages that keep both formats, and Tuesday Women's 2s is on neither",
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const tenant = await filterTenant();
      const first = (await fetchRawHtml(request, `${tenant.path}?format=4v4&format=6v6`)).html;
      const second = (await fetchRawHtml(request, `${tenant.path}?format=4v4&format=6v6&leagues=2`))
        .html;
      expect(countOf(first)).toBe('6 of 7 leagues');
      expect(leagueRows(first)).toHaveLength(5);
      expect(leagueRows(second)).toEqual(['Wednesday Reverse Coed 4s']);
      expect([...leagueRows(first), ...leagueRows(second)]).not.toContain("Tuesday Women's 2s");
      const pageLinks = hrefsIn(between(second, 'aria-label="Leagues pages"', '</nav>'));
      expect(pageLinks).toContain(`${tenant.path}?format=4v4&format=6v6#leagues`);
      for (const href of hrefsIn(between(second, 'aria-label="Active filters"', '</ul>'))) {
        expect(href).not.toContain('leagues=');
      }
    },
  );

  test(
    'girls U10 shows only the U10 league of a soccer organization',
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const division = (ageGroup: DivisionSeed['ageGroup']) => ({
        gender: 'womens' as const,
        playersPerSide: 7,
        level: 'rec' as const,
        ageGroup,
      });
      const tenant = await seedTenant({
        name: 'E2E Youth Filters',
        locations: [LOCATIONS[0]],
        leagues: [
          {
            name: 'U10 Girls',
            sport: 'soccer',
            locations: [LOCATIONS[0].name],
            division: division('u10'),
          },
          {
            name: "Women's Rec",
            sport: 'soccer',
            locations: [LOCATIONS[0].name],
            division: division('adult'),
          },
        ],
      });
      const { html } = await fetchRawHtml(request, `${tenant.path}?gender=girls&age=u10`);
      expect(leagueRows(html)).toEqual(['U10 Girls']);
      expect(countOf(html)).toBe('1 of 2 leagues');
      expect(plainText(between(html, 'aria-label="Active filters"', '</ul>'))).toContain(
        'Gender: Girls',
      );
    },
  );

  test(
    'an unknown value or a canary is ignored and appears nowhere in the body or headers',
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const tenant = await filterTenant();
      const canary = `ott${Date.now()}canary`;
      for (const query of ['gender=nope', 'format=4x4', `format=${canary}`, `gender=${canary}`]) {
        const { status, headers, html } = await fetchRawHtml(request, `${tenant.path}?${query}`);
        const value = query.split('=')[1];
        expect(status, query).toBe(200);
        expect(html, query).not.toContain(value);
        expect(JSON.stringify(headers), query).not.toContain(value);
        expect(countOf(html), query).toBe('7 leagues');
      }
    },
  );

  test(
    'Registration open follows the filters, and a view with no match has no open section or Register link',
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const tenant = await filterTenant();
      const fours = (await fetchRawHtml(request, `${tenant.path}?format=4v4`)).html;
      const open = between(fours, 'id="registration-open"', '</section>');
      expect(
        [...open.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/g)].map(([, h]) => plainText(h)),
      ).toEqual(['Monday Coed 4s']);
      const none = (await fetchRawHtml(request, `${tenant.path}?gender=mens&format=6v6`)).html;
      expect(none).not.toContain('id="registration-open"');
      expect(plainText(none)).not.toContain('Register for a season');
      const leagues = plainText(between(none, 'id="leagues"', '</section>'));
      expect(leagues).toContain('No leagues match these filters');
      expect(leagues).toContain('Clear all');
      expect(countOf(none)).toBe('0 of 7 leagues');
    },
  );
});

test.describe('organization filters on the sport view: raw server HTML', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test(
    'a filtered page 2 is noindex, names the sport view as its canonical, and writes its links in canonical order',
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const tenant = await filterTenant();
      const sportPath = `${tenant.path}/sports/beach-volleyball`;
      const { status, html } = await fetchRawHtml(
        request,
        `${sportPath}?page=2&format=6v6&format=4v4&format=4v4`,
      );
      expect(status).toBe(200);
      expect(metaName(html, 'robots')).toBe('noindex');
      expect(canonicalOf(html)).toBe(`${ORIGIN}${sportPath}`);
      expect(countOf(html)).toBe('6 of 7 leagues');
      expect(leagueRows(html)).toHaveLength(1);
      const pageLinks = hrefsIn(between(html, 'aria-label="Leagues pages"', '</nav>'));
      expect(pageLinks).toContain(`${sportPath}?format=4v4&format=6v6#leagues`);
      for (const href of hrefsIn(between(html, 'aria-label="Active filters"', '</ul>'))) {
        expect(href).not.toContain('page=');
      }
    },
  );

  test(
    'an unfiltered page 2 stays indexed with its own page as the canonical',
    RAW_HTTP,
    async ({ request }, testInfo) => {
      test.skip(!isDesktop(testInfo), 'raw HTML does not depend on the viewport');
      const tenant = await filterTenant();
      const { html } = await fetchRawHtml(request, `${tenant.path}?leagues=2&gender=nope`);
      expect(metaName(html, 'robots')).toBeUndefined();
      expect(canonicalOf(html)).toBe(`${ORIGIN}${tenant.path}?leagues=2`);
      expect(countOf(html)).toBe('7 leagues');
    },
  );
});

test.describe('organization filters in the browser', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  const count = (page: Page) =>
    page.getByRole('search', { name: 'Filter leagues' }).getByRole('status');
  const pills = (page: Page) =>
    page.getByRole('list', { name: 'Active filters' }).getByRole('link');

  test('a pill and Clear all change the URL without a page load and move focus to the count', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await filterTenant();
    await page.goto(`${tenant.path}?gender=coed&format=4v4`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await page.evaluate(() => ((window as Window & { e2eMarker?: number }).e2eMarker = 1));

    await pills(page).filter({ hasText: 'Gender: Coed' }).click();
    await expect(page).toHaveURL(`${baseURL}${tenant.path}?format=4v4`);
    await expect(count(page)).toHaveText('3 of 7 leagues');
    await expect(count(page)).toBeFocused();

    await page
      .getByRole('search', { name: 'Filter leagues' })
      .getByRole('link', { name: 'Clear all' })
      .click();
    await expect(page).toHaveURL(`${baseURL}${tenant.path}`);
    await expect(count(page)).toHaveText('7 leagues');
    await expect(count(page)).toBeFocused();
    expect(await page.evaluate(() => (window as Window & { e2eMarker?: number }).e2eMarker)).toBe(
      1,
    );
  });

  test('a pill pressed while the new page loads holds the rows busy and the count never reads the previous result', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await filterTenant();
    const held = await holdQueries(page, ['organizations:listPublicLeagues'], {
      holdFromStart: false,
    });
    await page.goto(`${tenant.path}?gender=coed&format=4v4`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(count(page)).toHaveText('2 of 7 leagues');
    held.holdNextAnswer();
    await pills(page).filter({ hasText: 'Gender: Coed' }).click();
    await expect(page).toHaveURL(`${baseURL}${tenant.path}?format=4v4`);
    await expect.poll(() => held.isHolding()).toBe(true);
    await expect(page.locator('#leagues ul[aria-busy="true"]')).toHaveCount(1);
    await expect(count(page)).toBeFocused();
    await expect(count(page)).not.toHaveText('2 of 7 leagues');
    held.release();
    await expect(count(page)).toHaveText('3 of 7 leagues');
    await expect(page.locator('#leagues [aria-busy="true"]')).toHaveCount(0);
  });

  test('from page 2, the keyboard opens Filters, checks Coed, and Show leagues loads page 1 of the result with focus kept', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await filterTenant();
    await page.goto(`${tenant.path}?format=4v4&format=6v6&leagues=2`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const form = page.getByRole('search', { name: 'Filter leagues' });
    await form.locator('summary').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    const coed = form.getByRole('checkbox', { name: 'Coed' });
    await expect(coed).toBeFocused();
    await page.keyboard.press('Space');
    await expect(coed).toBeChecked();
    const show = form.getByRole('button', { name: 'Show leagues' });
    for (let presses = 0; presses < 20; presses++) {
      if (await show.evaluate((button) => button === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(show).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${baseURL}${tenant.path}?gender=coed&format=4v4&format=6v6`);
    await expect(count(page)).toHaveText('4 of 7 leagues');
    await expect(show).toBeFocused();
  });

  test('the Locations page links keep gender=coed, and a filter change keeps locations=2', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await filterTenant();
    await page.goto(`${tenant.path}?gender=coed&locations=2`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const locationPages = page
      .getByRole('navigation', { name: 'Locations pages' })
      .getByRole('link');
    await expect(locationPages.first()).toHaveAttribute(
      'href',
      `${tenant.path}?gender=coed#locations`,
    );
    await pills(page).first().click();
    await expect(page).toHaveURL(`${baseURL}${tenant.path}?locations=2`);
  });

  test('after the page-load wait, Try again keeps the filters and the page', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await filterTenant();
    const held = await holdQueries(page, ['organizations:listPublicLeagues'], {
      holdFromStart: false,
    });
    await page.clock.install();
    await page.goto(`${tenant.path}?format=4v4&format=6v6`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    held.holdNextAnswer();
    await page
      .getByRole('navigation', { name: 'Leagues pages' })
      .getByRole('link', { name: 'Next page' })
      .click();
    await expect.poll(() => held.isHolding()).toBe(true);
    await page.clock.fastForward('00:11');
    await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      `${tenant.path}?format=4v4&format=6v6&leagues=2`,
    );
    held.release();
  });

  test('the open filters pass the axe helper, with each dimension in a fieldset', async ({
    page,
    consoleGuard,
  }) => {
    const tenant = await filterTenant();
    await page.goto(`${tenant.path}?gender=coed&format=4v4`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await page.getByRole('search', { name: 'Filter leagues' }).getByText('Filters').click();
    const fieldsets = page.getByRole('search', { name: 'Filter leagues' }).locator('fieldset');
    await expect(fieldsets).toHaveCount(4);
    for (const name of ['Gender', 'Format', 'Level', 'Age group']) {
      await expect(page.getByRole('group', { name })).toBeVisible();
    }
    await expect(page.getByRole('checkbox', { name: 'Coed' })).toBeChecked();
    await expectAccessible(page);
  });

  test.describe('with JavaScript disabled', () => {
    test.use({ javaScriptEnabled: false });

    test('opening Filters, checking a value, and Show leagues loads the filtered URL', async ({
      page,
    }) => {
      const tenant = await filterTenant();
      await page.goto(tenant.path);
      const form = page.getByRole('search', { name: 'Filter leagues' });
      await form.getByText('Filters').click();
      await form.getByText("Men's", { exact: true }).click();
      await form.getByRole('button', { name: 'Show leagues' }).click();
      await expect(page).toHaveURL(`${baseURL}${tenant.path}?gender=mens`);
      await expect(page.locator('#leagues').getByRole('heading', { level: 3 })).toHaveText([
        "Thursday Men's 4s",
      ]);
      await expect(count(page)).toHaveText('1 of 7 leagues');
    });
  });
});

test.describe('organization filters offline', () => {
  test.skip(remoteBaseUrl !== undefined, NO_SEED);

  test('a filtered view seen online shows from its saved copy offline, with its filters offered', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    const tenant = await filterTenant();
    await page.goto(`${tenant.path}?gender=coed`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    const form = page.getByRole('search', { name: 'Filter leagues' });
    await expect(count(page)).toHaveText('4 of 7 leagues');
    await form.getByRole('link', { name: 'Clear all' }).click();
    await expect(count(page)).toHaveText('7 leagues');

    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(`${baseURL}${tenant.path}?gender=coed`);
    await expect(page.locator('app-saved-copy-note')).toBeVisible();
    await expect(count(page)).toHaveText('4 of 7 leagues');
    await form.getByText('Filters').click();
    await expect(page.getByRole('group', { name: 'Gender' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Coed' })).toBeChecked();
    await context.setOffline(false);
  });

  test('offline, a filter never seen shows the not-saved view, whose Try again keeps the filters', async ({
    page,
    context,
    consoleGuard,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-mobile', 'one browser project only');
    const tenant = await filterTenant();
    await page.goto(`${tenant.path}?gender=coed&format=4v4`);
    await expect.poll(() => consoleGuard.hydrated).toBe(true);
    await expect(count(page)).toHaveText('2 of 7 leagues');

    await context.setOffline(true);
    await expect(page.locator('header + [role="status"] [data-offline-note]')).toBeVisible();
    await page
      .getByRole('list', { name: 'Active filters' })
      .getByRole('link')
      .filter({ hasText: 'Gender: Coed' })
      .click();
    await expect(page).toHaveURL(`${baseURL}${tenant.path}?format=4v4`);
    await expect(
      page.getByRole('heading', { name: "This page isn't saved on this device" }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      `${tenant.path}?format=4v4`,
    );
    await context.setOffline(false);
  });

  function count(page: Page) {
    return page.getByRole('search', { name: 'Filter leagues' }).getByRole('status');
  }
});
