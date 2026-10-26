import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const workflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'e2e.yml'),
  'utf8',
);

function job(name) {
  const block = new RegExp(`^ {2}${name}:\\n([\\s\\S]*?)(?=^ {2}\\S|(?![\\s\\S]))`, 'm').exec(
    workflow,
  );
  assert.ok(block, `job ${name} not found`);
  return block[1];
}

function e2eSteps() {
  const steps = [];
  for (const [, block] of job('e2e').matchAll(/^ {6}- ([\s\S]*?)(?=^ {6}- |(?![\s\S]))/gm)) {
    const name = /^name: (.+)$/m.exec(block)?.[1];
    const condition = /^ {8}if: (.+)$/m.exec(block)?.[1];
    if (name) steps.push({ name, condition });
  }
  return steps;
}

function stepScript(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(
    `^ {6}- name: ${escaped}\\n(?: {8}.*\\n)*? {8}run: \\|\\n((?: {10}.*\\n|\\n)+)`,
    'm',
  ).exec(workflow);
  assert.ok(block, `${name}: run script not found`);
  return block[1].replace(/^ {10}/gm, '');
}

describe('the nightly full run', () => {
  const names = e2eSteps().map((step) => step.name);

  it('is one schedule trigger, once a day', () => {
    const on = /^on:\n([\s\S]*?)(?=^\S)/m.exec(workflow)?.[1] ?? '';
    const crons = [...on.matchAll(/^ {4}- cron: '([^']+)'$/gm)].map((match) => match[1]);
    assert.equal(crons.length, 1, 'exactly one cron');
    assert.match(crons[0], /^\d{1,2} \d{1,2} \* \* \*$/, 'a minute, an hour, then every day');
  });

  it('has no pull_request_target trigger', () => {
    assert.doesNotMatch(workflow, /pull_request_target/);
  });

  it('runs only on the schedule and on dispatch: no PR or push trigger', () => {
    const on = /^on:\n([\s\S]*?)(?=^\S)/m.exec(workflow)?.[1] ?? '';
    const triggers = [...on.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]);
    assert.deepEqual(triggers, ['schedule', 'workflow_dispatch']);
  });

  it('opens the issue in a job after e2e, only for a failed scheduled run', () => {
    const issue = job('nightly-issue');
    assert.match(issue, /^ {4}needs: e2e$/m);
    assert.match(
      issue,
      /^ {4}if: \$\{\{ !cancelled\(\) && needs\.e2e\.result == 'failure' && github\.event_name == 'schedule' \}\}$/m,
    );
  });

  it('gives the issue job issues: write and nothing else, with the workflow token only', () => {
    const issue = job('nightly-issue');
    assert.match(issue, /^ {4}permissions:\n {6}issues: write\n(?! {6}\S)/m, 'only issues: write');
    assert.match(issue, /GH_TOKEN: \$\{\{ github\.token \}\}/);
    assert.doesNotMatch(issue, /uses:/, 'no checkout and no action');
  });

  it('keeps read-only default permissions and uses no secret', () => {
    assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
    assert.doesNotMatch(workflow, /secrets\./);
  });

  it('pins every action to a full commit SHA', () => {
    const uses = [...workflow.matchAll(/^\s*(?:- )?uses: (\S+)/gm)].map((match) => match[1]);
    assert.ok(uses.length >= 3, uses.join(', '));
    for (const reference of uses) {
      assert.match(reference, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, reference);
    }
  });

  it('puts a timeout on every job', () => {
    for (const name of ['e2e', 'nightly-gate', 'nightly-issue']) {
      assert.match(job(name), /^ {4}timeout-minutes: \d+$/m, name);
    }
  });

  it('lists the failing tests after e2e and before the report upload, for a scheduled failure', () => {
    assert.equal(names.indexOf('e2e failures'), names.indexOf('e2e') + 1, names.join(', '));
    assert.equal(names.indexOf('e2e report'), names.indexOf('e2e failures') + 1, names.join(', '));
    const step = e2eSteps().find((candidate) => candidate.name === 'e2e failures');
    assert.equal(
      step?.condition,
      "${{ !cancelled() && github.event_name == 'schedule' && steps.e2e.outcome == 'failure' }}",
    );
    assert.match(job('e2e'), /e2e_failures: \$\{\{ steps\.failures\.outputs\.failures \}\}/);
    assert.match(job('nightly-issue'), /FAILURES: \$\{\{ needs\.e2e\.outputs\.e2e_failures \}\}/);
  });
});

