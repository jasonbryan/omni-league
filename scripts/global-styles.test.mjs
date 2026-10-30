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
    assert.match(
      css,
      /html\s*\{\s*scroll-padding-top:\s*calc\(4\.5rem \+ var\(--offline-note-h, 0px\)\);\s*\}/,
    );
    assert.match(
      css,
      /body\s*\{\s*@apply bg-background text-foreground font-sans antialiased;\s*\}/,
    );
    assert.match(css, /:focus-visible\s*\{\s*@apply outline-2 outline-offset-2 outline-ring;\s*\}/);
  });

  it('sizes buttons and fields to 44px on coarse pointers only', async () => {
    const css = withoutComments(await read('src', 'styles', 'base.css'));
    const start = css.indexOf('@media (pointer: coarse)');
    assert.ok(start > css.indexOf('@layer base'), 'a media block after the base layer');
    const block = css.slice(start);
    assert.match(
      block,
      /\[data-slot='button'\],\s*\[data-slot='sheet-close'\]\s*\{\s*min-height:\s*--spacing\(11\);\s*min-width:\s*--spacing\(11\);\s*\}/,
    );
    assert.match(block, /\[data-slot='input'\]\s*\{\s*min-height:\s*--spacing\(11\);\s*\}/);
    assert.doesNotMatch(css.slice(0, start), /pointer:\s*coarse/);
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
  // <ng-icon> wins over it, as in the mockup kit.
  it('src/styles.css declares the ng-icon layer first, before Tailwind declares its layers', async () => {
    const css = withoutComments(await read('src', 'styles.css'));
    const statement = /@layer\s+ng-icon\s*;/.exec(css);
    assert.ok(statement, '@layer ng-icon; is declared');
    assert.ok(statement.index < css.indexOf("@import 'tailwindcss'"), 'before Tailwind');
    assert.doesNotMatch(css.slice(0, statement.index), /\S/, 'as the first statement');
  });
});

async function filesUnder(dir, extensions) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      found.push(relative(root, join(entry.parentPath, entry.name)));
    }
  }
  return found.sort();
}

