import { expect, type Locator } from '@playwright/test';

export async function expectLogoLoaded(mark: Locator): Promise<void> {
  const logo = mark.locator('img');
  await expect(logo).toHaveCount(1);
  await expect
    .poll(() => logo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);
}
