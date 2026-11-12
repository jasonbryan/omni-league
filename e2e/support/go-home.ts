import type { Locator, Page } from '@playwright/test';
import { baseURL } from './env';
import { expect } from './fixtures';

/** Goes to Home by the sidebar's link, which a phone keeps in the sheet that the menu button opens. */
export async function goHomeBySidebar(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: 'Open navigation' });
  const navigation = (await menu.isVisible())
    ? await openSheet(page, menu)
    : page.getByRole('navigation', { name: 'Your account' });
  await navigation.getByRole('link', { name: 'Home', exact: true }).click();
  await expect(page).toHaveURL(`${baseURL}/app`);
}

async function openSheet(page: Page, menu: Locator) {
  await menu.click();
  return page.getByRole('dialog', { name: 'Navigation' });
}
