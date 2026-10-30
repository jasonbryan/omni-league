import type { Page } from '@playwright/test';

export function overlayPanes(page: Page): Promise<{ inContainer: boolean; inPopover: boolean }[]> {
  return page.locator('.cdk-overlay-pane').evaluateAll((panes) =>
    panes.map((pane) => ({
      inContainer: pane.closest('.cdk-overlay-container') !== null,
      inPopover: pane.closest('[popover]') !== null,
    })),
  );
}
