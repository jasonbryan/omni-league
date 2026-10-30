// A spec that skips, or that its project's filter never lists, still exits Playwright 0, so the job
// compares each run's JSON report against this table.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** @typedef {{ name: string, spec: string, project: string, tests: number }} ProductionRun */

/** @type {readonly ProductionRun[]} */
export const PRODUCTION_RUNS = Object.freeze(
  [
    { name: 'production-mobile', spec: 'e2e/pwa.spec.ts', project: 'chromium-mobile', tests: 10 },
    {
      name: 'production-desktop',
      spec: 'e2e/harness/no-service-worker.spec.ts',
      project: 'chromium-desktop',
      tests: 2,
    },
    { name: 'pwa-update', spec: 'e2e/pwa-update.spec.ts', project: 'chromium-mobile', tests: 1 },
    {
      name: 'kill-switch',
      spec: 'e2e/pwa-kill-switch.spec.ts',
      project: 'chromium-mobile',
      tests: 1,
    },
  ].map((run) => Object.freeze(run)),
);

export const REPORT_ROOT = 'test-results';

const RAN = new Set(['expected', 'unexpected', 'flaky']);

/** @param {string} root @param {ProductionRun} run */
export function reportPath(root, run) {
  return join(root, run.name, 'results.json');
}

/**
 * @param {unknown} report
 * @returns {{ spec: string, project: string, status: string, title: string }[]}
 */
function listedTests(report) {
  const tests = [];
  /** @param {any} suite @param {string[]} titles */
  const walk = (suite, titles) => {
    for (const child of suite.suites ?? []) {
      walk(child, child.file && child.title === child.file ? titles : [...titles, child.title]);
    }
    for (const found of suite.specs ?? []) {
      for (const test of found.tests ?? []) {
        // Playwright reports the file relative to e2e/.
        const spec = `e2e/${found.file}`;
        tests.push({
          spec,
          project: test.projectName,
          status: test.status,
          title: `${spec}:${found.line}: ${[...titles, found.title].join(' › ')}`,
        });
      }
    }
  };
  walk({ suites: /** @type {any} */ (report)?.suites ?? [] }, []);
  return tests;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * @param {ProductionRun} run
 * @param {unknown} report the parsed JSON report, or undefined when there is none
 * @param {{ path?: string }} [options]
 * @returns {{ summary: string, problems: string[] }}
 */
export function checkRun(run, report, { path = reportPath(REPORT_ROOT, run) } = {}) {
  const label = `${run.name}: ${run.spec} on ${run.project}`;
  if (report === undefined) {
    const problem = `${label}: no report (${path}): the run did not finish`;
    return { summary: problem, problems: [problem] };
  }
  const tests = listedTests(report);
  const own = tests.filter((test) => test.spec === run.spec && test.project === run.project);
  const problems = [];
  if (own.length !== run.tests) {
    problems.push(`${label}: lists ${plural(own.length, 'test')}, expected ${run.tests}`);
  }
  for (const test of own) {
    if (!RAN.has(test.status)) problems.push(`${label}: ${test.status}: ${test.title}`);
  }
  const elsewhere = new Map();
  for (const test of tests) {
    if (test.spec === run.spec && test.project === run.project) continue;
    const key = `${test.spec}\u0000${test.project}`;
    elsewhere.set(key, (elsewhere.get(key) ?? 0) + 1);
  }
  for (const [key, count] of elsewhere) {
    const [spec, project] = key.split('\u0000');
    problems.push(
      spec === run.spec
        ? `${label}: ${plural(count, 'test')} listed under ${project}`
        : `${label}: the run also lists ${spec} on ${project} (${plural(count, 'test')})`,
    );
  }
  const count = (status) => own.filter((test) => test.status === status).length;
  const ran = own.filter((test) => RAN.has(test.status)).length;
  const summary =
    `${label}: ${ran} of ${run.tests} run ` +
    `(${count('expected')} passed, ${count('unexpected')} failed, ${count('flaky')} flaky)`;
  return { summary, problems };
}

/** @param {string} path @returns {unknown} */
function readReport(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** @param {string} [root] */
export function checkReports(root = REPORT_ROOT) {
  const summaries = [];
  const problems = [];
  for (const run of PRODUCTION_RUNS) {
    const path = reportPath(root, run);
    const result = checkRun(run, readReport(path), { path });
    summaries.push(result.summary);
    problems.push(...result.problems);
  }
  return { summaries, problems };
}

if (import.meta.main) {
  const { summaries, problems } = checkReports(process.argv[2]);
  for (const line of summaries) console.log(line);
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}
