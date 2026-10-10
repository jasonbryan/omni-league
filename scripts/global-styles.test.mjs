// Tests for the global styles wiring (#61). Run with `npm run test:scripts` (node:test).
// The values themselves are checked by token-contrast.test.mjs; this file checks that the tokens,
// the shared base file, and the two stylesheets that import it stay wired together, and that no
// colour literal lives in src/ outside src/styles/tokens.css.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseRootTokens } from './token-contrast.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...path) => readFile(join(root, ...path), 'utf8');

const SIDEBAR_TOKENS = [
  '--sidebar',
  '--sidebar-foreground',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--sidebar-border',
  '--sidebar-ring',
];

/** Replaces each comment with its newlines, so line numbers survive. */
const withoutComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ''))
    .replace(/(^|\s)\/\/.*$/gm, '$1');

describe('src/styles/tokens.css', () => {
  it('defines the eight sidebar tokens, --radius, and --font-sans in :root', async () => {
    const tokens = parseRootTokens(await read('src', 'styles', 'tokens.css'));
    for (const name of [...SIDEBAR_TOKENS, '--radius', '--font-sans']) {
      assert.ok(tokens.has(name), `${name} is missing from :root`);
    }
    assert.equal(tokens.get('--radius'), '0.75rem');
    assert.match(tokens.get('--font-sans'), /^'Inter Variable'/);
  });

  it('has no .dark block (dark mode is out of scope) and no starter-values paragraph', async () => {
    const css = await read('src', 'styles', 'tokens.css');
    assert.doesNotMatch(withoutComments(css), /\.dark\b/);
    assert.doesNotMatch(css, /starter values/i);
  });
});

describe('src/styles/base.css', () => {
  it('holds the base layer: border colour, scroll offset, body, and the solid focus outline', async () => {
    const css = withoutComments(await read('src', 'styles', 'base.css'));
    assert.match(css, /@layer base\s*\{/);
    assert.match(css, /\*\s*\{\s*@apply border-border;\s*\}/);
    assert.match(css, /html\s*\{\s*scroll-padding-top:\s*4\.5rem;\s*\}/);
    assert.match(
      css,
      /body\s*\{\s*@apply bg-background text-foreground font-sans antialiased;\s*\}/,
    );
    assert.match(css, /:focus-visible\s*\{\s*@apply outline-2 outline-offset-2 outline-ring;\s*\}/);
  });
});

describe('the two stylesheets that import the base file', () => {
  for (const [name, path] of [
    ['src/styles.css', ['src', 'styles.css']],
    ['design/mockup-kit/mockup-kit.css', ['design', 'mockup-kit', 'mockup-kit.css']],
  ]) {
    it(`${name} imports base.css and does not repeat its rules`, async () => {
      const css = withoutComments(await read(...path));
      assert.match(css, /@import\s+'[^']*styles\/base\.css'\s*;/);
      assert.doesNotMatch(css, /scroll-padding-top|:focus-visible|@apply|border-border/);
    });
  }

  it('src/styles.css imports Tailwind with source(.), the tokens, brain preset, and Inter', async () => {
    const css = withoutComments(await read('src', 'styles.css'));
    assert.match(css, /@import\s+'tailwindcss'\s+source\('\.'\)\s*;/);
    assert.match(css, /@import\s+'\.\/styles\/tokens\.css'\s*;/);
    assert.match(css, /@import\s+'@spartan-ng\/brain\/hlm-tailwind-preset\.css'\s*;/);
    assert.match(css, /@import\s+'@fontsource-variable\/inter\/wght\.css'\s*;/);
  });

  // @ng-icons/core puts its host `color: var(--ng-icon__color, currentColor)` in `@layer ng-icon`,
  // and a layer declared later wins. Declared before Tailwind's layers, a colour utility on an
  // <ng-icon> wins over it, as in the mockup kit (#60).
  it('src/styles.css declares the ng-icon layer first, before Tailwind declares its layers', async () => {
    const css = withoutComments(await read('src', 'styles.css'));
    const statement = /@layer\s+ng-icon\s*;/.exec(css);
    assert.ok(statement, '@layer ng-icon; is declared');
    assert.ok(statement.index < css.indexOf("@import 'tailwindcss'"), 'before Tailwind');
    assert.doesNotMatch(css.slice(0, statement.index), /\S/, 'as the first statement');
  });
});

/** Every file under `dir` with one of the extensions, as paths relative to the repo root. */
async function filesUnder(dir, extensions) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      found.push(relative(root, join(entry.parentPath, entry.name)));
    }
  }
  return found.sort();
}