describe('focus treatment in the app shell and the vendored sheet', () => {
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
  // Run on the source with comments removed, because a `#` followed by digits in a comment is not a
  // colour. A hex literal is not followed by a hyphen either, so the fragment `#add-location` (the
  // jump link to the add form) is not one.
  const COLOUR = /#[0-9a-fA-F]{3,8}(?![\w-])|rgba?\(|hsla?\(|oklch\(/;
  // The install colours cannot be tokens: the theme-color meta and the manifest are read by
  // the browser and the operating system, which know no CSS variable. These four lines are the only
  // ones allowed. Each entry is an exact file and full trimmed line, allowed at most once.
  const ALLOWED = [
    { file: join('src', 'index.html'), line: '<meta name="theme-color" content="#ffffff" />' },
    {
      file: join('src', 'index.spec.ts'),
      line: "expect(meta?.getAttribute('content')).toBe('#ffffff');",
    },
    { file: join('src', 'pwa-assets.spec.ts'), line: "theme_color: '#ffffff'," },
    { file: join('src', 'pwa-assets.spec.ts'), line: "background_color: '#f6f7fa'," },
  ];

  function findColourLiterals(sources) {
    const used = new Map();
    const matches = [];
    for (const [file, text] of Object.entries(sources)) {
      withoutComments(text)
        .split('\n')
        .forEach((raw, index) => {
          if (!COLOUR.test(raw)) return;
          const line = raw.trim();
          const key = `${file}\n${line}`;
          const allowed = ALLOWED.some((entry) => entry.file === file && entry.line === line);
          if (allowed && !used.has(key)) {
            used.set(key, 1);
            return;
          }
          matches.push(`${file}:${index + 1}: ${line}`);
        });
    }
    return matches;
  }

  it('finds nothing in .css, .ts, and .html files except src/styles/tokens.css and the four allowed lines', async () => {
    const files = (await filesUnder(join(root, 'src'), ['.css', '.ts', '.html'])).filter(
      (file) => file !== join('src', 'styles', 'tokens.css'),
    );
    assert.ok(files.length > 10, 'the source files were actually listed');
    const sources = {};
    for (const file of files) sources[file] = await read(file);
    assert.deepEqual(findColourLiterals(sources), []);
    for (const { file, line } of ALLOWED) {
      const count = sources[file].split('\n').filter((l) => l.trim() === line).length;
      assert.equal(count, 1, `${file}: ${line}`);
    }
  });

  it('allows the four lines once each and rejects a second theme-color meta or an extra hex line', () => {
    const [html, spec, assets1] = ALLOWED;
    const assets2 = ALLOWED[3];
    const ok = {
      [html.file]: `  ${html.line}\n`,
      [spec.file]: `${spec.line}\n`,
      [assets1.file]: `${assets1.line}\n${assets2.line}\n`,
    };
    assert.deepEqual(findColourLiterals(ok), []);
    assert.equal(
      findColourLiterals({ ...ok, [html.file]: `${html.line}\n${html.line}\n` }).length,
      1,
    );
    assert.equal(
      findColourLiterals({
        ...ok,
        [html.file]: `${html.line}\n<meta name="theme-color" content="#000000" />\n`,
      }).length,
      1,
    );
    assert.equal(
      findColourLiterals({
        ...ok,
        [assets1.file]: `${ok[assets1.file]}  border_color: '#123456',\n`,
      }).length,
      1,
    );
    assert.equal(
      findColourLiterals({ ...ok, [join('src', 'other.ts')]: `${assets1.line}\n` }).length,
      1,
    );
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

  it('still catches every hex form, and does not read a jump-link fragment as a colour', () => {
    for (const line of [
      'color: #FFF;',
      'color:#abc',
      'background: #12345678;',
      'fill="#0af"',
      "const c = '#add';",
      'x(#fff)',
      'border: 1px solid #f00 !important',
      'a{color:#ABCDEF}',
    ]) {
      assert.match(withoutComments(line), COLOUR, line);
    }
    for (const line of [
      '<a href="#add-location">Add location</a>',
      "this.router.navigate([], { fragment: 'add-location' }); // #add-location",
      'url(#add-location)',
      'href="#fade-in"',
    ]) {
      assert.doesNotMatch(withoutComments(line), COLOUR, line);
    }
  });
});

describe('touch-target classes in src/', () => {
  // A width breakpoint cannot tell a tablet from a desktop, so `min-h-11` released at `md:` leaves a
  // 768px-wide touch screen below 44px. `pointer-coarse:min-h-11` asks the pointer instead.
  const QUOTED = /(["'`])([^"'`\n]*)\1/g;
  const WIDTH_RELEASE = /^(?:sm|md|lg|xl|2xl):min-h-(?:0|auto)$/;

  function findWidthReleasedTouchTargets(sources) {
    const matches = [];
    for (const [file, text] of Object.entries(sources)) {
      text.split('\n').forEach((line, index) => {
        for (const [, , classes] of line.matchAll(QUOTED)) {
          const tokens = classes.split(/\s+/);
          if (tokens.includes('min-h-11') && tokens.some((token) => WIDTH_RELEASE.test(token))) {
            matches.push(`${file}:${index + 1}: ${classes.trim()}`);
          }
        }
      });
    }
    return matches;
  }

  it('finds no class string that pairs min-h-11 with a width-prefixed min-h-0 or min-h-auto', async () => {
    const files = await filesUnder(join(root, 'src'), ['.ts', '.html']);
    assert.ok(files.length > 10, 'the source files were actually listed');
    const sources = {};
    for (const file of files) sources[file] = await read(file);
    assert.deepEqual(findWidthReleasedTouchTargets(sources), []);
  });

  it('names the file and line of each class string that pairs the two', () => {
    const found = findWidthReleasedTouchTargets({
      'a.ts': [
        "const A = 'inline-flex min-h-11 items-center md:min-h-0';",
        '<a class="flex min-h-11 md:min-h-0 gap-2">x</a>',
        'const B = `min-h-11 2xl:min-h-auto`;',
        'ok',
      ].join('\n'),
    });
    assert.equal(found.length, 3);
    assert.match(found[0], /^a\.ts:1: /);
    assert.match(found[1], /^a\.ts:2: /);
    assert.match(found[2], /^a\.ts:3: /);
  });

  it('accepts the pointer query, a lone min-h-0, and min-h-11 with a different release', () => {
    assert.deepEqual(
      findWidthReleasedTouchTargets({
        'a.ts': [
          "const A = 'inline-flex items-center pointer-coarse:min-h-11';",
          "const B = 'min-h-0 md:min-h-0';",
          "const C = 'min-h-11 pointer-fine:min-h-0';",
          "const D = 'md:min-h-11 md:min-h-0';",
        ].join('\n'),
      }),
      [],
    );
  });
});
