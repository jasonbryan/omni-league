import type { Locator, Page } from '@playwright/test';
import { join } from 'node:path';
import {
  CHIP_CHOICE_INPUT_CLASSES,
  CHIP_CHOICE_LABEL_CLASSES,
  CHIP_CHOICE_WRAPPER_CLASSES,
  RADIO_CHIP_CLASSES,
  chipLinkClasses,
} from '../src/app/ui/chip/chip-classes';
import {
  RADIO_CLASSES,
  RADIO_EDGE_CLASSES,
  RADIO_INPUT_STYLES,
} from '../src/app/ui/radio-group/radio-classes';
import { tabKey } from './support/a11y';
import { chipLabel, chooseChip } from './support/chip';
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

const filterChip = (name: string, label: string): string =>
  `<label class="${CHIP_CHOICE_WRAPPER_CLASSES}"><input type="checkbox" name="${name}" class="${CHIP_CHOICE_INPUT_CLASSES}" /><span class="${CHIP_CHOICE_LABEL_CLASSES}">${label}</span></label>`;

// Copies what brain's radio renders inside helm's: the wrapping label, the `data-checked="false"` of an
// unchecked radio, the inline styles of its native input, and the helm class string before the chip classes.
const radioChip = (name: string, label: string): string =>
  `<label class="${CHIP_CHOICE_WRAPPER_CLASSES}"><hlm-radio class="shrink-0"><brn-radio class="brn-radio ${RADIO_CLASSES} ${RADIO_EDGE_CLASSES} ${RADIO_CHIP_CLASSES}" data-checked="false" data-disabled="false"><div data-slot="indicator" class="flex h-fit w-fit empty:hidden"></div><input type="radio" name="${name}" style="${RADIO_INPUT_STYLES}" />${label}</brn-radio></hlm-radio></label>`;

const radioGroup = (name: string, labels: string[]): string =>
  `<div role="radiogroup" aria-label="${name}" class="grid gap-3"><div class="flex flex-wrap gap-2">${labels.map((label) => radioChip(name, label)).join('')}</div></div>`;

// Brain sets `data-checked` on every radio of a group when one is chosen; the page has no Angular.
const MIRROR_CHECKED = `document.addEventListener('change', (event) => {
  const input = event.target;
  if (input.type !== 'radio') return;
  for (const radio of document.querySelectorAll('input[name="' + input.name + '"]')) {
    radio.closest('brn-radio').setAttribute('data-checked', String(radio.checked));
  }
});`;

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Chips</title><style>${KIT_CSS}</style></head><body class="p-4">
  <fieldset>
    <legend class="mb-1.5 text-sm font-medium">Sport</legend>
    ${radioGroup('sport', SPORTS)}
  </fieldset>
  <div class="mt-4 flex flex-wrap gap-2">${filterChip('open', 'Open')}</div>
  <nav class="mt-4 flex flex-wrap gap-2" aria-label="Sports">
    <a href="#all" aria-current="page" class="${chipLinkClasses(true)}">All sports</a>
    <a href="#soccer" class="${chipLinkClasses(false)}">Soccer</a>
  </nav>
  <fieldset class="mt-4">
    <legend class="mb-1.5 text-sm font-medium">Level</legend>
    ${radioGroup('level', LEVELS)}
  </fieldset>
  <div id="foreground-probe" class="bg-foreground"></div>
  <script>${MIRROR_CHECKED}</script>
</body></html>`;

// The same label on a radio chip and a filter chip, so their widths match too.
const PAIR_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Pair</title><style>${KIT_CSS}</style></head><body class="p-4">
  <fieldset>
    <legend class="mb-1.5 text-sm font-medium">Radio</legend>
    ${radioGroup('pair', ['Soccer', 'Other'])}
  </fieldset>
  <fieldset class="mt-4">
    <legend class="mb-1.5 text-sm font-medium">Filter</legend>
    <div class="flex flex-wrap gap-2">${filterChip('filter', 'Soccer')}</div>
  </fieldset>
  <script>${MIRROR_CHECKED}</script>
</body></html>`;

test.beforeEach(async ({ page }) => {
  expect(KIT_CSS, `${MOCKUP} has no inlined mockup kit; run npm run design:css`).not.toBe('');
  await page.setContent(PAGE);
});

