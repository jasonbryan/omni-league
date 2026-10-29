import type { Locator, Page } from '@playwright/test';
import { expectAccessible } from './support/a11y';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { freezeOrganizations } from './support/freeze-organizations';
import { numberedSeasons, seedSeasons, seedTenant, type LeagueSeed } from './support/tenant';

test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: no local Convex backend to seed');

// The widths the page control must fit: the narrowest phone, a common phone, the breakpoint that shows every page, and a desktop.
const WIDTHS = [320, 375, 640, 1280];
const WIDE_FROM = 640;
const TOUCH_TARGET = 44;
const MOBILE_PROJECT = 'chromium-mobile';
const COURTS = { name: 'Page Control Courts', address: '1 Beach Rd, Corpus Christi, TX 78401' };

// Five pages is the largest list the control shows whole from 640px; six is the first that gets gaps.
const FIVE_PAGES = 25;
const SIX_PAGES = 30;

interface Target {
  name: string;
  label: string;
  path: string;
  pageCount: number;
}

let targets: Target[];
let findPath: string;

const soccerLeagues = (count: number): LeagueSeed[] =>
  Array.from({ length: count }, (_, i) => ({
    name: `Soccer League ${String(i + 1).padStart(2, '0')}`,
    sport: 'soccer' as const,
    locations: [COURTS.name],
  }));

async function seedTargets(): Promise<Target[]> {
  const five = await seedTenant({
    name: 'E2E Five Pages',
    locations: [COURTS],
    leagues: soccerLeagues(FIVE_PAGES),
  });
  const six = await seedTenant({
    name: 'E2E Six Pages',
    locations: [COURTS],
    leagues: soccerLeagues(SIX_PAGES),
  });
  const seasons = await seedTenant({
    name: 'E2E Seasons',
    locations: [COURTS],
    leagues: [
      { name: 'Five League', sport: 'soccer', locations: [COURTS.name] },
      { name: 'Six League', sport: 'soccer', locations: [COURTS.name] },
    ],
  });
  await Promise.all([
    seedSeasons(seasons, 'five-league', numberedSeasons(FIVE_PAGES)),
    seedSeasons(seasons, 'six-league', numberedSeasons(SIX_PAGES)),
  ]);
  return [
    {
      name: 'leagues, 5 pages',
      label: 'Leagues pages',
      path: `${five.path}/sports/soccer`,
      pageCount: 5,
    },
    {
      name: 'leagues, 6 pages',
      label: 'Leagues pages',
      path: `${six.path}/sports/soccer`,
      pageCount: 6,
    },
    {
      name: 'seasons, 5 pages',
      label: 'Seasons pages',
      path: `${seasons.path}/leagues/five-league`,
      pageCount: 5,
    },
    {
      name: 'seasons, 6 pages',
      label: 'Seasons pages',
      path: `${seasons.path}/leagues/six-league`,
      pageCount: 6,
    },
  ];
}

/** The page numbers a visitor sees: the ones the width hides are not counted. */
async function visiblePages(nav: Locator): Promise<number[]> {
  const numbers: number[] = [];
  for (const link of await nav.getByRole('link', { name: /^Page \d+$/ }).all()) {
    if (await link.isVisible()) numbers.push(Number((await link.innerText()).replace(/\D/g, '')));
  }
  return numbers;
}

function expectedPages(width: number, page: number, pageCount: number): number[] {
  if (pageCount <= 4) return Array.from({ length: pageCount }, (_, i) => i + 1);
  if (width >= WIDE_FROM) {
    if (pageCount === 5) return [1, 2, 3, 4, 5];
    return [...new Set([1, page - 1, page, page + 1, pageCount])]
      .filter((n) => n >= 1 && n <= pageCount)
      .sort((a, b) => a - b);
  }
  return [...new Set([1, page, pageCount])].sort((a, b) => a - b);
}

/** Empty when the page does not scroll sideways, and otherwise the elements that reach past the right edge. */
const overflowing = (page: Page) =>
  page.evaluate(() => {
    const edge = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= edge) return [];
    return [...document.body.querySelectorAll('*')]
      .filter((element) => element.getBoundingClientRect().right > edge + 0.5)
      .slice(0, 5)
      .map((element) => `${element.tagName.toLowerCase()} ${element.textContent?.slice(0, 30)}`);
  });

