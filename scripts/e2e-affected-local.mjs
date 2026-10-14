// `npm run e2e:affected [-- <playwright test args>]`: the local e2e run for the files this branch
// changed. It lists them against the merge base with `origin/main`, selects the specs they map to
// with the same rules CI uses (scripts/e2e-affected.mjs), and runs those through `npm run e2e`, so
// the machine-wide lock applies. When the rules say `full`, or the changed files cannot be listed,
// it runs the full suite. Extra arguments go to `playwright test`; a spec path among them is run in
// addition to the selection. Node built-ins only.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { deriveSessionSpecs, selectSpecs } from './e2e-affected.mjs';
import { runE2e } from './e2e.mjs';

const ROOT = join(import.meta.dirname, '..');
const BASE_REF = 'origin/main';

/** @param {string[]} args @returns {string} Standard output of `git <args>`; throws on failure. */
function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || result.error}`);
  }
  return result.stdout;
}

/**
 * The files this branch changes relative to where it left `origin/main`: commits, staged and
 * unstaged edits, and untracked files that are not ignored. A rename lists both paths.
 * @param {(args: string[]) => string} [run] Runs git and returns its standard output.
 * @returns {string[]}
 */
export function changedFiles(run = git) {
  const base = run(['merge-base', BASE_REF, 'HEAD']).trim();
  const lines = (output) => output.split('\n').filter(Boolean);
  return [
    ...new Set([
      ...lines(run(['diff', '--no-renames', '--name-only', base])),
      ...lines(run(['ls-files', '--others', '--exclude-standard'])),
    ]),
  ].sort();
}

/**
 * The arguments of `npm run e2e` for these changed files.
 * @param {string[] | (() => string[])} files
 * @param {string[]} extraArgs
 * @param {{ sessionSpecs?: () => string[] }} [context]
 * @returns {{ args: string[], specs: string[] | undefined }} `specs` is undefined for a full run.
 */
export function e2eArgs(files, extraArgs, { sessionSpecs } = {}) {
  let list;
  try {
    list = typeof files === 'function' ? files() : files;
  } catch (error) {
    console.error(`e2e:affected: ${error instanceof Error ? error.message : error}`);
  }
  let selection = { scope: /** @type {const} */ ('full') };
  try {
    selection = selectSpecs(list, {
      event: 'pull_request',
      base: 'main',
      sessionSpecs: sessionSpecs ?? (() => deriveSessionSpecs(ROOT)),
    });
  } catch (error) {
    console.error(`e2e:affected: ${error instanceof Error ? error.message : error}`);
  }
  return selection.scope === 'full'
    ? { args: extraArgs, specs: undefined }
    : { args: [...selection.specs, ...extraArgs], specs: selection.specs };
}

if (import.meta.main) {
  const { args, specs } = e2eArgs(changedFiles, process.argv.slice(2));
  console.error(
    specs
      ? `e2e:affected: running ${specs.join(' ')}`
      : 'e2e:affected: the changed files need the full suite',
  );
  process.exitCode = await runE2e(args);
}
