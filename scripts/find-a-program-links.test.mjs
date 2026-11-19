import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const appDir = join(root, 'src', 'app');

const LEAGUES_REDIRECT = 'src/app/find/leagues-redirect.ts';
const NEW_USER_FILE = 'src/app/account/home-new-user.ts';
const OLD_NAME = /Find (a|another) league/;
const NEW_USER_SENTENCE = /Find a league, then register a team or register as a free agent\./;

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

const read = (file) => readFileSync(join(root, file), 'utf8').replace(/\s+/g, ' ');

function filesMatching(pattern, exempt, text = read) {
  return [...sourceFiles(appDir)]
    .filter((file) => !exempt.includes(file))
    .filter((file) => pattern.test(text(file)));
}

describe('the entry points to the search', () => {
  it('no template reads "Find a league" or "Find another league", apart from the new-user sentence', () => {
    const withoutSentence = (file) => read(file).replace(NEW_USER_SENTENCE, '');
    assert.deepEqual(filesMatching(OLD_NAME, [], withoutSentence), []);
  });

  it('no template or component links to /leagues, which redirects: they go straight to /programs', () => {
    assert.deepEqual(filesMatching(/(["'`])\/leagues(?:[?#]|\1)/, [LEAGUES_REDIRECT]), []);
  });

  it('each exemption is still needed', () => {
    assert.match(read(NEW_USER_FILE), NEW_USER_SENTENCE);
  });
});