async function open(page: Page, consoleGuard: { hydrated: boolean }, path: string, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(path);
  await expect.poll(() => consoleGuard.hydrated).toBe(true);
}

test.describe('the page control at each width', () => {
  test.use({ isMobile: true, hasTouch: true });

  test.beforeEach(() => {
    test.skip(test.info().project.name !== MOBILE_PROJECT, 'one browser project only');
  });

  test.beforeAll(async () => {
    if (test.info().project.name !== MOBILE_PROJECT) return;
    targets = await seedTargets();
    // Enough organizations for a second page whatever else the shared backend holds.
    for (let i = 0; i < 6; i++) {
      await seedTenant({ locations: [COURTS], leagues: soccerLeagues(1) });
    }
    findPath = '/leagues';
  });

  for (const index of [0, 1, 2, 3]) {
    test(`the page control of the ${['5-page leagues', '6-page leagues', '5-page seasons', '6-page seasons'][index]} list fits, shows the pages the width allows, and keeps 44px targets at every width`, async ({
      page,
      consoleGuard,
    }) => {
      const { label, path, pageCount } = targets[index];
      for (const width of WIDTHS) {
        for (const current of [1, 3]) {
          const where = `${width}px, page ${current}`;
          await open(page, consoleGuard, `${path}?page=${current}`, width);
          const nav = page.getByRole('navigation', { name: label });
          await expect(nav, where).toBeVisible();
          const box = await nav.locator('ul').boundingBox();
          expect(box!.x + box!.width, `${where}: the page list ends at`).toBeLessThanOrEqual(width);
          expect(await overflowing(page), where).toEqual([]);
          expect(await visiblePages(nav), where).toEqual(expectedPages(width, current, pageCount));
          for (const link of await nav.getByRole('link').all()) {
            if (!(await link.isVisible())) continue;
            const size = await link.boundingBox();
            expect(size!.height, `${where} ${await link.innerText()}`).toBeGreaterThanOrEqual(
              TOUCH_TARGET,
            );
            expect(size!.width, `${where} ${await link.innerText()}`).toBeGreaterThanOrEqual(
              TOUCH_TARGET,
            );
          }
        }
      }
    });

    test(`Next of the ${['5-page leagues', '6-page leagues', '5-page seasons', '6-page seasons'][index]} list works from the keyboard at every width`, async ({
      page,
      consoleGuard,
    }) => {
      const { label, path } = targets[index];
      for (const width of WIDTHS) {
        await open(page, consoleGuard, path, width);
        const nav = page.getByRole('navigation', { name: label });
        const next = nav.getByRole('link', { name: 'Next page' });
        await next.focus();
        await expect(next, `${width}px`).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page, `${width}px`).toHaveURL(/[?&]page=2$/);
        await expect(nav.getByRole('link', { name: 'Page 2' }), `${width}px`).toHaveAttribute(
          'aria-current',
          'page',
        );
        expect(await overflowing(page), `${width}px`).toEqual([]);
      }
    });
  }

  for (const width of WIDTHS) {
    test(`the organizations list of the Find a league page fits and keeps 44px targets at ${width}px`, async ({
      page,
      consoleGuard,
    }) => {
      await freezeOrganizations(page);
      await open(page, consoleGuard, findPath, width);
      const nav = page.getByRole('navigation', { name: 'Organizations pages' });
      await expect(nav).toBeVisible();
      expect(await overflowing(page)).toEqual([]);
      const box = await nav.locator('ul').boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      for (const link of await nav.getByRole('link').all()) {
        if (!(await link.isVisible())) continue;
        const size = await link.boundingBox();
        expect(size!.height).toBeGreaterThanOrEqual(TOUCH_TARGET);
      }
      await expectAccessible(page);
    });
  }

  for (const width of WIDTHS) {
    test(`the 5-page leagues and seasons lists pass the accessibility checks at ${width}px`, async ({
      page,
      consoleGuard,
    }) => {
      for (const index of [0, 2]) {
        await open(page, consoleGuard, `${targets[index].path}?page=3`, width);
        await expectAccessible(page);
      }
    });
  }
});
