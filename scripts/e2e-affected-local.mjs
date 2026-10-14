// The run goes through `runE2e` so the machine-wide lock applies.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { deriveSessionSpecs, selectSpecs } from './e2e-affected.mjs';
import { runE2e } from './e2e.mjs';

const ROOT = join(import.meta.dirname, '..');
const BASE_REF = 'origin/main';
const TEST_DIR = 'e2e/';
const isFilter = (arg) => !arg.startsWith('-');

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || result.error}`);
  }
  return result.stdout;
}

/**
 * @param {(args: string[]) => string} [runGit]
 * @returns {string[]}
 */
export function changedFiles(runGit = git) {
  const base = runGit(['merge-base', BASE_REF, 'HEAD']).trim();
  const lines = (output) => output.split('\n').filter(Boolean);
  return [
    ...new Set([
      ...lines(runGit(['diff', '--no-renames', '--name-only', base])),
      ...lines(runGit(['ls-files', '--others', '--exclude-standard'])),
    ]),
  ].sort();
}

/**
 * @param {string[] | (() => string[])} files
 * @param {string[]} extraArgs
 * @param {{ sessionSpecs?: () => string[] }} [context]
 * @returns {{ args: string[], specs: string[] | undefined }}
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
  if (selection.scope === 'full') {
    // Playwright runs only the files that match a name on its command line, so any name would
    // otherwise narrow a full run to it.
    const args = extraArgs.some(isFilter) ? [TEST_DIR, ...extraArgs] : extraArgs;
    return { args, specs: undefined };
  }
  return { args: [...selection.specs, ...extraArgs], specs: selection.specs };
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
