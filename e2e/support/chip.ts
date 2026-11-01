import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures';

/** The label of the chip whose radio is named `name`. */
export function chipLabel(scope: Page | Locator, name: string): Locator {
  const page = 'goto' in scope ? scope : scope.page();
  return scope.locator('label').filter({ has: page.getByRole('radio', { name, exact: true }) });
}

/**
 * Chooses a chip as a user does, by clicking its label. `check({ force: true })` on the hidden radio
 * does not change its state on WebKit.
 */
export async function chooseChip(label: Locator): Promise<void> {
  await label.click();
  await expect(label.getByRole('radio')).toBeChecked();
}
