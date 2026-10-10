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
  it('runs on a push to main, daily, and by hand', () => {
    assert.match(code, /^on:\n {2}push:\n {4}branches: \[main\]\n {2}schedule:/m);
    assert.match(code, /^ {2}schedule:\n {4}- cron: '[^']+'$/m);
    assert.match(code, /^ {2}workflow_dispatch:/m);
  });

  it('has no pull_request, pull_request_target, or workflow_run trigger, so no branch run holds the token', () => {
    assert.ok(!/pull_request|workflow_run/.test(code.replace(/pull-requests: read/, '')));
    const triggers = /^on:\n([\s\S]*?)^permissions:/m.exec(code)?.[1] ?? '';
    assert.deepEqual(
      [...triggers.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]),
      ['push', 'schedule', 'workflow_dispatch'],
    );
  });

  it('has no concurrency group, which could replace a pending run and drop a delete', () => {
    assert.ok(!/concurrency:|cancel-in-progress/.test(code));
  });
});

describe('clean-previews workflow permissions', () => {
  it('is read-only at the top level and grants only contents and pull-requests read to the job', () => {
    assert.match(code, /^permissions:\n {2}contents: read\n\n/m);
    const job = /^ {2}clean:\n([\s\S]*)$/m.exec(code)?.[1] ?? '';
    const permissions = /^ {4}permissions:\n((?: {6}\S.*\n)+)/m.exec(job)?.[1];
    assert.equal(permissions, '      contents: read\n      pull-requests: read\n');
  });

  it('declares the preview-cleanup environment, which holds the token and limits it to main', () => {
    const job = /^ {2}clean:\n([\s\S]*)$/m.exec(code)?.[1] ?? '';
    assert.match(job, /^ {4}environment: preview-cleanup$/m);
    // A plain name, not a mapping or an expression: the environment cannot depend on the event.
    assert.ok(!/environment:\s*\n|environment:.*\$\{\{/.test(code));
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

  it('checks out the default branch on every trigger, never a branch or PR ref', () => {
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

  it('reads PR numbers from the push event file, never through an expression', () => {
    assert.match(run, /"\$GITHUB_EVENT_PATH"/);
    assert.ok(!/github\.event\.(commits|head_commit)/.test(code));
    assert.ok(!/--pr \$\{\{/.test(run));
  });

  it('has no pull_request branch, and an unknown event deletes nothing and fails', () => {
    assert.ok(!/pull_request/.test(run));
    assert.match(run, /\*\)\n\s+echo "Unexpected event [^\n]*nothing deleted\."\n\s+exit 1/);
  });
});

describe('clean-previews workflow dry run on dispatch', () => {
  it('has a boolean dry_run input that defaults to true', () => {
    assert.match(
      code,
      /^ {2}workflow_dispatch:\n {4}inputs:\n {6}dry_run:\n(?: {8}.*\n)*? {8}type: boolean\n(?: {8}.*\n)*? {8}default: true\n/m,
    );
  });

  it('deletes only when the input is exactly false', () => {
    assert.match(
      code,
      /if \[ "\$DRY_RUN" = "false" \]; then\n\s+node scripts\/clean-previews\.mjs --yes\n/,
    );
    assert.ok(!/\$DRY_RUN" (=|!=) "true"/.test(code));
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
function bash(script, env, event) {
  const dir = mkdtempSync(join(tmpdir(), 'clean-previews-'));
  try {
    const log = join(dir, 'node-args');
    const output = join(dir, 'github-output');
    writeFileSync(output, '');
    const eventPath = join(dir, 'event.json');
    if (event !== undefined) writeFileSync(eventPath, JSON.stringify(event));
    writeFileSync(join(dir, 'node'), `#!/bin/sh\necho "$@" >> '${log}'\n`);
    chmodSync(join(dir, 'node'), 0o755);
    const result = spawnSync('bash', ['-e', '-c', script], {
      env: {
        PATH: `${dir}:/usr/bin:/bin`,
        GITHUB_OUTPUT: output,
        GITHUB_EVENT_PATH: eventPath,
        ...env,
      },
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

  const run = (env, event) => bash(deleteScript, env, event).nodeArgs.trim();
  const push = (...messages) => ({ commits: messages.map((message) => ({ message })) });
  const pr = (...numbers) =>
    numbers.map((number) => `scripts/clean-previews.mjs --yes --pr ${number}`).join('\n');

  it('a push deletes the PR named in each commit subject, one --pr run each', () => {
    assert.equal(
      run(
        { GITHUB_EVENT_NAME: 'push' },
        push('feat(organizations): sport counts (#101) (#155)', 'fix: x (#9)'),
      ),
      pr(9, 101, 155),
    );
  });

  it('a push reads the subject only, and each number once', () => {
    assert.equal(
      run(
        { GITHUB_EVENT_NAME: 'push' },
        push('fix: a (#12)\n\nbody mentions (#13) and (#14)', 'chore: b (#12)'),
      ),
      pr(12),
    );
  });

  it('a push with no (#n) in a subject runs nothing and exits 0', () => {
    for (const event of [push('chore: direct commit'), push('fix: #5 and (#0) and (#x)'), {}]) {
      const result = bash(deleteScript, { GITHUB_EVENT_NAME: 'push' }, event);
      assert.equal(result.status, 0, JSON.stringify(event));
      assert.equal(result.nodeArgs, '');
    }
  });

  it('a push passes only digits to the script, whatever the subject holds', () => {
    const subject = 'x (#7) $(touch pwned); `id` --yes (#8)';
    assert.equal(run({ GITHUB_EVENT_NAME: 'push' }, push(subject)), pr(7, 8));
  });

  it('a push skips an oversized number with a notice, deletes the rest, and exits 0', () => {
    const big = '99999999999999999999';
    const result = bash(
      deleteScript,
      { GITHUB_EVENT_NAME: 'push' },
      push(`fix: a (#${big}) (#12)`, 'chore: b (#1234567890)'),
    );
    assert.equal(result.status, 0);
    assert.equal(result.nodeArgs.trim(), pr(12));
    assert.equal(result.stdout.match(/::notice title=Skipped an oversized number/g)?.length, 2);
    // Nine digits is still a PR number.
    assert.equal(run({ GITHUB_EVENT_NAME: 'push' }, push('c (#999999999)')), pr(999999999));
    // Only an oversized number: no run, exit 0.
    const only = bash(deleteScript, { GITHUB_EVENT_NAME: 'push' }, push(`d (#${big})`));
    assert.equal(only.status, 0);
    assert.equal(only.nodeArgs, '');
  });

  it('a push past 20 numbers keeps the last 20, so the PR own number survives', () => {
    const numbers = Array.from({ length: 30 }, (_, i) => i + 1);
    const subject = `feat: x ${numbers.map((n) => `(#${n})`).join(' ')}`;
    const kept = numbers.slice(-20);
    assert.equal(run({ GITHUB_EVENT_NAME: 'push' }, push(subject)), pr(...kept));
    // Across commits: the newest commit's numbers come last and win.
    const commits = numbers.map((n) => `fix: c${n} (#${n})`);
    assert.equal(run({ GITHUB_EVENT_NAME: 'push' }, push(...commits)), pr(...kept));
    // The PR number need not be the highest: the last match is kept, counted at its last place.
    const lowLast = `feat: y ${[...numbers, 5].map((n) => `(#${n})`).join(' ')}`;
    assert.equal(run({ GITHUB_EVENT_NAME: 'push' }, push(lowLast)), pr(5, ...numbers.slice(11)));
  });

  it('a push run fails when any single delete fails, after trying the rest', () => {
    const script = deleteScript.replaceAll('node scripts', 'false scripts');
    const result = bash(script, { GITHUB_EVENT_NAME: 'push' }, push('a (#1)', 'b (#2)'));
    assert.equal(result.status, 1);
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

  it('a dispatch deletes only when dry_run is exactly false; anything else lists only', () => {
    assert.equal(
      run({ GITHUB_EVENT_NAME: 'workflow_dispatch', DRY_RUN: 'false' }),
      'scripts/clean-previews.mjs --yes',
    );
    for (const DRY_RUN of ['', 'False', '0', 'no', 'maybe']) {
      assert.equal(
        run({ GITHUB_EVENT_NAME: 'workflow_dispatch', DRY_RUN }),
        'scripts/clean-previews.mjs --dry-run',
        DRY_RUN,
      );
    }
  });

  it('a pull_request or any other event deletes nothing and fails', () => {
    for (const GITHUB_EVENT_NAME of ['pull_request', 'workflow_run', '']) {
      const result = bash(deleteScript, { GITHUB_EVENT_NAME, DRY_RUN: 'false' });
      assert.equal(result.status, 1, GITHUB_EVENT_NAME);
      assert.equal(result.nodeArgs, '', GITHUB_EVENT_NAME);
    }
  });
});
