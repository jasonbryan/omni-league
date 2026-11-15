import type { Page } from '@playwright/test';
import { expect } from './fixtures';

export async function expectDescriptionHeightHeldWhileTyping(page: Page, address: string) {
  const description = page.locator('#slug-description');
  const preview = description.locator('strong');
  await expect(preview).toHaveText('your-address');
  const emptyHeight = (await description.boundingBox())?.height;
  expect(emptyHeight).toBeGreaterThan(0);
  for (let length = 1; length <= address.length; length++) {
    const prefix = address.slice(0, length);
    await page.locator('#slug').fill(prefix);
    await expect(preview).toHaveText(prefix);
    expect((await description.boundingBox())?.height, `after "${prefix}"`).toBe(emptyHeight);
  }
}