const radioChipOf = (radio: Locator): Locator => radio.locator('xpath=ancestor::brn-radio');
const filterChipOf = (checkbox: Locator): Locator =>
  checkbox.locator('xpath=following-sibling::span');

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
    expect((await outline(radioChipOf(radios.nth(1)))).style).not.toBe('none');
    expect((await outline(radioChipOf(radios.nth(0)))).style).toBe('none');
  });

  test('Space toggles the checkbox chip, and the focused chip shows a focus ring', async ({
    page,
  }) => {
    const checkbox = page.getByRole('checkbox');
    await page.keyboard.press(tabKey(page));
    await page.keyboard.press(tabKey(page));
    await expect(checkbox).toBeFocused();
    expect((await outline(filterChipOf(checkbox))).style).not.toBe('none');

    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();
    await page.keyboard.press('Space');
    await expect(checkbox).not.toBeChecked();
  });

  test('every chip is 36px on fine pointers and 44px on touch screens', async ({ page }) => {
    const height = await expectedHeight(page);
    const chips = page.locator('span.rounded-full, a.rounded-full, brn-radio.rounded-full');
    await expect(chips).toHaveCount(SPORTS.length + LEVELS.length + 3);
    for (const chip of await chips.all()) {
      expect(Math.round((await chip.boundingBox())?.height ?? 0)).toBe(height);
    }
  });

  test('a one-letter chip is at least 44px wide on touch screens and keeps its natural width on fine pointers', async ({
    page,
  }) => {
    const coarse = await page.evaluate((query) => matchMedia(query).matches, COARSE_POINTER);
    const level = radioChipOf(page.getByRole('radio', { name: 'B', exact: true }));
    const box = await level.boundingBox();
    expect(box).not.toBeNull();
    if (coarse) {
      expect(Math.round(box?.width ?? 0)).toBeGreaterThanOrEqual(COARSE_POINTER_WIDTH);
      expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(COARSE_POINTER_HEIGHT);
      const offsets = await level.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents([...element.childNodes].find((node) => node.nodeType === 3)!);
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
    const unchecked = await radioChipOf(page.getByRole('radio').nth(0)).evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    expect(unchecked).not.toBe(foreground);

    await chooseChip(chipLabel(page, SPORTS[0]));
    const checked = radioChipOf(page.getByRole('radio').nth(0));
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
    await chooseChip(chipLabel(page, SPORTS[0]));
    const checked = radioChipOf(radios.nth(0));
    const other = radioChipOf(radios.nth(1));
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
    await chooseChip(chipLabel(page, SPORTS[1]));
    await page.getByRole('radio').nth(1).blur();

    const checked = radioChipOf(page.getByRole('radio').nth(1));
    const unchecked = radioChipOf(page.getByRole('radio').nth(0));
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
    await radios.nth(0).evaluate((radio) => {
      (radio as HTMLInputElement).checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const checked = radioChipOf(radios.nth(0));
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

const LOOK = [
  'backgroundColor',
  'color',
  'borderTopColor',
  'borderTopStyle',
  'borderTopWidth',
  'borderTopLeftRadius',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'marginTop',
  'width',
  'height',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'whiteSpace',
  'cursor',
  'userSelect',
  'opacity',
  'outlineStyle',
  'outlineWidth',
  'outlineOffset',
  'outlineColor',
  'forcedColorAdjust',
  'alignItems',
  'justifyContent',
] as const;

async function look(chip: Locator): Promise<Record<string, string>> {
  return chip.evaluate((element, properties) => {
    const style = getComputedStyle(element);
    return Object.fromEntries(
      properties.map((property) => [
        property,
        style.getPropertyValue(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)),
      ]),
    );
  }, LOOK);
}

test.describe('a radio chip and a filter chip', () => {
  test.beforeEach(async ({ page }) => {
    await page.setContent(PAIR_PAGE);
  });

  const pair = (page: Page) => ({
    radio: page.getByRole('radio', { name: 'Soccer', exact: true }),
    filter: page.getByRole('checkbox', { name: 'Soccer', exact: true }),
  });

  async function expectSameLook(page: Page): Promise<void> {
    const { radio, filter } = pair(page);
    expect(await look(radioChipOf(radio))).toEqual(await look(filterChipOf(filter)));
  }

  test('look the same when unchecked, with brain’s data-checked="false"', async ({ page }) => {
    await expect(radioChipOf(pair(page).radio)).toHaveAttribute('data-checked', 'false');
    await expectSameLook(page);
  });

  test('look the same when hovered while unchecked', async ({ page }) => {
    test.skip(!(await page.evaluate(() => matchMedia('(hover: hover)').matches)), 'no hover');
    const { radio, filter } = pair(page);
    await radioChipOf(radio).hover();
    const radioLook = await look(radioChipOf(radio));
    await filterChipOf(filter).hover();
    expect(radioLook).toEqual(await look(filterChipOf(filter)));
    expect(radioLook['backgroundColor']).not.toBe('rgba(0, 0, 0, 0)');
  });

  test('look the same when checked', async ({ page }) => {
    const { radio, filter } = pair(page);
    await chooseChip(chipLabel(page, 'Soccer').first());
    await filter.check({ force: true });
    await expect(radioChipOf(radio)).toHaveAttribute('data-checked', 'true');
    await page.mouse.move(0, 0);
    await expectSameLook(page);
    await expect(radioChipOf(pair(page).radio)).toHaveCSS(
      'background-color',
      await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.className = 'bg-foreground';
        document.body.append(probe);
        return getComputedStyle(probe).backgroundColor;
      }),
    );
  });

  async function expectSameLookWhenFocused(page: Page): Promise<void> {
    const { radio, filter } = pair(page);
    const tab = tabKey(page);
    await page.keyboard.press(tab);
    await expect(radio).toBeFocused();
    const uncheckedRadio = await look(radioChipOf(radio));
    await page.keyboard.press(tab);
    await expect(filter).toBeFocused();
    expect(uncheckedRadio).toEqual(await look(filterChipOf(filter)));
    expect(uncheckedRadio['outlineStyle']).not.toBe('none');

    await page.keyboard.press('Space');
    await expect(filter).toBeChecked();
    await radio.focus();
    await page.keyboard.press('Space');
    await expect(radio).toBeChecked();
    const checkedRadio = await look(radioChipOf(radio));
    await page.keyboard.press(tab);
    await expect(filter).toBeFocused();
    expect(checkedRadio).toEqual(await look(filterChipOf(filter)));
    expect(checkedRadio['outlineStyle']).not.toBe('none');
  }

  test('look the same with keyboard focus, unchecked and checked', async ({ page }) => {
    await expectSameLookWhenFocused(page);
  });

  test('look the same in forced colors, unchecked, checked, and focused', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await expectSameLook(page);
    await expectSameLookWhenFocused(page);
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expectSameLook(page);
  });
});
