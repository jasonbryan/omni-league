import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const workflow = readFileSync(
  join(import.meta.dirname, '..', '.github', 'workflows', 'staging-rebuild.yml'),
  'utf8',
);
const code = workflow
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');

const HOOK_URL = 'https://api.example.test/build_hooks/SECRET-HOOK-ID';
const STAGING_URL = 'https://staging.example.test';

/** @param {string} name */
function job(name) {
  const block = new RegExp(`^ {2}${name}:\\n([\\s\\S]*?)(?=^ {2}\\S|(?![\\s\\S]))`, 'm').exec(code);
  assert.ok(block, `job ${name} not found`);
  return block[1];
}

/** @param {string} jobName */
function steps(jobName) {
  return [...job(jobName).matchAll(/^ {6}- ([\s\S]*?)(?=^ {6}- |(?![\s\S]))/gm)].map(
    (match) => `      - ${match[1]}`,
  );
}

/** @param {string} jobName @param {string} name */
function step(jobName, name) {
  const found = steps(jobName).find((block) => block.includes(`- name: ${name}\n`));
  assert.ok(found, `step ${name} not found`);
  return found;
}

/** @param {string} jobName @param {string} name */
function stepScript(jobName, name) {
  const block = /^ {8}run: \|\n((?: {10}.*\n|\n)+)/m.exec(step(jobName, name));
  assert.ok(block, `${name}: run script not found`);
  return block[1].replace(/^ {10}/gm, '');
}

describe('the staging rebuild triggers and permissions', () => {
  it('runs only on the schedule every 2 days and by hand', () => {
    const on = /^on:\n([\s\S]*?)(?=^\S)/m.exec(code)?.[1] ?? '';
    assert.deepEqual(
      [...on.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]),
      ['schedule', 'workflow_dispatch'],
    );
    assert.match(on, /^ {4}- cron: '17 9 \*\/2 \* \*'$/m);
  });

  it('grants the workflow no permissions', () => {
    assert.match(code, /^permissions: \{\}$/m);
  });

  it('has no pull_request, pull_request_target, or workflow_run trigger', () => {
    assert.doesNotMatch(code, /pull_request|workflow_run/);
  });
});

