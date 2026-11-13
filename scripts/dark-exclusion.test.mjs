import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  builtStylesheetProblems,
  darkExclusionProblems,
  readDarkExclusionInputs,
} from './dark-exclusion.mjs';

const ROOT = join(import.meta.dirname, '..');

const exclusion = (...entries) =>
  `@import 'tailwindcss' source('.');\n@source not inline('${entries.join(' ')}');\n`;
const NO_DARK_THEME = ':root { --background: oklch(1 0 0); }\n';

const problems = (inputs) =>
  darkExclusionProblems({
    sources: {},
    stylesCss: exclusion(),
    tokensCss: NO_DARK_THEME,
    ...inputs,
  });

describe('the dark-variant exclusion in src/styles.css', () => {
  it('lists every dark-variant class that the files Tailwind scans use', async () => {
    const inputs = await readDarkExclusionInputs(ROOT);
    assert.ok(Object.keys(inputs.sources).length > 100, 'the source files were actually listed');
    assert.deepEqual(darkExclusionProblems(inputs), []);
  });

  it('reads the files Tailwind scans and none of the others', async () => {
    const { sources } = await readDarkExclusionInputs(ROOT);
    const files = Object.keys(sources);
    assert.ok(files.includes('src/app/ui/input/hlm-input.ts'));
    assert.ok(files.includes('src/index.html'));
    assert.ok(files.includes('src/styles/base.css'));
    assert.ok(!files.includes('src/styles.css'), 'the exclusion itself');
    assert.ok(!files.some((file) => file.endsWith('.spec.ts')));
    assert.ok(!files.some((file) => file.includes('/testing/')));
  });

  it('fails on a dark class in a .ts file that the exclusion does not list', () => {
    const found = problems({
      sources: { 'src/app/a.ts': "const c = 'flex dark:bg-input/30 p-2';" },
    });
    assert.equal(found.length, 1);
    assert.match(found[0], /"dark:bg-input\/30"/);
    assert.match(found[0], /src\/app\/a\.ts/);
    assert.match(found[0], /@source not inline\(\) in src\/styles\.css/);
    assert.match(found[0], /scripts\/dark-exclusion\.mjs/);
  });

  it('fails on hover:dark:bg-x in a .html file', () => {
    const found = problems({
      sources: { 'src/app/a.html': '<a class="hover:dark:bg-x">x</a>' },
    });
    assert.equal(found.length, 1);
    assert.match(found[0], /"hover:dark:bg-x"/);
    assert.match(found[0], /src\/app\/a\.html/);
  });

  it('fails on md:dark:bg-x in a .css file', () => {
    const found = problems({
      sources: { 'src/app/a.css': '.a { @apply md:dark:bg-x; }' },
    });
    assert.equal(found.length, 1);
    assert.match(found[0], /"md:dark:bg-x"/);
    assert.match(found[0], /src\/app\/a\.css/);
  });

  it('finds a dark class whose variant carries an arbitrary value', () => {
    const found = problems({
      sources: {
        'src/a.ts': "x('dark:has-[>[data-slot=a]]:bg-x dark:data-[a=true]:ring-y/40')",
      },
    });
    assert.equal(found.length, 2);
    assert.match(found[0], /"dark:has-\[>\[data-slot=a\]\]:bg-x"/);
    assert.match(found[1], /"dark:data-\[a=true\]:ring-y\/40"/);
  });

  it('names each file that uses a missing class', () => {
    const found = problems({
      sources: { 'src/a.ts': "'dark:bg-x'", 'src/b.html': '<i class="dark:bg-x"></i>' },
    });
    assert.equal(found.length, 2);
    assert.match(found[0], /src\/a\.ts/);
    assert.match(found[1], /src\/b\.html/);
  });

  it('passes when the exclusion lists the class, in any chain position', () => {
    assert.deepEqual(
      problems({
        sources: {
          'src/a.ts': "'dark:bg-x hover:dark:bg-y md:dark:bg-z'",
          'src/a.html': '<i class="dark:bg-x"></i>',
        },
        stylesCss: exclusion('dark:bg-x', 'hover:dark:bg-y', 'md:dark:bg-z'),
      }),
      [],
    );
  });

  it('ignores prose and keys that only look like a dark variant', () => {
    assert.deepEqual(
      problems({
        sources: {
          'src/a.ts':
            "const theme = { dark: 'x' }; // the dark: key, dark:\nconst m = 'darkness:bg-x';",
          'src/a.md': 'Use `dark:` classes (see the docs).',
        },
      }),
      [],
    );
  });

  it('fails on an exclusion entry with no dark variant', () => {
    const found = problems({ stylesCss: exclusion('bg-input/30') });
    assert.equal(found.length, 1);
    assert.match(found[0], /"bg-input\/30"/);
    assert.match(found[0], /no dark variant/);
    assert.match(found[0], /src\/styles\.css/);
    assert.match(found[0], /scripts\/dark-exclusion\.mjs/);
  });

  it('fails on an exclusion entry that uses brace expansion', () => {
    const found = problems({ stylesCss: exclusion('{dark:,}bg-input/30') });
    assert.equal(found.length, 1);
    assert.match(found[0], /"\{dark:,\}bg-input\/30"/);
    assert.match(found[0], /brace expansion/);
    assert.match(found[0], /src\/styles\.css/);
    assert.match(found[0], /scripts\/dark-exclusion\.mjs/);
  });

  it('leaves the two outline entries that no page uses alone', () => {
    assert.deepEqual(
      problems({ stylesCss: `${exclusion('outline-destructive', 'outline-muted')}` }),
      [],
    );
  });

  it('fails when tokens.css has a .dark block while the exclusion still lists classes', () => {
    const found = problems({
      stylesCss: exclusion('dark:bg-x'),
      tokensCss: ':root { --a: 1; }\n.dark { --a: 2; }\n',
    });
    assert.equal(found.length, 1);
    assert.match(found[0], /src\/styles\/tokens\.css/);
    assert.match(found[0], /\.dark/);
    assert.match(found[0], /@source not inline\(\) in src\/styles\.css/);
    assert.match(found[0], /scripts\/dark-exclusion\.mjs/);
  });

  it('accepts a .dark block once the exclusion lists no dark classes', () => {
    assert.deepEqual(
      problems({
        stylesCss: exclusion('outline-destructive'),
        tokensCss: ':root { --a: 1; }\n.dark { --a: 2; }\n',
      }),
      [],
    );
  });

  it('does not read a .dark in a comment or a longer class name as a selector', () => {
    assert.deepEqual(
      problems({
        stylesCss: exclusion('dark:bg-x'),
        tokensCss: '/* .dark is out of scope */\n.dark-sidebar { --a: 2; }\n',
        sources: { 'src/a.ts': "'dark:bg-x'" },
      }),
      [],
    );
  });
});

