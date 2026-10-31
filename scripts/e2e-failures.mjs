import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MAX_LISTED = 30;

function firstLine(message) {
  const text = String(message ?? '')
    // eslint-disable-next-line no-control-regex -- ANSI escapes in Playwright messages
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .find((line) => line.trim() !== '');
  return (text ?? '').trim().slice(0, 200);
}

/**
 * @param {unknown} report
 * @returns {{ failures: string[], errors: string[] }}
 */
function reportFailures(report) {
  const failures = [];
  /** @param {any} suite @param {string[]} titles */
  const walk = (suite, titles) => {
    for (const child of suite.suites ?? []) {
      // The file-level suite is titled with the file name; the spec records the file itself.
      walk(child, child.file && child.title === child.file ? titles : [...titles, child.title]);
    }
    for (const found of suite.specs ?? []) {
      for (const test of found.tests ?? []) {
        // `unexpected` failed every attempt; a `flaky` test passed on retry.
        if (test.status !== 'unexpected') continue;
        const title = [...titles, found.title].join(' › ');
        // Playwright reports the file relative to e2e/.
        failures.push(`${test.projectName}: e2e/${found.file}:${found.line}: ${title}`);
      }
    }
  };
  const root = /** @type {any} */ (report);
  walk({ suites: root?.suites ?? [] }, []);
  const errors = [];
  for (const error of root?.errors ?? []) {
    const line = firstLine(error?.message);
    if (line) errors.push(`run error: ${line}`);
  }
  return { failures, errors };
}

/** @param {unknown[]} reports @returns {string[]} */
function listFailures(reports) {
  const failures = [];
  const errors = [];
  for (const report of reports) {
    const found = reportFailures(report);
    failures.push(...found.failures);
    errors.push(...found.errors);
  }
  failures.sort();
  const listed = failures.slice(0, MAX_LISTED);
  if (failures.length > MAX_LISTED) listed.push(`and ${failures.length - MAX_LISTED} more`);
  return [...listed, ...errors];
}

/**
 * @param {unknown} report
 * @returns {string[]}
 */
export function failingTests(report) {
  return listFailures([report]);
}

/** @param {string} path @returns {unknown} */
function readReport(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
}

/** @param {string} path @returns {string[]} */
export function failuresFromFile(path) {
  return failuresFromFiles([path]);
}

/**
 * A missing or unreadable report adds nothing: a run that was skipped or cancelled wrote none.
 * @param {string[]} paths
 * @returns {string[]}
 */
export function failuresFromFiles(paths) {
  return listFailures(paths.map(readReport).filter((report) => report !== undefined));
}

/**
 * The problems that `scripts/e2e-production-check.mjs` wrote; a missing or malformed file adds none.
 * @param {string} path
 * @returns {string[]}
 */
export function expectedTestProblems(path) {
  const list = readReport(path);
  if (!Array.isArray(list) || !list.every((item) => typeof item === 'string')) return [];
  return list.map((problem) => `expected tests: ${problem}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--problems');
  const problemsFile = flag === -1 ? undefined : args.splice(flag, 2)[1];
  const problems = problemsFile === undefined ? [] : expectedTestProblems(problemsFile);
  const failures = failuresFromFiles(args.length > 0 ? args : ['test-results/results.json']);
  process.stdout.write(`failures=${JSON.stringify([...problems, ...failures])}\n`);
}
