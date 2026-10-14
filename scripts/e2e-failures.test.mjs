import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { MAX_LISTED, failingTests, failuresFromFile } from './e2e-failures.mjs';

const script = join(import.meta.dirname, 'e2e-failures.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'e2e-failures-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const test = (projectName, status) => ({ projectName, status, results: [] });
const found = (file, line, title, ...tests) => ({ file, line, title, ok: false, tests });

const report = {
  suites: [
    {
      title: 'organization-staff.spec.ts',
      file: 'organization-staff.spec.ts',
      specs: [
        found(
          'organization-staff.spec.ts',
          12,
          'copies the link',
          test('chromium-mobile', 'unexpected'),
          test('chromium-desktop', 'expected'),
        ),
      ],
      suites: [
        {
          title: 'invite panel',
          file: 'organization-staff.spec.ts',
          specs: [
            found(
              'organization-staff.spec.ts',
              40,
              'revokes',
              test('chromium-desktop', 'unexpected'),
            ),
            found('organization-staff.spec.ts', 55, 'resends', test('chromium-desktop', 'flaky')),
            found('organization-staff.spec.ts', 70, 'skips', test('chromium-desktop', 'skipped')),
          ],
        },
      ],
    },
  ],
};

describe('failingTests', () => {
  it('lists each test that failed every attempt, per project, with its describe title', () => {
    assert.deepEqual(failingTests(report), [
      'chromium-desktop: e2e/organization-staff.spec.ts:40: invite panel › revokes',
      'chromium-mobile: e2e/organization-staff.spec.ts:12: copies the link',
    ]);
  });

  it('leaves out flaky, skipped, and passed tests', () => {
    const passing = {
      suites: [
        {
          title: 'a.spec.ts',
          file: 'a.spec.ts',
          specs: [
            found('a.spec.ts', 1, 'ok', test('chromium-desktop', 'expected')),
            found('a.spec.ts', 2, 'flaky', test('chromium-desktop', 'flaky')),
            found('a.spec.ts', 3, 'skipped', test('chromium-desktop', 'skipped')),
          ],
        },
      ],
    };
    assert.deepEqual(failingTests(passing), []);
  });

  it(`lists at most ${MAX_LISTED} tests and counts the rest`, () => {
    const many = {
      suites: [
        {
          title: 'a.spec.ts',
          file: 'a.spec.ts',
          specs: Array.from({ length: MAX_LISTED + 7 }, (_, index) =>
            found('a.spec.ts', index + 1, `t${index + 1}`, test('chromium-desktop', 'unexpected')),
          ),
        },
      ],
    };
    const listed = failingTests(many);
    assert.equal(listed.length, MAX_LISTED + 1);
    assert.equal(listed.at(-1), 'and 7 more');
  });

  it('adds the first line of a run-level error, without colour codes', () => {
    const errored = {
      suites: [],
      errors: [{ message: '\u001b[31mglobalSetup failed\u001b[39m\nstack' }],
    };
    assert.deepEqual(failingTests(errored), ['run error: globalSetup failed']);
  });

  it('gives an empty list for a report with nothing in it', () => {
    assert.deepEqual(failingTests({}), []);
    assert.deepEqual(failingTests(null), []);
  });
});

describe('failuresFromFile', () => {
  it('reads a report file', () => {
    const path = join(scratch, 'results.json');
    writeFileSync(path, JSON.stringify(report));
    assert.equal(failuresFromFile(path).length, 2);
  });

  it('gives an empty list for a missing or unparsable file', () => {
    assert.deepEqual(failuresFromFile(join(scratch, 'missing.json')), []);
    const path = join(scratch, 'broken.json');
    writeFileSync(path, '{ not json');
    assert.deepEqual(failuresFromFile(path), []);
  });
});

describe('the command line', () => {
  it('prints one failures= line of JSON that GITHUB_OUTPUT accepts', () => {
    const path = join(scratch, 'cli.json');
    writeFileSync(path, JSON.stringify(report));
    const result = spawnSync(process.execPath, [script, path], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^failures=\[.*\]\n$/);
    assert.equal(JSON.parse(result.stdout.slice('failures='.length)).length, 2);
  });

  it('prints failures=[] and exits 0 when the report is missing', () => {
    const result = spawnSync(process.execPath, [script, join(scratch, 'none.json')], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'failures=[]\n');
  });
});
