// A runtime import of `convex/server` or `convex/_generated/api` puts Convex's server code in the
// browser bundle, so app files get `api` and `getFunctionName` from the Convex adapter instead.

import assert from 'node:assert/strict';
import { dirname, join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { ESLint } from 'eslint';

const ROOT = join(import.meta.dirname, '..');
const eslint = new ESLint({ cwd: ROOT });

const GENERATED_API = join(ROOT, 'convex/_generated/api');

function generatedApiFrom(file) {
  return relative(dirname(join(ROOT, file)), GENERATED_API)
    .split('\\')
    .join('/');
}

async function restrictedImports(file, text) {
  const [result] = await eslint.lintText(text, { filePath: join(ROOT, file) });
  return result.messages.filter((message) => message.ruleId === 'no-restricted-imports');
}

const APP_FILES = [
  'src/app/find/find-page.ts',
  'src/app/core/data/convex/saved-copies.ts',
  'src/app/core/data/convex/testing/saved-copy.ts',
  'src/server.ts',
  'src/app/core/url-serializer.ts',
];

describe('runtime imports of Convex server code', () => {
  for (const file of APP_FILES) {
    const generated = generatedApiFrom(file);

    it(`are refused in ${file}`, async () => {
      for (const text of [
        "import { getFunctionName } from 'convex/server';\nexport { getFunctionName };\n",
        "import { anyApi } from 'convex/server';\nimport type { FunctionReference } from 'convex/server';\nexport { anyApi };\nexport type { FunctionReference };\n",
        `import { api } from '${generated}';\nexport { api };\n`,
        `import { api } from '${generated}.js';\nexport { api };\n`,
        `export { api } from '${generated}';\n`,
        "export { getFunctionName } from 'convex/server';\n",
      ]) {
        assert.equal((await restrictedImports(file, text)).length > 0, true, text);
      }
    });

    it(`allow type imports in ${file}`, async () => {
      for (const text of [
        "import type { FunctionReference } from 'convex/server';\nexport type { FunctionReference };\n",
        "import { type FunctionArgs } from 'convex/server';\nexport type { FunctionArgs };\n",
        `import type { api } from '${generated}';\nexport type Api = typeof api;\n`,
      ]) {
        assert.deepEqual(await restrictedImports(file, text), [], text);
      }
    });
  }

  it('are allowed in specs, which never ship in the browser bundle', async () => {
    const text = "import { anyApi } from 'convex/server';\nexport { anyApi };\n";
    for (const file of ['src/app/core/data/convex/api.spec.ts', 'src/app/find/find-page.spec.ts']) {
      assert.deepEqual(await restrictedImports(file, text), [], file);
    }
  });

  it('are allowed in convex/, where the functions run on the server', async () => {
    const text =
      "import { v } from 'convex/values';\nimport { anyApi } from 'convex/server';\nexport { anyApi, v };\n";
    assert.deepEqual(await restrictedImports('convex/organizations.ts', text), []);
  });

  it('leave the convex/browser and React bans in place', async () => {
    const browser = "import { ConvexClient } from 'convex/browser';\nexport { ConvexClient };\n";
    const react = "import { useState } from 'react';\nexport { useState };\n";
    assert.equal((await restrictedImports('src/app/find/find-page.ts', browser)).length, 1);
    assert.equal((await restrictedImports('src/app/find/find-page.spec.ts', browser)).length, 1);
    assert.deepEqual(
      await restrictedImports('src/app/core/data/convex/connection.ts', browser),
      [],
    );
    for (const file of [
      'src/app/find/find-page.ts',
      'src/app/find/find-page.spec.ts',
      'src/app/core/data/convex/saved-copies.ts',
      'src/app/core/data/convex/api.spec.ts',
      'src/server.ts',
    ]) {
      assert.equal((await restrictedImports(file, react)).length, 1, file);
    }
  });
});
