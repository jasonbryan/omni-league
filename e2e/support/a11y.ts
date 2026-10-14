import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Derived from `@axe-core/playwright` so `axe-core` need not be a direct dependency. */
type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;
type Result = AxeResults['violations'][number];

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

export const REFLOW_WIDTH = 320;

export interface AxeScanOptions {
  /**
   * Rules to disable. Only per rule, each with a one-line why at the call site. Prefer `exclude`
   * for a single known element.
   */
  disableRules?: string[];
  /** CSS selectors excluded from the scan (same rule: a one-line why at the call site). */
  exclude?: string[];
}

export interface TabWalkOptions {
  /**
   * Expected focus order as CSS selectors (each must match one element). Unset: the order must
   * follow the DOM order of the sequentially focusable elements.
   */
  expectedOrder?: string[];
  maxSteps?: number;
}

export interface TabWalkResult {
  order: string[];
  failures: string[];
}

export interface ReflowResult {
  width: number;
  scrollWidth: number;
  clientWidth: number;
  passed: boolean;
}

export type AccessibilityOptions = AxeScanOptions & TabWalkOptions;

export async function axeScan(page: Page, options: AxeScanOptions = {}): Promise<AxeResults> {
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  if (options.disableRules?.length) builder = builder.disableRules(options.disableRules);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  return builder.analyze();
}

export function describeViolations(violations: Result[]): string[] {
  return violations.map(
    (v) =>
      `${v.id} (${v.impact ?? 'unknown impact'}): ${v.help} [${v.nodes
        .map((n) => n.target.join(' '))
        .join(', ')}] ${v.helpUrl}`,
  );
}

export async function checkReflow(page: Page): Promise<ReflowResult> {
  const original = page.viewportSize();
  await page.setViewportSize({ width: REFLOW_WIDTH, height: original?.height ?? 800 });
  try {
    const size = await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      // Measure the settled layout: a `transition-all` control (the top bar's account link, whose
      // max-width drops at the md breakpoint) is still mid-transition two frames after the resize.
      // Only finite animations are awaited: an infinite one (`animate-pulse`, `animate-spin`) never
      // finishes, so waiting for it would hang until the test timeout.
      const finite = document
        .getAnimations()
        .filter((a) => a.effect !== null && a.effect.getComputedTiming().endTime !== Infinity);
      await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
      const root = document.documentElement;
      return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
    });
    return { width: REFLOW_WIDTH, ...size, passed: size.scrollWidth <= size.clientWidth };
  } finally {
    if (original) await page.setViewportSize(original);
  }
}

const WALK_KEY = '__e2eTabWalk';

interface WalkState {
  elements: Element[];
  unfocused: string[];
  sentinel: HTMLElement;
}

type WalkWindow = Window & { [WALK_KEY]?: WalkState };

interface StepInfo {
  /**
   * `start`: still on the start marker (Tab did not move focus); `outside`: on the body or outside
   * the document (focus left the page); `element`: on an element of the page.
   */
  where: 'start' | 'outside' | 'element';
  index: number;
  description: string;
  /**
   * How many Tab presses in a row one element takes before focus moves on: more than 1 for a native
   * date or time field, whose segments (and picker button) each take a Tab press inside the one
   * element.
   */
  parts: number;
  focusVisible: boolean | null;
  inViewport: boolean;
  unobscured: boolean;
  coveredBy: string;
}

