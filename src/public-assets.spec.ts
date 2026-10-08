import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

// ADR 0010 item 3: netlify.toml gives `Cache-Control: public, max-age=31536000, immutable` to the
// content-hashed build outputs (`/media/*`, `/main-*.js`, `/chunk-*.js`, `/polyfills-*.js`,
// `/styles-*.css`). Files copied from `public/` must never take those names, or an unhashed file
// would be cached by browsers for a year.
const hashedFileName = /^(?:(?:main|chunk|polyfills)-.*\.js|styles-.*\.css)$/;

/** Paths under `dir` (relative, sorted) that collide with the long-cached build outputs. */
function hashedNameCollisions(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .map((entry) => ({ entry, path: relative(dir, join(entry.parentPath, entry.name)) }))
    .filter(
      ({ entry, path }) =>
        path === 'media' || (!entry.isDirectory() && hashedFileName.test(entry.name)),
    )
    .map(({ path }) => path)
    .sort();
}

describe('public/ file names', () => {
  it('use none of the content-hashed names that get a long-lived Cache-Control', () => {
    expect(hashedNameCollisions(join(process.cwd(), 'public'))).toEqual([]);
  });

  it('the check reports every colliding name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'public-names-'));
    try {
      mkdirSync(join(dir, 'media'));
      mkdirSync(join(dir, 'icons'));
      for (const name of [
        'main-ABC.js',
        'chunk-1.js',
        'polyfills-x.js',
        'styles-y.css',
        'icons/main-z.js',
        'favicon.ico',
        'main.js',
        'styles.css',
      ]) {
        writeFileSync(join(dir, name), '');
      }

      expect(hashedNameCollisions(dir)).toEqual([
        'chunk-1.js',
        join('icons', 'main-z.js'),
        'main-ABC.js',
        'media',
        'polyfills-x.js',
        'styles-y.css',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
