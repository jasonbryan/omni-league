// Checks of .github/workflows/clean-previews.yml (#158). Run with `npm run test:scripts` (node:test).
// Node built-ins only: the file is read with regular expressions, not a YAML parser. The rules come
// from docs/process/ci.md (Workflow security) plus the owner's exception for CONVEX_TEAM_TOKEN.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const workflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'clean-previews.yml'),
  'utf8',
);
const code = workflow
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');

/** The steps of the `clean` job, each as its text block. */
function steps() {
  const job = /^ {2}clean:\n([\s\S]*?)(?![\s\S])/m.exec(code)?.[1] ?? '';
  return [...job.matchAll(/^ {6}- ([\s\S]*?)(?=^ {6}- |(?![\s\S]))/gm)].map((match) => match[1]);
}

describe('clean-previews workflow triggers', () => {
  it('runs on PR close, daily, and by hand', () => {
    assert.match(code, /^on:\n {2}pull_request:\n {4}types: \[closed\]$/m);
    assert.match(code, /^ {2}schedule:\n {4}- cron: '[^']+'$/m);
    assert.match(code, /^ {2}workflow_dispatch:/m);
  });

  it('never uses pull_request_target or workflow_run', () => {
    assert.ok(!/pull_request_target|workflow_run/.test(code));
  });

  it('has a concurrency group that does not cancel a running delete', () => {
    assert.match(code, /^concurrency:\n {2}group: clean-previews\n {2}cancel-in-progress: false$/m);
  });
});

describe('clean-previews workflow permissions', () => {
  it('is read-only at the top level and grants only contents and pull-requests read to the job', () => {
    assert.match(code, /^permissions:\n {2}contents: read\n\n/m);
    const job = /^ {2}clean:\n([\s\S]*)$/m.exec(code)?.[1] ?? '';
    const permissions = /^ {4}permissions:\n((?: {6}\S.*\n)+)/m.exec(job)?.[1];
    assert.equal(permissions, '      contents: read\n      pull-requests: read\n');
  });

  it('sets timeout-minutes on the job', () => {
    assert.match(code, /^ {4}timeout-minutes: \d+$/m);
  });
});

