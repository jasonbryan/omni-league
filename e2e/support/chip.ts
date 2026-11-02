import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures';

// The radio is `sr-only`, so the label is what a user sees and clicks.
export function chipLabel(scope: Page | Locator, radioName: string): Locator {
  const page = 'goto' in scope ? scope : scope.page();
  return scope
    .locator('label')
    .filter({ has: page.getByRole('radio', { name: radioName, exact: true }) });
}

// `check({ force: true })` on the hidden radio does not change its state on WebKit.
export async function chooseChip(label: Locator): Promise<void> {
  await label.click();
  await expect(label.getByRole('radio')).toBeChecked();
}
