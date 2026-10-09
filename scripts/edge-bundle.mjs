// Edge-safety check of the server bundle (#15, ADR 0010 item 2). Node built-ins only.
// Netlify Edge Functions refuse filesystem access, and that includes `process.cwd()`, which
// `path.resolve('.')` calls. A Node-only entry of a dependency (for example `convex/browser`'s
// `node` export, which runs `createRequire(resolve('.'))` at module load) then fails every SSR
// request with a 500, while the same bundle runs fine under Node and local Deno.
// `scripts/ng-convex.mjs build` runs this check after `ng build`, so such a bundle fails the build
// (locally, in CI, and on Netlify) instead of being published.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

// Node built-ins whose use in the server bundle means filesystem access or a CommonJS `require`
// shim. `path` is listed because its `resolve` reads the working directory.
const FS_MODULES = String.raw`(?:node:)?(?:fs|path|module)(?:/[^"']*)?`;

const RULES = [
  { name: 'createRequire (Node CommonJS require shim)', pattern: /\bcreateRequire\b/ },
  { name: 'process.cwd (filesystem access)', pattern: /\bprocess\s*\.\s*cwd\b/ },
  {
    name: 'import of a Node filesystem module (fs, path, or module)',
    pattern: new RegExp(String.raw`(?:\bfrom|\bimport)\s*\(?\s*["']${FS_MODULES}["']`),
  },
  {
    name: 'require of a Node filesystem module (fs, path, or module)',
    pattern: new RegExp(String.raw`require\s*\(\s*["']${FS_MODULES}["']`),
  },
];

/**
 * The names of the edge-unsafe constructs found in one server-bundle file's source, in rule order;
 * empty when the source is edge-safe.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function findEdgeUnsafeCode(source) {
  return RULES.filter((rule) => rule.pattern.test(source)).map((rule) => rule.name);
}

/**
 * Checks every `.mjs` file under `serverDir` (the build's `server/` directory, recursively).
 * Returns one entry per file and problem, with the path relative to `serverDir`; empty when the
 * bundle is edge-safe. Throws when `serverDir` has no `.mjs` file, so a missing build never passes.
 *
 * @param {string} serverDir
 * @returns {Promise<{ file: string, problem: string }[]>}
 */
export async function checkServerBundle(serverDir) {
  const entries = await readdir(serverDir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  if (files.length === 0) throw new Error(`no .mjs files in ${serverDir}`);

  const problems = [];
  for (const file of files) {
    for (const problem of findEdgeUnsafeCode(await readFile(file, 'utf8'))) {
      problems.push({ file: relative(serverDir, file), problem });
    }
  }
  return problems;
}
