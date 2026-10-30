import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { PRODUCTION_RUNS, checkReports, checkRun, reportPath } from './e2e-production-check.mjs';

const script = join(import.meta.dirname, 'e2e-production-check.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'e2e-production-check-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const run = (name) => {
  const found = PRODUCTION_RUNS.find((candidate) => candidate.name === name);
  assert.ok(found, `no run ${name}`);
  return found;
};

/** A Playwright JSON report in which the run's spec lists `tests` tests with these statuses. */
function reportFor(
  { spec, project, tests },
  { statuses = [], projectName = project, file = spec } = {},
) {
  const relative = file.replace(/^e2e\//, '');
  return {
    suites: [
      {
        title: relative,
        file: relative,
        specs: [],
        suites: [
          {
            title: 'service worker',
            file: relative,
            specs: Array.from({ length: tests }, (_, index) => ({
              file: relative,
              line: 10 + index,
              title: `test ${index + 1}`,
              tests: [{ projectName, status: statuses[index] ?? 'expected', results: [] }],
            })),
          },
        ],
      },
    ],
    errors: [],
  };
}

describe('the expected production runs', () => {
  it('lists the four runs, each with one spec, one project, and its test count', () => {
    assert.deepEqual(
      PRODUCTION_RUNS.map(({ name, spec, project, tests }) => [name, spec, project, tests]),
      [
        ['production-mobile', 'e2e/pwa.spec.ts', 'chromium-mobile', 10],
        ['production-desktop', 'e2e/harness/no-service-worker.spec.ts', 'chromium-desktop', 2],
        ['pwa-update', 'e2e/pwa-update.spec.ts', 'chromium-mobile', 1],
        ['kill-switch', 'e2e/pwa-kill-switch.spec.ts', 'chromium-mobile', 1],
      ],
    );
  });

  it('reads each run from its own report folder', () => {
    assert.equal(
      reportPath('test-results', run('pwa-update')),
      join('test-results', 'pwa-update', 'results.json'),
    );
  });
});

describe('checkRun', () => {
  it('passes a report in which every expected test ran, passed, failed, or flaky', () => {
    const mobile = run('production-mobile');
    const statuses = ['expected', 'unexpected', 'flaky'];
    assert.deepEqual(checkRun(mobile, reportFor(mobile, { statuses })).problems, []);
    assert.match(
      checkRun(mobile, reportFor(mobile, { statuses })).summary,
      /^production-mobile: e2e\/pwa\.spec\.ts on chromium-mobile: 10 of 10 run \(8 passed, 1 failed, 1 flaky\)$/,
    );
  });

  it('fails when one test is skipped, naming the spec, the project, and the test', () => {
    const mobile = run('production-mobile');
    const statuses = ['expected', 'expected', 'skipped'];
    const { problems } = checkRun(mobile, reportFor(mobile, { statuses }));
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0], /e2e\/pwa\.spec\.ts on chromium-mobile/);
    assert.match(problems[0], /skipped: e2e\/pwa\.spec\.ts:12: service worker › test 3/);
  });

  it('fails when the report has no entry for the spec', () => {
    const desktop = run('production-desktop');
    const { problems } = checkRun(desktop, { suites: [], errors: [] });
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(
      problems[0],
      /^production-desktop: e2e\/harness\/no-service-worker\.spec\.ts on chromium-desktop: lists 0 tests, expected 2$/,
    );
  });

  it('fails when the spec is listed under another project', () => {
    const desktop = run('production-desktop');
    const { problems } = checkRun(desktop, reportFor(desktop, { projectName: 'chromium-mobile' }));
    assert.ok(
      problems.some((problem) =>
        /e2e\/harness\/no-service-worker\.spec\.ts on chromium-desktop: 2 tests listed under chromium-mobile/.test(
          problem,
        ),
      ),
      problems.join('\n'),
    );
    assert.ok(
      problems.some((problem) => /lists 0 tests, expected 2$/.test(problem)),
      problems.join('\n'),
    );
  });

  it('fails when the spec lists 0 tests', () => {
    const update = run('pwa-update');
    const { problems } = checkRun(update, reportFor({ ...update, tests: 0 }));
    assert.deepEqual(problems, [
      'pwa-update: e2e/pwa-update.spec.ts on chromium-mobile: lists 0 tests, expected 1',
    ]);
  });

  it('fails when the spec lists fewer or more tests than expected', () => {
    const mobile = run('production-mobile');
    assert.deepEqual(checkRun(mobile, reportFor({ ...mobile, tests: 9 })).problems, [
      'production-mobile: e2e/pwa.spec.ts on chromium-mobile: lists 9 tests, expected 10',
    ]);
    assert.deepEqual(checkRun(mobile, reportFor({ ...mobile, tests: 11 })).problems, [
      'production-mobile: e2e/pwa.spec.ts on chromium-mobile: lists 11 tests, expected 10',
    ]);
  });

  it('fails when the run also lists a spec the table does not give it', () => {
    const kill = run('kill-switch');
    const report = reportFor(kill);
    report.suites.push(...reportFor({ ...kill, spec: 'e2e/smoke.spec.ts' }).suites);
    const { problems } = checkRun(kill, report);
    assert.deepEqual(problems, [
      'kill-switch: e2e/pwa-kill-switch.spec.ts on chromium-mobile: the run also lists e2e/smoke.spec.ts on chromium-mobile (1 test)',
    ]);
  });

  it('fails when there is no report, because the run never finished', () => {
    const { problems } = checkRun(run('kill-switch'), undefined);
    assert.deepEqual(problems, [
      'kill-switch: e2e/pwa-kill-switch.spec.ts on chromium-mobile: no report (test-results/kill-switch/results.json): the run did not finish',
    ]);
  });
});

