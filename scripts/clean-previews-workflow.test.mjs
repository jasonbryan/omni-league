// Checks of .github/workflows/clean-previews.yml (#158). Run with `npm run test:scripts` (node:test).
// Node built-ins only: the file is read with regular expressions, not a YAML parser. The rules come
// from docs/process/ci.md (Workflow security) plus the owner's exception for CONVEX_TEAM_TOKEN.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
      /actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+persist-credentials: false/,
    );
    assert.ok(!/npm (ci|install)/.test(code));
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
