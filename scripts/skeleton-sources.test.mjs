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

const pulsing = () =>
  [...sourceFiles(appDir)]
    .filter((path) => readFileSync(path, 'utf8').includes('animate-pulse'))
    .map((path) => relative(root, path).split(sep).join('/'));

describe('hand-written skeletons', () => {
  it('are absent outside src/app/ui: a loading box uses hlmSkeleton or SKELETON_CLASSES', () => {
    assert.deepEqual(pulsing(), []);
  });

  it('the helm skeleton pulses only through motion-safe:animate-pulse', () => {
    const skeleton = readFileSync(join(uiDir, 'skeleton', 'hlm-skeleton.ts'), 'utf8');
    assert.match(skeleton, /motion-safe:animate-pulse/);
    assert.doesNotMatch(skeleton.replaceAll('motion-safe:animate-pulse', ''), /animate-/);
  });
});