function setUpWalk(key: string): string[] {
  const describe = (el: Element): string => {
    const name = (el.getAttribute('aria-label') ?? el.textContent ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${name.slice(0, 40)}"`;
  };
  const focusStyle = (el: Element): string => {
    const s = getComputedStyle(el);
    return `outline: ${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset}; box-shadow: ${s.boxShadow}`;
  };
  const rendered = (el: Element): boolean =>
    typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ visibilityProperty: true })
      : el.getClientRects().length > 0;
  const candidates = document.querySelectorAll(
    'a[href], area[href], button, input, select, textarea, iframe, summary, ' +
      'audio[controls], video[controls], [tabindex], [contenteditable]',
  );
  const seenRadioGroups = new Set<string>();
  const radios = (el: HTMLInputElement): HTMLInputElement[] =>
    Array.from(
      (el.form ?? document).querySelectorAll<HTMLInputElement>(
        `input[type="radio"][name="${CSS.escape(el.name)}"]`,
      ),
    );
  const elements = Array.from(candidates).filter((el) => {
    if (!(el instanceof HTMLElement || el instanceof SVGElement)) return false;
    if (el.tabIndex < 0 || el.matches(':disabled') || el.closest('[inert]') || !rendered(el)) {
      return false;
    }
    if (el instanceof HTMLElement && el.tagName === 'SUMMARY') {
      const details = el.parentElement;
      if (details?.tagName !== 'DETAILS' || details.querySelector(':scope > summary') !== el) {
        return false;
      }
    }
    if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
      const group = radios(el);
      const tabStop = group.find((r) => r.checked) ?? group[0];
      const groupKey = `${el.form ? 'form' : 'doc'}:${el.name}`;
      if (el !== tabStop || seenRadioGroups.has(groupKey)) return false;
      seenRadioGroups.add(groupKey);
    }
    return true;
  });

  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  const unfocused = elements.map(focusStyle);
  const sentinel = document.createElement('div');
  sentinel.tabIndex = -1;
  sentinel.setAttribute('aria-hidden', 'true');
  sentinel.style.cssText =
    'position:absolute;top:0;left:0;width:1px;height:1px;overflow:hidden;outline:none';
  document.body.prepend(sentinel);
  window.scrollTo(0, 0);
  sentinel.focus({ preventScroll: true });
  (window as WalkWindow)[key as typeof WALK_KEY] = { elements, unfocused, sentinel };
  return elements.map(describe);
}

