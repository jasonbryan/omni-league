import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect } from './fixtures';

const TOUCH_TARGET = 44;
const TABLET_VIEWPORT = { width: 1024, height: 768 } as const;

/** A touch tablet: wide enough for the desktop layout, with a coarse pointer. */
export const TOUCH_TABLET = { viewport: TABLET_VIEWPORT, hasTouch: true } as const;

export type Pointer = 'touch' | 'mouse';

export const pointerOf = (testInfo: TestInfo): Pointer =>
  testInfo.project.use.hasTouch ? 'touch' : 'mouse';

export const footerAnchors = (page: Page): Locator =>
  page.getByRole('contentinfo').getByRole('link');

/** The links and the plain text of the current page, which sit in the same row. */
export const breadcrumbItems = (page: Page): Locator =>
  page.getByRole('navigation', { name: 'Breadcrumb' }).locator('li:not([aria-hidden="true"]) > *');

/** Fails first when the browser's pointer is not the one the test means to measure. */
export async function expectLinkHeights(
  page: Page,
  links: Locator,
  pointer: Pointer,
): Promise<void> {
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(
    pointer === 'touch',
  );
  const count = await links.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const link = links.nth(i);
    await link.scrollIntoViewIfNeeded();
    const box = await link.boundingBox();
    const name = ((await link.textContent()) ?? '').trim();
    const height = box?.height ?? 0;
    if (pointer === 'touch') {
      expect(height, `"${name}" is at least ${TOUCH_TARGET}px tall`).toBeGreaterThanOrEqual(
        TOUCH_TARGET,
      );
    } else {
      expect(height, `"${name}" keeps its line height`).toBeLessThan(TOUCH_TARGET);
    }
  }
}
