import { expect, type Locator } from '@playwright/test';

export const SIGNED_IN_BADGE_HEIGHT = 20;
export const PUBLIC_BADGE_HEIGHT = 22;

const HEIGHT_TOLERANCE = 0.5;
const OUTLINED_VARIANTS = new Set(['outline', 'outline-destructive', 'outline-muted']);

interface Measured {
  variant: string | null;
  height: number;
  borderColor: string;
  expectedBorderColor: string;
}

export async function expectBadges(badges: Locator, height: number): Promise<void> {
  await expect(badges.first()).toBeVisible();
  const measured = await badges.evaluateAll(
    (elements, outlined): Measured[] => {
      const colorOf = (declaration: string) => {
        const probe = document.createElement('i');
        probe.style.cssText = `border: 1px solid ${declaration}`;
        document.body.append(probe);
        const color = getComputedStyle(probe).borderTopColor;
        probe.remove();
        return color;
      };
      return elements.map((element) => {
        const variant = element.getAttribute('data-variant');
        return {
          variant,
          height: element.getBoundingClientRect().height,
          borderColor: getComputedStyle(element).borderTopColor,
          expectedBorderColor: colorOf(
            variant !== null && outlined.includes(variant) ? 'var(--border)' : 'transparent',
          ),
        };
      });
    },
    [...OUTLINED_VARIANTS],
  );
  for (const badge of measured) {
    expect(Math.abs(badge.height - height), `${badge.variant} badge height`).toBeLessThanOrEqual(
      HEIGHT_TOLERANCE,
    );
    expect(badge.borderColor, `${badge.variant} badge border colour`).toBe(
      badge.expectedBorderColor,
    );
  }
}
