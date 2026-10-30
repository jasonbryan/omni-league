import type { Page } from '@playwright/test';

/** Each open CDK overlay pane, with whether it sits in `.cdk-overlay-container` and whether a `popover` element (the browser's top layer) holds it. */
export function overlayPanes(page: Page): Promise<{ inContainer: boolean; inPopover: boolean }[]> {
  return page.locator('.cdk-overlay-pane').evaluateAll((panes) =>
    panes.map((pane) => ({
      inContainer: pane.closest('.cdk-overlay-container') !== null,
      inPopover: pane.closest('[popover]') !== null,
    })),
  );
}
