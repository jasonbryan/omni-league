// Tests for the `VIEWPORT_AGNOSTIC` e2e tag (#181). Run with `npm run test:scripts` (node:test).
// Part 1 runs the guard on synthetic sources. Part 2 runs it on the real e2e sources. Part 3 asks
// Playwright which projects run each tagged test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { checkE2eDirectory, describeViolation, findViolations } from './e2e-viewport-agnostic.mjs';

const root = join(import.meta.dirname, '..');

/** Violations of one spec source, plus optional support sources. */
const check = (spec, ...support) =>
  findViolations([
    { path: 'e2e/example.spec.ts', text: spec },
    ...support.map((text, index) => ({ path: `e2e/support/helper-${index}.ts`, text })),
  ]);

const names = (violations) => violations.map((violation) => violation.name);

describe('the viewport-agnostic guard', () => {
  it('accepts a tagged test that checks no screen-dependent behaviour', () => {
    assert.deepEqual(
      check(`test('token', VIEWPORT_AGNOSTIC, async ({ page }) => {
        await page.goto('/sign-in');
        await expect(page.getByRole('alert')).toBeVisible();
      });`),
      [],
    );
  });

  it('flags each kind of screen-dependent call in a tagged test', () => {
    const cases = [
      ['expectAccessible', 'await expectAccessible(page);'],
      ['axeScan', 'await axeScan(page);'],
      ['AxeBuilder', 'await new AxeBuilder({ page }).analyze();'],
      ['tabWalk', 'await tabWalk(page);'],
      ['checkReflow', 'await checkReflow(page);'],
      ['screenshot', 'await screenshot(page, testInfo, "x");'],
      ['screenshot', 'await page.screenshot({ path });'],
      ['toHaveScreenshot', 'await expect(page).toHaveScreenshot();'],
      ['setViewportSize', 'await page.setViewportSize({ width: 320, height: 800 });'],
      ['viewportSize', 'const width = page.viewportSize()?.width;'],
      ['isMobile', 'test.skip(isMobile, "x");'],
      ['toBeFocused', 'await expect(field).toBeFocused();'],
      ['tabKey', 'await page.keyboard.press(tabKey);'],
    ];
    for (const [name, line] of cases) {
      const violations = check(`test('t', VIEWPORT_AGNOSTIC, async ({ page }) => {\n${line}\n});`);
      assert.ok(names(violations).includes(name), `${name} not flagged: ${line}`);
    }
  });

  it('flags a screen-dependent call in a test inside a tagged describe', () => {
    const violations = check(`test.describe('group', VIEWPORT_AGNOSTIC, () => {
      test('inner', async ({ page }) => {
        await expectAccessible(page);
      });
    });`);
    assert.deepEqual(names(violations), ['expectAccessible']);
    assert.equal(violations[0].title, 'group');
  });

  it('flags a call that reaches axe, a screenshot, or reflow through a helper', () => {
    const local = check(`
      async function scan(page) { await axeScan(page); }
      const shoot = async (page) => { await screenshot(page, info, 'x'); };
      async function outer(page) { await scan(page); }
      test('a', VIEWPORT_AGNOSTIC, async ({ page }) => { await outer(page); });
      test('b', VIEWPORT_AGNOSTIC, async ({ page }) => { await shoot(page); });`);
    assert.deepEqual(names(local), ['outer', 'shoot']);
    assert.ok(local.every((violation) => violation.via));

    const imported = check(
      `import { reflowOf } from './support/helper-0';
       test('c', VIEWPORT_AGNOSTIC, async ({ page }) => { await reflowOf(page); });`,
      `export async function reflowOf(page) { return checkReflow(page); }`,
    );
    assert.deepEqual(names(imported), ['reflowOf']);
  });

  it('reads a describe or test on the plain `base` test too', () => {
    const violations = check(`base.describe('plain', VIEWPORT_AGNOSTIC, () => {
      base('inner', async ({ page }) => { await checkReflow(page); });
    });`);
    assert.deepEqual(names(violations), ['checkReflow']);
  });

  it('flags a tag passed through a spread or a condition', () => {
    const violations = check(
      `test('t', known ? {} : VIEWPORT_AGNOSTIC, async ({ page }) => { await expectAccessible(page); });`,
    );
    assert.deepEqual(names(violations), ['expectAccessible']);
  });

  it('ignores untagged tests, and a helper that is never called by a tagged test', () => {
    assert.deepEqual(
      check(`
        async function scan(page) { await axeScan(page); }
        test('untagged', async ({ page }) => { await expectAccessible(page); await scan(page); });
        test('tagged', VIEWPORT_AGNOSTIC, async ({ page }) => { await page.goto('/'); });`),
      [],
    );
  });

  it('names the file, line, and test in its message', () => {
    const violations = check(
      `\n\ntest('the title', VIEWPORT_AGNOSTIC, async () => { checkReflow(); });`,
    );
    const [line] = violations.map((violation) => describeViolation(violation, root));
    assert.match(
      line,
      /example\.spec\.ts:3: "the title" is VIEWPORT_AGNOSTIC but uses checkReflow/,
    );
  });
});

