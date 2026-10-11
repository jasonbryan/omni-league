import type { Page, TestInfo } from '@playwright/test';
import { join } from 'node:path';

/** A full-page PNG for the tester's mockup comparison, at this project's width. */
export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const width = page.viewportSize()?.width ?? 0;
  const file = join(testInfo.config.rootDir, 'screenshots', `${name}-${width}.png`);
  const png = await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  await testInfo.attach(`${name}-${width}.png`, { body: png, contentType: 'image/png' });
}
