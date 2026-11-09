import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { PROBLEMS_FILE, PRODUCTION_RUNS } from './e2e-production-check.mjs';

const SETUP_MINUTES = 2;
const SPARE_MINUTES = 1;
const SHARDS = 10;
const SHARD_NUMBERS = Array.from({ length: SHARDS }, (_, index) => index + 1);
const GLOBAL_TIMEOUT_MS = 1_800_000;
const E2E_SETUP_MINUTES = 13;
const E2E_MARGIN_MINUTES = 2;
const RESULTS = ['failure', 'cancelled', 'success', 'skipped'];

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

function jobSteps(jobName) {
  const steps = [];
  for (const [, block] of job(jobName).matchAll(/^ {6}- ([\s\S]*?)(?=^ {6}- |(?![\s\S]))/gm)) {
    const uses = /^(?: {8})?uses: (\S+)/m.exec(block)?.[1];
    const name = /^name: (.+)$/m.exec(block)?.[1] ?? uses;
    const id = /^ {8}id: (.+)$/m.exec(block)?.[1];
    const condition = /^ {8}if: (.+)$/m.exec(block)?.[1];
    const envBlock = /^ {8}env:\n((?: {10}.*\n)+)/m.exec(block)?.[1] ?? '';
    const env = Object.fromEntries(
      [...envBlock.matchAll(/^ {10}(\w+): (.+)$/gm)].map((match) => [match[1], match[2]]),
    );
    const run =
      /^ {8}run: \|\n((?: {10}.*\n|\n)+)/m.exec(block)?.[1]?.replace(/^ {10}/gm, '') ??
      /^ {8}run: (.+)$/m.exec(block)?.[1];
    steps.push({ name, id, condition, uses, env, run, block });
  }
  return steps;
}

