import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

const workflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'ci.yml'),
  'utf8',
);

function job(name) {
  const block = new RegExp(`^ {2}${name}:\\n([\\s\\S]*?)(?=^ {2}\\S|(?![\\s\\S]))`, 'm').exec(
    workflow,
  );
  assert.ok(block, `job ${name} not found`);
  return block[1];
}

function ciSteps() {
  const steps = [];
  for (const [, block] of job('ci').matchAll(/^ {6}- ([\s\S]*?)(?=^ {6}- |(?![\s\S]))/gm)) {
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
  const names = ciSteps().map((step) => step.name);

  it('is one schedule trigger, once a day', () => {
    const on = /^on:\n([\s\S]*?)(?=^\S)/m.exec(workflow)?.[1] ?? '';
    const crons = [...on.matchAll(/^ {4}- cron: '([^']+)'$/gm)].map((match) => match[1]);
    assert.equal(crons.length, 1, 'exactly one cron');
    assert.match(crons[0], /^\d{1,2} \d{1,2} \* \* \*$/, 'a minute, an hour, then every day');
  });

  it('has no pull_request_target trigger', () => {
    assert.doesNotMatch(workflow, /pull_request_target/);
  });

  it('runs the ci job for a schedule: only a push and a draft PR are skipped', () => {
    assert.match(
      job('ci'),
      /^ {4}if: \$\{\{ !cancelled\(\) && github\.event_name != 'push' && !github\.event\.pull_request\.draft && needs\.nightly-gate\.outputs\.skip != 'true' \}\}$/m,
    );
  });

  it('keeps warm-cache to pushes to main', () => {
    assert.match(job('warm-cache'), /^ {4}if: \$\{\{ github\.event_name == 'push' \}\}$/m);
  });

  it('opens the issue in a job after ci, only for a failed scheduled run', () => {
    const issue = job('nightly-issue');
    assert.match(issue, /^ {4}needs: ci$/m);
    assert.match(
      issue,
      /^ {4}if: \$\{\{ !cancelled\(\) && needs\.ci\.result == 'failure' && github\.event_name == 'schedule' \}\}$/m,
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
    assert.ok(uses.length >= 4, uses.join(', '));
    for (const reference of uses) {
      assert.match(reference, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, reference);
    }
  });

  it('puts a timeout on every job', () => {
    for (const name of ['ci', 'nightly-gate', 'nightly-issue', 'warm-cache']) {
      assert.match(job(name), /^ {4}timeout-minutes: \d+$/m, name);
    }
  });

  it('lists the failing tests after e2e and before the report upload, for a scheduled failure', () => {
    assert.equal(names.indexOf('e2e failures'), names.indexOf('e2e') + 1, names.join(', '));
    assert.equal(names.indexOf('e2e report'), names.indexOf('e2e failures') + 1, names.join(', '));
    const step = ciSteps().find((candidate) => candidate.name === 'e2e failures');
    assert.equal(
      step?.condition,
      "${{ !cancelled() && github.event_name == 'schedule' && steps.e2e.outcome == 'failure' }}",
    );
    assert.match(job('ci'), /e2e_failures: \$\{\{ steps\.failures\.outputs\.failures \}\}/);
    assert.match(job('nightly-issue'), /FAILURES: \$\{\{ needs\.ci\.outputs\.e2e_failures \}\}/);
  });
});

describe('the e2e specs step', () => {
  const names = ciSteps().map((step) => step.name);

  it('runs right after scope, for app scope only', () => {
    assert.equal(names[0], 'scope');
    assert.equal(names[1], 'e2e specs');
    const step = ciSteps().find((candidate) => candidate.name === 'e2e specs');
    assert.equal(step?.condition, "${{ steps.scope.outputs.app == 'true' }}");
  });

  it('feeds the e2e step, which still runs after a drift failure', () => {
    const e2e = /^ {6}- name: e2e\n([\s\S]*?)(?=^ {6}- name:)/m.exec(workflow)?.[1] ?? '';
    assert.match(e2e, /E2E_SCOPE: \$\{\{ steps\.specs\.outputs\.e2e_scope \}\}/);
    assert.match(e2e, /E2E_SPECS: \$\{\{ steps\.specs\.outputs\.e2e_specs \}\}/);
    assert.match(e2e, /if: \$\{\{ !cancelled\(\) && steps\.e2e-backend\.outcome == 'success' \}\}/);
  });

  const write = (repo, path, text) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };

  /**
   * @param {(repo: string, git: (...args: string[]) => void) => void} prepare
   * @param {string} event
   */
  function runSpecsStep(prepare, event = 'pull_request') {
    const repo = mkdtempSync(join(tmpdir(), 'e2e-specs-step-'));
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
      copyFileSync(
        join(import.meta.dirname, 'e2e-affected.mjs'),
        join(repo, 'scripts', 'e2e-affected.mjs'),
      );
      prepare(repo, git);
      const output = join(repo, 'github-output');
      writeFileSync(output, '');
      const result = spawnSync('bash', ['-e', '-c', stepScript('e2e specs')], {
        cwd: repo,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: output,
          GITHUB_EVENT_NAME: event,
          GITHUB_BASE_REF: 'main',
        },
      });
      return {
        status: result.status,
        stdout: result.stdout,
        outputs: readFileSync(output, 'utf8'),
      };
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }

  const changeFile = (path) => (repo, git) => {
    write(repo, path, 'one\n');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    write(repo, path, 'two\n');
    git('add', '.');
    git('commit', '-q', '-m', 'change');
  };

  it('writes the affected specs for the files the last commit changed', () => {
    const run = runSpecsStep(changeFile('src/app/invites/accept-invite-page.ts'));
    assert.equal(run.status, 0);
    assert.equal(
      run.outputs,
      'e2e_scope=affected\ne2e_specs=e2e/accept-invite.spec.ts e2e/harness/ e2e/smoke.spec.ts\n',
    );
    assert.doesNotMatch(run.stdout, /::warning::/);
  });

  it('writes the full scope for a shared file', () => {
    const run = runSpecsStep(changeFile('src/app/shell/shell.ts'));
    assert.equal(run.outputs, 'e2e_scope=full\ne2e_specs=\n');
  });

  it('writes the full scope for a sign-up change when the e2e specs cannot be read', () => {
    // The scratch repository has no e2e/ directory, so the session specs cannot be derived.
    const run = runSpecsStep(changeFile('src/app/sign-up/sign-up-page.ts'));
    assert.equal(run.outputs, 'e2e_scope=full\ne2e_specs=\n');
  });

  it('writes the full scope for a scheduled run, whatever changed', () => {
    const run = runSpecsStep(changeFile('src/app/invites/accept-invite-page.ts'), 'schedule');
    assert.equal(run.outputs, 'e2e_scope=full\ne2e_specs=\n');
  });

  it('warns and writes the full scope when git diff fails (no parent commit)', () => {
    const run = runSpecsStep((repo, git) => {
      write(repo, 'src/app/invites/accept-invite-page.ts', 'one\n');
      git('add', '.');
      git('commit', '-q', '-m', 'only');
    });
    assert.equal(run.status, 0);
    assert.match(run.stdout, /::warning::e2e spec selection failed; running the full suite/);
    assert.equal(run.outputs, 'e2e_scope=full\ne2e_specs=\n');
  });

  it('warns and writes the full scope when the selection script is broken', () => {
    const run = runSpecsStep((repo, git) => {
      write(repo, 'src/app/invites/accept-invite-page.ts', 'one\n');
      git('add', '.');
      git('commit', '-q', '-m', 'base');
      write(repo, 'src/app/invites/accept-invite-page.ts', 'two\n');
      write(repo, 'scripts/e2e-affected.mjs', 'throw new Error("broken");\n');
      git('add', '.');
      git('commit', '-q', '-m', 'change');
    });
    assert.equal(run.status, 0);
    assert.match(run.stdout, /::warning::e2e spec selection failed/);
    assert.equal(run.outputs, 'e2e_scope=full\ne2e_specs=\n');
  });
});

