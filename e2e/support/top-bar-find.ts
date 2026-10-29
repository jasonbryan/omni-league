import type { Page } from '@playwright/test';

const FIELD_FROM_WIDTH = 768;

export function topBarFind(page: Page): string {
  const width = page.viewportSize()?.width ?? 0;
  return width >= FIELD_FROM_WIDTH
    ? 'header form[role="search"] input'
    : 'header a[href="/leagues"]';
}
