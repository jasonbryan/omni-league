// Checks of the step order and conditions in the `ci` workflow file (#116). Run with
// `npm run test:scripts` (node:test). Node built-ins only: the step names and `if:` lines are read
// with regular expressions, not a YAML parser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const workflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml'),
  'utf8',
);

/** The `ci` job's steps in file order: the `- name:` and the `if:` condition of each. */
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
    assert.ok(names.includes('e2e backend'), names.join(', '));
  });

  it('runs test:scripts after e2e browsers and before e2e backend', () => {
    const browsers = names.indexOf('e2e browsers');
    const scripts = names.indexOf('test:scripts');
    const backend = names.indexOf('e2e backend');
    assert.ok(browsers !== -1 && scripts !== -1 && backend !== -1, names.join(', '));
    assert.equal(scripts, browsers + 1, 'test:scripts directly follows e2e browsers');
    assert.equal(backend, scripts + 1, 'e2e backend directly follows test:scripts');
  });

  it('gives test:scripts the checks condition, not success()', () => {
    const step = ciSteps().find((candidate) => candidate.name === 'test:scripts');
    assert.equal(
      step?.condition,
      "${{ !cancelled() && steps.install.outcome == 'success' && steps.scope.outputs.checks == 'true' }}",
    );
  });

  it('runs the build-dependent steps only for app scope (#165)', () => {
    const appOnly = [
      'audit signatures',
      'test',
      'test:convex',
      'build',
      'e2e browsers',
      'e2e backend',
    ];
    for (const name of appOnly) {
      const step = ciSteps().find((candidate) => candidate.name === name);
      assert.match(step?.condition ?? '', /steps\.scope\.outputs\.app == 'true'/, name);
    }
  });

  it('runs lint, typecheck, and actionlint for every scope but docs (#165)', () => {
    const expected = { lint: 'checks', typecheck: 'typecheck', actionlint: 'checks' };
    for (const [name, output] of Object.entries(expected)) {
      const step = ciSteps().find((candidate) => candidate.name === name);
      const pattern = new RegExp(`steps\\.scope\\.outputs\\.${output} == 'true'`);
      assert.match(step?.condition ?? '', pattern, name);
    }
  });

  it('runs scope first, before release age and install (#165)', () => {
    const names = ciSteps().map((step) => step.name);
    assert.equal(names[0], 'scope');
    assert.ok(names.indexOf('release age') < names.indexOf('install'));
  });

  it('feeds scope from scripts/ci-scope.mjs and falls back to every check (#165)', () => {
    assert.match(workflow, /node scripts\/ci-scope\.mjs/);
    assert.match(workflow, /scope=app\\napp=true\\nchecks=true\\ntypecheck=true\\n/);
  });

  it('keeps success() on e2e browsers and e2e backend', () => {
    for (const name of ['e2e browsers', 'e2e backend']) {
      const step = ciSteps().find((candidate) => candidate.name === name);
      assert.equal(step?.condition, "${{ success() && steps.scope.outputs.app == 'true' }}", name);
    }
  });
});
