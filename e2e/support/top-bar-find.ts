import type { Page } from '@playwright/test';

/** The top bar shows the field from this width and a link below it. */
const FIELD_FROM_WIDTH = 768;

/** The one control of the top bar's Find a league that can take focus at the page's width. */
export function topBarFind(page: Page): string {
  const width = page.viewportSize()?.width ?? 0;
  return width >= FIELD_FROM_WIDTH
    ? 'header form[role="search"] input'
    : 'header a[href="/leagues"]';
}
