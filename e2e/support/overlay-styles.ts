import type { Page } from '@playwright/test';

type Computed = Record<string, string>;

export interface OverlayStyles {
  container: Computed | null;
  pane: Computed | null;
  backdrop: Computed | null;
  html: Computed;
}

const POSITIONING = ['position', 'z-index', 'pointer-events'];
const BACKDROP = [...POSITIONING, 'background-color', 'opacity', 'transition-duration'];
const ROOT = ['position', 'overflow-y'];

export function stylesheetsHaveOverlayRules(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const holdsRule = (rules: CSSRuleList): boolean =>
      Array.from(rules).some(
        (rule) =>
          (rule instanceof CSSStyleRule && rule.selectorText.includes('.cdk-overlay-container')) ||
          ('cssRules' in rule && holdsRule(rule.cssRules as CSSRuleList)),
      );
    return Array.from(document.styleSheets).some((sheet) => holdsRule(sheet.cssRules));
  });
}

// A fade or slide in progress would make `opacity` depend on timing.
export async function overlayStyles(page: Page): Promise<OverlayStyles> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished),
    ),
  );
  return page.evaluate(
    ([positioning, backdrop, root]) => {
      const read = (selector: string, properties: string[]): Computed | null => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const style = getComputedStyle(element);
        return Object.fromEntries(
          properties.map((property) => [property, style.getPropertyValue(property)]),
        );
      };
      return {
        container: read('.cdk-overlay-container', positioning),
        pane: read('.cdk-overlay-pane', positioning),
        backdrop: read('.cdk-overlay-backdrop', backdrop),
        html: read('html', root) ?? {},
      };
    },
    [POSITIONING, BACKDROP, ROOT],
  );
}

export const SHEET_OVERLAY_STYLES: OverlayStyles = {
  container: { position: 'fixed', 'z-index': '1000', 'pointer-events': 'none' },
  pane: { position: 'static', 'z-index': '1000', 'pointer-events': 'auto' },
  backdrop: {
    position: 'absolute',
    'z-index': '1000',
    'pointer-events': 'auto',
    'background-color': 'oklab(0.21 0.00473189 -0.0336691 / 0.5)',
    opacity: '1',
    'transition-duration': '0s',
  },
  html: { position: 'fixed', 'overflow-y': 'scroll' },
};

export const POPOVER_OVERLAY_STYLES: OverlayStyles = {
  container: { position: 'fixed', 'z-index': '1000', 'pointer-events': 'none' },
  pane: { position: 'static', 'z-index': '1000', 'pointer-events': 'auto' },
  backdrop: null,
  html: { position: 'static', 'overflow-y': 'visible' },
};
