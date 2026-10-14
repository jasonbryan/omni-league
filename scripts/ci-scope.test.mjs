import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  APP_TEST_INPUTS,
  TOOLING_TEST_INPUTS,
  classify,
  deriveAppScripts,
  formatOutputs,
} from './ci-scope.mjs';

const script = join(import.meta.dirname, 'ci-scope.mjs');
const pr = { event: 'pull_request', base: 'main' };
const repoRoot = join(import.meta.dirname, '..');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'ci-scope-')));
after(() => rmSync(scratch, { recursive: true, force: true }));

/** @param {Record<string, string>} files */
function fakeRepo(files) {
  const root = mkdtempSync(join(scratch, 'repo-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** @param {string} root */
function deriveWithoutClassifier(root) {
  const derived = deriveAppScripts(root);
  derived.delete('scripts/ci-scope.mjs');
  derived.delete('scripts/e2e-affected.mjs');
  return derived;
}

describe('classify: PR into main', () => {
  const docsOnly = [
    ['docs/process/ci.md'],
    ['design/mockups/12-roster.html'],
    ['.claude/agents/designer.md', '.claude/skills/dev-cycle/SKILL.md'],
    ['README.md', 'AGENTS.md'],
    ['docs/a.md', 'README.md', 'design/x.css'],
  ];
  for (const files of docsOnly) {
    it(`is docs for ${files.join(', ')}`, () => {
      assert.deepEqual(classify(files, pr), { scope: 'docs', typecheck: false });
    });
  }

  const tooling = [
    ['scripts/ci-scope.test.mjs'],
    ['scripts/fixtures/icons.json'],
    ['.github/workflows/clean-previews.yml'],
    ['.github/dependabot.yml', 'docs/process/ci.md'],
    ['design/icons/any.svg'],
    ['design/mockup-kit/mockup-kit.css'],
    ['design/mockups/80-app-icon.html'],
    ['.claude/helper.mjs'],
    ['docs/tool.js'],
  ];
  for (const files of tooling) {
    it(`is tooling without typecheck for ${files.join(', ')}`, () => {
      assert.deepEqual(classify(files, pr), { scope: 'tooling', typecheck: false });
    });
  }

  it('is tooling with typecheck when a TypeScript file changes', () => {
    assert.deepEqual(classify(['.claude/helper.ts'], pr), { scope: 'tooling', typecheck: true });
    assert.deepEqual(classify(['scripts/x.mts', 'docs/a.md'], pr), {
      scope: 'tooling',
      typecheck: true,
    });
  });

  const app = [
    ['src/app/app.ts'],
    ['src/styles/tokens.css'],
    ['src/notes.md'],
    ['convex/schema.ts'],
    ['e2e/home.spec.ts'],
    ['package.json'],
    ['package-lock.json'],
    ['angular.json'],
    ['netlify.toml'],
    ['ngsw-config.json'],
    ['public/favicon.ico'],
    ['tsconfig.json'],
    ['tsconfig.app.json'],
    ['eslint.config.mjs'],
    ['.npmrc'],
    ['docs/a.md', 'src/app/app.ts'],
    ['scripts/ci-scope.mjs', 'convex/auth.ts'],
    // The CI files: the full suite runs, because the PR's own copy of the classifier decides its scope.
    ['.github/workflows/ci.yml'],
    ['scripts/ci-scope.mjs'],
    ['scripts/e2e-affected.mjs'],
    ['scripts/ci-scope.mjs', 'scripts/ci-scope.test.mjs'],
    ['docs/a.md', '.github/workflows/ci.yml'],
    ['docs/glossary.md'],
    ['docs/process/hosting.md'],
  ];
  for (const files of app) {
    it(`is app for ${files.join(', ')}`, () => {
      assert.deepEqual(classify(files, pr), { scope: 'app', typecheck: true });
    });
  }

  it('is app for a path git quotes (non-ASCII), a path outside every list, or an odd path', () => {
    assert.equal(classify(['"docs/caf\\303\\251.md"'], pr).scope, 'app');
    assert.equal(classify(['unknown/file.txt'], pr).scope, 'app');
    assert.equal(classify(['docs/../src/app/app.ts'], pr).scope, 'app');
    assert.equal(classify(['/docs/a.md'], pr).scope, 'app');
  });

  it('is app for an empty or missing file list (detection failed)', () => {
    assert.equal(classify([], pr).scope, 'app');
    assert.equal(classify([''], pr).scope, 'app');
    assert.equal(classify(undefined, pr).scope, 'app');
  });
});

describe('classify: event and base', () => {
  it('is app on workflow_dispatch and push, whatever changed', () => {
    for (const event of ['workflow_dispatch', 'push', '', undefined]) {
      assert.equal(classify(['docs/a.md'], { event, base: 'main' }).scope, 'app', String(event));
    }
  });

  it('is app on a release PR into production', () => {
    const release = { event: 'pull_request', base: 'production' };
    assert.equal(classify(['docs/a.md'], release).scope, 'app');
  });
});

describe('formatOutputs', () => {
  it('writes GITHUB_OUTPUT lines for each scope', () => {
    assert.equal(
      formatOutputs({ scope: 'docs', typecheck: false }),
      'scope=docs\napp=false\nchecks=false\ntypecheck=false\n',
    );
    assert.equal(
      formatOutputs({ scope: 'tooling', typecheck: false }),
      'scope=tooling\napp=false\nchecks=true\ntypecheck=false\n',
    );
    assert.equal(
      formatOutputs({ scope: 'app', typecheck: true }),
      'scope=app\napp=true\nchecks=true\ntypecheck=true\n',
    );
  });
});

describe('command line', () => {
  /**
   * @param {string} stdin
   * @param {Record<string, string>} env
   */
  function run(stdin, env) {
    return spawnSync(process.execPath, [script], {
      input: stdin,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', ...env },
    });
  }

  it('reads changed paths from stdin and prints the outputs', () => {
    const result = run('docs/a.md\nscripts/x.mjs\n', {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_BASE_REF: 'main',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'scope=tooling\napp=false\nchecks=true\ntypecheck=false\n');
  });

  it('prints app outputs for empty input', () => {
    const result = run('', { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'scope=app\napp=true\nchecks=true\ntypecheck=true\n');
  });

  it('prints app outputs when the event variables are unset', () => {
    const result = run('docs/a.md\n', {});
    assert.equal(result.stdout, 'scope=app\napp=true\nchecks=true\ntypecheck=true\n');
  });
});

describe('scripts the build, e2e, or deploy run are app', () => {
  const runByBuild = [
    'scripts/ng-convex.mjs',
    'scripts/edge-bundle.mjs',
    'scripts/sw-config-check.mjs',
    'scripts/e2e-convex.mjs',
    'scripts/e2e.mjs',
    'scripts/serve-ssr.mjs',
    'scripts/build-icons.mjs',
    'scripts/check-deploy-env.mjs',
  ];

  it('derives every build, e2e, and deploy script from this repository', () => {
    const derived = deriveAppScripts(repoRoot);
    for (const script of runByBuild) assert.ok(derived.has(script), script);
  });

  it('includes what the derived scripts import (noindex.mjs, png.mjs)', () => {
    const derived = deriveAppScripts(repoRoot);
    assert.ok(derived.has('scripts/noindex.mjs'));
    assert.ok(derived.has('scripts/png.mjs'));
  });

  it('leaves tests, fixtures, and CI-only helpers as tooling', () => {
    const derived = deriveAppScripts(repoRoot);
    assert.ok(!derived.has('scripts/setup-github.sh'));
    assert.ok([...derived].every((script) => !script.endsWith('.test.mjs')));
  });

  it('classifies a change to each derived script as app, and to its test as tooling', () => {
    const appScripts = deriveAppScripts(repoRoot);
    for (const script of runByBuild) {
      assert.deepEqual(
        classify([script], { ...pr, appScripts }),
        { scope: 'app', typecheck: true },
        script,
      );
      const test = script.replace(/\.mjs$/, '.test.mjs');
      assert.equal(classify([test], { ...pr, appScripts }).scope, 'tooling', test);
    }
  });

  it('classifies a script that nothing runs as tooling', () => {
    const appScripts = deriveAppScripts(repoRoot);
    assert.equal(classify(['scripts/setup-github.sh'], { ...pr, appScripts }).scope, 'tooling');
    assert.equal(classify(['scripts/token-contrast.mjs'], { ...pr, appScripts }).scope, 'tooling');
  });

  it('finds scripts named in package.json, netlify.toml, angular.json, playwright.config.ts, and e2e/', () => {
    const root = fakeRepo({
      'package.json': '{"scripts":{"a":"node scripts/from-package.mjs --x"}}',
      'netlify.toml': 'command = "npm ci && node scripts/from-netlify.mjs preview"',
      'angular.json': '{"x":"scripts/from-angular.mjs"}',
      'playwright.config.ts': "const c = 'node scripts/from-playwright.mjs serve';",
      'e2e/support/helper.ts':
        "// runs scripts/from-e2e.mjs\nconst p = join(root, 'scripts', 'joined.mjs');",
      'scripts/from-package.mjs': '',
      'scripts/from-netlify.mjs': '',
      'scripts/from-angular.mjs': '',
      'scripts/from-playwright.mjs': '',
      'scripts/from-e2e.mjs': '',
      'scripts/joined.mjs': '',
      'scripts/unrelated.mjs': '',
    });
    assert.deepEqual([...deriveWithoutClassifier(root)].sort(), [
      'scripts/from-angular.mjs',
      'scripts/from-e2e.mjs',
      'scripts/from-netlify.mjs',
      'scripts/from-package.mjs',
      'scripts/from-playwright.mjs',
      'scripts/joined.mjs',
    ]);
  });

  it('follows relative imports and spawned scripts transitively, and ignores tests', () => {
    const root = fakeRepo({
      'package.json':
        '{"scripts":{"a":"node scripts/top.mjs && node scripts/gone.mjs && node scripts/x.test.mjs"}}',
      'netlify.toml': '',
      'angular.json': '{}',
      'playwright.config.ts': '',
      'e2e/a.spec.ts': '',
      'scripts/top.mjs':
        "import { a } from './mid.mjs';\nconst b = await import('./lib/deep.mjs');\nconst c = 'scripts/spawned.mjs';",
      'scripts/mid.mjs':
        "import data from './data.json' with { type: 'json' };\nimport x from '../src/other.ts';",
      'scripts/data.json': '{}',
      'scripts/lib/deep.mjs': '',
      'scripts/spawned.mjs': '',
      'scripts/x.test.mjs': '',
      'scripts/untouched.mjs': '',
      'src/other.ts': '',
    });
    assert.deepEqual([...deriveWithoutClassifier(root)].sort(), [
      'scripts/data.json',
      'scripts/gone.mjs',
      'scripts/lib/deep.mjs',
      'scripts/mid.mjs',
      'scripts/spawned.mjs',
      'scripts/top.mjs',
    ]);
  });

  it('counts a referenced script as app whether or not it exists, so deleting one is an app change', () => {
    const root = fakeRepo({
      'package.json': '{"scripts":{"a":"node scripts/kept.mjs && node scripts/deleted.mjs"}}',
      'netlify.toml': '',
      'angular.json': '{}',
      'playwright.config.ts': '',
      'e2e/a.spec.ts': '',
      'scripts/kept.mjs':
        "import { x } from './deleted-import.mjs';\nimport { y } from '../scripts/deleted-up.mjs';",
    });
    const appScripts = deriveWithoutClassifier(root);
    for (const gone of ['deleted', 'deleted-import', 'deleted-up']) {
      const path = `scripts/${gone}.mjs`;
      assert.ok(appScripts.has(path), path);
      assert.deepEqual(classify([path], { ...pr, appScripts }), { scope: 'app', typecheck: true });
    }
    assert.equal(classify(['scripts/other.mjs'], { ...pr, appScripts }).scope, 'tooling');
  });

  it('derives ./scripts/x.mjs from a reference file', () => {
    const root = fakeRepo({
      'package.json': '{"scripts":{"build":"node ./scripts/dot.mjs"}}',
      'netlify.toml': '',
      'angular.json': '{}',
      'playwright.config.ts': '',
      'e2e/a.spec.ts': '',
    });
    assert.deepEqual([...deriveWithoutClassifier(root)], ['scripts/dot.mjs']);
  });

  it('derives ../scripts/x.mjs and ../../scripts/x.mjs from a reference file', () => {
    const root = fakeRepo({
      'package.json': '{}',
      'netlify.toml': '',
      'angular.json': '{}',
      'playwright.config.ts': "const p = resolve(dir, '../scripts/up.mjs');",
      'e2e/a.spec.ts': "const q = join(here, '../../scripts/up2.mjs');",
    });
    assert.deepEqual([...deriveWithoutClassifier(root)].sort(), [
      'scripts/up.mjs',
      'scripts/up2.mjs',
    ]);
  });

  it('does not derive a scripts directory that sits under another path', () => {
    const root = fakeRepo({
      'package.json': '{"scripts":{"a":"node scripts/real.mjs"}}',
      'netlify.toml': 'x = "src/scripts/nested.mjs"',
      'angular.json': '{}',
      'playwright.config.ts': "const q = 'node_modules/pkg/scripts/other.mjs';",
      'e2e/a.spec.ts': '',
    });
    assert.deepEqual([...deriveWithoutClassifier(root)], ['scripts/real.mjs']);
  });

  it('throws when a reference file is missing or names no script, so the caller falls back to app', () => {
    assert.throws(() => deriveAppScripts(fakeRepo({})));
    const noScripts = fakeRepo({
      'package.json': '{}',
      'netlify.toml': '',
      'angular.json': '{}',
      'playwright.config.ts': '',
      'e2e/a.spec.ts': '',
    });
    assert.throws(() => deriveAppScripts(noScripts));
  });

  it('keeps the fail-safe paths app even for a derived-free docs change', () => {
    const appScripts = deriveAppScripts(repoRoot);
    assert.equal(classify(['docs/a.md'], { event: 'workflow_dispatch', appScripts }).scope, 'app');
    assert.equal(classify(['docs/a.md'], { event: 'push', base: 'main', appScripts }).scope, 'app');
    assert.equal(classify([], { ...pr, appScripts }).scope, 'app');
    assert.equal(classify(['"scripts/caf\\303\\251.mjs"'], { ...pr, appScripts }).scope, 'app');
  });
});

describe('files a test reads are not docs', () => {
  it('lists every docs file that a Convex test reads as app', () => {
    const convexTests = readdirSync(join(repoRoot, 'convex'), { recursive: true })
      .filter((path) => /\.test\.[cm]?ts$/.test(String(path)))
      .map((path) => readFileSync(join(repoRoot, 'convex', String(path)), 'utf8'));
    const read = new Set(
      convexTests.flatMap((text) =>
        [...text.matchAll(/(?:\.\.\/)+((?:docs|design)\/[\w./-]+?\.[a-z]+)/g)].map((m) => m[1]),
      ),
    );
    assert.ok(read.size > 0, 'no Convex test reads a docs file; update APP_TEST_INPUTS');
    for (const file of read) {
      assert.ok(APP_TEST_INPUTS.includes(file), `${file} is read by a Convex test`);
    }
  });

  it('classifies each file that test:convex reads as app and each that test:scripts reads as tooling', () => {
    for (const file of APP_TEST_INPUTS) {
      assert.equal(classify([file], pr).scope, 'app', file);
    }
    assert.equal(classify(['docs/process/ci.md'], pr).scope, 'docs');
    for (const input of TOOLING_TEST_INPUTS) {
      const file = input.endsWith('/') ? `${input}x` : input;
      assert.equal(classify([file], pr).scope, 'tooling', file);
    }
  });

  it('keeps the files build-icons reads in the tooling list', () => {
    const source = readFileSync(join(repoRoot, 'scripts', 'build-icons.mjs'), 'utf8');
    const read = [...source.matchAll(/'(design\/[\w./-]+)'/g)].map((m) => m[1]);
    assert.ok(read.length >= 5);
    for (const file of read) {
      assert.equal(classify([file], pr).scope, 'tooling', file);
    }
  });
});

describe('command line: derived scripts', () => {
  const env = {
    PATH: process.env.PATH ?? '',
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_BASE_REF: 'main',
  };
  const app = 'scope=app\napp=true\nchecks=true\ntypecheck=true\n';

  it('gives app for a change to scripts/ng-convex.mjs and tooling for scripts/token-contrast.mjs', () => {
    const run = (stdin) =>
      spawnSync(process.execPath, [script], { input: stdin, encoding: 'utf8', env }).stdout;
    assert.equal(run('scripts/ng-convex.mjs\n'), app);
    assert.equal(run('scripts/e2e.mjs\nscripts/serve-ssr.mjs\n'), app);
    assert.equal(run('scripts/ci-scope.mjs\n'), app);
    assert.equal(run('.github/workflows/ci.yml\n'), app);
    assert.equal(
      run('scripts/token-contrast.mjs\n'),
      'scope=tooling\napp=false\nchecks=true\ntypecheck=false\n',
    );
  });

  it('gives app when the script list cannot be derived (no package.json beside the script)', () => {
    const root = fakeRepo({});
    mkdirSync(join(root, 'scripts'));
    copyFileSync(script, join(root, 'scripts', 'ci-scope.mjs'));
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'ci-scope.mjs')], {
      input: 'docs/a.md\n',
      encoding: 'utf8',
      env,
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, app);
    assert.match(result.stderr, /ci-scope:/);
  });
});