describe('the e2e job', () => {
  const names = e2eSteps().map((step) => step.name);

  it('runs every spec, with no selection', () => {
    assert.ok(!names.includes('e2e specs'), names.join(', '));
    const e2e = /^ {6}- name: e2e\n([\s\S]*?)(?=^ {6}- name:)/m.exec(workflow)?.[1] ?? '';
    assert.match(e2e, /^ {8}run: npm run e2e$/m);
  });

  it('runs e2e after a drift failure, but only once the backend is up', () => {
    const step = e2eSteps().find((candidate) => candidate.name === 'e2e');
    assert.equal(step?.condition, "${{ !cancelled() && steps.e2e-backend.outcome == 'success' }}");
  });

  it('adds WebKit only on a dispatch that asks for it', () => {
    assert.match(job('e2e'), /E2E_WEBKIT: \$\{\{ inputs\.webkit == true && '1' \|\| '0' \}\}/);
  });
});

describe('the nightly issue step', () => {
  const hasJq = spawnSync('jq', ['--version']).status === 0;
  const skip = hasJq ? false : 'jq is not installed';

  /**
   * @param {Record<string, string>} env
   * @param {string} existing
   * @returns {string}
   */
  function runIssueStep(env, existing = '[]') {
    const dir = mkdtempSync(join(tmpdir(), 'nightly-issue-'));
    try {
      const log = join(dir, 'calls');
      writeFileSync(
        join(dir, 'gh'),
        [
          '#!/bin/sh',
          'if [ "$1 $2" = "issue list" ]; then printf \'%s\' "$EXISTING"; exit 0; fi',
          '{ printf \'ARGS:\'; for a in "$@"; do printf \' [%s]\' "$a"; done; printf \'\\n\'; } >> "$GH_LOG"',
          '',
        ].join('\n'),
        { mode: 0o755 },
      );
      const result = spawnSync('bash', ['-e', '-c', stepScript('open or update the issue')], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          PATH: `${dir}:${process.env.PATH}`,
          GH_LOG: log,
          EXISTING: existing,
          RUN_URL: 'https://github.com/o/r/actions/runs/7',
          COMMIT: 'abcdef0123456789',
          ISSUE_TITLE: 'Nightly e2e failed on main',
          ...env,
        },
      });
      assert.equal(result.status, 0, result.stderr);
      return readFileSync(log, 'utf8');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('opens a type:bug issue with the failing tests and a run link', { skip }, () => {
    const calls = runIssueStep({
      FAILURES: JSON.stringify(['chromium-desktop: e2e/a.spec.ts:3: boom']),
    });
    assert.match(calls, /ARGS: \[issue\] \[create\] \[--title\] \[Nightly e2e failed on main\]/);
    assert.match(calls, /\[--label\] \[type:bug\] \[--label\] \[status:ready\]/);
    assert.match(calls, /Nightly e2e: FAIL \(main abcdef0\)/);
    assert.match(calls, /Run: https:\/\/github\.com\/o\/r\/actions\/runs\/7/);
    assert.match(calls, /- `chromium-desktop: e2e\/a\.spec\.ts:3: boom`/);
  });

  it(
    'wraps each failing test in backticks so a mention or issue number does not link',
    { skip },
    () => {
      const calls = runIssueStep({
        FAILURES: JSON.stringify(['chromium-desktop: e2e/a.spec.ts:3: ping @owner about #12 `x`']),
      });
      assert.match(calls, /- `chromium-desktop: e2e\/a\.spec\.ts:3: ping @owner about #12 'x'`/);
    },
  );

  it('comments on the open issue instead of opening a second one', { skip }, () => {
    const calls = runIssueStep(
      { FAILURES: '["chromium-mobile: e2e/b.spec.ts:9: bang"]' },
      JSON.stringify([
        { number: 12, title: 'Something else' },
        { number: 41, title: 'Nightly e2e failed on main' },
      ]),
    );
    assert.match(calls, /ARGS: \[issue\] \[comment\] \[41\] \[--body\]/);
    assert.doesNotMatch(calls, /\[create\]/);
    assert.match(calls, /bang/);
  });

  it('says no failing test was recorded when the list is empty or unreadable', { skip }, () => {
    for (const failures of ['[]', '', 'not json']) {
      const calls = runIssueStep({ FAILURES: failures });
      assert.match(calls, /\[create\]/, failures);
      assert.match(calls, /No failing test was recorded/, failures);
      assert.match(calls, /Run: https:\/\/github\.com\/o\/r\/actions\/runs\/7/, failures);
    }
  });
});

