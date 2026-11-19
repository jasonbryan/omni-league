import type { Locator } from '@playwright/test';
import { expect } from './fixtures';

export interface TextBox {
  height: number;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
}

const TOLERANCE_PX = 0.5;

export const textBoxes = (scope: Locator, selector: string): Promise<TextBox[]> =>
  scope.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const style = getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
      };
    }),
  );

/** A skeleton bar stands for a loaded element when they wrap to the same lines, so their heights and type match. */
export function expectSameTextBoxes(skeleton: TextBox[], loaded: TextBox[], what: string): void {
  expect(skeleton.length, `${what}: bars ${skeleton.length}, loaded ${loaded.length}`).toBe(
    loaded.length,
  );
  expect(skeleton.length, `${what}: nothing to compare`).toBeGreaterThan(0);
  skeleton.forEach((bar, index) => {
    const shown = loaded[index];
    const message = `${what} ${index}: bar ${JSON.stringify(bar)}, loaded ${JSON.stringify(shown)}`;
    expect(Math.abs(bar.height - shown.height), message).toBeLessThan(TOLERANCE_PX);
    expect(bar.fontSize, message).toBe(shown.fontSize);
    expect(bar.fontWeight, message).toBe(shown.fontWeight);
    expect(bar.lineHeight, message).toBe(shown.lineHeight);
  });
}
