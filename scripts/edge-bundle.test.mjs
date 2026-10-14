import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { checkServerBundle, findEdgeUnsafeCode } from './edge-bundle.mjs';

const CREATE_REQUIRE = 'createRequire (Node CommonJS require shim)';
const DENO_CWD = 'Deno.cwd (filesystem access)';
const CWD = 'process.cwd (filesystem access)';
const IMPORT = 'import of a Node filesystem module (fs, path, or module)';
const BARE = 'import of a package outside the allow-list';
const REQUIRE = 'require of a Node filesystem module (fs, path, or module)';

// The construct that failed every SSR request on Netlify Edge: `convex/browser`'s `node`
// entry (dist/esm/browser/simple_client-node.js), as published and as minified into
// main.server.mjs by the production build.
const CONVEX_NODE_ENTRY =
  "import {createRequire} from 'module';import {resolve as nodePathResolve} from 'path';" +
  "const require=createRequire(nodePathResolve('.'));";
const CONVEX_NODE_ENTRY_MINIFIED =
  'import{createRequire as F_}from"module";import{resolve as U_}from"path";var pi=F_(U_("."));';

describe('findEdgeUnsafeCode', () => {
  it('flags the Convex node entry, as published', () => {
    assert.deepEqual(findEdgeUnsafeCode(CONVEX_NODE_ENTRY), [CREATE_REQUIRE, IMPORT]);
  });

  it('flags the Convex node entry, minified', () => {
    assert.deepEqual(findEdgeUnsafeCode(CONVEX_NODE_ENTRY_MINIFIED), [CREATE_REQUIRE, IMPORT]);
  });

  it("flags Angular's Node require banner", () => {
    const banner =
      "import { createRequire as __ngCreateRequire } from 'node:module';\n" +
      "globalThis['require'] ??= __ngCreateRequire(import.meta.url);";
    assert.deepEqual(findEdgeUnsafeCode(banner), [CREATE_REQUIRE, IMPORT]);
  });

  it('flags process.cwd', () => {
    assert.deepEqual(findEdgeUnsafeCode('const root = process.cwd();'), [CWD]);
    assert.deepEqual(findEdgeUnsafeCode('var r=process .cwd()'), [CWD]);
  });

  for (const specifier of ['fs', 'node:fs', 'fs/promises', 'node:fs/promises', 'path', 'module']) {
    it(`flags a static, dynamic, or bare import of ${specifier}`, () => {
      assert.deepEqual(findEdgeUnsafeCode(`import{readFile as a}from"${specifier}";`), [IMPORT]);
      assert.deepEqual(findEdgeUnsafeCode(`const m = await import('${specifier}');`), [IMPORT]);
      assert.deepEqual(findEdgeUnsafeCode(`import "${specifier}";`), [IMPORT]);
    });

    it(`flags a require of ${specifier}`, () => {
      assert.deepEqual(findEdgeUnsafeCode(`var a=__require("${specifier}")`), [REQUIRE]);
    });
  }

  it('flags process["cwd"], Deno.cwd, and a template-literal import of node:path', () => {
    assert.deepEqual(findEdgeUnsafeCode('const r=process["cwd"]();'), [CWD]);
    assert.deepEqual(findEdgeUnsafeCode("const r=process['cwd']();"), [CWD]);
    assert.deepEqual(findEdgeUnsafeCode('const r=Deno.cwd();'), [DENO_CWD]);
    assert.deepEqual(findEdgeUnsafeCode('const p=await import(`node:path`);'), [IMPORT]);
  });

  it('flags a bare import outside the allow-list, static or dynamic', () => {
    assert.deepEqual(findEdgeUnsafeCode('import{x}from"pathe";'), [BARE]);
    assert.deepEqual(findEdgeUnsafeCode("await import('left-pad');"), [BARE]);
    assert.deepEqual(findEdgeUnsafeCode('import"xhr2-extra";'), [BARE]);
  });

  it('accepts edge-safe code: node:process, relative chunks, and look-alike names', () => {
    const source = [
      "import { env } from 'node:process';",
      'import{a as b}from"./chunk-EIPVYCHO.mjs";',
      'import Aw from"./angular-app-manifest.mjs";',
      'const lazy = () => import("./chunk-XYYCKFVS.mjs");',
      'const p = new URL(request.url).pathname; resolve("."); fsPath("module");',
      '// moved from "CanLoadMore" to "LoadingMore"; add import "@angular/compiler"; first',
      'import{x}from"node:process";const x=await import("xhr2");import"xhr2";',
    ].join('\n');
    assert.deepEqual(findEdgeUnsafeCode(source), []);
  });
});

describe('checkServerBundle', () => {
  async function withServerDir(files, run) {
    const dir = await mkdtemp(join(tmpdir(), 'edge-bundle-'));
    try {
      for (const [name, content] of Object.entries(files)) {
        await mkdir(join(dir, name, '..'), { recursive: true });
        await writeFile(join(dir, name), content);
      }
      await run(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('reports each problem with the file relative to the server directory, nested files too', async () => {
    await withServerDir(
      {
        'main.server.mjs': CONVEX_NODE_ENTRY_MINIFIED,
        'server.mjs': "import { env } from 'node:process';",
        'assets-chunks/index.mjs': 'export default `<p>${process.cwd()}</p>`;',
        'index.server.html': 'createRequire is not checked in HTML',
      },
      async (dir) => {
        assert.deepEqual(await checkServerBundle(dir), [
          { file: join('assets-chunks', 'index.mjs'), problem: CWD },
          { file: 'main.server.mjs', problem: CREATE_REQUIRE },
          { file: 'main.server.mjs', problem: IMPORT },
        ]);
      },
    );
  });

  it('returns no problems for an edge-safe bundle', async () => {
    await withServerDir(
      { 'main.server.mjs': 'export const a = 1;', 'server.mjs': 'import "./main.server.mjs";' },
      async (dir) => {
        assert.deepEqual(await checkServerBundle(dir), []);
      },
    );
  });

  it('throws when the directory has no .mjs file, so a missing build never passes', async () => {
    await withServerDir({ 'index.server.html': '' }, async (dir) => {
      await assert.rejects(checkServerBundle(dir), /no \.mjs files/);
    });
  });
});