describe('skipping a quiet night', () => {
  it('gates e2e behind a job that runs for a schedule only', () => {
    const gate = job('nightly-gate');
    assert.match(gate, /^ {4}if: \$\{\{ github\.event_name == 'schedule' \}\}$/m);
    assert.match(job('e2e'), /^ {4}needs: nightly-gate$/m);
  });

  it('lets e2e run when the gate was skipped or failed, and skips it only on skip=true', () => {
    const condition = /^ {4}if: (.+)$/m.exec(job('e2e'))?.[1] ?? '';
    assert.match(condition, /^\$\{\{ !cancelled\(\) && /, 'a skipped gate does not skip e2e');
    assert.match(condition, /needs\.nightly-gate\.outputs\.skip != 'true'/);
    assert.doesNotMatch(condition, /needs\.nightly-gate\.result/, 'a failed gate runs the suite');
  });

  it('opens no nightly issue because the gate failed or e2e was skipped', () => {
    assert.match(job('nightly-issue'), /needs\.e2e\.result == 'failure'/);
  });

  it('gives the gate actions: read and nothing else, with the workflow token only', () => {
    const gate = job('nightly-gate');
    assert.match(gate, /^ {4}permissions:\n {6}actions: read\n(?! {6}\S)/m, 'only actions: read');
    assert.match(gate, /GH_TOKEN: \$\{\{ github\.token \}\}/);
    assert.match(gate, /HEAD_SHA: \$\{\{ github\.sha \}\}/);
    assert.doesNotMatch(gate, /uses:/, 'no checkout and no action');
    assert.match(gate, /skip: \$\{\{ steps\.last-green\.outputs\.skip \}\}/);
  });

  /**
   * @param {{ output?: string, exit?: number }} lookup
   * @param {string} head
   */
  function runGate({ output = '', exit = 0 }, head = 'abcdef0123456789') {
    const dir = mkdtempSync(join(tmpdir(), 'nightly-gate-'));
    try {
      const log = join(dir, 'args');
      writeFileSync(
        join(dir, 'gh'),
        [
          '#!/bin/sh',
          'for a in "$@"; do echo "$a"; done > "$GH_LOG"',
          'printf \'%s\' "$GH_OUTPUT"',
          'exit "$GH_EXIT"',
          '',
        ].join('\n'),
        { mode: 0o755 },
      );
      const outputFile = join(dir, 'github-output');
      writeFileSync(outputFile, '');
      const result = spawnSync('bash', ['-e', '-c', stepScript('last green night')], {
        cwd: dir,
        encoding: 'utf8',
        env: {
          PATH: `${dir}:${process.env.PATH}`,
          GH_LOG: log,
          GH_OUTPUT: output,
          GH_EXIT: String(exit),
          HEAD_SHA: head,
          GITHUB_OUTPUT: outputFile,
        },
      });
      assert.equal(result.status, 0, result.stderr);
      return {
        outputs: readFileSync(outputFile, 'utf8'),
        stdout: result.stdout,
        args: readFileSync(log, 'utf8').split('\n').filter(Boolean),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('skips with a notice when main is the commit the last successful nightly run tested', () => {
    const run = runGate({ output: 'abcdef0123456789' });
    assert.equal(run.outputs, 'skip=true\n');
    assert.match(run.stdout, /^::notice::main is still abcdef0, the commit the last successful/m);
  });

  it('asks for the last successful scheduled run of e2e.yml on main', () => {
    const { args } = runGate({ output: 'abcdef0123456789' });
    assert.deepEqual(args.slice(0, 2), ['run', 'list']);
    for (const [flag, value] of [
      ['--workflow', 'e2e.yml'],
      ['--event', 'schedule'],
      ['--status', 'success'],
      ['--branch', 'main'],
      ['--limit', '1'],
    ]) {
      assert.equal(args[args.indexOf(flag) + 1], value, flag);
    }
  });

  it('runs the suite when main has moved, when there was no green night, or when the lookup fails', () => {
    for (const lookup of [
      { output: '1111111222222233333' },
      { output: '' },
      { output: 'abcdef0123456789', exit: 1 },
      { output: 'garbage that is not a sha', exit: 4 },
    ]) {
      const run = runGate(lookup);
      assert.equal(run.outputs, 'skip=false\n', JSON.stringify(lookup));
      assert.doesNotMatch(run.stdout, /::notice::/);
    }
  });
});
