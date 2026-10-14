// The note is driven by `setOffline` (navigator.onLine false), which needs no socket route and no
// fake clock.
import type { Locator, Page } from '@playwright/test';
import { axeScan, describeViolations } from './support/a11y';
import { remoteBaseUrl } from './support/env';
import { expect, test } from './support/fixtures';
import { RAW_HTTP } from './support/raw-http';
import { fetchRawHtml } from './support/raw-html';
import { numberedLocations, seedTenant } from './support/tenant';

/** 200% is the largest root text size WCAG 1.4.4 asks for. */
const CASES = [
  { width: 320, textPercent: 100 },
  { width: 360, textPercent: 200 },
  { width: 320, textPercent: 200 },
  { width: 1280, textPercent: 100 },
  { width: 1280, textPercent: 200 },
];

const px = (value: string) => Number.parseFloat(value);

const rootVar = (page: Page) =>
  page.evaluate(() => document.documentElement.style.getPropertyValue('--offline-note-h'));

const computed = (locator: Locator, property: string) =>
  locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

test.describe('offline note height', () => {
  test.skip(remoteBaseUrl !== undefined, 'E2E_BASE_URL is set: needs the local Convex backend');

  test('the scroll offsets and the sticky note follow the measured note height', async ({
    page,
    context,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'chromium-mobile',
      'one browser project only, to save CI minutes',
    );
    const tenant = await seedTenant({
      locations: numberedLocations(10),
      leagues: [{ name: 'Alpha League', sport: 'soccer', locations: ['Location 01'] }],
    });
    await page.goto(tenant.path);
    const status = page.locator('header + [role="status"]');
    const note = status.locator('[data-offline-note]');
    const header = page.locator('header');

    await expect(status).toBeAttached();
    expect(await rootVar(page)).toBe('');
    expect(px(await computed(page.locator('html'), 'scroll-padding-top'))).toBe(72);

    await context.setOffline(true);
    await expect(note).toBeVisible({ timeout: 2_000 });

    for (const { width, textPercent } of CASES) {
      const label = `${width}px, text ${textPercent}%`;
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate((percent) => {
        document.documentElement.style.fontSize = `${percent}%`;
      }, textPercent);
      const rem = (16 * textPercent) / 100;
      const barHeight = 4 * rem + 1;

      await expect
        .poll(async () => px(await rootVar(page)) - ((await status.boundingBox())?.height ?? 0), {
          message: `--offline-note-h tracks the note at ${label}`,
        })
        .toBeCloseTo(0, 1);
      const noteBox = (await status.boundingBox())!;
      expect(noteBox.y, label).toBeCloseTo(barHeight, 0);
      // At 200% text a phone-width note wraps past its one-line height (2 x 18px + 2 x 16px = 72px).
      if (textPercent === 200 && width <= 360) expect(noteBox.height, label).toBeGreaterThan(72);
      const offset = 4.5 * rem + noteBox.height;
      expect(px(await computed(page.locator('html'), 'scroll-padding-top')), label).toBeCloseTo(
        offset,
        0,
      );
      expect(px(await computed(header, 'scroll-margin-top')), label).toBeCloseTo(-offset, 0);

      const results = await axeScan(page);
      expect(describeViolations(results.violations), `axe violations at ${label}`).toEqual([]);

      await page.locator('main').evaluate((main) => {
        const spacer = (height: string) => {
          const element = document.createElement('div');
          element.style.height = height;
          return element;
        };
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Focus target';
        const target = document.createElement('div');
        target.id = 'e2e-focus-target';
        target.append(spacer('1500px'), button, spacer('2500px'));
        main.append(target);
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
      const button = page.locator('#e2e-focus-target button');
      await expect.poll(async () => (await button.boundingBox())?.y ?? 0).toBeLessThan(0);
      await button.focus();
      await expect(button).toBeFocused();
      const noteBottom = barHeight + noteBox.height;
      expect((await button.boundingBox())!.y, `focus at ${label}`).toBeGreaterThanOrEqual(
        noteBottom,
      );
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await button.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      expect((await button.boundingBox())!.y, `anchor at ${label}`).toBeCloseTo(offset, 0);
      await page.evaluate(() => {
        document.getElementById('e2e-focus-target')?.remove();
        window.scrollTo(0, 0);
      });

      await page.evaluate(() => window.scrollTo(0, 400));
      expect((await status.boundingBox())!.y, `note stuck below the bar at ${label}`).toBeCloseTo(
        barHeight,
        0,
      );
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await context.setOffline(false);
    await expect(note).toBeHidden({ timeout: 15_000 });
    await expect.poll(() => rootVar(page)).toBe('');
    expect(px(await computed(page.locator('html'), 'scroll-padding-top'))).toBe(72);
    expect(px(await computed(header, 'scroll-margin-top'))).toBe(-72);
    await expect(note).toHaveCount(0);
  });

  test(
    'the server HTML is unchanged: an empty status region and no custom property',
    RAW_HTTP,
    async ({ request }) => {
      const tenant = await seedTenant({});
      const { html } = await fetchRawHtml(request, tenant.path);
      expect(html).toMatch(
        /<app-offline-note[^>]*role="status"[^>]*>(<!--[^>]*-->)*<\/app-offline-note>/,
      );
      expect(html).not.toContain('data-offline-note');
      // The class names read the variable; nothing in the HTML sets it.
      expect(html).not.toMatch(/--offline-note-h\s*:/);
      expect(/<html\b[^>]*>/.exec(html)![0]).not.toMatch(/\bstyle=/);
    },
  );
});
