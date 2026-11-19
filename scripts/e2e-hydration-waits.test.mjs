import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const fixtures = join(import.meta.dirname, 'fixtures', 'e2e-hydration-waits');

const POLLS_ANY_HYDRATION = /\bpoll\(\s*\(\s*\)\s*=>\s*[\w.]*\.hydrated\b/;
const DEFINES_OWN_WAIT = /\bfunction\s+hydrated\b/;

const violations = (text) =>
  [
    POLLS_ANY_HYDRATION.test(text) && 'polls `consoleGuard.hydrated`, which any page satisfies',
    DEFINES_OWN_WAIT.test(text) && 'defines its own `hydrated`',
  ].filter(Boolean);

function specFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...specFiles(path));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

const fixture = (name) => readFileSync(join(fixtures, name), 'utf8');

describe('the hydration wait rule', () => {
  it('flags a bare poll of `consoleGuard.hydrated`', () => {
    assert.equal(violations(fixture('bare-poll.txt')).length, 1);
  });

  it('flags a poll written across lines, with a message', () => {
    assert.equal(violations(fixture('wrapped-poll.txt')).length, 1);
  });

  it('flags a local copy of the wait, and the poll inside it', () => {
    assert.equal(violations(fixture('local-copy.txt')).length, 2);
  });

  it('accepts the shared waits and a plain read of `hydrated`', () => {
    assert.deepEqual(violations(fixture('shared-waits.txt')), []);
  });

  it('holds for every e2e file outside e2e/support', () => {
    const support = join(root, 'e2e', 'support') + sep;
    const found = specFiles(join(root, 'e2e'))
      .filter((path) => !path.startsWith(support))
      .flatMap((path) =>
        violations(readFileSync(path, 'utf8')).map(
          (reason) => `${relative(root, path)}: ${reason}`,
        ),
      );
    assert.deepEqual(found, [], 'use hydrated() or gotoHydrated() from e2e/support/hydrated.ts');
  });
});
