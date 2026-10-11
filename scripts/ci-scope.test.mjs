// Unit tests for scripts/ci-scope.mjs (#165). Run with `npm run test:scripts` (node:test).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { classify, formatOutputs } from './ci-scope.mjs';

const script = join(import.meta.dirname, 'ci-scope.mjs');
const pr = { event: 'pull_request', base: 'main' };

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
    ['scripts/ci-scope.mjs', 'scripts/ci-scope.test.mjs'],
    ['scripts/fixtures/icons.json'],
    ['.github/workflows/ci.yml'],
    ['.github/dependabot.yml', 'docs/process/ci.md'],
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