async function readStep(key: string): Promise<StepInfo> {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const state = (window as WalkWindow)[key as typeof WALK_KEY];
  if (!state) throw new Error('Tab walk state missing');
  const describe = (el: Element): string => {
    const name = (el.getAttribute('aria-label') ?? el.textContent ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${name.slice(0, 40)}"`;
  };
  // Tab stops inside one native date or time input: its segments, then its picker button. This runs
  // in the page, so the table is local.
  const inputParts: Record<string, number> = {
    date: 4,
    month: 3,
    week: 3,
    time: 4,
    'datetime-local': 6,
  };
  const active = document.activeElement;
  if (
    !active ||
    active === document.body ||
    active === document.documentElement ||
    active === state.sentinel
  ) {
    return {
      where: active && active === state.sentinel ? 'start' : 'outside',
      index: -1,
      description: '',
      parts: 1,
      focusVisible: null,
      inViewport: true,
      unobscured: true,
      coveredBy: '',
    };
  }
  const index = state.elements.indexOf(active);
  const s = getComputedStyle(active);
  const now = `outline: ${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor} ${s.outlineOffset}; box-shadow: ${s.boxShadow}`;
  const rect = active.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const inViewport =
    rect.width > 0 && rect.height > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
  const hit = inViewport ? document.elementFromPoint(x, y) : null;
  let unobscured = !!hit && (hit === active || active.contains(hit));
  if (inViewport && !unobscured) {
    // An inline element that wraps (a link in a sentence) has one box per line, and the centre of
    // their union can fall beside the shorter line, on the text around it. The element is obscured
    // only when the centre of none of its line boxes is on it.
    for (const box of active.getClientRects()) {
      const bx = box.left + box.width / 2;
      const by = box.top + box.height / 2;
      if (box.width <= 0 || box.height <= 0 || bx < 0 || by < 0 || bx >= innerWidth) continue;
      if (by >= innerHeight) continue;
      const lineHit = document.elementFromPoint(bx, by);
      if (lineHit && (lineHit === active || active.contains(lineHit))) {
        unobscured = true;
        break;
      }
    }
  }
  return {
    where: 'element',
    index,
    description: describe(active),
    parts: active instanceof HTMLInputElement ? (inputParts[active.type] ?? 1) : 1,
    focusVisible: index >= 0 ? now !== state.unfocused[index] : null,
    inViewport,
    unobscured,
    coveredBy: hit && !unobscured ? describe(hit) : '',
  };
}

function resolveExpectedOrder(args: [string, string[]]): number[] {
  const [key, selectors] = args;
  const state = (window as WalkWindow)[key as typeof WALK_KEY];
  if (!state) throw new Error('Tab walk state missing');
  return selectors.map((selector) => {
    const el = document.querySelector(selector);
    return el ? state.elements.indexOf(el) : -2;
  });
}

function tearDownWalk(key: string): void {
  const state = (window as WalkWindow)[key as typeof WALK_KEY];
  state?.sentinel.remove();
  delete (window as WalkWindow)[key as typeof WALK_KEY];
}

/**
 * The key that moves focus to the next element. WebKit on macOS follows the system default and
 * Tabs only to text fields; Option+Tab moves through every element, as Tab does in WebKit on Linux
 * (CI) and in Chromium. Prefix `Shift+` to move back.
 */
export function tabKey(page: Page): 'Tab' | 'Alt+Tab' {
  const browserName = page.context().browser()?.browserType().name();
  return browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab';
}

const TAB_ROUNDS = 2;
const STEP_MARGIN = 5;
const EXTRA_PRESSES_PER_DATE_FIELD = 5;

function defaultMaxSteps(focusableCount: number, dateFieldCount: number): number {
  return (
    focusableCount * TAB_ROUNDS +
    STEP_MARGIN +
    dateFieldCount * EXTRA_PRESSES_PER_DATE_FIELD * TAB_ROUNDS
  );
}

/**
 * CSS visual reordering is not detected (manual check). A page with no focusable elements passes.
 * Shadow roots and iframe contents are not walked.
 */
export async function tabWalk(page: Page, options: TabWalkOptions = {}): Promise<TabWalkResult> {
  const domOrder = await page.evaluate(setUpWalk, WALK_KEY);
  const failures: string[] = [];
  const tab = tabKey(page);
  const dateFieldCount = await page.evaluate(
    () =>
      document.querySelectorAll(
        'input[type="date"], input[type="month"], input[type="week"], input[type="time"], ' +
          'input[type="datetime-local"]',
      ).length,
  );
  const maxSteps = options.maxSteps ?? defaultMaxSteps(domOrder.length, dateFieldCount);
  const same = (a: StepInfo | undefined, b: StepInfo): boolean =>
    !!a && a.where === 'element' && a.index === b.index && a.description === b.description;
  // A fresh Tab sequence starts once focus first leaves the page, so positive tabindex values are
  // seen in the order the browser really uses. A browser that wraps from the last element to the
  // first without leaving the page completes its round in phase "before".
  let phase: 'before' | 'cycle' | 'return' = 'before';
  const before: StepInfo[] = [];
  let cycle: StepInfo[] = [];
  let previous: StepInfo | undefined;
  let stays = 0;
  let done = false;
  const trap = (message: string): void => {
    failures.push(`2.1.2 No keyboard trap: ${message}`);
    done = true;
  };
  try {
    for (let step = 1; step <= maxSteps && !done; step++) {
      await page.keyboard.press(tab);
      const info = await page.evaluate(readStep, WALK_KEY);
      if (info.where === 'start') {
        trap('Tab did not move focus from the top of the page');
        break;
      }
      if (info.where === 'element' && same(previous, info)) {
        stays++;
        if (stays > info.parts) {
          trap(`focus stayed on ${info.description} after Tab`);
          break;
        }
        continue;
      }
      stays = 1;
      previous = info;
      if (phase === 'before') {
        if (info.where === 'outside') {
          phase = 'cycle';
        } else if (same(before[0], info)) {
          cycle = before;
          done = true;
        } else if (before.some((b) => same(b, info))) {
          trap(
            `focus cycled back to ${info.description} without returning to the start ${before[0]?.description}`,
          );
        } else {
          before.push(info);
        }
        continue;
      }
      if (phase === 'cycle') {
        if (info.where === 'outside') {
          const nothingTakesFocus = cycle.length === 0;
          if (nothingTakesFocus) done = true;
          else phase = 'return';
        } else if (cycle.some((c) => same(c, info))) {
          trap(
            `focus cycled back to ${info.description} without returning to the start ${cycle[0]?.description}`,
          );
        } else {
          cycle.push(info);
        }
        continue;
      }
      if (!same(cycle[0], info)) {
        trap(
          `after leaving the page, Tab focused ${info.description || 'nothing'} instead of the start ${cycle[0]?.description}`,
        );
      }
      done = true;
    }
    if (!done) {
      trap(
        `focus did not return to the start within ${maxSteps} Tab presses ` +
          `(visited: ${[...before, ...cycle].map((v) => v.description).join(' -> ') || 'nothing'})`,
      );
    }

    for (const info of cycle.length > 0 ? cycle : before) {
      if (info.focusVisible === false) {
        failures.push(
          `2.4.7 Focus visible: ${info.description} has the same outline and box-shadow focused as unfocused`,
        );
      }
      if (!info.inViewport) {
        failures.push(
          `2.4.11 Focus not obscured: ${info.description} is outside the viewport when focused`,
        );
      } else if (!info.unobscured) {
        failures.push(
          `2.4.11 Focus not obscured: ${info.description} is covered by ${info.coveredBy || 'another element'} at its centre`,
        );
      }
    }

    const trapped = failures.some((f) => f.startsWith('2.1.2'));
    const expectedIndexes = options.expectedOrder
      ? await page.evaluate(resolveExpectedOrder, [WALK_KEY, options.expectedOrder] as [
          string,
          string[],
        ])
      : domOrder.map((_, i) => i);
    options.expectedOrder?.forEach((selector, i) => {
      if (expectedIndexes[i] === -2)
        failures.push(`2.4.3 Focus order: expected-order selector "${selector}" matched nothing`);
      if (expectedIndexes[i] === -1)
        failures.push(`2.4.3 Focus order: "${selector}" is not sequentially focusable`);
    });
    const nameOf = (i: number): string => domOrder[i] ?? `unknown element #${i}`;
    if (!trapped && cycle.map((c) => c.index).join(',') !== expectedIndexes.join(',')) {
      failures.push(
        `2.4.3 Focus order: expected [${expectedIndexes.map(nameOf).join(' -> ')}] (${
          options.expectedOrder ? 'expected order' : 'DOM order'
        }), got [${cycle.map((c) => c.description).join(' -> ')}]`,
      );
    }
  } finally {
    await page.evaluate(tearDownWalk, WALK_KEY);
  }
  return { order: cycle.map((c) => c.description), failures };
}

/**
 * All three are soft assertions, so one run reports every failure. The full axe results, including
 * `incomplete` ("needs review") items for the manual checklist, are attached to the test report.
 */
export async function expectAccessible(
  page: Page,
  options: AccessibilityOptions = {},
): Promise<void> {
  // The sticky top bar covers whatever scrolled under it, and axe's target-size rule counts a control
  // with a sliver showing as too small.
  await page.evaluate(() => window.scrollTo(0, 0));
  const results = await axeScan(page, options);
  await test.info().attach('axe-results', {
    body: JSON.stringify(
      { violations: results.violations, incomplete: results.incomplete },
      null,
      2,
    ),
    contentType: 'application/json',
  });
  expect
    .soft(describeViolations(results.violations), `axe violations (tags ${AXE_TAGS.join(', ')})`)
    .toEqual([]);

  const walk = await tabWalk(page, options);
  expect.soft(walk.failures, 'Tab walk (2.1.2, 2.4.3, 2.4.7, 2.4.11)').toEqual([]);

  const reflow = await checkReflow(page);
  expect
    .soft(reflow, `1.4.10 Reflow at ${REFLOW_WIDTH} CSS px (scrollWidth <= clientWidth)`)
    .toMatchObject({
      passed: true,
    });
}