describe('clean-previews workflow actions', () => {
  it('uses only GitHub-owned actions pinned to a full commit SHA', () => {
    const uses = [...code.matchAll(/^\s+- uses: (\S+)(.*)$/gm)];
    assert.ok(uses.length >= 2);
    for (const [, action, rest] of uses) {
      assert.match(action, /^actions\/[a-z-]+@[0-9a-f]{40}$/, action);
      assert.match(rest, /# v\d+\.\d+\.\d+$/, action);
    }
  });

  it('checks out without persisting credentials and installs no packages', () => {
    assert.match(
      code,
      /actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n(?:\s+ref: [^\n]*\n)?\s+persist-credentials: false/,
    );
    assert.ok(!/npm (ci|install)/.test(code));
  });

  it('checks out the default branch on every trigger, never a PR ref', () => {
    const checkout = steps().find((step) => /actions\/checkout@/.test(step)) ?? '';
    assert.match(checkout, /^ {10}ref: \$\{\{ github\.event\.repository\.default_branch \}\}$/m);
    assert.ok(!/github\.(head_ref|sha)|pull_request\.head|refs\/pull/.test(code));
  });
});

describe('clean-previews workflow secret handling', () => {
  it('reads secrets.CONVEX_TEAM_TOKEN only as a presence check and as one step env value', () => {
    const references = code.match(/secrets\.[A-Za-z_]+/g) ?? [];
    assert.deepEqual(references, ['secrets.CONVEX_TEAM_TOKEN', 'secrets.CONVEX_TEAM_TOKEN']);
    assert.ok(!/secrets\.CONVEX_TEAM_TOKEN[^\n]*\bwith:/.test(code));
    // Never inside a run script, and never echoed.
    for (const step of steps()) {
      const run = /^ {8}run: ([\s\S]*)$/m.exec(step)?.[1] ?? '';
      assert.ok(!run.includes('${{'), 'no expression inside a run script');
    }
    assert.ok(
      !/\$\{?CONVEX_TEAM_TOKEN|printenv|\benv\b *\|/.test(
        code.replace(/^ +CONVEX_TEAM_TOKEN: .*$/m, ''),
      ),
    );
    assert.ok(!/set -x|ACTIONS_STEP_DEBUG/.test(code));
  });

  it('skips with a notice, not a failure, when the secret is missing', () => {
    assert.match(code, /HAS_TOKEN: \$\{\{ secrets\.CONVEX_TEAM_TOKEN != '' \}\}/);
    assert.match(code, /::notice[^\n]*CONVEX_TEAM_TOKEN/);
    assert.match(code, /if: steps\.secret\.outputs\.present == 'true'/);
  });

  it('gives the token only to the step that runs the script, with the workflow token for gh', () => {
    const withToken = steps().filter((step) => /CONVEX_TEAM_TOKEN: \$\{\{ secrets/.test(step));
    assert.equal(withToken.length, 1);
    const [step] = withToken;
    assert.match(step, /GH_TOKEN: \$\{\{ github\.token \}\}/);
    assert.match(step, /GH_REPO: \$\{\{ github\.repository \}\}/);
    assert.match(step, /node scripts\/clean-previews\.mjs/);
  });
});

describe('clean-previews workflow commands', () => {
  const run = steps().find((step) => /node scripts\/clean-previews\.mjs/.test(step)) ?? '';

  it('deletes only the closed PR on a pull_request event, passing the number through env', () => {
    assert.match(run, /PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/);
    assert.match(run, /node scripts\/clean-previews\.mjs --yes --pr "\$PR_NUMBER"/);
    assert.ok(!/--pr \$\{\{/.test(run));
    assert.match(run, /"\$GITHUB_EVENT_NAME" = "pull_request"/);
  });

  it('sweeps every closed or merged PR on schedule and dispatch', () => {
    assert.match(run, /else\n\s+node scripts\/clean-previews\.mjs --yes\n/);
  });
});

describe('clean-previews workflow dry run on dispatch', () => {
  it('has a boolean dry_run input that defaults to true', () => {
    assert.match(
      code,
      /^ {2}workflow_dispatch:\n {4}inputs:\n {6}dry_run:\n(?: {8}.*\n)*? {8}type: boolean\n(?: {8}.*\n)*? {8}default: true\n/m,
    );
  });

  it('reads the input through env, and only for a dispatch', () => {
    assert.match(
      code,
      /DRY_RUN: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.dry_run \}\}/,
    );
    assert.ok(!/inputs\.dry_run/.test(code.replace(/^ +DRY_RUN: .*$/m, '')));
  });
});

/** The `run:` script of the step whose text matches `pattern`, dedented. */
function runScript(pattern) {
  const step = steps().find((candidate) => pattern.test(candidate)) ?? '';
  const body = /^ {8}run: \|\n((?: {10}.*\n|\n)+)/m.exec(step)?.[1] ?? '';
  assert.ok(body, `no run script for ${pattern}`);
  return body.replace(/^ {10}/gm, '');
}

/** Runs a workflow script in bash with a fake `node` that records its arguments. */
function bash(script, env) {
  const dir = mkdtempSync(join(tmpdir(), 'clean-previews-'));
  try {
    const log = join(dir, 'node-args');
    const output = join(dir, 'github-output');
    writeFileSync(output, '');
    writeFileSync(join(dir, 'node'), `#!/bin/sh\necho "$@" >> '${log}'\n`);
    chmodSync(join(dir, 'node'), 0o755);
    const result = spawnSync('bash', ['-e', '-c', script], {
      env: { PATH: `${dir}:/usr/bin:/bin`, GITHUB_OUTPUT: output, ...env },
      encoding: 'utf8',
    });
    const read = (file) => {
      try {
        return readFileSync(file, 'utf8');
      } catch {
        return '';
      }
    };
    return { ...result, nodeArgs: read(log), githubOutput: read(output) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('clean-previews workflow scripts, executed', () => {
  const deleteScript = runScript(/node scripts\/clean-previews\.mjs/);
  const secretScript = runScript(/name: secret/);

  it('a missing secret skips with a notice and exits 0, so the job passes', () => {
    for (const value of ['false', '']) {
      const result = bash(secretScript, { HAS_TOKEN: value });
      assert.equal(result.status, 0, value);
      assert.match(result.stdout, /::notice[^\n]*CONVEX_TEAM_TOKEN/);
      assert.ok(!result.githubOutput.includes('present=true'), value);
    }
  });

  it('a present secret sets present=true and prints no notice', () => {
    const result = bash(secretScript, { HAS_TOKEN: 'true' });
    assert.equal(result.status, 0);
    assert.equal(result.githubOutput, 'present=true\n');
    assert.ok(!result.stdout.includes('::notice'));
  });

  const run = (env) => bash(deleteScript, env).nodeArgs.trim();

  it('a PR close deletes only that PR, whatever the dry-run value', () => {
    for (const DRY_RUN of ['', 'true', 'false']) {
      assert.equal(
        run({ GITHUB_EVENT_NAME: 'pull_request', PR_NUMBER: '159', DRY_RUN }),
        'scripts/clean-previews.mjs --yes --pr 159',
        DRY_RUN,
      );
    }
  });

  it('the daily schedule sweeps and deletes', () => {
    assert.equal(
      run({ GITHUB_EVENT_NAME: 'schedule', DRY_RUN: 'false' }),
      'scripts/clean-previews.mjs --yes',
    );
    assert.equal(run({ GITHUB_EVENT_NAME: 'schedule' }), 'scripts/clean-previews.mjs --yes');
  });

  it('a dispatch with dry_run lists only: --dry-run, no --yes, no --pr', () => {
    assert.equal(
      run({ GITHUB_EVENT_NAME: 'workflow_dispatch', DRY_RUN: 'true' }),
      'scripts/clean-previews.mjs --dry-run',
    );
  });

  it('a dispatch with dry_run unticked sweeps and deletes', () => {
    assert.equal(
      run({ GITHUB_EVENT_NAME: 'workflow_dispatch', DRY_RUN: 'false' }),
      'scripts/clean-previews.mjs --yes',
    );
  });
});
