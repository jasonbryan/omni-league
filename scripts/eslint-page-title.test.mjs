// The tab title has one writer, PageTitle, so the app shell's slim bar cannot drift from it.
// A file that sets the title through Angular's Title service would change the tab and not the bar.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ESLint } from 'eslint';

const ROOT = join(import.meta.dirname, '..');
const eslint = new ESLint({ cwd: ROOT });
const TITLE_MESSAGE = /PageTitle/;
const IMPORT_TITLE = "import { Title } from '@angular/platform-browser';\nexport { Title };\n";

async function restrictedImports(file, text) {
  const [result] = await eslint.lintText(text, { filePath: join(ROOT, file) });
  return result.messages.filter((message) => message.ruleId === 'no-restricted-imports');
}

// One file for each flat-config block that applies `no-restricted-imports` to non-spec files.
const REFUSED_IN = [
  'src/app/organizations/league/league-context.ts',
  'src/app/core/focus-main.ts',
  'src/app/core/data/convex/convex-client.ts',
  'src/app/core/url-serializer.ts',
  'src/server.ts',
];

describe('imports of Title from @angular/platform-browser', () => {
  for (const file of REFUSED_IN) {
    it(`are refused in ${file}`, async () => {
      for (const text of [
        IMPORT_TITLE,
        "import { Meta, Title } from '@angular/platform-browser';\nexport { Meta, Title };\n",
        "export { Title } from '@angular/platform-browser';\n",
      ]) {
        const messages = await restrictedImports(file, text);
        assert.equal(messages.length, 1, text);
        assert.match(messages[0].message, TITLE_MESSAGE, text);
      }
    });
  }

  it('allow the other exports of @angular/platform-browser in a page', async () => {
    const file = 'src/app/organizations/league/league-context.ts';
    const text = "import { Meta } from '@angular/platform-browser';\nexport { Meta };\n";
    assert.deepEqual(await restrictedImports(file, text), []);
  });

  for (const file of ['src/app/core/page-title.ts', 'src/app/core/page-meta.ts']) {
    it(`are allowed in ${file}`, async () => {
      assert.deepEqual(await restrictedImports(file, IMPORT_TITLE), []);
    });

    it(`keep the Convex barrel ban in ${file}`, async () => {
      const text = "import { injectQuery } from './data/convex';\nexport { injectQuery };\n";
      assert.equal((await restrictedImports(file, text)).length, 1);
    });
  }

  it('are allowed in a spec, which reads getTitle()', async () => {
    for (const file of [
      'src/app/organizations/league/league-page.spec.ts',
      'src/app/core/page-title.spec.ts',
    ]) {
      assert.deepEqual(await restrictedImports(file, IMPORT_TITLE), [], file);
    }
  });

  it('pass in the files that set a title today', async () => {
    for (const file of [
      'src/app/offline/not-saved-view.ts',
      'src/app/not-found/not-found-view.ts',
      'src/app/core/page-meta.ts',
      'src/app/core/page-title.ts',
    ]) {
      const text = await readFile(join(ROOT, file), 'utf8');
      const messages = await restrictedImports(file, text);
      assert.deepEqual(
        messages.filter((message) => TITLE_MESSAGE.test(message.message)),
        [],
        file,
      );
    }
  });
});
