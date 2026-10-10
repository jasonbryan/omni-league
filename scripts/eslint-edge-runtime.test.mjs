// Checks of the edge-runtime block of eslint.config.mjs (#116). Run with `npm run test:scripts`
// (node:test). The Netlify edge function bundles `src/server*.ts` and every `src/` file they import
// (ADR 0010), so each of those files must get the server-entry restrictions: no environment reads,
// no Node built-ins, and the `convex/browser` ban that applies to all of `src/`.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { ESLint } from 'eslint';
import ts from 'typescript';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
const eslint = new ESLint({ cwd: ROOT });

const ENV_READ = "export const x = process.env['X'];\n";
const CONVEX_BROWSER = "import { ConvexClient } from 'convex/browser';\nexport { ConvexClient };\n";

/** The rule ids ESLint reports for `text` linted as the repository file `file`. */
async function ruleIds(file, text) {
  const [result] = await eslint.lintText(text, { filePath: join(ROOT, file) });
  return result.messages.map((message) => message.ruleId);
}

describe('edge-runtime lint block', () => {
  for (const file of ['src/server.ts', 'src/app/core/url-serializer.ts']) {
    it(`bans an environment read in ${file}`, async () => {
      assert.ok((await ruleIds(file, ENV_READ)).includes('no-restricted-globals'));
    });

    it(`still bans convex/browser in ${file}`, async () => {
      assert.ok((await ruleIds(file, CONVEX_BROWSER)).includes('no-restricted-imports'));
    });
  }

  it('does not apply to other app files', async () => {
    assert.ok(
      !(await ruleIds('src/app/core/page-meta.ts', ENV_READ)).includes('no-restricted-globals'),
    );
  });
});

/** Compiler options of the app build: path aliases and module resolution as the bundler reads them. */
function appCompilerOptions() {
  const path = join(ROOT, 'tsconfig.app.json');
  const { config } = ts.readConfigFile(path, ts.sys.readFile);
  return ts.parseJsonConfigFileContent(config, ts.sys, ROOT).options;
}

/**
 * Every `src/` file the server entries import, directly or through other files: relative paths and
 * `tsconfig` path aliases. Packages (`node_modules`) are not followed. Spec files are not entries.
 */
function edgeGraph() {
  const options = appCompilerOptions();
  const entries = readdirSync(SRC)
    .filter((name) => /^server.*\.ts$/.test(name) && !name.endsWith('.spec.ts'))
    .map((name) => join(SRC, name));
  const seen = new Set(entries);
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    const source = ts.sys.readFile(file) ?? '';
    for (const { fileName } of ts.preProcessFile(source, true, true).importedFiles) {
      const { resolvedModule } = ts.resolveModuleName(fileName, file, options, ts.sys);
      const resolved = resolvedModule?.resolvedFileName;
      if (!resolved || resolved.includes('/node_modules/') || resolved.endsWith('.d.ts')) continue;
      if (!resolved.startsWith(`${SRC}/`)) continue;
      if (!seen.has(resolved)) {
        seen.add(resolved);
        queue.push(resolved);
      }
    }
  }
  return [...seen].map((file) => relative(ROOT, file).split('\\').join('/')).sort();
}

describe('the edge function import graph', () => {
  it('reaches src/app/core/url-serializer.ts', () => {
    // Guards the walk itself: if it found nothing under src/app, the coverage test below is empty.
    assert.ok(edgeGraph().includes('src/app/core/url-serializer.ts'), edgeGraph().join(', '));
  });

  it('is covered by the edge-runtime block: every imported src/ file bans environment reads', async () => {
    const uncovered = [];
    for (const file of edgeGraph()) {
      const config = await eslint.calculateConfigForFile(join(ROOT, file));
      const [severity, ...options] = [config.rules['no-restricted-globals']].flat();
      const banned = options.some((option) => option?.name === 'process');
      if (severity !== 2 && severity !== 'error') uncovered.push(file);
      else if (!banned) uncovered.push(file);
    }
    assert.deepEqual(
      uncovered,
      [],
      `imported by src/server*.ts but not matched by the edge-runtime block in eslint.config.mjs: ${uncovered.join(', ')}`,
    );
  });
});
