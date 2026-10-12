import type { Page, TestInfo } from '@playwright/test';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * The file a screenshot is saved to: `screenshots/<name>-<width>.png`, with `-<browser>` added for
 * a browser other than Chromium, because `webkit-mobile` and `chromium-mobile` share the 360 px
 * width and two workers would otherwise write the same file.
 */
export function screenshotFile(
  rootDir: string,
  name: string,
  width: number,
  browserName: string,
): string {
  const browser = browserName === 'chromium' ? '' : `-${browserName}`;
  return join(rootDir, 'screenshots', `${name}-${width}${browser}.png`);
}

/**
 * A full-page PNG for the tester's mockup comparison, at this project's width. Give each test its
 * own `name` (add the role or case to a name a loop reuses): two tests that run on different
 * workers and share a name still write one file, and the last one wins. The write goes to a
 * temporary file first and is renamed into place, so the file is never half written.
 */
export async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const width = page.viewportSize()?.width ?? 0;
  const file = screenshotFile(
    testInfo.config.rootDir,
    name,
    width,
    testInfo.project.use.browserName ?? 'chromium',
  );
  const png = await page.screenshot({ fullPage: true, animations: 'disabled' });
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${String(testInfo.workerIndex)}.tmp`;
  await writeFile(temporary, png);
  await rename(temporary, file);
  await testInfo.attach(`${name}-${width}.png`, { body: png, contentType: 'image/png' });
}
