import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const workflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml'),
  'utf8',
);

function ciSteps() {
  const job = /^ {2}ci:\n([\s\S]*?)(?=^ {2}\S)/m.exec(workflow)?.[1] ?? '';
  const steps = [];
  for (const [, block] of job.matchAll(/^ {6}- ([\s\S]*?)(?=^ {6}- |(?![\s\S]))/gm)) {
    const name = /^name: (.+)$/m.exec(block)?.[1];
    const condition = /^ {8}if: (.+)$/m.exec(block)?.[1];
    if (name) steps.push({ name, condition });
  }
  return steps;
}

describe('ci workflow step order', () => {
  const names = ciSteps().map((step) => step.name);

  it('reads the steps of the ci job', () => {
    assert.ok(names.includes('format:check'), names.join(', '));
    assert.ok(names.includes('test:scripts'), names.join(', '));
  });

  it('runs no e2e step and has no schedule: the e2e suite runs in e2e.yml', () => {
    for (const name of names) assert.doesNotMatch(name, /e2e/, name);
    assert.doesNotMatch(workflow, /npm run e2e|e2e-convex|schedule:/);
  });

  it('runs test:scripts right after the chromium install, as the last step', () => {
    const chromium = names.indexOf('chromium');
    const scripts = names.indexOf('test:scripts');
    assert.ok(chromium !== -1 && scripts !== -1, names.join(', '));
    assert.equal(scripts, chromium + 1, 'test:scripts directly follows chromium');
    assert.equal(scripts, names.length - 1, 'test:scripts is the last step');
  });

  it('gives test:scripts the checks condition, not success()', () => {
    const step = ciSteps().find((candidate) => candidate.name === 'test:scripts');
    assert.equal(
      step?.condition,
      "${{ !cancelled() && steps.install.outcome == 'success' && steps.scope.outputs.checks == 'true' }}",
    );
  });

  it('runs the build-dependent steps only for app scope', () => {
    const appOnly = ['audit signatures', 'test', 'test:convex', 'build', 'chromium'];
    for (const name of appOnly) {
      const step = ciSteps().find((candidate) => candidate.name === name);
      assert.match(step?.condition ?? '', /steps\.scope\.outputs\.app == 'true'/, name);
    }
  });

  it('runs lint, typecheck, and actionlint for every scope but docs', () => {
    const expected = { lint: 'checks', typecheck: 'typecheck', actionlint: 'checks' };
    for (const [name, output] of Object.entries(expected)) {
      const step = ciSteps().find((candidate) => candidate.name === name);
      const pattern = new RegExp(`steps\\.scope\\.outputs\\.${output} == 'true'`);
      assert.match(step?.condition ?? '', pattern, name);
    }
  });

  it('runs scope first, before release age and install', () => {
    const names = ciSteps().map((step) => step.name);
    assert.equal(names[0], 'scope');
    assert.ok(names.indexOf('release age') < names.indexOf('install'));
  });

  it('feeds scope from scripts/ci-scope.mjs and falls back to every check', () => {
    assert.match(workflow, /node scripts\/ci-scope\.mjs/);
    assert.match(workflow, /scope=app\\napp=true\\nchecks=true\\ntypecheck=true\\n/);
  });

  it('keeps success() on the chromium install', () => {
    const step = ciSteps().find((candidate) => candidate.name === 'chromium');
    assert.equal(step?.condition, "${{ success() && steps.scope.outputs.app == 'true' }}");
  });

  it('skips the ci job for a push and a draft PR only', () => {
    assert.match(
      workflow,
      /^ {4}if: \$\{\{ github\.event_name != 'push' && !github\.event\.pull_request\.draft \}\}$/m,
    );
  });

  it('keeps warm-cache to pushes to main', () => {
    const job = /^ {2}warm-cache:\n([\s\S]*)/m.exec(workflow)?.[1] ?? '';
    assert.match(job, /^ {4}if: \$\{\{ github\.event_name == 'push' \}\}$/m);
  });
});

function scopeScript() {
  const block = /^ {6}- name: scope\n(?: {8}.*\n)*? {8}run: \|\n((?: {10}.*\n|\n)+)/m.exec(
    workflow,
  );
  assert.ok(block, 'scope step run script not found');
  return block[1].replace(/^ {10}/gm, '');
}

// A symlink to `scripts/` would not do for the classifier copy: it runs only when its path is its
// real path.
/** @param {(repo: string) => void} prepare */
function runScopeStep(prepare) {
  const repo = mkdtempSync(join(tmpdir(), 'ci-scope-step-'));
  try {
    const git = (...args) => {
      const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    };
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(join(repo, 'scripts'));
    mkdirSync(join(repo, 'e2e'));
    copyFileSync(join(import.meta.dirname, 'ci-scope.mjs'), join(repo, 'scripts', 'ci-scope.mjs'));
    writeFileSync(join(repo, 'package.json'), '{"scripts":{"build":"node scripts/build.mjs"}}');
    for (const name of ['netlify.toml', 'angular.json', 'playwright.config.ts']) {
      writeFileSync(join(repo, name), '');
    }
    prepare(repo);
    const output = join(repo, 'github-output');
    writeFileSync(output, '');
    const result = spawnSync('bash', ['-e', '-c', scopeScript()], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_BASE_REF: 'main',
      },
    });
    return { status: result.status, stdout: result.stdout, outputs: readFileSync(output, 'utf8') };
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

describe('the scope step', () => {
  const commit = (repo, message) => {
    for (const args of [
      ['add', 'docs'],
      ['commit', '-q', '-m', message],
    ]) {
      const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
  };
  const writeDoc = (repo, text) => {
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'docs', 'note.md'), text);
  };

  it('writes the classifier outputs without a warning when git diff succeeds', () => {
    const run = runScopeStep((repo) => {
      writeDoc(repo, 'one\n');
      commit(repo, 'base');
      writeDoc(repo, 'two\n');
      commit(repo, 'change');
    });
    assert.equal(run.status, 0);
    assert.equal(run.outputs, 'scope=docs\napp=false\nchecks=false\ntypecheck=false\n');
    assert.doesNotMatch(run.stdout, /::warning::/);
  });

  it('warns and runs every check when git diff fails (no parent commit)', () => {
    const run = runScopeStep((repo) => {
      writeDoc(repo, 'one\n');
      commit(repo, 'only');
    });
    assert.equal(run.status, 0);
    assert.match(run.stdout, /::warning::scope detection failed; running every check/);
    assert.equal(run.outputs, 'scope=app\napp=true\nchecks=true\ntypecheck=true\n');
  });
});
