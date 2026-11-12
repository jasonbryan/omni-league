import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const appDir = join(root, 'src', 'app');
const uiDir = join(appDir, 'ui');

const CARD_SURFACE = ['bg-card', 'ring-foreground/10'];

const PENDING = [];

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

const posix = (path) => relative(root, path).split(sep).join('/');

const STRING_LITERAL = /'[^'\n]*'|"[^"\n]*"|`[^`]*`/g;

const withCardSurface = () =>
  [...sourceFiles(appDir)]
    .filter((path) =>
      (readFileSync(path, 'utf8').match(STRING_LITERAL) ?? []).some((literal) =>
        CARD_SURFACE.every((name) => literal.includes(name)),
      ),
    )
    .map(posix)
    .sort();

describe('hand-written card surfaces', () => {
  it('are absent outside src/app/ui', () => {
    assert.deepEqual(withCardSurface(), PENDING);
  });

  it('are listed as pending only while the file still holds one', () => {
    const holding = new Set(withCardSurface());
    assert.deepEqual(
      PENDING.filter((path) => !holding.has(path)),
      [],
    );
  });
});
