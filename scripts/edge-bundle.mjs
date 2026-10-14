// Netlify Edge Functions refuse filesystem access, and that includes `process.cwd()`, which
// `path.resolve('.')` calls. A Node-only entry of a dependency (for example `convex/browser`'s
// `node` export, which runs `createRequire(resolve('.'))` at module load) then fails every SSR
// request with a 500, while the same bundle runs fine under Node and local Deno.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

// `path` is listed because its `resolve` reads the working directory.
const FS_MODULES = String.raw`(?:node:)?(?:fs|path|module)(?:/[^"']*)?`;

// A new dependency that reaches the edge bundle is reviewed here first. `xhr2` is Angular's
// server-side XMLHttpRequest shim.
const ALLOWED_BARE_IMPORTS = ['xhr2'];
const QUOTE = '["\'\\x60]'; // ", ', or a backtick (template-literal specifier)
// Only import statements at a statement start and dynamic `import(...)` calls count, so prose in
// comments and strings of an unminified (development) bundle does not match.
const BARE_SPECIFIER = String.raw`${QUOTE}(?!node:|\.|/|${FS_MODULES}${QUOTE}|(?:${ALLOWED_BARE_IMPORTS.join('|')})${QUOTE})[^"'\x60]`;
const BARE_IMPORT = new RegExp(
  String.raw`(?:(?:^|[;}])\s*import\s*(?:[^;"'\x60]*?\bfrom\s*)?|\bimport\s*\(\s*)${BARE_SPECIFIER}`,
  'm',
);

const RULES = [
  { name: 'createRequire (Node CommonJS require shim)', pattern: /\bcreateRequire\b/ },
  {
    name: 'process.cwd (filesystem access)',
    pattern: /\bprocess\s*(?:\.\s*cwd\b|\[\s*["'\x60]cwd["'\x60]\s*\])/,
  },
  { name: 'Deno.cwd (filesystem access)', pattern: /\bDeno\s*\.\s*cwd\b/ },
  {
    name: 'import of a Node filesystem module (fs, path, or module)',
    pattern: new RegExp(String.raw`(?:\bfrom|\bimport)\s*\(?\s*${QUOTE}${FS_MODULES}${QUOTE}`),
  },
  { name: 'import of a package outside the allow-list', pattern: BARE_IMPORT },
  {
    name: 'require of a Node filesystem module (fs, path, or module)',
    pattern: new RegExp(String.raw`require\s*\(\s*["']${FS_MODULES}["']`),
  },
];

/**
 * @param {string} source
 * @returns {string[]}
 */
export function findEdgeUnsafeCode(source) {
  return RULES.filter((rule) => rule.pattern.test(source)).map((rule) => rule.name);
}

/**
 * @param {string} serverDir
 * @returns {Promise<{ file: string, problem: string }[]>}
 */
export async function checkServerBundle(serverDir) {
  const entries = await readdir(serverDir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  // A missing build never passes.
  if (files.length === 0) throw new Error(`no .mjs files in ${serverDir}`);

  const problems = [];
  for (const file of files) {
    for (const problem of findEdgeUnsafeCode(await readFile(file, 'utf8'))) {
      problems.push({ file: relative(serverDir, file), problem });
    }
  }
  return problems;
}
