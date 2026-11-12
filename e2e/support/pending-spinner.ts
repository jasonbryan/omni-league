import { expect, type Locator } from '@playwright/test';

const SPINNER_SIZE = 16;
const POSITION_TOLERANCE = 0.5;
const DEFAULT_PADDING = 12;
const LARGE_PADDING = 16;

interface Measured {
  offset: number;
  expectedOffset: number;
  padding: number;
  width: number;
  height: number;
  topGap: number;
  bottomGap: number;
  large: boolean;
}

const SPINNER = 'hlm-spinner[data-icon="inline-start"]';

export async function expectSpinnerAtButtonStart(button: Locator): Promise<Measured> {
  const measured = await button.evaluate(async (element, selector): Promise<Measured> => {
    // `transition-all` on the button animates its padding while the spinner arrives.
    await Promise.allSettled(element.getAnimations().map((animation) => animation.finished));
    const spinner = element.querySelector<HTMLElement>(selector)!;
    // A turning box has a larger bounding box, so each measurement starts from the unturned one.
    for (const animation of spinner.getAnimations()) {
      animation.pause();
      animation.currentTime = 0;
    }
    const box = element.getBoundingClientRect();
    const mark = spinner.getBoundingClientRect();
    const style = getComputedStyle(element);
    const border = parseFloat(style.borderLeftWidth);
    const padding = parseFloat(style.paddingInlineStart);
    const room = element.clientWidth - padding - parseFloat(style.paddingInlineEnd);
    const content = document.createRange();
    content.selectNodeContents(element);
    return {
      offset: mark.left - box.left,
      // The label is centred, so a button wider than its content leaves room on both sides.
      expectedOffset: border + padding + (room - content.getBoundingClientRect().width) / 2,
      padding,
      width: mark.width,
      height: mark.height,
      topGap: mark.top - box.top,
      bottomGap: box.bottom - mark.bottom,
      large: /(^|\s)h-11(\s|$)/.test(element.getAttribute('class') ?? ''),
    };
  }, SPINNER);
  expect(Math.abs(measured.offset - measured.expectedOffset)).toBeLessThan(POSITION_TOLERANCE);
  expect(measured.padding).toBe(measured.large ? LARGE_PADDING : DEFAULT_PADDING);
  expect(measured.width).toBe(SPINNER_SIZE);
  expect(measured.height).toBe(SPINNER_SIZE);
  expect(Math.abs(measured.topGap - measured.bottomGap)).toBeLessThan(POSITION_TOLERANCE * 2);
  return measured;
}

export async function spinnerAnimationName(button: Locator): Promise<string> {
  return button.evaluate(
    (element, selector) => getComputedStyle(element.querySelector(selector)!).animationName,
    SPINNER,
  );
}