describe('checkReports and the command line', () => {
  function writeReports(dir, reports) {
    for (const [name, report] of Object.entries(reports)) {
      mkdirSync(join(dir, name), { recursive: true });
      writeFileSync(join(dir, name, 'results.json'), JSON.stringify(report));
    }
  }

  const allPassing = () =>
    Object.fromEntries(PRODUCTION_RUNS.map((expected) => [expected.name, reportFor(expected)]));

  it('passes when every run matches the table', () => {
    const dir = join(scratch, 'pass');
    writeReports(dir, allPassing());
    const { summaries, problems } = checkReports(dir);
    assert.deepEqual(problems, []);
    assert.equal(summaries.length, PRODUCTION_RUNS.length);
    const result = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(
      result.stdout,
      /^production-mobile: e2e\/pwa\.spec\.ts on chromium-mobile: 10 of 10/m,
    );
    assert.match(result.stdout, /^kill-switch: e2e\/pwa-kill-switch\.spec\.ts on chromium-mobile/m);
  });

  it('exits 1 and names every problem, across runs, when a report is wrong or missing', () => {
    const dir = join(scratch, 'fail');
    const reports = allPassing();
    reports['production-mobile'] = reportFor(run('production-mobile'), {
      statuses: ['skipped'],
    });
    delete reports['kill-switch'];
    writeReports(dir, reports);
    const result = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /production-mobile: e2e\/pwa\.spec\.ts on chromium-mobile: .*skipped/,
    );
    assert.match(result.stderr, /kill-switch: .*no report/);
    assert.match(result.stdout, /^production-desktop: .*2 of 2 run/m);
  });

  it('reports an unreadable report as missing', () => {
    const dir = join(scratch, 'broken');
    writeReports(dir, allPassing());
    writeFileSync(join(dir, 'pwa-update', 'results.json'), '{ not json');
    const { problems } = checkReports(dir);
    assert.deepEqual(problems.length, 1);
    assert.match(problems[0], /^pwa-update: .*no report/);
  });
});