describe('the e2e step', () => {
  /**
   * @param {Record<string, string>} env
   * @returns {string[]}
   */
  function npmArguments(env) {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-step-'));
    try {
      const log = join(dir, 'args');
      writeFileSync(
        join(dir, 'npm'),
        '#!/bin/sh\nfor a in "$@"; do echo "$a"; done > "$NPM_LOG"\n',
        { mode: 0o755 },
      );
      const result = spawnSync('bash', ['-e', '-c', stepScript('e2e')], {
        cwd: dir,
        encoding: 'utf8',
        env: { PATH: `${dir}:${process.env.PATH}`, NPM_LOG: log, ...env },
      });
      assert.equal(result.status, 0, result.stderr);
      return readFileSync(log, 'utf8').split('\n').filter(Boolean);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('passes an affected selection to Playwright after --', () => {
    assert.deepEqual(
      npmArguments({
        E2E_SCOPE: 'affected',
        E2E_SPECS: 'e2e/accept-invite.spec.ts e2e/harness/ e2e/smoke.spec.ts',
      }),
      ['run', 'e2e', '--', 'e2e/accept-invite.spec.ts', 'e2e/harness/', 'e2e/smoke.spec.ts'],
    );
  });

  it('runs every spec for the full scope, even when specs are listed', () => {
    assert.deepEqual(npmArguments({ E2E_SCOPE: 'full', E2E_SPECS: 'e2e/smoke.spec.ts' }), [
      'run',
      'e2e',
      '--',
    ]);
  });

  it('runs every spec when the specs step did not run or printed nothing', () => {
    assert.deepEqual(npmArguments({ E2E_SCOPE: '', E2E_SPECS: '' }), ['run', 'e2e', '--']);
    assert.deepEqual(npmArguments({}), ['run', 'e2e', '--']);
  });

  it('runs every spec for an affected selection with no specs', () => {
    assert.deepEqual(npmArguments({ E2E_SCOPE: 'affected', E2E_SPECS: '' }), ['run', 'e2e', '--']);
  });

  it('passes a glob character through unexpanded', () => {
    assert.deepEqual(npmArguments({ E2E_SCOPE: 'affected', E2E_SPECS: '*.spec.ts' }), [
      'run',
      'e2e',
      '--',
      '*.spec.ts',
    ]);
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
  it('gates ci behind a job that runs for a schedule only', () => {
    const gate = job('nightly-gate');
    assert.match(gate, /^ {4}if: \$\{\{ github\.event_name == 'schedule' \}\}$/m);
    assert.match(job('ci'), /^ {4}needs: nightly-gate$/m);
  });

  it('lets ci run when the gate was skipped or failed, and skips it only on skip=true', () => {
    const condition = /^ {4}if: (.+)$/m.exec(job('ci'))?.[1] ?? '';
    assert.match(condition, /^\$\{\{ !cancelled\(\) && /, 'a skipped gate does not skip ci');
    assert.match(condition, /needs\.nightly-gate\.outputs\.skip != 'true'/);
    assert.doesNotMatch(condition, /needs\.nightly-gate\.result/, 'a failed gate runs the suite');
    assert.match(condition, /github\.event_name != 'push' && !github\.event\.pull_request\.draft/);
  });

  it('opens no nightly issue because the gate failed or ci was skipped', () => {
    assert.match(job('nightly-issue'), /needs\.ci\.result == 'failure'/);
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

  it('asks for the last successful scheduled run of ci.yml on main', () => {
    const { args } = runGate({ output: 'abcdef0123456789' });
    assert.deepEqual(args.slice(0, 2), ['run', 'list']);
    for (const [flag, value] of [
      ['--workflow', 'ci.yml'],
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