describe('the staging rebuild secret', () => {
  const reference = 'secrets.STAGING_BUILD_HOOK_URL';

  it('is referenced twice: as a boolean in secret check and as the value in trigger', () => {
    assert.equal(code.split(reference).length - 1, 2);
    assert.match(
      step('rebuild', 'secret check'),
      /^ {8}env:\n {10}HAS_HOOK: \$\{\{ secrets\.STAGING_BUILD_HOOK_URL != '' \}\}$/m,
    );
    assert.match(
      step('rebuild', 'trigger'),
      /^ {8}env:\n {10}HOOK_URL: \$\{\{ secrets\.STAGING_BUILD_HOOK_URL \}\}$/m,
    );
  });

  it('is never inside a run script, echoed, or traced', () => {
    for (const block of steps('rebuild')) {
      const script = /^ {8}run: \|\n((?: {10}.*\n|\n)+)/m.exec(block)?.[1] ?? '';
      assert.doesNotMatch(script, /\$\{\{/, 'no expression inside run');
    }
    assert.doesNotMatch(code, /set -[a-z]*x|set -o xtrace/);
    const uses = code.split('\n').filter((line) => /\$\{?HOOK_URL\b/.test(line));
    assert.deepEqual(uses, ['            "${HOOK_URL}?trigger_title=scheduled+staging+rebuild"']);
  });

  it('is limited to the staging-rebuild environment', () => {
    assert.match(job('rebuild'), /^ {4}environment: staging-rebuild$/m);
    assert.ok(!/environment:\s*\n|environment:.*\$\{\{/.test(code));
  });
});

describe('the staging rebuild jobs', () => {
  it('rebuild has the four steps in order, a timeout, no permissions, and no action', () => {
    const rebuild = job('rebuild');
    const named = steps('rebuild').map((block) => ({
      name: /^ {6}- name: (.+)$/m.exec(block)?.[1],
      id: /^ {8}id: (.+)$/m.exec(block)?.[1],
    }));
    assert.deepEqual(named, [
      { name: 'secret check', id: 'secret-check' },
      { name: 'slot before', id: 'slot-before' },
      { name: 'trigger', id: 'trigger' },
      { name: 'verify', id: 'verify' },
    ]);
    assert.match(rebuild, /^ {4}timeout-minutes: 35$/m);
    assert.doesNotMatch(rebuild, /^ {4}permissions:/m);
    assert.doesNotMatch(rebuild, /uses:/);
  });

  it('rebuild names the first failed step in its outputs from every step outcome', () => {
    const output = /^ {6}failed_step: (.+)$/m.exec(job('rebuild'))?.[1] ?? '';
    const ids = ['secret-check', 'slot-before', 'trigger', 'verify'];
    const positions = ids.map((id) => output.indexOf(`steps.${id}.outcome == 'failure'`));
    assert.ok(
      positions.every(
        (position, index) => position >= 0 && (index === 0 || position > positions[index - 1]),
      ),
      output,
    );
  });

  it('rebuild-issue runs only after a failed scheduled rebuild, with issues: write only', () => {
    const issue = job('rebuild-issue');
    assert.match(issue, /^ {4}needs: rebuild$/m);
    assert.match(
      issue,
      /^ {4}if: \$\{\{ !cancelled\(\) && needs\.rebuild\.result == 'failure' && github\.event_name == 'schedule' \}\}$/m,
    );
    assert.match(issue, /^ {4}timeout-minutes: 5$/m);
    assert.match(issue, /^ {4}permissions:\n {6}issues: write\n(?! {6}\S)/m, 'only issues: write');
    assert.doesNotMatch(issue, /uses:/);
    assert.match(issue, /FAILED_STEP: \$\{\{ needs\.rebuild\.outputs\.failed_step \}\}/);
    const script = stepScript('rebuild-issue', 'open or update the issue');
    assert.doesNotMatch(script, /\$\{\{/);
  });
});

/**
 * @param {string} dir
 * @param {string} name
 * @param {string[]} lines
 */
function writeStub(dir, name, lines) {
  const path = join(dir, name);
  writeFileSync(path, ['#!/bin/sh', ...lines, ''].join('\n'));
  chmodSync(path, 0o755);
}

/**
 * @param {string} jobName
 * @param {string} name
 * @param {{ env?: Record<string, string>, stubs?: (dir: string) => void }} options
 */
function runStep(jobName, name, { env = {}, stubs = () => {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'staging-rebuild-'));
  try {
    stubs(dir);
    const output = join(dir, 'github-output');
    writeFileSync(output, '');
    const result = spawnSync('bash', ['-e', '-c', stepScript(jobName, name)], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        GITHUB_OUTPUT: output,
        STAGING_URL,
        STUB_DIR: dir,
        ...env,
      },
    });
    const read = (file) => {
      try {
        return readFileSync(join(dir, file), 'utf8');
      } catch {
        return '';
      }
    };
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      githubOutput: readFileSync(output, 'utf8'),
      calls: read('calls'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A curl that logs every call to "calls". Reads of staging-slot.txt answer the next word of
 * SLOTS (the last word repeats; "_" is an empty body). The org page answers PAGE_BODY and
 * PAGE_STATUS. Any other URL is the hook and answers HOOK_EXIT.
 */
function curlStub(dir) {
  writeStub(dir, 'curl', [
    'echo "$*" >> "$STUB_DIR/calls"',
    'for url; do :; done',
    'case "$url" in',
    '  */staging-slot.txt)',
    '    n=$(cat "$STUB_DIR/count" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$STUB_DIR/count"',
    '    word=$(printf "%s\\n" $SLOTS | sed -n "${n}p"); [ -n "$word" ] || word=$(printf "%s\\n" $SLOTS | tail -n 1)',
    '    [ "$word" = "_" ] && word=""',
    '    printf "%s" "$word" ;;',
    '  */organizations/*) printf "%s\\n%s" "$PAGE_BODY" "$PAGE_STATUS" ;;',
    '  *) exit "${HOOK_EXIT:-0}" ;;',
    'esac',
  ]);
}

describe('the secret check step', () => {
  it('fails with one error naming the secret when it is unset, and posts nothing', () => {
    for (const value of ['false', '']) {
      const run = runStep('rebuild', 'secret check', {
        env: { HAS_HOOK: value },
        stubs: curlStub,
      });
      assert.equal(run.status, 1, value);
      assert.equal(run.output.match(/::error/g)?.length, 1);
      assert.match(run.output, /STAGING_BUILD_HOOK_URL/);
      assert.equal(run.calls, '');
    }
  });

  it('passes when the secret is set', () => {
    const run = runStep('rebuild', 'secret check', { env: { HAS_HOOK: 'true' }, stubs: curlStub });
    assert.equal(run.status, 0);
    assert.equal(run.calls, '');
  });
});

describe('the slot before step', () => {
  it('records the slot staging serves', () => {
    for (const slot of ['staging-a', 'staging-b']) {
      const run = runStep('rebuild', 'slot before', { env: { SLOTS: slot }, stubs: curlStub });
      assert.equal(run.status, 0);
      assert.equal(run.githubOutput, `slot=${slot}\n`);
    }
  });

  it('records unknown for an empty, wrong, or missing body', () => {
    for (const slot of ['_', 'staging-c', 'Not Found']) {
      const run = runStep('rebuild', 'slot before', { env: { SLOTS: slot }, stubs: curlStub });
      assert.equal(run.status, 0, slot);
      assert.equal(run.githubOutput, 'slot=unknown\n', slot);
    }
    const run = runStep('rebuild', 'slot before', {
      env: { SLOTS: 'staging-a' },
      stubs: (dir) => writeStub(dir, 'curl', ['exit 22']),
    });
    assert.equal(run.status, 0);
    assert.equal(run.githubOutput, 'slot=unknown\n');
  });
});

describe('the trigger step', () => {
  it('posts an empty JSON body with a title to the hook, with retries and a timeout', () => {
    const run = runStep('rebuild', 'trigger', { env: { HOOK_URL }, stubs: curlStub });
    assert.equal(run.status, 0);
    assert.equal(run.calls.trim().split('\n').length, 1);
    assert.match(run.calls, /--fail/);
    assert.match(run.calls, /--max-time 30/);
    assert.match(run.calls, /--retry 2/);
    assert.match(run.calls, /-X POST/);
    assert.match(run.calls, /-d \{\}/);
    assert.ok(run.calls.includes(`${HOOK_URL}?trigger_title=scheduled+staging+rebuild`));
  });

  it('fails when the hook answers an error, and never prints the hook URL', () => {
    const run = runStep('rebuild', 'trigger', {
      env: { HOOK_URL, HOOK_EXIT: '22' },
      stubs: curlStub,
    });
    assert.notEqual(run.status, 0);
    assert.ok(!run.output.includes('SECRET-HOOK-ID'));
    const ok = runStep('rebuild', 'trigger', { env: { HOOK_URL }, stubs: curlStub });
    assert.ok(!ok.output.includes('SECRET-HOOK-ID'));
  });
});

describe('the trigger step with the real curl', () => {
  const secretPath = 'SECRET-HOOK-ID';

  it('does not print the hook path when curl cannot connect or rejects the URL', () => {
    for (const hookUrl of [
      `http://127.0.0.1:1/build_hooks/${secretPath}`,
      `ht!tp://127.0.0.1/build_hooks/${secretPath}`,
      '',
    ]) {
      const run = runStep('rebuild', 'trigger', { env: { HOOK_URL: hookUrl } });
      assert.notEqual(run.status, 0, hookUrl);
      assert.ok(!run.output.includes(secretPath), run.output);
      assert.ok(!run.output.includes('trigger_title'), run.output);
    }
  });
});

describe('the verify step', () => {
  const page = 'Gulf Coast Sport &amp; Social';
  // bash counts whole seconds, so a limit of 1 can end in under a second.
  const fast = { POLL_SECONDS: '0.05', POLL_LIMIT_SECONDS: '5' };

  /** @param {Record<string, string>} env */
  function verify(env) {
    return runStep('rebuild', 'verify', {
      env: { PAGE_STATUS: '200', PAGE_BODY: page, ...fast, ...env },
      stubs: curlStub,
    });
  }

  it('passes when the slot flips and the organization page answers 200 with its name', () => {
    const run = verify({ SLOT_BEFORE: 'staging-a', SLOTS: 'staging-a staging-a staging-b' });
    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /Staging now serves staging-b \(it served staging-a\)/);
  });

  it('passes when the slot flips from unknown, and matches the name unencoded', () => {
    const run = verify({
      SLOT_BEFORE: 'unknown',
      SLOTS: '_ staging-a',
      PAGE_BODY: 'x Gulf Coast Sport & Social x',
    });
    assert.equal(run.status, 0, run.output);
  });

  it('ignores an unreadable body while waiting', () => {
    const run = verify({ SLOT_BEFORE: 'staging-b', SLOTS: '_ garbage staging-a' });
    assert.equal(run.status, 0, run.output);
  });

  it('does not count an unreadable body as a flip while waiting', () => {
    const run = verify({
      SLOT_BEFORE: 'staging-a',
      SLOTS: '_ garbage staging-a',
      POLL_LIMIT_SECONDS: '1',
    });
    assert.equal(run.status, 1);
    assert.match(run.output, /::error[^\n]*still reads staging-a/);
    assert.doesNotMatch(run.calls, /organizations/, 'no page check without a flip');
  });

  it('fails with an error naming the last slot when the slot never flips', () => {
    const run = verify({ SLOT_BEFORE: 'staging-a', SLOTS: 'staging-a', POLL_LIMIT_SECONDS: '1' });
    assert.equal(run.status, 1);
    assert.equal(run.output.match(/::error/g)?.length, 1);
    assert.match(run.output, /::error[^\n]*still reads staging-a/);
    assert.doesNotMatch(run.calls, /organizations/, 'no page check without a flip');
  });

  it('names unknown as the last slot when the file never becomes readable', () => {
    const run = verify({ SLOT_BEFORE: 'unknown', SLOTS: '_', POLL_LIMIT_SECONDS: '1' });
    assert.equal(run.status, 1);
    assert.match(run.output, /::error[^\n]*still reads unknown/);
  });

  it('fails when the organization page is not 200', () => {
    const run = verify({ SLOT_BEFORE: 'staging-a', SLOTS: 'staging-b', PAGE_STATUS: '503' });
    assert.equal(run.status, 1);
    assert.match(run.output, /::error[^\n]*status 503/);
  });

  it('fails when the organization page lacks the name', () => {
    const run = verify({ SLOT_BEFORE: 'staging-a', SLOTS: 'staging-b', PAGE_BODY: 'Not found' });
    assert.equal(run.status, 1);
    assert.match(run.output, /::error[^\n]*without the name/);
  });
});

describe('the rebuild issue step', () => {
  const hasJq = spawnSync('jq', ['--version']).status === 0;
  const skip = hasJq ? false : 'jq is not installed';

  /**
   * @param {Record<string, string>} env
   * @param {string} existing
   */
  function runIssue(env, existing = '[]') {
    return runStep('rebuild-issue', 'open or update the issue', {
      env: {
        EXISTING: existing,
        RUN_URL: 'https://github.com/o/r/actions/runs/7',
        ISSUE_TITLE: 'Scheduled staging rebuild failed',
        FAILED_STEP: 'verify',
        ...env,
      },
      stubs: (dir) =>
        writeStub(dir, 'gh', [
          'if [ "$1 $2" = "issue list" ]; then printf \'%s\' "$EXISTING"; exit 0; fi',
          '{ printf \'ARGS:\'; for a in "$@"; do printf \' [%s]\' "$a"; done; printf \'\\n\'; } >> "$STUB_DIR/calls"',
        ]),
    }).calls;
  }

  it('opens an issue with the three labels, the run link, and the failed step', { skip }, () => {
    const calls = runIssue({});
    assert.match(
      calls,
      /ARGS: \[issue\] \[create\] \[--title\] \[Scheduled staging rebuild failed\]/,
    );
    assert.match(
      calls,
      /\[--label\] \[type:bug\] \[--label\] \[area:infra\] \[--label\] \[status:ready\]/,
    );
    assert.match(calls, /\[--body\] \[Scheduled staging rebuild: FAIL\n/);
    assert.match(calls, /Run: https:\/\/github\.com\/o\/r\/actions\/runs\/7/);
    assert.match(calls, /Failed step: `verify`/);
  });

  it('comments on the open issue instead of opening a second one', { skip }, () => {
    const calls = runIssue(
      { FAILED_STEP: 'trigger' },
      JSON.stringify([
        { number: 12, title: 'Something else' },
        { number: 41, title: 'Scheduled staging rebuild failed' },
      ]),
    );
    assert.match(calls, /ARGS: \[issue\] \[comment\] \[41\] \[--body\]/);
    assert.doesNotMatch(calls, /\[create\]/);
    assert.match(calls, /Failed step: `trigger`/);
  });

  it('says no step is recorded when the job was cancelled or timed out', { skip }, () => {
    const calls = runIssue({ FAILED_STEP: '' });
    assert.match(calls, /Scheduled staging rebuild: FAIL/);
    assert.match(calls, /No step is recorded as failed/);
  });
});
