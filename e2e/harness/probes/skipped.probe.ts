// Run only by `console-fixture.spec.ts`.
import type { Page } from '@playwright/test';
import { test } from '../../support/fixtures';

test.use({
  expectedConvexErrors: ['probe:add'],
  expectedFailedRequests: [{ status: 409, path: '/probe-conflict' }],
  expectedConsoleWarnings: ['probe warning'],
});

async function logError(page: Page, text: string): Promise<void> {
  await Promise.all([
    page.waitForEvent('console', (m) => m.text() === text),
    page.evaluate((t) => console.error(t), text),
  ]);
}

test('skips with no console error', async ({ page }) => {
  await page.setContent('<p>ok</p>');
  test.skip(true, 'probe');
});

test('skips after a console.error', async ({ page }) => {
  await page.setContent('<p>ok</p>');
  await logError(page, 'probe error before the skip');
  test.skip(true, 'probe');
});

test('skips after a page error', async ({ page }) => {
  await page.setContent('<p>ok</p>');
  await Promise.all([
    page.waitForEvent('pageerror'),
    page.evaluate(() => {
      setTimeout(() => {
        throw new Error('probe page error before the skip');
      });
    }),
  ]);
  test.skip(true, 'probe');
});

test('skips after a console.error on a second page', async ({ context }) => {
  const page = await context.newPage();
  await page.setContent('<p>ok</p>');
  await logError(page, 'probe error on a second page');
  test.skip(true, 'probe');
});

test('skips after an unlisted console.warn', async ({ page }) => {
  await page.setContent('<p>ok</p>');
  await Promise.all([
    page.waitForEvent('console', (m) => m.type() === 'warning'),
    page.evaluate(() => console.warn('other warning before the skip')),
  ]);
  test.skip(true, 'probe');
});

test('does not skip (condition false), allowances unused', async ({ page }) => {
  await page.setContent('<p>ok</p>');
  test.skip(false, 'probe');
});