describe('reading the files on disk', () => {
  async function withTree(files, run) {
    const dir = await mkdtemp(join(tmpdir(), 'dark-exclusion-'));
    try {
      for (const [path, text] of Object.entries(files)) {
        await mkdir(join(dir, path, '..'), { recursive: true });
        await writeFile(join(dir, path), text);
      }
      return await run(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const TREE = {
    'src/styles.css': exclusion('dark:bg-x'),
    'src/styles/tokens.css': NO_DARK_THEME,
    'src/app/a.ts': 'a',
    'src/app/a.spec.ts': 'spec',
    'src/app/testing/helper.ts': 'helper',
    'src/app/ui/testing/deep/helper.ts': 'deep helper',
    'src/app/b.md': 'notes',
    'src/app/c.json': '{}',
    'docs/readme.md': 'outside src',
  };

  it('keeps every extension under src/ and drops specs, testing/, and styles.css', async () => {
    const { sources, stylesCss, tokensCss } = await withTree(TREE, readDarkExclusionInputs);
    assert.deepEqual(Object.keys(sources).sort(), [
      'src/app/a.ts',
      'src/app/b.md',
      'src/app/c.json',
      'src/styles/tokens.css',
    ]);
    assert.equal(stylesCss, TREE['src/styles.css']);
    assert.equal(tokensCss, NO_DARK_THEME);
  });

  it('passes a dark class that only a spec file or a testing helper uses', async () => {
    const found = await withTree(
      {
        ...TREE,
        'src/app/a.spec.ts': "expect(el.className).toContain('dark:bg-x');",
        'src/app/ui/testing/literals.ts': "export const A = 'dark:bg-y';",
      },
      async (dir) => darkExclusionProblems(await readDarkExclusionInputs(dir)),
    );
    assert.deepEqual(found, []);
  });

  it('reads a dark class from a file of any extension', async () => {
    const found = await withTree(
      {
        ...TREE,
        'src/styles.css': exclusion('md:dark:bg-x'),
        'src/app/c.json': '{"x":"md:dark:bg-x"}',
      },
      async (dir) => darkExclusionProblems(await readDarkExclusionInputs(dir)),
    );
    assert.deepEqual(found, []);
    const missing = await withTree(
      { ...TREE, 'src/app/c.json': '{"x":"md:dark:bg-y"}' },
      async (dir) => darkExclusionProblems(await readDarkExclusionInputs(dir)),
    );
    assert.equal(missing.length, 1);
    assert.match(missing[0], /src\/app\/c\.json/);
  });
});

describe('the production stylesheet check', () => {
  async function withBrowserDir(files, run) {
    const dir = await mkdtemp(join(tmpdir(), 'dark-styles-'));
    try {
      for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
      return await run(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('fails on a styles-*.css that contains :is(.dark *), and names the file', async () => {
    const found = await withBrowserDir(
      {
        'styles-ABC123.css': '.a{color:red}:is(.dark *){color:blue}',
        'main-XYZ.js': 'console.log(":is(.dark *)")',
      },
      builtStylesheetProblems,
    );
    assert.equal(found.length, 1);
    assert.match(found[0], /styles-ABC123\.css/);
    assert.match(found[0], /:is\(\.dark \*\)/);
  });

  it('reads the unhashed styles.css that the development build writes', async () => {
    const found = await withBrowserDir(
      { 'styles.css': ':is(.dark *){color:blue}' },
      builtStylesheetProblems,
    );
    assert.equal(found.length, 1);
    assert.match(found[0], /styles\.css/);
  });

  it('passes a stylesheet with no dark selector', async () => {
    const found = await withBrowserDir(
      { 'styles-ABC123.css': '.a{color:red}.dark-note{color:blue}' },
      builtStylesheetProblems,
    );
    assert.deepEqual(found, []);
  });

  it('fails when the build wrote no stylesheet, so the check cannot pass on nothing', async () => {
    const found = await withBrowserDir({ 'main-XYZ.js': '' }, builtStylesheetProblems);
    assert.equal(found.length, 1);
    assert.match(found[0], /no styles\.css or styles-\*\.css/);
  });
});

describe('scripts/ng-convex.mjs', () => {
  it('fails the production build on a problem in the built stylesheet', async () => {
    const source = await readFile(join(ROOT, 'scripts', 'ng-convex.mjs'), 'utf8');
    const afterBuild = source.slice(source.indexOf('async function afterBuild()'));
    assert.match(source, /import \{ builtStylesheetProblems \} from '\.\/dark-exclusion\.mjs'/);
    assert.match(afterBuild, /builtStylesheetProblems\(browserDir\)/);
    assert.match(afterBuild, /throw new Error\([^)]*dark-exclusion\.mjs/s);
  });
});
