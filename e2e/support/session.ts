import type { Browser, Page } from '@playwright/test';
import { tokensSettled } from './auth-tokens';
import { baseURL } from './env';
import { expect } from './fixtures';
import type { TestUser } from './users';

/** Signs `user` up through the real sign-up form and waits for /app and the Convex token. */
export async function signUp(page: Page, user: TestUser): Promise<void> {
  const tokens = tokensSettled(page);
  await page.goto('/sign-up');
  await page.locator('#name').fill(user.name);
  await page.locator('#email').fill(user.email);
  await page.locator('#password').fill(user.password);
  await page.getByRole('checkbox', { name: 'I am 18 or older' }).click();
  await page.getByRole('button', { name: /Create account/ }).click();
  await expect(page).toHaveURL(`${baseURL}/app`);
  await tokens;
}

/** A second signed-in browser context, for a second user. Close its context when done. */
export async function otherUser(browser: Browser, user: TestUser): Promise<Page> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await signUp(page, user);
  return page;
}
