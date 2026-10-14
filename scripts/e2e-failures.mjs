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
