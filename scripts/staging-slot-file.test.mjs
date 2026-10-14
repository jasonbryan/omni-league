import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { STAGING_SLOT_FILE, writeStagingSlotFile } from './staging-slot-file.mjs';

async function inTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), 'staging-slot-'));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('writeStagingSlotFile', () => {
  for (const slot of ['staging-a', 'staging-b']) {
    it(`writes ${slot} and a newline on a branch deploy`, () =>
      inTempDir(async (dir) => {
        const written = await writeStagingSlotFile(dir, {
          CONTEXT: 'branch-deploy',
          STAGING_SLOT: slot,
        });
        assert.equal(written, true);
        assert.equal(STAGING_SLOT_FILE, 'staging-slot.txt');
        assert.equal(await readFile(join(dir, 'staging-slot.txt'), 'utf8'), `${slot}\n`);
      }));
  }

  const cases = {
    'a deploy preview': { CONTEXT: 'deploy-preview', STAGING_SLOT: 'staging-a' },
    production: { CONTEXT: 'production', STAGING_SLOT: 'staging-a' },
    'no CONTEXT (a local build)': { STAGING_SLOT: 'staging-a' },
    'a branch deploy with no slot': { CONTEXT: 'branch-deploy' },
    'a branch deploy with the slot main': { CONTEXT: 'branch-deploy', STAGING_SLOT: 'main' },
    'a branch deploy with an empty slot': { CONTEXT: 'branch-deploy', STAGING_SLOT: '' },
    'a branch deploy with a slot and a newline': {
      CONTEXT: 'branch-deploy',
      STAGING_SLOT: 'staging-a\n',
    },
  };
  for (const [title, env] of Object.entries(cases)) {
    it(`writes no file for ${title}`, () =>
      inTempDir(async (dir) => {
        assert.equal(await writeStagingSlotFile(dir, env), false);
        assert.deepEqual(await readdir(dir), []);
      }));
  }
});

describe('scripts/ng-convex.mjs', () => {
  it('writes the slot file after a build, before the noindex early return', () => {
    const source = readFileSync(join(import.meta.dirname, 'ng-convex.mjs'), 'utf8');
    assert.match(
      source,
      /import \{[^}]*writeStagingSlotFile[^}]*\} from '\.\/staging-slot-file\.mjs'/,
    );
    const call = source.indexOf('writeStagingSlotFile(');
    assert.ok(call > 0, 'ng-convex.mjs calls writeStagingSlotFile');
    assert.ok(call < source.indexOf('if (!noindex) return;'), 'the call precedes the early return');
  });
});