describe('the real e2e sources', () => {
  it('tag no screen-dependent test as viewport-agnostic', () => {
    const violations = checkE2eDirectory(join(root, 'e2e')).map((violation) =>
      describeViolation(violation, root),
    );
    assert.deepEqual(violations, []);
  });
});

/**
 * `playwright test --list` as JSON, one entry per test: `{ title, tags, projects }`. Playwright
 * lists a test once for each project that runs it, so the entries are merged by file, line, and
 * title.
 */
function listTests(env = {}) {
  const run = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules', '@playwright', 'test', 'cli.js'),
      'test',
      '--list',
      '--reporter=json',
    ],
    { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(run.status, 0, run.stderr);
  const tests = new Map();
  const visit = (suite, titles) => {
    for (const spec of suite.specs ?? []) {
      const title = [...titles, spec.title].join(' > ');
      const key = `${spec.file}:${spec.line}:${title}`;
      const entry = tests.get(key) ?? {
        title,
        tags: spec.tags ?? [],
        projects: [],
      };
      entry.projects.push(...spec.tests.map((test) => test.projectName));
      tests.set(key, entry);
    }
    for (const child of suite.suites ?? []) {
      visit(child, child.title === suite.file ? titles : [...titles, child.title]);
    }
  };
  for (const suite of JSON.parse(run.stdout).suites) visit(suite, [suite.title]);
  return [...tests.values()];
}

describe('the Playwright projects', () => {
  const withoutWebkit = listTests({ E2E_WEBKIT: '0' });
  const withWebkit = listTests({ E2E_WEBKIT: '1' });

  it('run every viewport-agnostic test in chromium-desktop and not in chromium-mobile', () => {
    const tagged = withoutWebkit.filter((spec) => spec.tags.includes('viewport-agnostic'));
    assert.ok(tagged.length > 0, 'no test is tagged viewport-agnostic');
    for (const spec of tagged) {
      assert.deepEqual(spec.projects, ['chromium-desktop'], spec.title);
    }
  });

  it('also run viewport-agnostic tests in webkit-mobile on a WebKit run', () => {
    const tagged = withWebkit.filter((spec) => spec.tags.includes('viewport-agnostic'));
    for (const spec of tagged) {
      assert.deepEqual(spec.projects, ['chromium-desktop', 'webkit-mobile'], spec.title);
    }
  });

  it('run every raw-HTTP test in chromium-desktop only', () => {
    for (const specs of [withoutWebkit, withWebkit]) {
      const raw = specs.filter((spec) => spec.tags.includes('raw-http'));
      assert.ok(raw.length > 0, 'no test is tagged raw-http');
      for (const spec of raw) assert.deepEqual(spec.projects, ['chromium-desktop'], spec.title);
    }
  });

  it('run every untagged test in both Chromium projects', () => {
    const untagged = withoutWebkit.filter(
      (spec) => !spec.tags.includes('viewport-agnostic') && !spec.tags.includes('raw-http'),
    );
    assert.ok(untagged.length > 0);
    for (const spec of untagged) {
      assert.deepEqual(spec.projects, ['chromium-mobile', 'chromium-desktop'], spec.title);
    }
  });
});
