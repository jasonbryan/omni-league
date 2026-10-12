// The failing e2e tests of a Playwright JSON report, for the nightly issue (#186, docs/process/ci.md).
// Node built-ins only. Usage: `node scripts/e2e-failures.mjs [report.json]` (default test-results/results.json).
// Prints one `failures=<JSON array of strings>` line for $GITHUB_OUTPUT: a test that failed every
// attempt (`unexpected`; a `flaky` test passed on retry), as `project: e2e/file:line: title` (Playwright reports the file relative to e2e/), at most
// MAX_LISTED of them with a final "and N more" entry, then the first line of any run-level error
// (a failed global setup, a config error). A report that is missing or unreadable gives `[]`; the
// issue then names the run and says no failing test was recorded.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MAX_LISTED = 30;

/** The first line of a message with terminal colour codes removed, capped in length. */
function firstLine(message) {
  const text = String(message ?? '')
    // eslint-disable-next-line no-control-regex -- ANSI escapes in Playwright messages
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .find((line) => line.trim() !== '');
  return (text ?? '').trim().slice(0, 200);
}

/**
 * @param {unknown} report Parsed Playwright JSON report.
 * @returns {string[]}
 */
export function failingTests(report) {
  const failures = [];
  /** @param {any} suite @param {string[]} titles */
  const walk = (suite, titles) => {
    for (const child of suite.suites ?? []) {
      // The file-level suite is titled with the file name; the spec records the file itself.
      walk(child, child.file && child.title === child.file ? titles : [...titles, child.title]);
    }
    for (const found of suite.specs ?? []) {
      for (const test of found.tests ?? []) {
        if (test.status !== 'unexpected') continue;
        const title = [...titles, found.title].join(' › ');
        failures.push(`${test.projectName}: e2e/${found.file}:${found.line}: ${title}`);
      }
    }
  };
  const root = /** @type {any} */ (report);
  walk({ suites: root?.suites ?? [] }, []);
  failures.sort();
  const listed = failures.slice(0, MAX_LISTED);
  if (failures.length > MAX_LISTED) listed.push(`and ${failures.length - MAX_LISTED} more`);
  for (const error of root?.errors ?? []) {
    const line = firstLine(error?.message);
    if (line) listed.push(`run error: ${line}`);
  }
  return listed;
}

/** @param {string} path @returns {string[]} */
export function failuresFromFile(path) {
  try {
    return failingTests(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return [];
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = failuresFromFile(process.argv[2] ?? 'test-results/results.json');
  process.stdout.write(`failures=${JSON.stringify(failures)}\n`);
}
