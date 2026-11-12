import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const ARCHIVE_MAX_BYTES = 1024 ** 3;

// Specs past the cap are left to the batch run, whose full suite covers them.
export const SCREEN_SPEC_CAP = 20;

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || result.error}`);
  }
  return result.stdout;
}

// The PR's list belongs to its head SHA, so every file the script reads comes from a copy of HEAD.
function headSnapshot(root) {
  const insideRepository =
    spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' })
      .status === 0;
  if (!insideRepository) return { dir: root, cleanup: () => {} };
  const dir = mkdtempSync(join(tmpdir(), 'own-specs-head-'));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  const fail = (command, result) => {
    cleanup();
    const reason = String(result.stderr ?? '').trim() || result.error;
    throw new Error(`${command} failed while copying HEAD: ${reason}`);
  };
  const archive = spawnSync('git', ['-C', root, 'archive', '--format=tar', 'HEAD'], {
    maxBuffer: ARCHIVE_MAX_BYTES,
  });
  if (archive.status !== 0) fail('git archive', archive);
  const extract = spawnSync('tar', ['-x', '-C', dir], { input: archive.stdout });
  if (extract.status !== 0) fail('tar', extract);
  return { dir, cleanup };
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

/** @returns {Map<string, string>} */
function readE2eTextsByPath(root) {
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
 * @param {() => string} root
 * @param {string[]} changed
 * @returns {string[]}
 */
function importingSpecs(root, changed) {
  const starting = changed.filter((file) => !SPEC_FILE.test(file));
  if (starting.length === 0) return [];
  const texts = readE2eTextsByPath(root());
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
 *   root: () => string,
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
  const graph = buildGraph(root());
  const union = new Set();
  for (const file of screenFiles) {
    const selection = select([file], {
      event: 'pull_request',
      base: 'main',
      root: root(),
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
 *   snapshot?: typeof headSnapshot,
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
  snapshot = headSnapshot,
  buildGraph = buildImportGraph,
  select = selectSpecs,
  sessionSpecs,
  ciScope,
  exists,
  named = [],
  log = () => {},
} = {}) {
  const changed = runGit(DIFF_ARGS).split('\n').filter(Boolean);
  let head;
  const tree = () => (head ??= snapshot(root)).dir;
  const existsInTree = exists ?? ((path) => existsSync(join(tree(), path)));
  const ciScopeOf = ciScope ?? ((files) => defaultCiScope(tree(), files));
  const sessionSpecsOf = sessionSpecs ?? (() => deriveSessionSpecs(tree()));
  let sessions;
  try {
    const specs = new Set(named);
    for (const file of changed) {
      if (file.startsWith(`${E2E_DIR}/`) && SPEC_FILE.test(file) && existsInTree(file)) {
        specs.add(file);
      }
    }
    for (const spec of importingSpecs(tree, changed)) specs.add(spec);
    const screen = screenSpecs(changed, {
      root: tree,
      buildGraph,
      select,
      sessionSpecs: () => (sessions ??= sessionSpecsOf()),
      log,
    });
    for (const spec of screen) specs.add(spec);
    if (specs.size === 0 && ciScopeOf(changed) === 'app') specs.add(SMOKE_SPEC);
    return [...specs].sort();
  } finally {
    head?.cleanup();
  }
}

const SPEC_PATH = /^e2e\/|\.spec\.ts$/;

/**
 * The options of `playwright test --help`, each with whether it takes a value: `required` for
 * `<value>`, `optional` for `[value]`, `none` for a switch. A test compares it with the installed
 * Playwright.
 * @type {{ names: string[], value: 'required' | 'optional' | 'none' }[]}
 */
export const PLAYWRIGHT_TEST_OPTIONS = [
  { names: ['--add-reporter'], value: 'required' },
  { names: ['--browser'], value: 'required' },
  { names: ['-c', '--config'], value: 'required' },
  { names: ['--debug'], value: 'optional' },
  { names: ['--fail-on-flaky-tests'], value: 'none' },
  { names: ['--forbid-only'], value: 'none' },
  { names: ['--fully-parallel'], value: 'none' },
  { names: ['-g', '--grep'], value: 'required' },
  { names: ['-G', '--grep-invert'], value: 'required' },
  { names: ['--global-timeout'], value: 'required' },
  { names: ['--headed'], value: 'none' },
  { names: ['--ignore-snapshots'], value: 'none' },
  { names: ['-j', '--workers'], value: 'required' },
  { names: ['--last-failed'], value: 'none' },
  { names: ['--last-failed-file'], value: 'required' },
  { names: ['--list'], value: 'none' },
  { names: ['--max-failures'], value: 'required' },
  { names: ['--no-deps'], value: 'none' },
  { names: ['--only-changed'], value: 'optional' },
  { names: ['--output'], value: 'required' },
  { names: ['--pass-with-no-tests'], value: 'none' },
  { names: ['--project'], value: 'required' },
  { names: ['--quiet'], value: 'none' },
  { names: ['--repeat-each'], value: 'required' },
  { names: ['--reporter'], value: 'required' },
  { names: ['--retries'], value: 'required' },
  { names: ['--run-agents'], value: 'required' },
  { names: ['--shard'], value: 'required' },
  { names: ['--shuffle'], value: 'optional' },
  { names: ['--test-list'], value: 'required' },
  { names: ['--test-list-invert'], value: 'required' },
  { names: ['--timeout'], value: 'required' },
  { names: ['--trace'], value: 'required' },
  { names: ['--tsconfig'], value: 'required' },
  { names: ['-u', '--update-snapshots'], value: 'optional' },
  { names: ['--ui'], value: 'none' },
  { names: ['--ui-host'], value: 'required' },
  { names: ['--ui-port'], value: 'required' },
  { names: ['--update-source-method'], value: 'required' },
  { names: ['-x'], value: 'none' },
];

const HELP_OPTIONS = ['-h', '--help'];
const USAGE_EXIT_CODE = 2;
const OPTION_TERMINATOR = '--';

const OPTIONS_BY_NAME = new Map(
  PLAYWRIGHT_TEST_OPTIONS.flatMap((option) => option.names.map((name) => [name, option])),
);

/**
 * @param {string} arg an argument that starts with `-`
 * @returns {{ valid: boolean, takesNextArg: boolean }}
 */
function readOption(arg) {
  const invalid = { valid: false, takesNextArg: false };
  if (arg.startsWith('--')) {
    const separator = arg.indexOf('=');
    const name = separator === -1 ? arg : arg.slice(0, separator);
    const option = OPTIONS_BY_NAME.get(name);
    if (option === undefined) return invalid;
    if (separator !== -1) return { valid: option.value !== 'none', takesNextArg: false };
    return { valid: true, takesNextArg: option.value === 'required' };
  }
  const option = OPTIONS_BY_NAME.get(arg.slice(0, 2));
  if (option === undefined) return invalid;
  if (arg.length === 2) return { valid: true, takesNextArg: option.value === 'required' };
  return { valid: option.value !== 'none', takesNextArg: false };
}

/**
 * @param {string[]} args
 * @returns {{ help: boolean, invalid: string | undefined }}
 */
function checkArgs(args) {
  let help = false;
  let invalid;
  let valueNext = false;
  for (const arg of args) {
    if (valueNext) {
      valueNext = false;
      continue;
    }
    if (arg === OPTION_TERMINATOR) break;
    if (!arg.startsWith('-')) continue;
    if (HELP_OPTIONS.includes(arg)) {
      help = true;
      continue;
    }
    const option = readOption(arg);
    if (!option.valid) invalid ??= arg;
    valueNext = option.takesNextArg;
  }
  return { help, invalid };
}

const USAGE = `Usage: npm run e2e:own -- [--list] [spec ...] [playwright test options]

