import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const appDir = join(root, 'src', 'app');

const LEAGUES_REDIRECT = 'src/app/find/leagues-redirect.ts';
const LEAGUE_FORMS = [
  'src/app/organizations/admin/league-create-form.ts',
  'src/app/organizations/league/league-details-form.ts',
];

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* sourceFiles(path);
    } else if (/\.(ts|html)$/.test(entry.name) && !entry.name.endsWith('.spec.ts')) {
      yield relative(root, path).split(sep).join('/');
    }
  }
}

function filesMatching(pattern, exempt) {
  return [...sourceFiles(appDir)]
    .filter((file) => !exempt.includes(file))
    .filter((file) => pattern.test(readFileSync(join(root, file), 'utf8')));
}

describe('the entry points to the search', () => {
  it('no template reads "Find a league" or "Find another league"', () => {
    assert.deepEqual(filesMatching(/Find (a|another) league/, LEAGUE_FORMS), []);
  });

  it('no template or component links to /leagues, which redirects: they go straight to /programs', () => {
    assert.deepEqual(filesMatching(/(["'`])\/leagues(?:[?#]|\1)/, [LEAGUES_REDIRECT]), []);
  });
});
