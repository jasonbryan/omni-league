// A run that fails before any test (global setup, a crash) makes Playwright write an empty
// `failedTests` list over the earlier one, and `--last-failed` then selects nothing. Playwright has
// no option that skips that write (`LastRunReporter.onEnd`), so the earlier file is kept here.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Equal to `RUN_NAME` in e2e/support/env.ts, which an `.mjs` script cannot import.
const RUN_NAME = /^[a-z0-9][a-z0-9-]*$/;

function lastOption(args, name) {
  let value;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--') break;
    if (args[i] === name) value = args[(i += 1)];
    else if (args[i].startsWith(`${name}=`)) value = args[i].slice(name.length + 1);
  }
  return value;
}

function hasConfigOption(args) {
  const end = args.indexOf('--');
  return args
    .slice(0, end === -1 ? args.length : end)
    .some(
      (arg) =>
        arg === '-c' || arg === '--config' || arg.startsWith('--config=') || /^-c./.test(arg),
    );
}

/**
 * The file Playwright's `LastRunReporter` writes, picked in its order, or `undefined` when the
 * script cannot know it (a `--config` file may set another `outputDir`, and an invalid
 * `E2E_RUN_NAME` is Playwright's to report).
 * @param {string[]} playwrightArgs
 * @param {NodeJS.ProcessEnv} env
 * @param {{ root: string, cwd: string }} bases `root` is the config's directory, `cwd` the
 *   directory `--output`, `--last-failed-file` and the environment variable resolve against.
 */
export function lastRunFile(playwrightArgs, env, { root, cwd }) {
  const override =
    lastOption(playwrightArgs, '--last-failed-file') ?? env.PLAYWRIGHT_LAST_RUN_OUTPUT_FILE;
  if (override) return resolve(cwd, override);
  const output = lastOption(playwrightArgs, '--output');
  if (output) return join(resolve(cwd, output), '.last-run.json');
  if (hasConfigOption(playwrightArgs)) return undefined;
  const runName = env.E2E_RUN_NAME;
  if (runName === undefined || runName === '') return join(root, 'test-results', '.last-run.json');
  if (!RUN_NAME.test(runName)) return undefined;
  return join(root, 'test-results', runName, '.last-run.json');
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

/** The parsed file, or `undefined` for a missing file or one cut short by a killed write. */
function readLastRun(file) {
  const text = readText(file);
  if (text === undefined) return undefined;
  try {
    const parsed = JSON.parse(text);
    return typeof parsed?.status === 'string' && Array.isArray(parsed.failedTests)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the file before Playwright deletes its `outputDir`. `restoreIfNoFailures` runs after the
 * step: every failing test is in `failedTests`, so an empty list on a run that did not pass, or no
 * file at all, records no failure and the earlier file is put back (or removed, if there was none).
 * @param {string | undefined} file
 */
export function keepLastRun(file) {
  if (file === undefined) return { restoreIfNoFailures() {} };
  const earlier = readText(file);
  return {
    restoreIfNoFailures() {
      const written = readLastRun(file);
      if (written && (written.status === 'passed' || written.failedTests.length > 0)) return;
      if (earlier === undefined) {
        rmSync(file, { force: true });
        return;
      }
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, earlier);
      console.error(`e2e: the run recorded no failed tests, so ${file} keeps the earlier list`);
    },
  };
}
