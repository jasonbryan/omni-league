import type { Locator, Page } from '@playwright/test';
import { join } from 'node:path';
import {
  CHIP_CHOICE_INPUT_CLASSES,
  CHIP_CHOICE_LABEL_CLASSES,
  CHIP_CHOICE_WRAPPER_CLASSES,
  chipLinkClasses,
} from '../src/app/ui/chip/chip-classes';
import { tabKey } from './support/a11y';
import { expect, test } from './support/fixtures';
import { inlinedKitCss } from './support/mockup-kit';

const MOCKUP = join(process.cwd(), 'design', 'mockups', '300-public-site-league-form.html');
const KIT_CSS = inlinedKitCss(MOCKUP);

const COARSE_POINTER = '(pointer: coarse)';
const FINE_POINTER_HEIGHT = 36;
const COARSE_POINTER_HEIGHT = 44;
const COARSE_POINTER_WIDTH = 44;

const SPORTS = ['Beach volleyball', 'Soccer', 'Softball'];
const LEVELS = ['B', 'AA'];

const choice = (type: 'radio' | 'checkbox', name: string, label: string): string =>
  `<label class="${CHIP_CHOICE_WRAPPER_CLASSES}"><input type="${type}" name="${name}" class="${CHIP_CHOICE_INPUT_CLASSES}" /><span class="${CHIP_CHOICE_LABEL_CLASSES}">${label}</span></label>`;

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Chips</title><style>${KIT_CSS}</style></head><body class="p-4">
  <fieldset>
    <legend class="mb-1.5 text-sm font-medium">Sport</legend>
    <div class="flex flex-wrap gap-2">${SPORTS.map((sport) => choice('radio', 'sport', sport)).join('')}</div>
  </fieldset>
  <div class="mt-4 flex flex-wrap gap-2">${choice('checkbox', 'open', 'Open')}</div>
  <nav class="mt-4 flex flex-wrap gap-2" aria-label="Sports">
    <a href="#all" aria-current="page" class="${chipLinkClasses(true)}">All sports</a>
    <a href="#soccer" class="${chipLinkClasses(false)}">Soccer</a>
  </nav>
  <fieldset class="mt-4">
    <legend class="mb-1.5 text-sm font-medium">Level</legend>
    <div class="flex flex-wrap gap-2">${LEVELS.map((level) => choice('radio', 'level', level)).join('')}</div>
  </fieldset>
  <div id="foreground-probe" class="bg-foreground"></div>
