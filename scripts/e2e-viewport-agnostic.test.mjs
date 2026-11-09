import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { checkE2eDirectory, describeViolation, findViolations } from './e2e-viewport-agnostic.mjs';

const root = join(import.meta.dirname, '..');

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
      ['boundingBox', 'const box = await field.boundingBox();'],
      ['toBeInViewport', 'await expect(field).toBeInViewport();'],
      ['activeElement', 'const id = await page.evaluate(() => document.activeElement?.id);'],
      ["'Tab'", "await page.keyboard.press('Tab');"],
      ["'Shift+Tab'", "await page.keyboard.press('Shift+Tab');"],
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

  it('flags a screen-dependent call in a hook that runs around a tagged test', () => {
    const outer = check(`
      test.describe('group', () => {
        test.beforeEach(async ({ page }) => { await expectAccessible(page); });
        test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await page.goto('/'); });
      });`);
    assert.deepEqual(names(outer), ['expectAccessible']);
    assert.ok(outer[0].hook);
    assert.match(describeViolation(outer[0], root), /in a hook that runs around it/);

    const fileLevel = check(`
      test.afterEach(async ({ page }) => { await page.keyboard.press('Tab'); });
      test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await page.goto('/'); });`);
    assert.deepEqual(names(fileLevel), ["'Tab'"]);
  });

  it('ignores a hook of a sibling describe or of an untagged test', () => {
    assert.deepEqual(
      check(`
        test.describe('other', () => {
          test.beforeEach(async ({ page }) => { await expectAccessible(page); });
          test('u', async ({ page }) => { await page.goto('/'); });
        });
        test.describe('group', () => {
          test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await page.goto('/'); });
        });`),
      [],
    );
  });

  it('flags a call through an import alias or an object-method helper', () => {
    const aliased = check(`
      import { expectAccessible as a11y } from './support/a11y';
      test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await a11y(page); });`);
    assert.deepEqual(names(aliased), ['expectAccessible']);

    const method = check(`
      const helpers = { async scan(page) { await axeScan(page); } };
      test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await helpers.scan(page); });`);
    assert.deepEqual(names(method), ['scan']);
  });

  it('reads a tag passed through a variable, an alias, or the title', () => {
    const body = 'async ({ page }) => { await expectAccessible(page); }';
    for (const source of [
      `const tag = VIEWPORT_AGNOSTIC;\ntest('t', tag, ${body});`,
      `const tag = { ...VIEWPORT_AGNOSTIC };\nconst again = tag;\ntest('t', again, ${body});`,
      `import { VIEWPORT_AGNOSTIC as AGNOSTIC } from './support/viewport-agnostic';\ntest('t', AGNOSTIC, ${body});`,
      `test('t @viewport-agnostic', ${body});`,
      `test('t', { tag: '@viewport-agnostic' }, ${body});`,
    ]) {
      assert.deepEqual(names(check(source)), ['expectAccessible'], source);
    }
    assert.deepEqual(
      check(
        `const tag = { tag: '@other' };\ntest('t', tag, async ({ page }) => { await expectAccessible(page); });`,
      ),
      [],
    );
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

  it('resolves a helper only within its own file or through an import', () => {
    const unexportedElsewhere = check(
      `test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await scan(page); });`,
      `async function scan(page) { await axeScan(page); }`,
    );
    assert.deepEqual(unexportedElsewhere, []);

    const localShadowsElsewhere = check(
      `import { settle } from './support/helper-0';
       test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await settle(page); });`,
      `export async function settle(page) { await open(page); }`,
      `async function open(page) { await page.screenshot(); }`,
    );
    assert.deepEqual(localShadowsElsewhere, []);

    const sameNameExportedElsewhere = check(
      `import { settle } from './support/helper-0';
       test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await settle(page); });`,
      `export async function settle(page) { await page.goto('/'); }`,
      `export async function settle(page) { await checkReflow(page); }`,
    );
    assert.deepEqual(sameNameExportedElsewhere, []);

    const ownFileWins = check(
      `async function open(page) { await page.goto('/'); }
       test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await open(page); });`,
      `export async function open(page) { await checkReflow(page); }`,
    );
    assert.deepEqual(ownFileWins, []);
  });

  it('follows a re-export, an export list, and an aliased import to the helper', () => {
    const reexported = check(
      `import { reflowOf } from './support/helper-0';
       test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await reflowOf(page); });`,
      `export { reflowOf } from './helper-1';`,
      `export async function reflowOf(page) { await checkReflow(page); }`,
    );
    assert.deepEqual(names(reexported), ['reflowOf']);

    const listed = check(
      `import { settle as wait } from './support/helper-0';
       test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await wait(page); });`,
      `async function inner(page) { await axeScan(page); }
       export { inner as settle };`,
    );
    assert.deepEqual(names(listed), ['settle']);
  });

  it('finds a method only on an object the file can reach through its imports', () => {
    const reachable = check(
      `import { app } from './support/helper-0';
       test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await app.scan(page); });`,
      `export const app = { async scan(page) { await axeScan(page); } };`,
    );
    assert.deepEqual(names(reachable), ['scan']);

    const unreachable = check(
      `test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await app.scan(page); });`,
      `export const app = { async scan(page) { await axeScan(page); } };`,
    );
    assert.deepEqual(unreachable, []);
  });

  it('counts a helper that is called or passed to a call, and not a name that is only mentioned', () => {
    const called = check(`
      async function scan(page) { await axeScan(page); }
      test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await expect.poll(scan).toBe(1); });`);
    assert.deepEqual(names(called), ['scan']);

    const mentioned = check(`
      async function scan(page) { await axeScan(page); }
      async function settle() { const scan = 1; return scan + 1; }
      test('t', VIEWPORT_AGNOSTIC, async ({ page }) => {
        const label = { scan: 1 };
        await settle();
        log(label.scan);
      });`);
    assert.deepEqual(mentioned, []);
  });

  it('finds a method that the test destructures from an imported object', () => {
    const violations = check(
      `import { press } from './support/helper-0';
       test('t', VIEWPORT_AGNOSTIC, async ({ page }) => {
         const { expectDone } = press;
         await expectDone(page);
       });`,
      `export const press = { async expectDone(page) { await expect(page).toBeFocused(); } };`,
    );
    assert.deepEqual(names(violations), ['expectDone']);
  });

  it('resolves a call on a namespace import to the exports of that file', () => {
    const violations = check(
      `import * as h from './support/helper-0';
       test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await h.scan(page); });`,
      `export async function scan(page) { await axeScan(page); }`,
    );
    assert.deepEqual(names(violations), ['scan']);

    const other = check(
      `import * as h from './support/helper-0';
       test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await h.scan(page); });`,
      `export async function scan(page) { await page.goto('/'); }`,
      `export async function scan(page) { await axeScan(page); }`,
    );
    assert.deepEqual(other, []);
  });

  it('counts a fixture the test destructures from its first parameter', () => {
    const fixtures = `export const fixtures = {
      shots: async ({ page }, use) => { await page.setViewportSize({ width: 320, height: 800 }); await use(); },
    };`;
    const tagged = check(
      `import { fixtures } from './support/helper-0';
       test('t', VIEWPORT_AGNOSTIC, async ({ shots }) => { await shots.take(); });`,
      fixtures,
    );
    assert.deepEqual(names(tagged), ['shots']);

    const renamed = check(
      `import { fixtures } from './support/helper-0';
       test('t', VIEWPORT_AGNOSTIC, async ({ shots: taken }) => { await taken.take(); });`,
      fixtures,
    );
    assert.deepEqual(names(renamed), ['shots']);

    const unused = check(
      `import { fixtures } from './support/helper-0';
       test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await page.goto('/'); });`,
      fixtures,
    );
    assert.deepEqual(unused, []);
  });

  it('counts a fixture that a test or hook inside a tagged describe destructures', () => {
    const fixtures = `export const fixtures = {
      shots: async ({ page }, use) => { await page.setViewportSize({ width: 320, height: 800 }); await use(); },
    };`;
    const importFixtures = `import { fixtures } from './support/helper-0';\n`;
    const inTest = check(
      `${importFixtures}test.describe('d', VIEWPORT_AGNOSTIC, () => {
         test('t', async ({ shots }) => { await shots.take(); });
       });`,
      fixtures,
    );
    assert.deepEqual(names(inTest), ['shots']);

    const inHook = check(
      `${importFixtures}test.describe('d', VIEWPORT_AGNOSTIC, () => {
         test.beforeEach(async ({ shots }) => { await shots.take(); });
         test('t', async ({ page }) => { await page.goto('/'); });
       });`,
      fixtures,
    );
    assert.deepEqual(names(inHook), ['shots']);

    const inStep = check(
      `${importFixtures}test.describe('d', VIEWPORT_AGNOSTIC, () => {
         test('t', async ({ shots }) => { await test.step('s', async () => { await shots.take(); }); });
       });`,
      fixtures,
    );
    assert.deepEqual(names(inStep), ['shots']);
  });

  it('counts a fixture that another fixture destructures', () => {
    const violations = check(
      `import { fixtures } from './support/helper-0';
       test('t', VIEWPORT_AGNOSTIC, async ({ outer }) => { await outer.go(); });`,
      `export const fixtures = {
         inner: async ({ page }, use) => { await page.setViewportSize({ width: 1, height: 1 }); await use(); },
         outer: async ({ inner }, use) => { await use(); },
       };`,
    );
    assert.deepEqual(names(violations), ['outer']);
  });

  it('reaches a method and a fixture through a re-export file', () => {
    const exported = `export const app = {
      async scan(page) { await axeScan(page); },
      shots: async ({ page }, use) => { await page.setViewportSize({ width: 1, height: 1 }); await use(); },
    };`;
    const method = check(
      `import { app } from './support/helper-0';
       test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await app.scan(page); });`,
      `export { app } from './helper-1';`,
      exported,
    );
    assert.deepEqual(names(method), ['scan']);

    const fixture = check(
      `import { test } from './support/helper-0';
       test('t', VIEWPORT_AGNOSTIC, async ({ shots }) => { await shots.take(); });`,
      `export * from './helper-1';`,
      exported,
    );
    assert.deepEqual(names(fixture), ['shots']);
  });

  it('follows a chain of re-exports to a helper and to a method', () => {
    const spec = `import { reflowOf, app } from './support/helper-0';
       test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await reflowOf(page); await app.scan(page); });`;
    const violations = check(
      spec,
      `export { reflowOf, app } from './helper-1';`,
      `export * from './helper-2';`,
      `export async function reflowOf(page) { await checkReflow(page); }
       export const app = { async scan(page) { await axeScan(page); } };`,
    );
    assert.deepEqual(names(violations), ['reflowOf', 'scan']);
  });

  it('keeps an imported helper in view when a same-named function is declared locally', () => {
    const violations = check(
      `import { open } from './support/helper-0';
       test('other', async () => { async function open() {} await open(); });
       test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await open(page); });`,
      `export async function open(page) { await page.setViewportSize({ width: 1, height: 1 }); }`,
    );
    assert.deepEqual(names(violations), ['open']);
  });

  it('follows a default export given as `export default name`', () => {
    const violations = check(
      `import scan from './support/helper-0';
       test('t', VIEWPORT_AGNOSTIC, async ({ page }) => { await scan(page); });`,
      `async function scan(page) { await axeScan(page); }
       export default scan;`,
    );
    assert.deepEqual(names(violations), ['scan']);
  });

  it('keeps an import alias to its own file', () => {
    const violations = check(
      `async function open() {}
       test('t', VIEWPORT_AGNOSTIC, async () => { await open(); });`,
      `import { screenshot as open } from './shots';`,
    );
    assert.deepEqual(violations, []);
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

// Playwright lists a test once for each project that runs it, so the entries are merged by file,
// line, and title.
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