function e2eSteps() {
  return jobSteps('e2e').filter((step) => step.block.startsWith('name: '));
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

  it('opens the issue in a job after both e2e jobs, for a scheduled run that failed or was cancelled', () => {
    const issue = job('nightly-issue');
    assert.match(issue, /^ {4}needs: \[e2e, e2e-production\]$/m);
    const condition = /^ {4}if: (.+)$/m.exec(issue)?.[1] ?? '';
    assert.match(condition, /^\$\{\{ always\(\) && /, 'a timed-out job concludes cancelled');
    const holds = (e2e, production, event = 'schedule') => {
      const script = condition
        .replace(/^\$\{\{ | \}\}$/g, '')
        .replaceAll('needs.e2e-production.result', 'production')
        .replaceAll('needs.e2e.result', 'e2e')
        .replaceAll('github.event_name', 'event')
        .replaceAll('always()', 'true')
        .replaceAll('==', '===');
      assert.match(script.replace(/'[a-z_]+'/g, ''), /^[\s&|()=a-z0-9!]*$/, script);
      return runInNewContext(script, { e2e, production, event });
    };
    for (const e2e of RESULTS) {
      for (const production of RESULTS) {
        const unfinished = ['failure', 'cancelled'];
        assert.equal(
          holds(e2e, production),
          unfinished.includes(e2e) || unfinished.includes(production),
          `${e2e} and ${production}`,
        );
        assert.equal(
          holds(e2e, production, 'workflow_dispatch'),
          false,
          `dispatch ${e2e} ${production}`,
        );
      }
    }
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
    for (const name of ['e2e', 'e2e-production', 'nightly-gate', 'nightly-issue']) {
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
    for (const shard of SHARD_NUMBERS) {
      assert.match(
        job('e2e'),
        new RegExp(
          `^ {6}e2e_failures_${shard}: \\$\\{\\{ matrix\\.shard == ${shard} && steps\\.failures\\.outputs\\.failures \\|\\| '' \\}\\}$`,
          'm',
        ),
        `e2e_failures_${shard}`,
      );
      assert.match(
        job('nightly-issue'),
        new RegExp(
          `^ {6}E2E_FAILURES_${shard}: \\$\\{\\{ needs\\.e2e\\.outputs\\.e2e_failures_${shard} \\}\\}$`,
          'm',
        ),
        `E2E_FAILURES_${shard}`,
      );
    }
    assert.match(
      job('nightly-issue'),
      /^ {6}PRODUCTION_FAILURES: \$\{\{ needs\.e2e-production\.outputs\.e2e_failures \}\}$/m,
    );
  });

  it('feeds the issue step the shard count and both job results from the workflow', () => {
    const issue = job('nightly-issue');
    assert.match(issue, new RegExp(`^ {6}E2E_SHARDS: ${SHARDS}$`, 'm'), 'the shard count');
    assert.match(issue, /^ {6}E2E_RESULT: \$\{\{ needs\.e2e\.result \}\}$/m, 'the e2e result');
    assert.match(
      issue,
      /^ {6}PRODUCTION_RESULT: \$\{\{ needs\.e2e-production\.result \}\}$/m,
      'the e2e-production result',
    );
  });
});

describe('the e2e-production job', () => {
  const steps = jobSteps('e2e-production');
  const names = steps.map((step) => step.name);
  const step = (name) => {
    const found = steps.find((candidate) => candidate.name === name);
    assert.ok(found, `step ${name} not found in ${names.join(', ')}`);
    return found;
  };
  const runNames = PRODUCTION_RUNS.map((run) => run.name);

  it('runs on the same nights as e2e, in parallel with it, within 20 minutes', () => {
    const production = job('e2e-production');
    assert.match(production, /^ {4}needs: nightly-gate$/m);
    assert.match(
      production,
      /^ {4}if: \$\{\{ !cancelled\(\) && needs\.nightly-gate\.outputs\.skip != 'true' \}\}$/m,
    );
    assert.match(production, /^ {4}runs-on: ubuntu-24\.04$/m);
    assert.match(production, /^ {4}timeout-minutes: 20$/m);
    assert.doesNotMatch(production, /^ {4}permissions:/m, 'the top-level contents: read only');
  });

  it('starts the backend, sets it up, seeds it, builds, serves, runs the four runs, checks, then uploads', () => {
    assert.deepEqual(names, [
      names[0],
      names[1],
      'install',
      'e2e browsers',
      'e2e backend',
      'e2e setup',
      'seed demo',
      'build',
      'app server',
      ...runNames,
      'expected tests',
      'e2e failures',
      'e2e report',
    ]);
    assert.match(steps[0].uses ?? '', /^actions\/checkout@/);
    assert.match(steps[0].block, /persist-credentials: false/);
    assert.match(steps[1].uses ?? '', /^actions\/setup-node@/);
  });

  it('starts the local backend in the background and waits up to 60 s for /version', () => {
    const backend = step('e2e backend');
    assert.match(
      backend.run ?? '',
      /^node scripts\/e2e-convex\.mjs serve > "\$RUNNER_TEMP\/\S+" 2>&1 &$/m,
    );
    assert.match(
      backend.run ?? '',
      /curl [^\n]*--retry-max-time 60 [^\n]*http:\/\/127\.0\.0\.1:3210\/version/,
    );
  });

  it('sets up auth on the local backend with the script alone: no env and no secret', () => {
    const setup = step('e2e setup');
    assert.equal(setup.run, 'node scripts/e2e-convex.mjs setup');
    assert.deepEqual(setup.env, {});
    assert.doesNotMatch(setup.block, /^ {8}env:/m);
    assert.doesNotMatch(job('e2e-production'), /secrets\./);
  });

  it('seeds the demo data with no demo password', () => {
    assert.equal(step('seed demo').run, 'node scripts/e2e-convex.mjs seed-demo');
    assert.doesNotMatch(job('e2e-production'), /DEMO_ACCOUNT_PASSWORD/);
  });

  it('builds for production against the local backend', () => {
    const build = step('build');
    assert.equal(build.run, 'npm run build');
    assert.deepEqual(build.env, { CONVEX_URL: 'http://127.0.0.1:3210' });
  });

  it('serves the build in the background and waits up to 60 s for /', () => {
    const app = step('app server');
    assert.match(app.run ?? '', /^PORT=4000 npm run serve:ssr > "\$RUNNER_TEMP\/\S+" 2>&1 &$/m);
    assert.match(
      app.run ?? '',
      /curl [^\n]*--retry-max-time 60 [^\n]*http:\/\/localhost:4000\/(?:[\s;]|$)/,
    );
  });

  it('runs each spec of the table in its own project, under its own run name', () => {
    for (const run of PRODUCTION_RUNS) {
      const found = step(run.name);
      assert.equal(found.run, `npx playwright test ${run.spec} --project=${run.project}`, run.name);
      assert.equal(found.env.E2E_RUN_NAME, run.name, run.name);
    }
    assert.equal(step('production-mobile').env.E2E_BASE_URL, 'http://localhost:4000');
    assert.equal(step('production-desktop').env.E2E_BASE_URL, 'http://localhost:4000');
    assert.deepEqual(step('pwa-update').env, {
      E2E_RUN_NAME: 'pwa-update',
      E2E_PWA_UPDATE: "'1'",
      E2E_BASE_URL: 'http://localhost:4101',
    });
    assert.deepEqual(step('kill-switch').env, {
      E2E_RUN_NAME: 'kill-switch',
      E2E_KILL_SWITCH: "'1'",
      E2E_BASE_URL: 'http://localhost:4100',
    });
    assert.doesNotMatch(job('e2e-production'), /^ {4}env:/m, 'no job-level env, so no CONVEX_URL');
  });

  it('runs the first run after a working setup, and every later run after a failed one', () => {
    assert.equal(step('production-mobile').condition, undefined);
    assert.equal(
      step('production-desktop').condition,
      "${{ !cancelled() && steps.app.outcome == 'success' }}",
    );
    for (const name of ['pwa-update', 'kill-switch']) {
      assert.equal(
        step(name).condition,
        "${{ !cancelled() && steps.browsers.outcome == 'success' }}",
        name,
      );
    }
    assert.equal(step('app server').id, 'app');
    assert.equal(step('e2e browsers').id, 'browsers');
  });

  it('gives each run a step timeout, so a hang still leaves time for the check, list, and upload', () => {
    const timeouts = Object.fromEntries(
      runNames.map((name) => [
        name,
        Number(/^ {8}timeout-minutes: (\d+)$/m.exec(step(name).block)?.[1]),
      ]),
    );
    assert.deepEqual(timeouts, {
      'production-mobile': 3,
      'production-desktop': 2,
      'pwa-update': 6,
      'kill-switch': 5,
    });
    const limit = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(job('e2e-production'))?.[1]);
    const runs = Object.values(timeouts).reduce((sum, minutes) => sum + minutes, 0);
    assert.ok(
      runs + SETUP_MINUTES <= limit - SPARE_MINUTES,
      `${runs} minutes of runs plus ${SETUP_MINUTES} of setup leave under ${SPARE_MINUTES} spare in ${limit}`,
    );
    for (const name of ['expected tests', 'e2e failures', 'e2e report']) {
      assert.doesNotMatch(step(name).block, /timeout-minutes/, name);
      assert.match(step(name).condition ?? '', /!cancelled\(\)|failure\(\)/, name);
    }
  });

  it('checks every run against the expected table, after a failed run too', () => {
    const check = step('expected tests');
    assert.equal(check.condition, '${{ !cancelled() }}');
    assert.equal(check.run, 'node scripts/e2e-production-check.mjs');
  });

  it('lists the failures of every run as the job output', () => {
    const failures = step('e2e failures');
    assert.equal(failures.id, 'failures');
    assert.equal(failures.condition, '${{ failure() }}');
    const paths = runNames.map((name) => `test-results/${name}/results.json`);
    assert.ok(
      (failures.run ?? '').includes(
        `node scripts/e2e-failures.mjs --problems test-results/${PROBLEMS_FILE} ${paths.join(' ')}`,
      ),
      failures.run,
    );
    assert.match(failures.run ?? '', /"\$GITHUB_OUTPUT"/);
    assert.match(
      job('e2e-production'),
      /^ {6}e2e_failures: \$\{\{ steps\.failures\.outputs\.failures \}\}$/m,
    );
  });

  it("uploads every run's results and report, pass or fail, for 7 days", () => {
    const upload = step('e2e report');
    assert.equal(upload.condition, '${{ !cancelled() }}');
    assert.equal(upload.uses, jobSteps('e2e').find((found) => found.name === 'e2e report')?.uses);
    assert.match(upload.block, /^ {10}name: e2e-production-report$/m);
    assert.match(upload.block, /^ {10}path: \|\n {12}test-results\/\n {12}playwright-report\/\n/m);
    assert.match(upload.block, /^ {10}retention-days: 7$/m);
  });
});

describe('the e2e job', () => {
  const steps = e2eSteps();
  const names = steps.map((step) => step.name);
  const step = (name) => {
    const found = steps.find((candidate) => candidate.name === name);
    assert.ok(found, `step ${name} not found in ${names.join(', ')}`);
    return found;
  };

  it(`is ${SHARDS} shards that all run to the end`, () => {
    const strategy = /^ {4}strategy:\n((?: {6}.*\n)+)/m.exec(job('e2e'))?.[1] ?? '';
    assert.match(strategy, /^ {6}fail-fast: false$/m);
    const matrix = /^ {8}shard: \[([\d, ]+)\]$/m.exec(strategy)?.[1] ?? '';
    assert.deepEqual(matrix.split(',').map(Number), SHARD_NUMBERS);
  });

  it('runs every spec, split across the shards, with no selection', () => {
    assert.ok(!names.includes('e2e specs'), names.join(', '));
    const run = step('e2e').run ?? '';
    assert.doesNotMatch(run, /\.spec\.ts|--grep/);
    assert.equal(step('e2e').env.SHARD, '${{ matrix.shard }}');
  });

  it('runs one shard of the suite under a global timeout, and only webkit-mobile on a WebKit dispatch', () => {
    const flags = `--shard="$SHARD/${SHARDS}" --global-timeout=${GLOBAL_TIMEOUT_MS}`;
    assert.equal(
      step('e2e').run,
      `if [ "$E2E_WEBKIT" = "1" ]; then\n  npm run e2e -- --project=webkit-mobile ${flags}\nelse\n  npm run e2e -- ${flags}\nfi\n`,
    );
  });

  it('keeps the job limit at 45 minutes, with room after the global timeout for setup and the report', () => {
    const limit = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(job('e2e'))?.[1]);
    assert.equal(limit, 45);
    const globalMinutes = GLOBAL_TIMEOUT_MS / 60_000;
    assert.ok(
      globalMinutes + E2E_SETUP_MINUTES + E2E_MARGIN_MINUTES <= limit,
      `${globalMinutes} minutes of tests, ${E2E_SETUP_MINUTES} of setup and ${E2E_MARGIN_MINUTES} spare do not fit in ${limit}`,
    );
  });

  it('runs e2e after a drift failure, but only once the backend is up', () => {
    assert.equal(
      step('e2e').condition,
      "${{ !cancelled() && steps.e2e-backend.outcome == 'success' }}",
    );
  });

  it('adds WebKit only on a dispatch that asks for it', () => {
    assert.match(job('e2e'), /E2E_WEBKIT: \$\{\{ inputs\.webkit == true && '1' \|\| '0' \}\}/);
  });

  it('uploads each shard under its own artifact name', () => {
    const upload = step('e2e report');
    assert.match(upload.block, /^ {10}name: e2e-report-\$\{\{ matrix\.shard \}\}$/m);
  });

  it('ends with a done step that marks the shard unless the job was cancelled', () => {
    assert.equal(names.at(-1), 'done');
    assert.equal(step('done').condition, '${{ !cancelled() }}');
    assert.equal(step('done').id, 'done');
    assert.equal(step('done').run, 'echo \'done=1\' >> "$GITHUB_OUTPUT"');
    for (const shard of SHARD_NUMBERS) {
      assert.match(
        job('e2e'),
        new RegExp(
          `^ {6}e2e_done_${shard}: \\$\\{\\{ matrix\\.shard == ${shard} && steps\\.done\\.outputs\\.done \\|\\| '' \\}\\}$`,
          'm',
        ),
        `e2e_done_${shard}`,
      );
      assert.match(
        job('nightly-issue'),
        new RegExp(
          `^ {6}E2E_DONE_${shard}: \\$\\{\\{ needs\\.e2e\\.outputs\\.e2e_done_${shard} \\}\\}$`,
          'm',
        ),
        `E2E_DONE_${shard}`,
      );
    }
    assert.doesNotMatch(job('e2e'), new RegExp(`e2e_(?:failures|done)_${SHARDS + 1}:`));
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
          E2E_RESULT: 'failure',
          PRODUCTION_RESULT: 'success',
          E2E_SHARDS: String(SHARDS),
          ...Object.fromEntries(SHARD_NUMBERS.map((shard) => [`E2E_DONE_${shard}`, '1'])),
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
      E2E_FAILURES_1: JSON.stringify(['chromium-desktop: e2e/a.spec.ts:3: boom']),
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
        E2E_FAILURES_1: JSON.stringify([
          'chromium-desktop: e2e/a.spec.ts:3: ping @owner about #12 `x`',
        ]),
      });
      assert.match(calls, /- `chromium-desktop: e2e\/a\.spec\.ts:3: ping @owner about #12 'x'`/);
    },
  );

  it('comments on the open issue instead of opening a second one', { skip }, () => {
    const calls = runIssueStep(
      { PRODUCTION_FAILURES: '["chromium-mobile: e2e/b.spec.ts:9: bang"]' },
      JSON.stringify([
        { number: 12, title: 'Something else' },
        { number: 41, title: 'Nightly e2e failed on main' },
      ]),
    );
    assert.match(calls, /ARGS: \[issue\] \[comment\] \[41\] \[--body\]/);
    assert.doesNotMatch(calls, /\[create\]/);
    assert.match(calls, /bang/);
  });

  it('lists the failures of every shard and of e2e-production in one comment', { skip }, () => {
    const calls = runIssueStep({
      E2E_FAILURES_1: JSON.stringify(['chromium-desktop: e2e/a.spec.ts:3: boom']),
      E2E_FAILURES_3: JSON.stringify(['chromium-mobile: e2e/b.spec.ts:5: crash']),
      PRODUCTION_FAILURES: JSON.stringify(['chromium-mobile: e2e/pwa.spec.ts:120: offline']),
    });
    assert.match(
      calls,
      /- `chromium-desktop: e2e\/a\.spec\.ts:3: boom`\n- `chromium-mobile: e2e\/b\.spec\.ts:5: crash`\n- `chromium-mobile: e2e\/pwa\.spec\.ts:120: offline`/,
    );
  });

  it(`keeps one list when the other ${SHARDS} shards are empty or unreadable`, { skip }, () => {
    for (const other of ['', '[]', 'not json', '{"a":1}']) {
      const calls = runIssueStep({
        ...Object.fromEntries(SHARD_NUMBERS.map((shard) => [`E2E_FAILURES_${shard}`, other])),
        PRODUCTION_FAILURES: JSON.stringify(['chromium-mobile: e2e/pwa-update.spec.ts:4: update']),
      });
      assert.match(calls, /- `chromium-mobile: e2e\/pwa-update\.spec\.ts:4: update`/, other);
      assert.doesNotMatch(calls, /No failing test was recorded/, other);
    }
  });

  it('says no failing test was recorded when the list is empty or unreadable', { skip }, () => {
    for (const failures of ['[]', '', 'not json']) {
      const calls = runIssueStep({ E2E_FAILURES_2: failures, PRODUCTION_FAILURES: failures });
      assert.match(calls, /\[create\]/, failures);
      assert.match(calls, /No failing test was recorded/, failures);
      assert.match(calls, /Run: https:\/\/github\.com\/o\/r\/actions\/runs\/7/, failures);
    }
  });

  const firstLine = (calls) => /\[--body\] \[([^\n]*)/.exec(calls)?.[1];
  const tests = (count, prefix) =>
    Array.from(
      { length: count },
      (_, index) => `chromium-mobile: e2e/${prefix}.spec.ts:${index + 1}: t`,
    );

  it('says FAIL and names no shard when every shard finished', { skip }, () => {
    const calls = runIssueStep({ E2E_FAILURES_2: JSON.stringify(tests(1, 'a')) });
    assert.equal(firstLine(calls), 'Nightly e2e: FAIL (main abcdef0)');
    assert.doesNotMatch(calls, /did not finish/);
  });

  it(
    'says CANCELLED when e2e was cancelled, and names each shard with no done marker',
    { skip },
    () => {
      const calls = runIssueStep({
        E2E_RESULT: 'cancelled',
        E2E_DONE_2: '',
        E2E_DONE_4: '',
        E2E_FAILURES_1: JSON.stringify(tests(1, 'a')),
      });
      assert.equal(firstLine(calls), 'Nightly e2e: CANCELLED (main abcdef0)');
      assert.match(calls, new RegExp(`- \`e2e\` shard 2 of ${SHARDS} did not finish`));
      assert.match(calls, new RegExp(`- \`e2e\` shard 4 of ${SHARDS} did not finish`));
      assert.doesNotMatch(calls, /shard [13] of/);
      assert.match(calls, /- `chromium-mobile: e2e\/a\.spec\.ts:1: t`/);
    },
  );

  it(
    'says CANCELLED and names the shard when one shard failed and another never finished',
    { skip },
    () => {
      const calls = runIssueStep({
        E2E_RESULT: 'failure',
        E2E_DONE_3: '',
        E2E_FAILURES_1: JSON.stringify(tests(2, 'a')),
      });
      assert.equal(firstLine(calls), 'Nightly e2e: CANCELLED (main abcdef0)');
      assert.match(calls, new RegExp(`- \`e2e\` shard 3 of ${SHARDS} did not finish`));
      assert.match(calls, /a\.spec\.ts:2: t/);
    },
  );

  it(
    'says CANCELLED for a cancelled e2e-production, with e2e failed or cancelled',
    { skip },
    () => {
      for (const e2e of ['failure', 'cancelled']) {
        const calls = runIssueStep({ E2E_RESULT: e2e, PRODUCTION_RESULT: 'cancelled' });
        assert.equal(firstLine(calls), 'Nightly e2e: CANCELLED (main abcdef0)', e2e);
        assert.match(calls, /- `e2e-production` did not finish/, e2e);
        assert.doesNotMatch(calls, /`e2e` shard/, e2e);
      }
    },
  );

  it(
    'says CANCELLED when e2e failed and e2e-production was cancelled, or the reverse',
    { skip },
    () => {
      const failed = runIssueStep({
        E2E_RESULT: 'failure',
        PRODUCTION_RESULT: 'cancelled',
        E2E_FAILURES_1: JSON.stringify(tests(1, 'a')),
      });
      assert.equal(firstLine(failed), 'Nightly e2e: CANCELLED (main abcdef0)');
      const reverse = runIssueStep({
        E2E_RESULT: 'cancelled',
        PRODUCTION_RESULT: 'failure',
        PRODUCTION_FAILURES: JSON.stringify(tests(1, 'p')),
        ...Object.fromEntries(SHARD_NUMBERS.map((shard) => [`E2E_DONE_${shard}`, ''])),
      });
      assert.equal(firstLine(reverse), 'Nightly e2e: CANCELLED (main abcdef0)');
      assert.match(reverse, /p\.spec\.ts:1: t/);
    },
  );

  it('names no shard when e2e was skipped', { skip }, () => {
    const calls = runIssueStep({
      E2E_RESULT: 'skipped',
      PRODUCTION_RESULT: 'failure',
      PRODUCTION_FAILURES: JSON.stringify(tests(1, 'p')),
      ...Object.fromEntries(SHARD_NUMBERS.map((shard) => [`E2E_DONE_${shard}`, ''])),
    });
    assert.equal(firstLine(calls), 'Nightly e2e: FAIL (main abcdef0)');
    assert.doesNotMatch(calls, /did not finish/);
  });

  it(
    'lists 30 tests and one "and <total> more" line for a night that fails in every shard',
    { skip },
    () => {
      const legs = Object.fromEntries(
        SHARD_NUMBERS.map((shard) => [
          `E2E_FAILURES_${shard}`,
          JSON.stringify([...tests(30, `leg${shard}`), 'and 5 more']),
        ]),
      );
      const calls = runIssueStep(legs);
      assert.equal(calls.match(/^- `chromium-mobile: /gm)?.length, 30);
      const total = SHARDS * 5 + (SHARDS * 30 - 30);
      assert.equal(total, 320);
      assert.equal(calls.match(/^- `and \d+ more`\]?$/gm)?.length, 1);
      assert.match(calls, /^- `and 320 more`\]?$/m);
    },
  );

  it('adds no "and <total> more" line when nothing is over the cap', { skip }, () => {
    const calls = runIssueStep({
      E2E_FAILURES_1: JSON.stringify(tests(20, 'a')),
      E2E_FAILURES_2: JSON.stringify(tests(10, 'b')),
    });
    assert.equal(calls.match(/^- `chromium-mobile: /gm)?.length, 30);
    assert.doesNotMatch(calls, / more`/);
  });

  it('keeps every expected tests and run error line when it caps the list', { skip }, () => {
    const calls = runIssueStep({
      E2E_FAILURES_1: JSON.stringify([...tests(40, 'a'), 'run error: Timed out waiting 1800s']),
      E2E_FAILURES_2: JSON.stringify(['run error: webServer failed']),
      PRODUCTION_FAILURES: JSON.stringify(['expected tests: pwa.spec.ts listed 9, expected 10']),
    });
    assert.equal(calls.match(/^- `chromium-mobile: /gm)?.length, 30);
    assert.match(calls, /^- `and 10 more`$/m);
    assert.match(calls, /^- `run error: Timed out waiting 1800s`\]?$/m);
    assert.match(calls, /^- `run error: webServer failed`\]?$/m);
    assert.match(calls, /^- `expected tests: pwa\.spec\.ts listed 9, expected 10`$/m);
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
    assert.match(job('nightly-issue'), /needs\.e2e-production\.result == 'failure'/);
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

  it('counts a night as green only when the whole workflow run succeeded', () => {
    const script = stepScript('last green night');
    assert.match(script, /gh run list --workflow e2e\.yml /);
    assert.match(script, / --status success /);
    assert.doesNotMatch(script, /--job|\.jobs/, 'the run status, not one job');
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

describe('a shard that reaches the global timeout', () => {
  const steps = e2eSteps();
  const found = (name) => steps.find((step) => step.name === name);

  it('still uploads its report after a failed e2e step, and before it is marked done', () => {
    assert.equal(
      found('e2e report')?.condition,
      "${{ !cancelled() && (steps.e2e.outcome == 'success' || steps.e2e.outcome == 'failure') }}",
    );
    const names = steps.map((step) => step.name);
    assert.ok(names.indexOf('e2e report') < names.indexOf('done'), names.join(', '));
  });

  it('leaves the e2e step to fail by itself, with no continue-on-error to hide it', () => {
    assert.doesNotMatch(found('e2e')?.block ?? '', /continue-on-error/);
  });

  it('keeps the global timeout shorter than the job limit by the setup and report budget', () => {
    const limit = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(job('e2e'))?.[1]);
    const globalMs = Number(/--global-timeout=(\d+)/.exec(found('e2e')?.run ?? '')?.[1]);
    assert.equal(globalMs, GLOBAL_TIMEOUT_MS);
    assert.ok(globalMs < limit * 60_000);
  });
});

describe('the sharded nightly in the docs', () => {
  const read = (...path) => readFileSync(join(import.meta.dirname, '..', ...path), 'utf8');
  const ci = read('docs', 'process', 'ci.md');
  const adr = read('docs', 'decisions', '0009-ci-pipeline.md');
  const amendment = 'Amendment: sharded nightly e2e and a reported cancel';

  it('amends the CI pipeline decision in a header line and in a section', () => {
    assert.match(adr, new RegExp(`^- \\*\\*Amended:\\*\\* 2026-11-05 .*"${amendment}`, 'm'));
    assert.match(adr, new RegExp(`^## ${amendment} \\(2026-11-05\\)$`, 'm'));
  });

  it('defines the term Shard in the glossary', () => {
    assert.match(read('docs', 'glossary.md'), /^- \*\*Shard:\*\* /m);
  });

  it('names the sharded e2e command and the per-shard artifact in ci.md', () => {
    assert.ok(
      ci.includes(`npm run e2e -- --shard=<n>/${SHARDS} --global-timeout=${GLOBAL_TIMEOUT_MS}`),
    );
    const reportRow = ci.split('\n').find((line) => line.startsWith('| `e2e report`'));
    assert.match(reportRow ?? '', /`e2e-report-<n>`/);
    const inventoryRow = ci
      .split('\n')
      .find((line) => line.startsWith('| `actions/upload-artifact`'));
    assert.match(inventoryRow ?? '', /`e2e-report-<n>`/);
  });

  it('records the shard runs, and names the re-shard trigger and the browser cache decision in ci.md', () => {
    for (const run of ['42126470169', '42130571352', '42135507342']) {
      assert.ok(ci.includes(`actions/runs/${run}`), run);
    }
    for (const leadIn of [
      'Re-shard trigger',
      'Why there is no browser cache',
      'Why shards are uneven',
    ]) {
      assert.ok(ci.includes(`**${leadIn}.**`), leadIn);
    }
    assert.ok(ci.includes('`run error: Timed out waiting`'), 'the line the trigger reads');
  });

  it('gives the batch run fallback the measured nightly runner minutes, not the one-job 25 minutes', () => {
    const measured =
      /^\| Nightly full run on `main`, sharded, measured .*?\*\*(\d+) minutes\*\*/m.exec(ci)?.[1];
    assert.ok(measured, 'the measured row of ci.md');
    const devCycle = read('docs', 'process', 'dev-cycle.md');
    assert.doesNotMatch(devCycle, /about 25 CI minutes/);
    assert.ok(devCycle.includes(`${measured} runner minutes`), `${measured} runner minutes`);
  });
});