</body></html>`;

test.beforeEach(async ({ page }) => {
  expect(KIT_CSS, `${MOCKUP} has no inlined mockup kit; run npm run design:css`).not.toBe('');
  await page.setContent(PAGE);
});

const chipOf = (input: Locator): Locator => input.locator('xpath=following-sibling::span');

async function outline(chip: Locator): Promise<{ style: string; width: string }> {
  return chip.evaluate((element) => {
    const { outlineStyle, outlineWidth } = getComputedStyle(element);
    return { style: outlineStyle, width: outlineWidth };
  });
}

async function expectedHeight(page: Page): Promise<number> {
  const coarse = await page.evaluate((query) => matchMedia(query).matches, COARSE_POINTER);
  return coarse ? COARSE_POINTER_HEIGHT : FINE_POINTER_HEIGHT;
}

test.describe('chip classes in the mockup kit', () => {
  test('Right arrow checks and focuses the next radio, and its chip shows a focus ring', async ({
    page,
  }) => {
    const radios = page.getByRole('radio');
    await page.keyboard.press(tabKey(page));
    await expect(radios.nth(0)).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(radios.nth(1)).toBeChecked();
    await expect(radios.nth(1)).toBeFocused();
    await expect(radios.nth(0)).not.toBeChecked();
    expect((await outline(chipOf(radios.nth(1)))).style).not.toBe('none');
    expect((await outline(chipOf(radios.nth(0)))).style).toBe('none');
  });

  test('Space toggles the checkbox chip, and the focused chip shows a focus ring', async ({
    page,
  }) => {
    const checkbox = page.getByRole('checkbox');
    await page.keyboard.press(tabKey(page));
    await page.keyboard.press(tabKey(page));
    await expect(checkbox).toBeFocused();
    expect((await outline(chipOf(checkbox))).style).not.toBe('none');

    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    await page.keyboard.press('Space');
    await expect(checkbox).not.toBeChecked();
  });

  test('every chip is 36px on fine pointers and 44px on touch screens', async ({ page }) => {
    const height = await expectedHeight(page);
    const chips = page.locator('span.rounded-full, a.rounded-full');
    await expect(chips).toHaveCount(SPORTS.length + LEVELS.length + 3);
    for (const chip of await chips.all()) {
      expect(Math.round((await chip.boundingBox())?.height ?? 0)).toBe(height);
    }
  });

  test('a one-letter chip is at least 44px wide on touch screens and keeps its natural width on fine pointers', async ({
    page,
  }) => {
    const coarse = await page.evaluate((query) => matchMedia(query).matches, COARSE_POINTER);
    const level = chipOf(page.getByRole('radio', { name: 'B', exact: true }));
    const box = await level.boundingBox();
    expect(box).not.toBeNull();
    if (coarse) {
      expect(Math.round(box?.width ?? 0)).toBeGreaterThanOrEqual(COARSE_POINTER_WIDTH);
      expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(COARSE_POINTER_HEIGHT);
      const offsets = await level.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const text = range.getBoundingClientRect();
        const chip = element.getBoundingClientRect();
        return { left: text.left - chip.left, right: chip.right - text.right };
      });
      expect(Math.abs(offsets.left - offsets.right)).toBeLessThan(1);
    } else {
      expect(box?.width ?? 0).toBeLessThan(COARSE_POINTER_WIDTH);
    }
  });

  test('the checked and current chips are --background on --foreground', async ({ page }) => {
    const foreground = await page
      .locator('#foreground-probe')
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    const unchecked = await chipOf(page.getByRole('radio').nth(0)).evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(unchecked).not.toBe(foreground);

    await page.getByRole('radio').nth(0).check({ force: true });
    const checked = chipOf(page.getByRole('radio').nth(0));
    await expect(checked).toHaveCSS('background-color', foreground);
    await expect(page.getByRole('link', { name: 'All sports' })).toHaveCSS(
      'background-color',
      foreground,
    );
    await expect(page.getByRole('link', { name: 'Soccer' })).not.toHaveCSS(
      'background-color',
      foreground,
    );
  });

  test('hovering fills an unchecked chip and leaves a checked chip as it is', async ({ page }) => {
    const hoverable = await page.evaluate(() => matchMedia('(hover: hover)').matches);
    test.skip(!hoverable, 'touch screens have no hover');
    const background = (chip: Locator) =>
      chip.evaluate((element) => getComputedStyle(element).backgroundColor);
    const radios = page.getByRole('radio');
    await radios.nth(0).check({ force: true });
    const checked = chipOf(radios.nth(0));
    const other = chipOf(radios.nth(1));
    const checkedBefore = await background(checked);
    const otherBefore = await background(other);

    await checked.hover();
    expect(await background(checked)).toBe(checkedBefore);
    await other.hover();
    expect(await background(other)).not.toBe(otherBefore);
  });

  test('forced colors draw the checked and current chips as a fill, with no outline until focused', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.getByRole('radio').nth(1).check({ force: true });

    const checked = chipOf(page.getByRole('radio').nth(1));
    const unchecked = chipOf(page.getByRole('radio').nth(0));
    const current = page.getByRole('link', { name: 'All sports' });
    const other = page.getByRole('link', { name: 'Soccer' });
    const fill = (chip: Locator) =>
      chip.evaluate((element) => getComputedStyle(element).backgroundColor);

    expect(await fill(checked)).not.toBe(await fill(unchecked));
    expect(await fill(current)).not.toBe(await fill(other));
    expect(await fill(current)).toBe(await fill(checked));
    for (const chip of [checked, unchecked, current, other]) {
      expect((await outline(chip)).style).toBe('none');
    }
  });

  test('forced colors show focus on a checked chip, which an unfocused one does not have', async ({
    page,
  }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    const radios = page.getByRole('radio');
    await radios.nth(0).evaluate((radio) => ((radio as HTMLInputElement).checked = true));
    const checked = chipOf(radios.nth(0));
    expect((await outline(checked)).style).toBe('none');

    await page.keyboard.press(tabKey(page));
    await expect(radios.nth(0)).toBeFocused();
    expect(await outline(checked)).toEqual({ style: 'solid', width: '2px' });
    const offset = await checked.evaluate((element) => getComputedStyle(element).outlineOffset);
    expect(offset).toBe('2px');

    const current = page.getByRole('link', { name: 'All sports' });
    expect((await outline(current)).style).toBe('none');
    await page.keyboard.press(tabKey(page));
    await page.keyboard.press(tabKey(page));
    await expect(current).toBeFocused();
    expect((await outline(current)).style).toBe('solid');
  });
});
