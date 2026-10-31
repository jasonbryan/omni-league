import type { Locator, Page } from '@playwright/test';
import { tabKey } from './a11y';
import { expect } from './fixtures';

/** Every sticky-footer test runs here: the footer sticks below 768px, and 640px is a short phone. */
export const PHONE = { width: 360, height: 640 } as const;

export interface FocusedPlace {
  control: string;
  inViewport: boolean;
  unobscured: boolean;
  aboveFooter: boolean;
}

export function settleAfterFocusScroll(page: Page): Promise<void> {
  return page.evaluate(async () => {
    // The error for the field just left renders after the focus scroll, so the check waits for it.
    for (let frame = 0; frame < 3; frame++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });
}

export async function focusedPlace(page: Page): Promise<FocusedPlace> {
  await settleAfterFocusScroll(page);
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement;
    // A chip's radio is visually hidden: its label is what the user sees.
    const face = active.closest('label') ?? active;
    const rect = face.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const inViewport = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
    const hit = inViewport ? document.elementFromPoint(x, y) : null;
    const footer = active.closest('form')?.querySelector('[data-slot="form-footer"]');
    return {
      control: [active.id, active.getAttribute('name'), active.tagName].find(Boolean)!,
      inViewport,
      unobscured: !!hit && face.contains(hit),
      aboveFooter:
        !!footer && (footer.contains(active) || rect.bottom <= footer.getBoundingClientRect().top),
    };
  });
}

export async function expectWhollyAboveFooter(page: Page, focused: Locator): Promise<void> {
  await expect(focused).toBeFocused();
  const place = await focusedPlace(page);
  expect(place).toMatchObject({ inViewport: true, unobscured: true, aboveFooter: true });
}

export async function footerTabWalk(
  page: Page,
  // A date field takes several Tabs, one per part, so the cap leaves room for them.
  { form, until, maxSteps = 40 }: { form: Locator; until: Locator; maxSteps?: number },
): Promise<FocusedPlace[]> {
  const viewport = page.viewportSize()!;
  // Or no control could ever end under the footer.
  expect((await form.boundingBox())!.height).toBeGreaterThan(viewport.height);
  const tab = tabKey(page);
  const seen: FocusedPlace[] = [];
  for (let step = 0; step < maxSteps; step++) {
    seen.push(await focusedPlace(page));
    if (await until.evaluate((control) => control === document.activeElement)) break;
    await page.keyboard.press(tab);
  }
  return seen;
}

// A date field takes one Tab per part.
export const controlsInTabOrder = (seen: FocusedPlace[]): string[] =>
  seen
    .map((place) => place.control)
    .filter((control, step, controls) => control !== controls[step - 1]);

export const underTheFooter = (seen: FocusedPlace[]): FocusedPlace[] =>
  seen.filter((place) => !place.inViewport || !place.unobscured || !place.aboveFooter);

/** In the viewport, unobscured at its centre, and inside the form's footer. */
export async function expectVisibleInFooter(page: Page, shown: Locator): Promise<void> {
  await expect(shown).toBeVisible();
  await settleAfterFocusScroll(page);
  const place = await shown.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const footer = element.closest('form')?.querySelector('[data-slot="form-footer"]');
    return {
      inViewport:
        rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
      unobscured: !!hit && element.contains(hit),
      inFooter: !!footer && footer.contains(element),
    };
  });
  expect(place).toEqual({ inViewport: true, unobscured: true, inFooter: true });
}

export async function footerHeight(form: Locator): Promise<number> {
  return (await form.locator('[data-slot="form-footer"]').boundingBox())!.height;
}

/** At 768px and wider the footer is in the flow, and the status sits on top of the button. */
export async function expectStatusOnTopOfButton(
  form: Locator,
  status: Locator,
  button: Locator,
): Promise<void> {
  const footer = form.locator('[data-slot="form-footer"]');
  await expect(footer).toHaveCSS('position', 'static');
  expect(await status.evaluate((element) => !!element.closest('[data-slot="form-footer"]'))).toBe(
    true,
  );
  const box = (await status.boundingBox())!;
  const below = (await button.boundingBox())!;
  expect(below.y - (box.y + box.height)).toBeGreaterThanOrEqual(0);
  expect(below.y - (box.y + box.height)).toBeLessThanOrEqual(16);
}

export async function expectAtMostTwoLines(title: Locator): Promise<void> {
  const { lines, clamp } = await title.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      lines: element.getBoundingClientRect().height / parseFloat(style.lineHeight),
      clamp: style.webkitLineClamp,
    };
  });
  expect(clamp).toBe('2');
  expect(lines).toBeLessThanOrEqual(2);
}
