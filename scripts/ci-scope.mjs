// Scope of a `ci` run from the files a PR changes (#165, docs/process/ci.md). Node built-ins only:
// the `scope` step runs before setup-node, on the Node the runner image ships.
//
// - `docs`: only docs/, design/, .claude/ and root *.md files, and no .js/.ts-family file. Runs
//   `release age`, install, and format:check.
// - `tooling`: only the non-app paths (docs/, design/, .claude/, .github/, scripts/, root *.md),
//   and no script the build, e2e, or deploy runs (see below). Adds lint, test:scripts, actionlint,
//   and typecheck when a TypeScript file changed. Skips the build-dependent steps: audit
//   signatures, test, test:convex, build, e2e.
// - `app`: anything else, an empty list, a path that is not plainly relative, a script the build,
//   e2e, or deploy runs, a non-PR event, or a release PR into production. Runs every step.
//   Detection that fails, including failing to derive the script list, is `app`.
//
// The scripts that count as app are derived, not listed: every `scripts/<file>` that package.json,
// netlify.toml, angular.json, playwright.config.ts, or a file under e2e/ names, plus every file those
// scripts import (relative imports, transitively). Test files (`*.test.mjs`) are tooling.
//
// Usage: `git diff --no-renames --name-only HEAD^1 HEAD | node scripts/ci-scope.mjs`, with
// GITHUB_EVENT_NAME and GITHUB_BASE_REF in the environment. It prints `key=value` lines for
// $GITHUB_OUTPUT.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Directories whose contents never affect the app build. */
const DOC_DIRS = ['docs/', 'design/', '.claude/'];
const TOOLING_DIRS = ['.github/', 'scripts/'];
/** Files ESLint lints (the .js and .ts families), wherever they live. */
const CODE_FILE = /\.[cm]?[jt]s$/;
const TYPESCRIPT_FILE = /\.[cm]?ts$/;
const ROOT_MARKDOWN = /^[^/]+\.md$/;

/** A plain repo-relative path: no quotes (git quotes non-ASCII names), backslashes, or dot segments. */
function isPlainPath(path) {
  return (
    path !== '' &&
    !/["\\\0]/.test(path) &&
    !path.startsWith('/') &&
    !path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  );
}

/** Files whose text names the scripts the build, e2e, or deploy run. */
const REFERENCE_FILES = ['package.json', 'netlify.toml', 'angular.json', 'playwright.config.ts'];
const REFERENCE_DIRS = ['e2e'];
const SCRIPT_EXTENSIONS = 'mjs|cjs|js|mts|cts|ts|sh';
/** `scripts/name.mjs` in a command line or a path string. */
const SCRIPT_PATH = new RegExp(`(?<![\\w./-])scripts/([\\w.-]+\\.(?:${SCRIPT_EXTENSIONS}))`, 'g');
/** `'scripts', 'name.mjs'`, the form `path.join` takes. */
const SCRIPT_JOIN = new RegExp(
  `['"]scripts['"],\\s*['"]([\\w.-]+\\.(?:${SCRIPT_EXTENSIONS}))['"]`,
  'g',
);
/** `from './x.mjs'`, `import('./x.mjs')`, `require('./x.cjs')`. */
const RELATIVE_IMPORT = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g;

/** @param {string} dir @returns {string[]} Every file below dir, as paths relative to dir's parent. */
function filesBelow(dir, prefix = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesBelow(join(dir, entry.name), posix.join(prefix, entry.name))
      : [posix.join(prefix, entry.name)],
  );
}

/**
 * The scripts the build, e2e, or deploy run, as repo-relative paths (`scripts/ng-convex.mjs`).
 * Throws when a reference file cannot be read, so the caller falls back to `app`.
 * @param {string} root Repository root.
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
  const add = (path) => {
    if (found.has(path) || /\.test\.[cm]?[jt]s$/.test(path) || !existsSync(join(root, path)))
      return;
    found.add(path);
    queue.push(path);
  };
  for (const source of sources) {
    const text = readFileSync(join(root, source), 'utf8');
    for (const match of text.matchAll(SCRIPT_PATH)) add(`scripts/${match[1]}`);
    for (const match of text.matchAll(SCRIPT_JOIN)) add(`scripts/${match[1]}`);
  }
  if (found.size === 0)
    throw new Error('no script is referenced; the reference files are unreadable');
  // The scripts those scripts run or import, transitively.
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
 * @param {string[] | undefined} files Changed paths, one entry per path.
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
    if (appOnly.has(file)) return everything;
    if (inToolingDir || CODE_FILE.test(file)) docsOnly = false;
    if (TYPESCRIPT_FILE.test(file)) typecheck = true;
  }
  return { scope: docsOnly ? 'docs' : 'tooling', typecheck };
}

/** The lines the `scope` step appends to $GITHUB_OUTPUT. */
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
    // Cannot tell which scripts the build runs: every check runs.
    process.stderr.write(`ci-scope: ${error instanceof Error ? error.message : error}\n`);
  }
  const result = appScripts
    ? classify(files, { ...context, appScripts })
    : classify(undefined, context);
  process.stdout.write(formatOutputs(result));
}
