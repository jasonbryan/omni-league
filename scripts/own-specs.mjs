import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, posix } from 'node:path';
import { classify, deriveAppScripts } from './ci-scope.mjs';
import { ALWAYS, buildImportGraph, deriveSessionSpecs, selectSpecs } from './e2e-affected.mjs';
import { runE2e } from './e2e.mjs';

const ROOT = join(import.meta.dirname, '..');
const DIFF_ARGS = ['diff', '--no-renames', '--name-only', 'origin/main...HEAD'];
const SMOKE_SPEC = 'e2e/smoke.spec.ts';
const SCREEN_DIRS = ['src/', 'design/'];
const MOCKUP_SPEC = /-mockup\.spec\.ts$/;
const SPEC_FILE = /\.spec\.ts$/;
const E2E_TEXT_FILE = /\.(?:ts|mts|mjs|js|json|html|css|md)$/;
const E2E_DIR = 'e2e';

// Specs past the cap are left to the batch run, whose full suite covers them.
export const SCREEN_SPEC_CAP = 20;

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || result.error}`);
  }
  return result.stdout;
}

function defaultCiScope(root, files) {
  let appScripts;
  try {
    appScripts = deriveAppScripts(root);
  } catch {
    return 'app';
  }
  return classify(files, { event: 'pull_request', base: 'main', appScripts }).scope;
}

/** @returns {Map<string, string>} the text of each file under e2e/, by repo path */
function readE2eFiles(root) {
  const texts = new Map();
  let entries;
  try {
    entries = readdirSync(join(root, E2E_DIR), { recursive: true, withFileTypes: true });
  } catch {
    return texts;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !E2E_TEXT_FILE.test(entry.name)) continue;
    const path = posix.join(
      E2E_DIR,
      ...join(entry.parentPath, entry.name)
        .slice(join(root, E2E_DIR).length + 1)
        .split(/[\\/]/),
    );
    texts.set(path, readFileSync(join(root, path), 'utf8'));
  }
  return texts;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} root
 * @param {string[]} changed
 * @returns {string[]}
 */
function importingSpecs(root, changed) {
  const starting = changed.filter((file) => !SPEC_FILE.test(file));
  if (starting.length === 0) return [];
  const texts = readE2eFiles(root);
  const files = new Set(starting);
  const specs = new Set();
  for (const file of files) {
    const stem = basename(file, extname(file));
    if (stem === '') continue;
    const importsIt = new RegExp(`[/']${escapeRegExp(stem)}(\\.[a-z]+)?'`);
    for (const [path, text] of texts) {
      if (!importsIt.test(text)) continue;
      if (SPEC_FILE.test(path)) specs.add(path);
      else files.add(path);
    }
  }
  return [...specs];
}

/**
 * @param {string[]} changed
 * @param {{
 *   root: string,
 *   buildGraph: typeof buildImportGraph,
 *   select: typeof selectSpecs,
 *   sessionSpecs: () => string[],
 *   log: (message: string) => void,
 * }} context
 * @returns {string[]}
 */
function screenSpecs(changed, { root, buildGraph, select, sessionSpecs, log }) {
  const screenFiles = changed.filter((file) => SCREEN_DIRS.some((dir) => file.startsWith(dir)));
  if (screenFiles.length === 0) return [];
  const graph = buildGraph(root);
  const union = new Set();
  for (const file of screenFiles) {
    const selection = select([file], {
      event: 'pull_request',
      base: 'main',
      root,
      sessionSpecs,
      graph,
      warn: () => {},
    });
    if (selection.scope === 'full') {
      log(`e2e:own: ${file} selects the full suite, which the batch run covers`);
      continue;
    }
    for (const filter of selection.specs) if (!ALWAYS.includes(filter)) union.add(filter);
  }
  if (union.size <= SCREEN_SPEC_CAP) return [...union];
  log(
    `e2e:own: ${union.size} screen specs pass the cap of ${SCREEN_SPEC_CAP}; keeping the mockup specs`,
  );
  return [...union].filter((filter) => MOCKUP_SPEC.test(filter));
}

/**
 * @param {{
 *   root?: string,
 *   runGit?: (args: string[]) => string,
 *   buildGraph?: typeof buildImportGraph,
 *   select?: typeof selectSpecs,
 *   sessionSpecs?: () => string[],
 *   ciScope?: (files: string[]) => string,
 *   exists?: (path: string) => boolean,
 *   named?: string[],
 *   log?: (message: string) => void,
 * }} [options]
 * @returns {string[]}
 */
export function ownSpecs({
  root = ROOT,
  runGit = (args) => git(root, args),
  buildGraph = buildImportGraph,
  select = selectSpecs,
  sessionSpecs = () => deriveSessionSpecs(root),
  ciScope = (files) => defaultCiScope(root, files),
  exists = (path) => existsSync(join(root, path)),
  named = [],
  log = () => {},
} = {}) {
  const changed = runGit(DIFF_ARGS).split('\n').filter(Boolean);
  let sessions;
  const specs = new Set(named);
  for (const file of changed) {
    if (file.startsWith(`${E2E_DIR}/`) && SPEC_FILE.test(file) && exists(file)) specs.add(file);
  }
  for (const spec of importingSpecs(root, changed)) specs.add(spec);
  const screen = screenSpecs(changed, {
    root,
    buildGraph,
    select,
    sessionSpecs: () => (sessions ??= sessionSpecs()),
    log,
  });
  for (const spec of screen) specs.add(spec);
  if (specs.size === 0 && ciScope(changed) === 'app') specs.add(SMOKE_SPEC);
  return [...specs].sort();
}

/**
 * @param {string[]} argv
 * @param {{
 *   own?: typeof ownSpecs,
 *   run?: typeof runE2e,
 *   print?: (line: string) => void,
 *   log?: (message: string) => void,
 * }} [dependencies]
 * @returns {Promise<number>}
 */
export async function main(
  argv,
  { own = ownSpecs, run = runE2e, print = console.log, log = console.error } = {},
) {
  const args = argv.filter((arg) => arg !== '--list');
  const named = args.filter((arg) => !arg.startsWith('-'));
  const flags = args.filter((arg) => arg.startsWith('-'));
  const specs = own({ named, log });
  if (argv.includes('--list')) {
    for (const spec of specs) print(spec);
    return 0;
  }
  if (specs.length === 0) {
    log('e2e:own: this PR has no own specs, so no e2e runs');
    return 0;
  }
  log(`e2e:own: running ${specs.join(' ')}`);
  return run([...specs, ...flags]);
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
