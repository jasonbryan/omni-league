// The Convex adapter barrel re-exports every adapter module, so startup code that imports a value
// from it puts the adapter code of every lazy page in the initial bundle.

import assert from 'node:assert/strict';
import { dirname, join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { ESLint } from 'eslint';

const ROOT = join(import.meta.dirname, '..');
const eslint = new ESLint({ cwd: ROOT });

const BARREL = join(ROOT, 'src/app/core/data/convex');
const BARREL_MESSAGE = /not the barrel/;

function barrelFrom(file) {
  const path = relative(dirname(join(ROOT, file)), BARREL)
    .split('\\')
    .join('/');
  return path.startsWith('.') ? path : `./${path}`;
}

async function restrictedImports(file, text) {
  const [result] = await eslint.lintText(text, { filePath: join(ROOT, file) });
  return result.messages.filter((message) => message.ruleId === 'no-restricted-imports');
}

const STARTUP_FILES = [
  'src/app/app.config.ts',
  'src/app/app.routes.ts',
  'src/app/core/auth/auth.service.ts',
  'src/app/core/service-worker/app-updates.ts',
  'src/app/core/focus-main.ts',
  'src/app/shell/update-prompt.ts',
  'src/app/shell/update-prompt-provider.ts',
];

describe('value imports of the Convex adapter barrel', () => {
  for (const file of STARTUP_FILES) {
    const barrel = barrelFrom(file);

    it(`are refused in ${file}`, async () => {
      for (const text of [
        `import { injectQuery } from '${barrel}';\nexport { injectQuery };\n`,
        `import { injectQuery } from '${barrel}/index';\nexport { injectQuery };\n`,
        `export { ConvexConnection } from '${barrel}';\n`,
      ]) {
        const messages = await restrictedImports(file, text);
        assert.equal(messages.length, 1, text);
        assert.match(messages[0].message, BARREL_MESSAGE, text);
      }
    });

    it(`allow type imports and direct module imports in ${file}`, async () => {
      for (const text of [
        `import type { ConvexAuthSource } from '${barrel}';\nexport type { ConvexAuthSource };\n`,
        `import { type QueryRef } from '${barrel}';\nexport type { QueryRef };\n`,
        `import { provideConvex } from '${barrel}/convex-client';\nexport { provideConvex };\n`,
        `import { ConvexConnection } from '${barrel}/connection';\nexport { ConvexConnection };\n`,
      ]) {
        assert.deepEqual(await restrictedImports(file, text), [], text);
      }
    });

    it(`keep the convex/browser, Convex server, and React bans in ${file}`, async () => {
      const generated = relative(dirname(join(ROOT, file)), join(ROOT, 'convex/_generated/api'))
        .split('\\')
        .join('/');
      for (const text of [
        "import { ConvexClient } from 'convex/browser';\nexport { ConvexClient };\n",
        "import { anyApi } from 'convex/server';\nexport { anyApi };\n",
        `import { api } from '${generated}';\nexport { api };\n`,
        "import { useState } from 'react';\nexport { useState };\n",
      ]) {
        assert.equal((await restrictedImports(file, text)).length, 1, text);
      }
    });
  }

  it('are allowed in a lazy page', async () => {
    const file = 'src/app/shell/account-link.ts';
    const text = `import { injectQuery } from '${barrelFrom(file)}';\nexport { injectQuery };\n`;
    assert.deepEqual(await restrictedImports(file, text), []);
  });

  it('are allowed in a spec next to a startup file', async () => {
    const file = 'src/app/core/focus-main.spec.ts';
    const text = `import { CONVEX_CLIENT } from '${barrelFrom(file)}';\nexport { CONVEX_CLIENT };\n`;
    assert.deepEqual(await restrictedImports(file, text), []);
  });

  it('leave the edge-runtime ban on Node built-ins in url-serializer.ts', async () => {
    const text = "import { readFileSync } from 'node:fs';\nexport { readFileSync };\n";
    const messages = await restrictedImports('src/app/core/url-serializer.ts', text);
    assert.equal(messages.length, 1);
    assert.match(messages[0].message, /no node: imports/);
  });
});
