import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const appDir = join(root, 'src', 'app');
const uiDir = join(appDir, 'ui');

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path !== uiDir) yield* sourceFiles(path);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      yield path;
    }
  }
}

describe('hand-written spinners', () => {
  it('are absent outside src/app/ui: a pending button uses <hlm-spinner>', () => {
    const offenders = [...sourceFiles(appDir)]
      .filter((path) => readFileSync(path, 'utf8').includes('animate-spin'))
      .map((path) => relative(root, path).split(sep).join('/'));
    assert.deepEqual(offenders, []);
  });

  it('the helm spinner spins only through motion-safe:animate-spin', () => {
    const spinner = readFileSync(join(uiDir, 'spinner', 'hlm-spinner.ts'), 'utf8');
    assert.match(spinner, /motion-safe:animate-spin/);
    assert.doesNotMatch(spinner.replaceAll('motion-safe:animate-spin', ''), /animate-/);
  });
});