Runs the PR's own e2e specs on the head SHA: the changed and imported specs, the specs of the
changed screens, the specs named here, and the smoke spec as a floor.
See docs/process/dev-cycle.md (Own e2e specs).

Options:
  --list        Print the own specs, one per line, without running them.
  -h, --help    Print this help.

Any other option goes to \`playwright test\`; see \`npx playwright test --help\`.
An unknown option exits 2 before anything starts.`;

/**
 * @param {string[]} args
 * @returns {{ named: string[], passthrough: string[] }}
 */
function splitArgs(args) {
  const named = [];
  const passthrough = [];
  let takesValue = false;
  let valueNext = false;
  for (const arg of args) {
    if (arg.startsWith('-')) {
      passthrough.push(arg);
      if (valueNext) {
        valueNext = false;
        takesValue = false;
        continue;
      }
      takesValue = !arg.includes('=');
      valueNext = readOption(arg).takesNextArg;
      continue;
    }
    valueNext = false;
    if (takesValue && !SPEC_PATH.test(arg)) passthrough.push(arg);
    else named.push(arg);
    takesValue = false;
  }
  return { named, passthrough };
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
  const { help, invalid } = checkArgs(argv);
  if (help) {
    print(USAGE);
    return 0;
  }
  if (invalid !== undefined) {
    log(`e2e:own: unknown option ${invalid}; see npm run e2e:own -- --help`);
    return USAGE_EXIT_CODE;
  }
  const args = argv.filter((arg) => arg !== '--list');
  const { named, passthrough } = splitArgs(args);
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
  return run([...specs, ...passthrough]);
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