describe('focus treatment in the app shell and the vendored sheet (#75)', () => {
  // The search from #75 criterion 9 (`rg -n`), run on the raw source, comments included.
  const HALO = /outline-none|ring-ring\/50|focus-visible:ring-3/;

  it("finds only main's focus:outline-none in src/app/shell/ and src/app/ui/sheet/", async () => {
    const files = [
      ...(await filesUnder(join(root, 'src', 'app', 'shell'), ['.css', '.ts', '.html'])),
      ...(await filesUnder(join(root, 'src', 'app', 'ui', 'sheet'), ['.css', '.ts', '.html'])),
    ];
    assert.ok(
      files.some((file) => file.endsWith(join('ui', 'sheet', 'hlm-sheet-content.ts'))),
      'the vendored sheet was listed',
    );
    const matches = [];
    for (const file of files) {
      (await read(file)).split('\n').forEach((line, index) => {
        if (HALO.test(line)) matches.push(`${file}:${index + 1}: ${line.trim()}`);
      });
    }
    assert.equal(matches.length, 1, matches.join('\n'));
    assert.match(
      matches[0],
      /shell\.ts:\d+: <main #main id="main" tabindex="-1" class="[^"]*\bfocus:outline-none\b/,
    );
  });
});

describe('colour literals in src/', () => {
  // The search from #61, run on the source with comments removed: an issue reference such as
  // `#100` in a comment is not a colour.
  const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(/;
  // The install colours (#80) cannot be tokens: the theme-color meta and the manifest are read by
  // the browser and the operating system, which know no CSS variable. These are the only lines
  // allowed, and each is a value fixed by the approved mockup, not a style.
  const INSTALL_COLOUR_LINES = {
    [join('src', 'index.html')]: /^<meta name="theme-color" content="#[0-9a-f]{6}" \/>$/,
    [join('src', 'index.spec.ts')]:
      /^expect\(meta\?\.getAttribute\('content'\)\)\.toBe\('#[0-9a-f]{6}'\);$/,
    [join('src', 'pwa-assets.spec.ts')]: /^(?:theme|background)_color: '#[0-9a-f]{6}',$/,
  };

  it('finds nothing in .css, .ts, and .html files except src/styles/tokens.css', async () => {
    const files = (await filesUnder(join(root, 'src'), ['.css', '.ts', '.html'])).filter(
      (file) => file !== join('src', 'styles', 'tokens.css'),
    );
    assert.ok(files.length > 10, 'the source files were actually listed');
    const matches = [];
    for (const file of files) {
      withoutComments(await read(file))
        .split('\n')
        .forEach((line, index) => {
          if (INSTALL_COLOUR_LINES[file]?.test(line.trim())) return;
          if (COLOUR.test(line)) matches.push(`${file}:${index + 1}: ${line.trim()}`);
        });
    }
    assert.deepEqual(matches, []);
  });

  it('catches a colour literal and ignores comments that name an issue', () => {
    for (const line of [
      'color: #fff;',
      'x: #1a2b3c',
      'rgb(0 0 0)',
      'hsl(1 2% 3%)',
      'oklch(1 0 0)',
    ]) {
      assert.match(withoutComments(line), COLOUR, line);
    }
    for (const text of ['// see #100', 'a(); // issue #2024', '/* #100 */', '<!-- #100 -->']) {
      assert.doesNotMatch(withoutComments(text), COLOUR, text);
    }
  });
});
