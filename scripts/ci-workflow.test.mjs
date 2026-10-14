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

function jobBlock(name) {
  const block = new RegExp(`^ {2}${name}:\\n([\\s\\S]*?)(?=^ {2}\\S|(?![\\s\\S]))`, 'm').exec(
    workflow,
  );
  assert.ok(block, `job ${name} not found`);
  return block[1];
}

function allSteps() {
  const steps = [];
  for (const [, block] of jobBlock('checks').matchAll(
    /^ {6}- ([\s\S]*?)(?=^ {6}- |(?![\s\S]))/gm,
  )) {
    const name = /^name: (.+)$/m.exec(block)?.[1];
    const id = /^(?: {8})?id: (.+)$/m.exec(block)?.[1];
    const condition = /^ {8}if: (.+)$/m.exec(block)?.[1];
    steps.push({ name: name ?? id, id, condition });
  }
  return steps;
}

function ciSteps() {
  return allSteps().filter((step) => step.name);
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

  it('runs the build-dependent steps only for app scope', () => {
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

  it('runs lint, typecheck, and actionlint for every scope but docs', () => {
    const expected = { lint: 'checks', typecheck: 'typecheck', actionlint: 'checks' };
    for (const [name, output] of Object.entries(expected)) {
      const step = ciSteps().find((candidate) => candidate.name === name);
      const pattern = new RegExp(`steps\\.scope\\.outputs\\.${output} == 'true'`);
      assert.match(step?.condition ?? '', pattern, name);
    }
  });

  it('checks the merge ref first, then scope, before release age and install', () => {
    const names = ciSteps().map((step) => step.name);
    assert.equal(names[0], 'merge ref');
    assert.equal(names[1], 'scope');
    assert.ok(names.indexOf('release age') < names.indexOf('install'));
  });

  it('feeds scope from scripts/ci-scope.mjs and falls back to every check', () => {
    assert.match(workflow, /node scripts\/ci-scope\.mjs/);
    assert.match(workflow, /scope=app\\napp=true\\nchecks=true\\ntypecheck=true\\n/);
  });

  it('keeps success() on e2e browsers and e2e backend', () => {
    const conditions = {
      'e2e browsers':
        "${{ success() && steps.scope.outputs.app == 'true' && env.FULL_RUN == '1' }}",
      'e2e backend': "${{ success() && steps.scope.outputs.app == 'true' }}",
    };
    for (const [name, expected] of Object.entries(conditions)) {
      const step = ciSteps().find((candidate) => candidate.name === name);
      assert.equal(step?.condition, expected, name);
    }
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

function lookup(context, path) {
  const walk = (value, segments) => {
    if (segments.length === 0) return value;
    if (value === undefined || value === null) return '';
    const [head, ...rest] = segments;
    if (head === '*') return value.map((item) => walk(item, rest));
    return walk(value[head], rest);
  };
  return walk(context, path.split('.')) ?? '';
}

function evaluateWorkflowExpression(expression, context) {
  const inner = /^\$\{\{\s*([\s\S]*?)\s*\}\}$/.exec(expression.trim())?.[1];
  assert.ok(inner !== undefined, `not one expression: ${expression}`);
  const functions = {
    cancelled: () => false,
    success: () => context.success ?? true,
    contains: (haystack, needle) => haystack.includes(needle),
    format: (template, ...values) => template.replace(/\{(\d+)\}/g, (_, i) => values[i]),
  };
  const source = inner.replace(
    /'((?:[^']|'')*)'|([A-Za-z_][\w-]*(?:\.(?:\*|[\w-]+))*)(\()?/g,
    (_match, text, path, call) => {
      if (text !== undefined) return JSON.stringify(text.replaceAll("''", "'"));
      if (call) {
        assert.ok(path in functions, `unknown function ${path}`);
        return `fn.${path}(`;
      }
      if (['true', 'false', 'null'].includes(path)) return path;
      return `get(${JSON.stringify(path)})`;
    },
  );
  return new Function('get', 'fn', `return (${source});`)(
    (path) => lookup(context, path),
    functions,
  );
}

const header = jobBlock('checks');
const jobName = /^ {4}name: (.+)$/m.exec(header)?.[1] ?? '';
const jobCondition = /^ {4}if: (.+)$/m.exec(header)?.[1] ?? '';
const fullRunEnv = /^ {6}FULL_RUN: (.+)$/m.exec(header)?.[1] ?? '';
const concurrencyGroup =
  /^concurrency:\n {2}group: (.+)\n {2}cancel-in-progress: true$/m.exec(workflow)?.[1] ?? '';

const PR = 7;
const RUN = 4242;

/**
 * @param {{ action: string, draft?: boolean, labels?: string[], label?: string, base?: string }} event
 * @param {{ skip?: string }} [gate]
 */
function pullRequestContext(
  { action, draft = false, labels = [], label, base = 'main' },
  gate = {},
) {
  return {
    github: {
      event_name: 'pull_request',
      run_id: RUN,
      base_ref: base,
      event: {
        action,
        label: label === undefined ? undefined : { name: label },
        pull_request: { number: PR, draft, labels: labels.map((name) => ({ name })) },
      },
    },
    needs: { 'nightly-gate': { outputs: { skip: gate.skip ?? '' } } },
  };
}

function otherContext(eventName, skip = '') {
  return {
    github: { event_name: eventName, run_id: RUN, event: {} },
    needs: { 'nightly-gate': { outputs: { skip } } },
  };
}

/** @param {object} context */
function decide(context) {
  return {
    runs: Boolean(evaluateWorkflowExpression(jobCondition, context)),
    name: evaluateWorkflowExpression(jobName, context),
    fullRun: evaluateWorkflowExpression(fullRunEnv, context),
    group: evaluateWorkflowExpression(concurrencyGroup, context),
  };
}

const FULL_PR = { runs: true, name: 'ci', fullRun: '1', group: `ci-${PR}` };
const FAST_PR = { runs: true, name: 'checks', fullRun: '0', group: `ci-${PR}` };
const SKIPPED_PR = { runs: false, name: 'checks', fullRun: '0', group: `ci-${PR}` };
const OTHER_LABEL = { runs: false, name: 'checks', fullRun: '0', group: `run-${RUN}` };

describe('the ci job by event', () => {
  const ready = { draft: false };
  const draft = { draft: true };
  const labeledReadyToMerge = {
    action: 'labeled',
    label: 'ready-to-merge',
    labels: ['ready-to-merge', 'type:chore'],
  };

  it('triggers on opened, reopened, synchronize, and labeled for PRs into main or production', () => {
    const on = /^on:\n([\s\S]*?)(?=^\S)/m.exec(workflow)?.[1] ?? '';
    const pullRequest = /^ {2}pull_request:\n((?: {4}.*\n)+)/m.exec(on)?.[1] ?? '';
    assert.match(pullRequest, /^ {4}types: \[opened, reopened, synchronize, labeled\]$/m);
    assert.match(pullRequest, /^ {4}branches: \[main, production\]$/m);
  });

  it('names the job id checks in the file, never ci', () => {
    assert.match(workflow, /^ {2}checks:\n/m);
    assert.doesNotMatch(workflow, /^ {2}ci:\n/m);
  });

  it('skips a push to a draft PR and names the skipped job checks', () => {
    for (const action of ['opened', 'reopened', 'synchronize']) {
      assert.deepEqual(decide(pullRequestContext({ action, ...draft })), SKIPPED_PR, action);
    }
  });

  it('runs the fast checks, named checks, for a push to a ready PR without a trigger label', () => {
    for (const action of ['opened', 'reopened', 'synchronize']) {
      const context = pullRequestContext({ action, ...ready, labels: ['type:chore'] });
      assert.deepEqual(decide(context), FAST_PR, action);
    }
  });

  it('runs the full ci when ready-to-merge is added, draft or ready', () => {
    for (const state of [draft, ready]) {
      assert.deepEqual(decide(pullRequestContext({ ...labeledReadyToMerge, ...state })), FULL_PR);
    }
  });

  it('runs the full ci again for a push while the label is on, update-branch included', () => {
    for (const state of [draft, ready]) {
      const context = pullRequestContext({
        action: 'synchronize',
        ...state,
        labels: ['ready-to-merge'],
      });
      assert.deepEqual(decide(context), FULL_PR);
    }
  });

  it('runs nothing and cancels nothing for another label, on its own concurrency group', () => {
    for (const labels of [['ready-to-merge', 'type:chore'], ['type:chore'], []]) {
      const context = pullRequestContext({
        action: 'labeled',
        ...ready,
        label: 'type:chore',
        labels,
      });
      assert.deepEqual(decide(context), OTHER_LABEL, labels.join());
    }
  });

  it('treats another label on a PR into production the same way', () => {
    const context = pullRequestContext({
      action: 'labeled',
      label: 'area:infra',
      labels: ['area:infra'],
      base: 'production',
    });
    assert.deepEqual(decide(context), OTHER_LABEL);
  });

  it('follows a removed label with a fast check, because unlabeled is not a trigger', () => {
    const on = /^on:\n([\s\S]*?)(?=^\S)/m.exec(workflow)?.[1] ?? '';
    assert.doesNotMatch(on, /unlabeled|ready_for_review/);
    assert.deepEqual(decide(pullRequestContext({ action: 'synchronize', ...ready })), FAST_PR);
  });

  it('runs ci for a gate label added after opened, and for pushes after it, draft or ready', () => {
    for (const gate of ['gate:technology', 'gate:production']) {
      for (const state of [draft, ready]) {
        for (const event of [
          { action: 'labeled', label: gate, labels: [gate] },
          { action: 'opened', labels: [gate] },
          { action: 'synchronize', labels: [gate] },
        ]) {
          assert.deepEqual(decide(pullRequestContext({ ...event, ...state })), FULL_PR, gate);
        }
      }
    }
  });

  it('runs ci on every push to a PR into production, draft or ready', () => {
    for (const state of [draft, ready]) {
      for (const action of ['opened', 'reopened', 'synchronize']) {
        const context = pullRequestContext({ action, ...state, base: 'production' });
        assert.deepEqual(decide(context), FULL_PR, action);
      }
    }
  });

  it('names a nightly and a dispatch run ci, and a gate-skipped nightly checks', () => {
    const full = { runs: true, name: 'ci', fullRun: '1', group: `ci-${RUN}` };
    assert.deepEqual(decide(otherContext('schedule')), full);
    assert.deepEqual(decide(otherContext('workflow_dispatch')), full);
    assert.deepEqual(decide(otherContext('schedule', 'true')), {
      runs: false,
      name: 'checks',
      fullRun: '0',
      group: `ci-${RUN}`,
    });
  });

  it('skips a push to main and names it checks, so no skipped ci exists', () => {
    assert.deepEqual(decide(otherContext('push')), {
      runs: false,
      name: 'checks',
      fullRun: '0',
      group: `ci-${RUN}`,
    });
  });

  it('agrees with an independent reading of the rules for every PR event shape', () => {
    const triggerLabels = ['ready-to-merge', 'gate:technology', 'gate:production'];
    const otherLabels = ['type:chore', 'area:infra'];
    const labelSets = [
      [],
      ['type:chore'],
      ['ready-to-merge'],
      ['ready-to-merge', 'type:chore'],
      ['gate:technology'],
      ['gate:production', 'area:infra'],
    ];
    const events = [];
    for (const isDraft of [true, false]) {
      for (const base of ['main', 'production']) {
        for (const labels of labelSets) {
          for (const action of ['opened', 'reopened', 'synchronize']) {
            events.push({ action, draft: isDraft, labels, base });
          }
          for (const label of [...triggerLabels, ...otherLabels]) {
            const added = [...new Set([...labels, label])];
            events.push({ action: 'labeled', draft: isDraft, labels: added, label, base });
          }
        }
      }
    }
    assert.ok(events.length > 150, String(events.length));
    for (const event of events) {
      const labeled = event.action === 'labeled';
      const full = labeled
        ? triggerLabels.includes(event.label)
        : event.labels.some((label) => triggerLabels.includes(label)) ||
          event.base === 'production';
      const expected = {
        runs: labeled ? full : full || !event.draft,
        name: full ? 'ci' : 'checks',
        fullRun: full ? '1' : '0',
        group: labeled && !full ? `run-${RUN}` : `ci-${PR}`,
      };
      assert.deepEqual(decide(pullRequestContext(event)), expected, JSON.stringify(event));
    }
  });
});

describe('the steps of a fast run and a full run', () => {
  /**
   * @param {object} context
   * @param {string} fullRun
   * @param {{ failing?: string, scope?: string }} [options]
   */
  function stepsRun(context, fullRun, { failing, scope = 'app' } = {}) {
    const state = { ...context, env: { FULL_RUN: fullRun }, steps: {}, success: true };
    const ran = [];
    for (const step of allSteps()) {
      const runs =
        step.condition === undefined
          ? state.success
          : evaluateWorkflowExpression(step.condition, state);
      const outcome = !runs
        ? 'skipped'
        : failing !== undefined && step.name === failing
          ? 'failure'
          : 'success';
      if (runs && step.name) ran.push(step.name);
      if (step.id !== undefined) {
        state.steps[step.id] = { outcome };
        if (step.id === 'scope' && runs) {
          const on = scope === 'app' ? 'true' : 'false';
          state.steps.scope.outputs = { app: on, checks: on, typecheck: on };
        }
      }
      if (outcome === 'failure') state.success = false;
    }
    return ran;
  }

  const e2eSteps = ['e2e specs', 'e2e browsers', 'e2e', 'e2e failures', 'e2e report'];
  const fastSteps = [
    'scope',
    'release age',
    'install',
    'format:check',
    'audit signatures',
    'lint',
    'typecheck',
    'test',
    'test:convex',
    'build',
    'actionlint',
    'test:scripts',
    'e2e backend',
    'convex codegen drift',
  ];
  const labelRun = pullRequestContext({
    action: 'labeled',
    label: 'ready-to-merge',
    labels: ['ready-to-merge'],
  });

  it('runs the fast steps and neither e2e browsers nor e2e in a fast run', () => {
    const ran = stepsRun(pullRequestContext({ action: 'synchronize' }), '0');
    for (const name of fastSteps) assert.ok(ran.includes(name), `${name} in ${ran.join(', ')}`);
    for (const name of e2eSteps) assert.ok(!ran.includes(name), `${name} in ${ran.join(', ')}`);
    assert.ok(!ran.includes('merge ref'), 'a fast run does not check the merge ref');
  });

  it('runs every step, the affected e2e specs included, in a full PR run', () => {
    const ran = stepsRun(labelRun, '1');
    const expected = ['merge ref', ...fastSteps, 'e2e specs', 'e2e browsers', 'e2e', 'e2e report'];
    for (const name of expected) assert.ok(ran.includes(name), `${name} in ${ran.join(', ')}`);
    assert.ok(!ran.includes('e2e failures'), 'the failures list is for a nightly failure only');
  });

  it('skips the merge-ref check on a nightly and a dispatch run', () => {
    for (const eventName of ['schedule', 'workflow_dispatch']) {
      const ran = stepsRun(otherContext(eventName), '1');
      assert.ok(!ran.includes('merge ref'), eventName);
      assert.ok(ran.includes('e2e'), eventName);
    }
  });

  it('keeps the test, build, and e2e steps off a docs-scope full run', () => {
    const ran = stepsRun(labelRun, '1', { scope: 'docs' });
    assert.deepEqual(
      ran.filter((name) => name.startsWith('e2e') || name === 'test' || name === 'build'),
      [],
    );
    assert.ok(ran.includes('format:check'));
  });

  it('stops after a stale merge ref: no install, no checks, no e2e', () => {
    assert.deepEqual(stepsRun(labelRun, '1', { failing: 'merge ref' }), ['merge ref']);
  });
});

describe('the merge ref step', () => {
  const stepRun = () => {
    const block = /^ {6}- name: merge ref\n(?: {8}.*\n)*? {8}run: \|\n((?: {10}.*\n|\n)+)/m.exec(
      workflow,
    );
    assert.ok(block, 'merge ref run script not found');
    return block[1].replace(/^ {10}/gm, '');
  };

  it('runs on a full pull_request run only, before anything else', () => {
    const step = ciSteps().find((candidate) => candidate.name === 'merge ref');
    assert.equal(
      step?.condition,
      "${{ github.event_name == 'pull_request' && env.FULL_RUN == '1' }}",
    );
    assert.equal(ciSteps()[0].name, 'merge ref');
  });

  it('reads the head from the event through env, not the script text', () => {
    assert.match(workflow, /PR_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
    assert.doesNotMatch(stepRun(), /\$\{\{/);
  });

  /** @param {(repo: string, git: (...args: string[]) => string) => string} prepare */
  function runMergeRef(prepare) {
    const repo = mkdtempSync(join(tmpdir(), 'ci-merge-ref-'));
    try {
      const git = (...args) => {
        const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
      };
      git('init', '-q', '-b', 'main');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'test');
      git('config', 'commit.gpgsign', 'false');
      const headSha = prepare(repo, git);
      const result = spawnSync('bash', ['-e', '-c', stepRun()], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, PR_HEAD_SHA: headSha },
      });
      return { status: result.status, output: result.stdout + result.stderr };
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  const commitFile = (repo, git, file, text) => {
    writeFileSync(join(repo, file), text);
    git('add', file);
    git('commit', '-q', '-m', `add ${file}`);
  };

  const mergeCommit = (repo, git) => {
    commitFile(repo, git, 'a', 'base\n');
    git('checkout', '-q', '-b', 'pr');
    commitFile(repo, git, 'b', 'pr\n');
    const head = git('rev-parse', 'HEAD');
    git('checkout', '-q', 'main');
    commitFile(repo, git, 'c', 'main\n');
    git('merge', '-q', '--no-ff', '-m', 'merge', 'pr');
    return head;
  };

  it('passes when the second parent of the merge commit is the PR head', () => {
    const run = runMergeRef(mergeCommit);
    assert.equal(run.status, 0, run.output);
    assert.doesNotMatch(run.output, /stale merge ref/);
  });

  it('fails with stale merge ref when the second parent is an older head', () => {
    const run = runMergeRef((repo, git) => {
      mergeCommit(repo, git);
      return '0123456789abcdef0123456789abcdef01234567';
    });
    assert.notEqual(run.status, 0);
    assert.match(run.output, /stale merge ref/);
  });

  it('fails with stale merge ref when the event gives no head and the commit is not a merge', () => {
    const run = runMergeRef((repo, git) => {
      commitFile(repo, git, 'a', 'only\n');
      return '';
    });
    assert.notEqual(run.status, 0);
    assert.match(run.output, /stale merge ref/);
  });

  it('fails with stale merge ref when the checked-out commit is not a merge commit', () => {
    const run = runMergeRef((repo, git) => {
      commitFile(repo, git, 'a', 'only\n');
      return git('rev-parse', 'HEAD');
    });
    assert.notEqual(run.status, 0);
    assert.match(run.output, /stale merge ref/);
  });
});
