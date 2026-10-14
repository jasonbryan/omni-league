// Node built-ins only: the `scope` step runs before setup-node, on the Node the runner image ships.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const DOC_DIRS = ['docs/', 'design/', '.claude/'];
const TOOLING_DIRS = ['.github/', 'scripts/'];
const CODE_FILE = /\.[cm]?[jt]s$/;
const TYPESCRIPT_FILE = /\.[cm]?ts$/;
const ROOT_MARKDOWN = /^[^/]+\.md$/;

// A PR's own copy of the classifier decides its scope, so a change to one of these runs every check.
const CI_FILES = ['.github/workflows/ci.yml', 'scripts/ci-scope.mjs', 'scripts/e2e-affected.mjs'];

// Docs that Convex and Angular tests read: a change to one must run those tests.
export const APP_TEST_INPUTS = ['docs/glossary.md', 'docs/process/hosting.md'];

// Design files that script tests read: a change to one must run `test:scripts`.
export const TOOLING_TEST_INPUTS = [
  'design/icons/',
  'design/mockup-kit/',
  'design/mockups/80-app-icon.html',
];

// git quotes non-ASCII names, so a quoted path is not plain.
function isPlainPath(path) {
  return (
    path !== '' &&
    !/["\\\0]/.test(path) &&
    !path.startsWith('/') &&
    !path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  );
}

const REFERENCE_FILES = ['package.json', 'netlify.toml', 'angular.json', 'playwright.config.ts'];
const REFERENCE_DIRS = ['e2e'];
const SCRIPT_EXTENSIONS = 'mjs|cjs|js|mts|cts|ts|sh';
const SCRIPT_PATH = new RegExp(
  `(?<![\\w/-])(?:\\.{1,2}/)*scripts/([\\w.-]+\\.(?:${SCRIPT_EXTENSIONS}))`,
  'g',
);
const SCRIPT_JOIN = new RegExp(
  `['"]scripts['"],\\s*['"]([\\w.-]+\\.(?:${SCRIPT_EXTENSIONS}))['"]`,
  'g',
);
const RELATIVE_IMPORT = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

/** @param {string} dir @returns {string[]} */
function filesBelow(dir, prefix = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesBelow(join(dir, entry.name), posix.join(prefix, entry.name))
      : [posix.join(prefix, entry.name)],
  );
}

/**
 * @param {string} root
 * @returns {Set<string>}
 */
export function deriveAppScripts(root) {
  const read = (path) => readFileSync(join(root, path), 'utf8');
  const sources = [
    ...REFERENCE_FILES,
    ...REFERENCE_DIRS.flatMap((dir) => filesBelow(join(root, dir), dir)),
  ];
  const found = new Set();
  const queue = [];
  // A referenced path counts even when missing: deleting a script the build still names is an app change.
  const add = (path) => {
    if (found.has(path) || /\.test\.[cm]?[jt]s$/.test(path)) return;
    found.add(path);
    if (existsSync(join(root, path))) queue.push(path);
  };
  for (const source of sources) {
    const text = readFileSync(join(root, source), 'utf8');
    for (const match of text.matchAll(SCRIPT_PATH)) add(`scripts/${match[1]}`);
    for (const match of text.matchAll(SCRIPT_JOIN)) add(`scripts/${match[1]}`);
  }
  if (found.size === 0)
    throw new Error('no script is referenced; the reference files are unreadable');
  for (const file of CI_FILES) if (file.startsWith('scripts/')) add(file);
  while (queue.length > 0) {
    const path = /** @type {string} */ (queue.pop());
    const text = read(path);
    for (const match of text.matchAll(SCRIPT_PATH)) add(`scripts/${match[1]}`);
    for (const match of text.matchAll(SCRIPT_JOIN)) add(`scripts/${match[1]}`);
    for (const match of text.matchAll(RELATIVE_IMPORT)) {
      const target = relative(root, resolve(root, dirname(path), match[1]));
      if (target.startsWith('..')) continue;
      const repoPath = target.split(sep).join('/');
      if (repoPath.startsWith('scripts/')) add(repoPath);
    }
  }
  return found;
}

/**
 * @param {string[] | undefined} files
 * @param {{ event?: string, base?: string, appScripts?: Iterable<string> }} [context]
 * @returns {{ scope: 'docs' | 'tooling' | 'app', typecheck: boolean }}
 */
export function classify(files, { event, base, appScripts = [] } = {}) {
  const appOnly = new Set(appScripts);
  const everything = { scope: 'app', typecheck: true };
  if (event !== 'pull_request' || base === 'production') return everything;
  if (!Array.isArray(files) || files.length === 0) return everything;

  let docsOnly = true;
  let typecheck = false;
  for (const file of files) {
    if (!isPlainPath(file)) return everything;
    const inDocDir = DOC_DIRS.some((dir) => file.startsWith(dir));
    const inToolingDir = TOOLING_DIRS.some((dir) => file.startsWith(dir));
    const rootMarkdown = ROOT_MARKDOWN.test(file);
    if (!inDocDir && !inToolingDir && !rootMarkdown) return everything;
    if (appOnly.has(file) || CI_FILES.includes(file) || APP_TEST_INPUTS.includes(file))
      return everything;
    const toolingInput = TOOLING_TEST_INPUTS.some((input) =>
      input.endsWith('/') ? file.startsWith(input) : file === input,
    );
    if (inToolingDir || toolingInput || CODE_FILE.test(file)) docsOnly = false;
    if (TYPESCRIPT_FILE.test(file)) typecheck = true;
  }
  return { scope: docsOnly ? 'docs' : 'tooling', typecheck };
}

export function formatOutputs({ scope, typecheck }) {
  return (
    `scope=${scope}\n` +
    `app=${scope === 'app'}\n` +
    `checks=${scope !== 'docs'}\n` +
    `typecheck=${typecheck}\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = readFileSync(0, 'utf8').split('\n').filter(Boolean);
  const context = { event: process.env.GITHUB_EVENT_NAME, base: process.env.GITHUB_BASE_REF };
  /** @type {Iterable<string> | undefined} */
  let appScripts;
  try {
    appScripts = deriveAppScripts(join(import.meta.dirname, '..'));
  } catch (error) {
    process.stderr.write(`ci-scope: ${error instanceof Error ? error.message : error}\n`);
  }
  const result = appScripts
    ? classify(files, { ...context, appScripts })
    : classify(undefined, context);
  process.stdout.write(formatOutputs(result));
}
