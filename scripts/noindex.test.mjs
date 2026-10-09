// Unit tests for scripts/noindex.mjs (#15). Run with `npm run test:scripts` (node:test).
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { NOINDEX_HEADERS_FILE, noindexForContext, writeNoindexHeaders } from './noindex.mjs';

describe('noindexForContext', () => {
  for (const context of ['deploy-preview', 'branch-deploy', 'dev', 'any-other-context']) {
    it(`is true for the non-production Netlify context ${context}`, () => {
      assert.equal(noindexForContext(context), true);
    });
  }

  for (const context of ['production', '', undefined]) {
    it(`is false for ${JSON.stringify(context)} (production, or a local build)`, () => {
      assert.equal(noindexForContext(context), false);
    });
  }
});

describe('writeNoindexHeaders', () => {
  it('writes a _headers file that sets X-Robots-Tag: noindex on every path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'noindex-'));
    try {
      await writeNoindexHeaders(dir);
      const text = await readFile(join(dir, '_headers'), 'utf8');
      assert.equal(text, NOINDEX_HEADERS_FILE);
      const rules = text.split('\n').filter((line) => line.trim() && !line.startsWith('#'));
      assert.deepEqual(rules, ['/*', '  X-Robots-Tag: noindex']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
