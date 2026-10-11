// Scope of a `ci` run from the files a PR changes (#165, docs/process/ci.md). Node built-ins only:
// the `scope` step runs before setup-node, on the Node the runner image ships.
//
// - `docs`: only docs/, design/, .claude/ and root *.md files, and no .js/.ts-family file. Runs
//   `release age`, install, and format:check.
// - `tooling`: only the non-app paths (docs/, design/, .claude/, .github/, scripts/, root *.md).
//   Adds lint, test:scripts, actionlint, and typecheck when a TypeScript file changed. Skips the
//   build-dependent steps: audit signatures, test, test:convex, build, e2e.
// - `app`: anything else, an empty list, a path that is not plainly relative, a non-PR event, or a
//   release PR into production. Runs every step. Detection that fails is `app`.
//
// Usage: `git diff --no-renames --name-only HEAD^1 HEAD | node scripts/ci-scope.mjs`, with
// GITHUB_EVENT_NAME and GITHUB_BASE_REF in the environment. It prints `key=value` lines for
// $GITHUB_OUTPUT.
import { readFileSync } from 'node:fs';
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

/**
 * @param {string[] | undefined} files Changed paths, one entry per path.
 * @param {{ event?: string, base?: string }} [context]
 * @returns {{ scope: 'docs' | 'tooling' | 'app', typecheck: boolean }}
 */
export function classify(files, { event, base } = {}) {
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
  process.stdout.write(formatOutputs(classify(files, context)));
}
