import type { Locator, Page } from '@playwright/test';
import { expectAccessible } from './a11y';
import { expect } from './fixtures';
import { holdQueries } from './hold-queries';

const BOX_TOLERANCE = 0.5;

/** Where a page keeps its rows, the row's actions slot, and the viewer's lines. */
export interface RowLayout {
  rows: string;
  actions: string;
  registered: string;
  waitlist: string;
}

export interface RowLine {
  slot: string;
  text: string;
}

export const CAMP_ROWS: RowLayout = {
  rows: '#sessions li',
  actions: 'session-actions',
  registered: 'session-registered',
  waitlist: 'session-waitlist',
};

export const TRAINING_CLASS_ROWS: RowLayout = {
  rows: '#classes li',
  actions: 'class-actions',
  registered: 'class-registered',
  waitlist: 'class-waitlist',
};

export const TRAINING_SERIES_ROWS: RowLayout = {
  rows: '#details-heading + dl > div',
  actions: 'series-actions',
  registered: 'series-registered',
  waitlist: 'series-waitlist',
};

const lineSelector = (layout: RowLayout) =>
  `[data-slot="${layout.registered}"], [data-slot="${layout.waitlist}"]`;

/** Measures the drawn boxes: a line that is clipped or leaves its row fails here, whatever its text says. */
export async function expectNoLineClippedOrSpilled(
  page: Page,
  layout: RowLayout,
  own: Locator,
  count: number,
) {
  const lines = await own.evaluate(
    (li, { selector, actionsSlot }) => {
      const slack = 0.5;
      const actions = li.querySelector(`[data-slot="${actionsSlot}"]`)!.getBoundingClientRect();
      const before = [...li.children]
        .filter((child) => child.getAttribute('data-slot') !== actionsSlot)
        .map((child) => child.getBoundingClientRect().bottom);
      const rowBox = li.getBoundingClientRect();
      const links = [...li.querySelectorAll(`[data-slot="${actionsSlot}"] > a`)].map((link) =>
        link.getBoundingClientRect(),
      );
      return [...li.querySelectorAll(selector)].map((line) => {
        const text = line.querySelector('span')!;
        const textBox = text.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
        return {
          clippedHeight: text.scrollHeight > text.clientHeight + 1,
          clippedWidth: text.scrollWidth > text.clientWidth + 1,
          clamped: getComputedStyle(text).webkitLineClamp !== 'none',
          ellipsis: getComputedStyle(text).textOverflow === 'ellipsis',
          hidden: getComputedStyle(text).overflow !== 'visible',
          lines: Math.round(textBox.height / lineHeight),
          outsideActions:
            textBox.top < actions.top - slack ||
            textBox.bottom > actions.bottom + slack ||
            textBox.left < actions.left - slack ||
            textBox.right > actions.right + slack,
          outsideRow:
            textBox.top < rowBox.top - slack ||
            textBox.bottom > rowBox.bottom + slack ||
            textBox.right > rowBox.right + slack,
          overlapsLineAbove: actions.top < Math.max(...before) - slack,
          overlapsLink: links.some(
            (link) =>
              textBox.left < link.right - slack &&
              textBox.right > link.left + slack &&
              textBox.top < link.bottom - slack &&
              textBox.bottom > link.top + slack,
          ),
          linkOutsideRow: links.some((link) => link.right > rowBox.right + slack),
        };
      });
    },
    { selector: lineSelector(layout), actionsSlot: layout.actions },
  );
  expect(lines).toHaveLength(count);
  for (const line of lines) {
    expect(line.clippedHeight, 'clipped in height').toBe(false);
    expect(line.clippedWidth, 'clipped in width').toBe(false);
    expect(line.clamped, 'line clamp').toBe(false);
    expect(line.ellipsis, 'text-overflow ellipsis').toBe(false);
    expect(line.hidden, 'hidden overflow').toBe(false);
    expect(line.outsideActions, 'outside the actions row').toBe(false);
    expect(line.outsideRow, 'outside the row').toBe(false);
    expect(line.overlapsLineAbove, 'on the line above').toBe(false);
    expect(line.overlapsLink, 'on the Register or Join link').toBe(false);
    expect(line.linkOutsideRow, 'the link leaves the row').toBe(false);
    expect(line.lines).toBeGreaterThanOrEqual(1);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
    'page scrolls sideways',
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
}

interface Change {
  index: number;
  top: number;
  height: number;
}

interface Recorder {
  stop: boolean;
  changes: Change[];
  otherChanges: Change[];
  pageHeights: number[];
}

/**
 * Records every row, and the boxes `otherColumn` matches, per animation frame while the held answers
 * are released. `otherColumn` names content that does not stretch to the grid row: in a two-column
 * layout the page then grows by at most the own row's growth, and that content never moves or resizes.
 * Without it the page grows by exactly the own row's growth.
 */
export async function expectOwnRowGrowsOnce(
  page: Page,
  url: string,
  layout: RowLayout,
  own: Locator,
  answers: string[],
  lines: RowLine[],
  mustGrow: boolean,
  mayGrow = true,
  otherColumn?: string,
): Promise<void> {
  const held = await holdQueries(page, answers);
  await page.goto(url);
  await expect.poll(() => held.isHolding()).toBe(true);
  await expect(own.locator(`[data-slot="${layout.actions}"]`)).toBeVisible();
  await expect(own.locator(lineSelector(layout))).toHaveCount(0);
  await page.evaluate(
    ({ rowsSelector, otherSelector }) => {
      const rows = [...document.querySelectorAll(rowsSelector)];
      const others = otherSelector ? [...document.querySelectorAll(otherSelector)] : [];
      const state: Recorder = { stop: false, changes: [], otherChanges: [], pageHeights: [] };
      const sample = (elements: Element[], last: (Change | undefined)[], into: Change[]) => {
        elements.forEach((element, index) => {
          const box = element.getBoundingClientRect();
          const now = { index, top: box.top + window.scrollY, height: box.height };
          const before = last[index];
          if (
            !before ||
            Math.abs(before.top - now.top) > 0.5 ||
            Math.abs(before.height - now.height) > 0.5
          ) {
            last[index] = now;
            into.push(now);
          }
        });
      };
      const lastRows: (Change | undefined)[] = [];
      const lastOthers: (Change | undefined)[] = [];
      const sampleFrame = () => {
        sample(rows, lastRows, state.changes);
        sample(others, lastOthers, state.otherChanges);
        state.pageHeights.push(document.documentElement.scrollHeight);
        if (!state.stop) requestAnimationFrame(sampleFrame);
      };
      sampleFrame();
      (window as unknown as { __rowRecorder: Recorder }).__rowRecorder = state;
    },
    { rowsSelector: layout.rows, otherSelector: otherColumn },
  );

  held.release();
  for (const slot of [layout.registered, layout.waitlist]) {
    const texts = lines.filter((line) => line.slot === slot).map((line) => line.text);
    if (texts.length > 0) await expect(own.locator(`[data-slot="${slot}"]`)).toHaveText(texts);
  }
  // A growth that is still coming would show within these frames.
  await page.waitForTimeout(700);
  const record = await page.evaluate(() => {
    const state = (window as unknown as { __rowRecorder: Recorder }).__rowRecorder;
    state.stop = true;
    return {
      changes: state.changes,
      otherChanges: state.otherChanges,
      pageHeights: state.pageHeights,
    };
  });
  const index = await own.evaluate(
    (li, rowsSelector) => [...document.querySelectorAll(rowsSelector)].indexOf(li),
    layout.rows,
  );
  const rowCount = new Set(record.changes.map((change) => change.index)).size;
  const byRow = (at: number) => record.changes.filter((change) => change.index === at);
  const baseline = (at: number) => byRow(at)[0];
  const final = (at: number) => byRow(at).at(-1)!;
  expect(rowCount).toBeGreaterThan(index);

  const ownGrowth = final(index).height - baseline(index).height;
  const ownHeights = byRow(index).filter(
    (change, at, all) => at > 0 && Math.abs(change.height - all[at - 1].height) > BOX_TOLERANCE,
  );
  expect(ownHeights.length, 'the own row changes height at most once').toBeLessThanOrEqual(1);
  if (mustGrow) expect(ownGrowth, 'the own row grows').toBeGreaterThan(BOX_TOLERANCE);
  if (!mayGrow) expect(ownGrowth, 'the own row does not grow').toBeLessThanOrEqual(BOX_TOLERANCE);
  expect(ownGrowth).toBeGreaterThanOrEqual(-BOX_TOLERANCE);

  for (let at = 0; at < index; at++) {
    expect(byRow(at), `row ${at} above the caller's row never moves or resizes`).toHaveLength(1);
  }
  for (let at = index + 1; at < rowCount; at++) {
    const changes = byRow(at);
    expect(changes.length, `row ${at} below moves at most once`).toBeLessThanOrEqual(2);
    expect(
      Math.abs(final(at).top - baseline(at).top - ownGrowth),
      `row ${at} below moves by the growth and no more`,
    ).toBeLessThanOrEqual(BOX_TOLERANCE);
    expect(
      Math.abs(final(at).height - baseline(at).height),
      `row ${at} below keeps its height`,
    ).toBeLessThanOrEqual(BOX_TOLERANCE);
  }
  const pageGrowth = record.pageHeights.at(-1)! - record.pageHeights[0];
  if (otherColumn === undefined) {
    expect(
      Math.abs(pageGrowth - ownGrowth),
      'the page grows by the growth and no more',
    ).toBeLessThanOrEqual(BOX_TOLERANCE);
  } else {
    expect(pageGrowth, 'the page grows by at most the growth').toBeLessThanOrEqual(
      ownGrowth + BOX_TOLERANCE,
    );
    expect(pageGrowth, 'the page does not shrink').toBeGreaterThanOrEqual(-BOX_TOLERANCE);
    const others = new Set(record.otherChanges.map((change) => change.index));
    expect(others.size, `${otherColumn} is on the page`).toBeGreaterThan(0);
    expect(
      record.otherChanges.length,
      `${otherColumn} in the other column never moves or resizes`,
    ).toBe(others.size);
  }
  await expectNoLineClippedOrSpilled(page, layout, own, lines.length);
  await expectAccessible(page);
}
