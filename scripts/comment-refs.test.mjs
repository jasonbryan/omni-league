import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { checkRepo, describeFinding, findReferences } from './comment-refs.mjs';

const root = join(import.meta.dirname, '..');

const scan = (path, text) => findReferences([{ path, text }]);
const lines = (path, text) => scan(path, text).map((finding) => finding.line);

const flagged = (path, text, message = text) =>
  assert.ok(scan(path, text).length > 0, `not flagged: ${message}`);
const accepted = (path, text, message = text) =>
  assert.deepEqual(scan(path, text), [], `flagged: ${message}`);

describe('the comment reference patterns', () => {
  it('flag each tracker form in a TypeScript line comment', () => {
    const forms = [
      '#12',
      '(#12)',
      'PR 90',
      'PR #90',
      'issue 12',
      'issue #12',
      'ADR 0013',
      'ADR-0013',
      'Tester (round 2)',
      'Reviewer (round 2)',
      'Implementer (round 2)',
      'Planner (round 2)',
      'https://github.com/jasonbryan/omni-league/issues/12',
      'https://github.com/jasonbryan/omni-league/pull/90',
    ];
    for (const form of forms) flagged('src/a.ts', `// see ${form}\nconst a = 1;`, form);
  });

  it('flag a repo URL that carries a fragment', () => {
    flagged('src/a.ts', '// https://github.com/jasonbryan/omni-league/issues/12#issuecomment-1');
  });

  it('print path, line, and the comment text', () => {
    const [finding] = scan('src/a.ts', 'const a = 1;\n\n  // fixes #12\n');
    assert.equal(describeFinding(finding), 'src/a.ts:3: // fixes #12');
  });

  it('flag every line of a block comment that holds a reference', () => {
    assert.deepEqual(lines('src/a.ts', '/**\n * one #12\n * two\n * three PR 90\n */\n'), [2, 4]);
  });

  it('flag a trailing comment and a JSDoc tag in a script', () => {
    flagged('scripts/a.mjs', 'const a = 1; // issue 12\n');
    flagged('scripts/a.mjs', '/** @param {string} a see #12 */\nfunction f(a) {}\n');
  });

  it('flag a comment after a shebang and a comment at the end of the file', () => {
    flagged('scripts/a.mjs', '#!/usr/bin/env node\nconst a = 1;\n// last #12');
  });

  it('flag a reference in a JSON config with comments', () => {
    flagged('tsconfig.json', '{\n  // see #12\n  "compilerOptions": {}\n}\n');
    accepted('tsconfig.json', '{ "a": "x // #12" }');
  });

  it('accept prose without a tracker reference', () => {
    accepted(
      'src/a.ts',
      '// The server rejects a second request in the same tick.\n// 12 players, 3 teams, issuer 12.\nconst a = 1;',
    );
  });
});

describe('the colour rule', () => {
  it('flags an all-digit number in a comment in every file type', () => {
    flagged('src/a.css', '/* see #111 */\na { color: red; }');
    flagged('src/a.ts', '// see #111');
    flagged('.github/workflows/a.yml', '# see #111');
    flagged('src/a.html', '<!-- see #111 -->');
  });

  it('accepts a hex colour that has a letter a to f', () => {
    accepted('src/a.css', '/* the grey is #fff or #1a2b3c */\na { color: red; }');
    accepted('src/a.ts', '// brand colour #1e3a8a, text #fff');
  });

  it('accepts a colour after a CSS property', () => {
    accepted('src/a.css', '/* color: #000 */\na { color: red; }');
    accepted('src/a.css', '/* border: 1px solid #111 */');
    accepted('src/a.css', '/* --surface: #222 */');
    accepted('src/a.ts', '// the old `background: #123` stays');
  });

  it('flags an issue number after a label that is not a colour property', () => {
    flagged('src/a.ts', '// closes: #12');
  });

  it('flags an issue number after prose that follows a colour-like label', () => {
    flagged('src/a.ts', '// Background: the fix in #274 moved this');
    flagged('src/a.ts', '// Border: see #12');
    flagged('src/a.css', 'a {\n  /* color: issue fixed in #274 */\n}');
  });

  it('accepts a colour after a multi-part CSS value', () => {
    accepted('src/a.css', '/* box-shadow: 0 0 0 2px #000 */');
  });

  it('accepts an HTML entity', () => {
    accepted('src/a.ts', '// renders &#39; for the apostrophe');
  });
});

describe('the anchor rule', () => {
  it('accepts a fragment after a URL in a TypeScript comment', () => {
    accepted('src/a.ts', '// see https://example.com/page#123');
  });

  it('accepts a fragment after a file path in a TypeScript comment', () => {
    accepted('src/a.ts', '// docs/process/dev-cycle.md#3-gates');
  });

  it('accepts a fragment after a URL in a YAML comment', () => {
    accepted('.github/workflows/a.yml', 'name: x\n# see https://example.com/page#123\n');
  });

  it('accepts a fragment after a file path in a YAML comment', () => {
    accepted('.github/workflows/a.yml', 'name: x\n# docs/process/dev-cycle.md#3-gates\n');
  });

  it('flags both numbers of a pair joined by a slash', () => {
    flagged('convex/a.test.ts', '// seeds #100/#101 apart');
    // The first number is a path anchor, so only the second can be what flags this line.
    flagged('convex/a.test.ts', '// docs/a.md#100/#101');
  });

  it('accepts a fragment after a URL in parentheses, angle brackets, or quotes', () => {
    accepted('src/a.ts', '// see (https://example.com/page#123)');
    accepted('src/a.ts', '// see <https://example.com/page#123>');
    accepted('src/a.ts', '// see "https://example.com/page#123"');
    accepted('.github/workflows/a.yml', '# see (https://example.com/page#123)');
  });

  it('flags a URL that ends before a number', () => {
    flagged('src/a.ts', '// see (https://example.com/page) #123');
  });

  it('flags a number followed by a dashed word', () => {
    flagged('src/a.ts', '// see #3-gates');
  });

  it('flags a number after a path with a space before the hash', () => {
    flagged('src/a.ts', '// docs/process/dev-cycle.md #3');
  });
});

describe('the TypeScript scanner', () => {
  it('does not read a comment marker inside a string', () => {
    accepted('src/a.ts', "const url = 'https://x.test/#12';");
    accepted('src/a.ts', 'const url = "// #12";');
    accepted('src/a.ts', 'const note = `/* #12 */`;');
  });

  it('does not read a hash inside a regex literal', () => {
    accepted('src/a.ts', 'const pattern = /#\\d+/;');
    accepted('src/a.ts', 'const pattern = /\\/\\/ #12/;');
  });

  it('reads a template literal that holds an expression', () => {
    accepted('src/a.ts', 'const a = `x ${y} // #12 ${z}`;');
    flagged('src/a.ts', 'const a = `x ${y}`; // #12');
  });

  it('flags an HTML comment inside an inline component template', () => {
    flagged(
      'src/a.component.ts',
      "@Component({ selector: 'a', template: `<div></div>\n<!-- see #12 -->` })\nclass A {}",
    );
  });

  it('flags a CSS comment inside inline component styles', () => {
    flagged(
      'src/a.component.ts',
      "@Component({ selector: 'a', template: '', styles: `a { color: red; } /* see #12 */` })\nclass A {}",
    );
    flagged(
      'src/a.component.ts',
      "@Component({ selector: 'a', template: '', styles: ['/* see #12 */'] })\nclass A {}",
    );
  });

  it('reports the line of a comment inside an inline template', () => {
    assert.deepEqual(
      lines(
        'src/a.component.ts',
        '@Component({\n  template: `\n<p></p>\n<!-- #12 -->`,\n})\nclass A {}',
      ),
      [4],
    );
  });

  it('does not read an HTML comment in an ordinary string', () => {
    accepted('src/a.ts', 'const html = `<!-- see #12 -->`;');
    accepted('src/a.ts', "const config = { template: '<!-- see #12 -->' };");
  });
});

describe('the hash-comment files', () => {
  const yml = '.github/workflows/a.yml';

  it('flags a comment at the line start, after whitespace, and in a shell block', () => {
    flagged(yml, '# see #12');
    flagged(yml, 'name: x # see #12');
    flagged(yml, 'jobs:\n  a:\n    steps:\n      - run: |\n          echo ok # see #12\n');
    flagged('scripts/a.sh', 'echo ok # issue 12');
    flagged('netlify.toml', '[build]\ncommand = "x" # PR 90\n');
    flagged('.gitignore', '# issue 12\n/dist\n');
    flagged('.npmrc', '# see #12\nengine-strict=true\n');
    flagged('.env.example', '# see #12\nCONVEX_URL=\n');
    flagged('.prettierignore', '# see #12\ndist/\n');
  });

  it('does not read a hash inside quotes or a shell expansion', () => {
    accepted(yml, "run: grep -E '\\(#[1-9][0-9]*\\)' file");
    accepted(yml, 'run: echo "(#${big:0:12}...)"');
    accepted(yml, 'run: for s in "${#specs[@]}"; do echo $#; done');
    accepted(yml, 'run: echo "a #12"');
    accepted('scripts/a.sh', "echo 'a #12'");
  });

  it('does not read the unquoted forms of those lines as comments', () => {
    accepted(yml, 'run: echo (#${big:0:12}...)');
    accepted(yml, 'run: echo ${#specs[@]} $#');
  });

  it('reads a comment after an apostrophe inside a plain value', () => {
    flagged(yml, "key: it's fine # see #12");
    accepted(yml, "key: it's fine # a why");
  });

  it('does not read a hash that follows a word character', () => {
    accepted(yml, 'run: echo a#12');
  });

  it('accepts an upstream bug URL', () => {
    accepted(yml, '# https://github.com/angular/angular/issues/123');
    accepted('src/a.ts', '// https://github.com/angular/angular/issues/123');
  });

  it('reports the line of the comment', () => {
    assert.deepEqual(lines(yml, 'a: 1\nb: 2\n# issue 12\n'), [3]);
  });

  it('accepts a pinned action version comment', () => {
    accepted(yml, '      - uses: actions/checkout@abc123 # v4.1.0');
  });
});

describe('the CSS and HTML files', () => {
  it('flags a reference in a stylesheet comment and an HTML comment', () => {
    flagged('src/a.css', 'a { color: red; }\n/* issue 12 */');
    flagged('src/a.scss', 'a { b: c; } // issue 12');
    flagged('src/index.html', '<p></p>\n<!-- PR 90 -->');
  });

  it('does not read a comment marker inside a CSS string or url', () => {
    accepted('src/a.css', 'a { content: "/* issue 12 */"; }');
    accepted('src/a.css', 'a { background: url("x.svg#12"); }');
  });
});

describe('the test titles', () => {
  const forms = [
    "it('x issue 12', () => {});",
    "test('x issue 12', () => {});",
    "describe('x issue 12', () => {});",
    "test.describe('x issue 12', () => {});",
    "test.step('x issue 12', async () => {});",
    "it.skip('x issue 12', () => {});",
    "it.only('x issue 12', () => {});",
    "test.skip('x issue 12', () => {});",
    "test.only('x issue 12', () => {});",
    "describe.skip('x issue 12', () => {});",
    "describe.only('x issue 12', () => {});",
    "test.describe.only('x issue 12', () => {});",
    "test.describe.serial('x issue 12', () => {});",
    "it.each([1, 2])('x issue 12', () => {});",
    "test.each([1, 2])('x issue 12', () => {});",
    "describe.each([1, 2])('x issue 12', () => {});",
    'test(`x issue 12`, () => {});',
    'test(`x ${name} issue 12`, () => {});',
    'test.step(`x ${name} (#12)`, async () => {});',
  ];

  for (const form of forms) {
    it(`flags a tracker reference in ${form.slice(0, form.indexOf('('))}`, () => {
      flagged('e2e/a.spec.ts', form);
    });
  }

  it('flags a tagged-template table of it.each, test.each, and describe.each', () => {
    flagged('e2e/a.spec.ts', "it.each`\n a | b\n ${1} | ${2}\n`('x issue 12', () => {});");
    flagged('e2e/a.spec.ts', "test.each`\n a\n ${1}\n`('x issue 12', () => {});");
    flagged('e2e/a.spec.ts', "describe.each`\n a\n ${1}\n`('x issue 12', () => {});");
    accepted('e2e/a.spec.ts', "it.each`\n a\n ${1}\n`('shows the roster', () => {});");
  });

  it('counts file lines, not the line breaks an escape spells', () => {
    assert.deepEqual(lines('e2e/a.spec.ts', "test('a\\nb #12', () => {});"), [1]);
    assert.deepEqual(
      lines('e2e/a.spec.ts', "test('a\\nb', () => {});\ntest('c #12', () => {});"),
      [2],
    );
  });

  it('counts file lines across a multi-line substitution', () => {
    assert.deepEqual(lines('e2e/a.spec.ts', 'test(`a ${\n  name\n} issue 12`, () => {});'), [3]);
  });

  it('reports the line of the title', () => {
    assert.deepEqual(
      lines(
        'e2e/a.spec.ts',
        "test.describe('group', () => {\n  test(\n    'x #12',\n    () => {},\n  );\n});",
      ),
      [3],
    );
  });

  it('flags a title in a script test', () => {
    flagged('scripts/a.test.mjs', "import { it } from 'node:test';\nit('x PR 90', () => {});");
  });

  it('accepts a title that describes behaviour', () => {
    accepted('e2e/a.spec.ts', "test('shows the roster after sign-in', () => {});");
    accepted(
      'e2e/a.spec.ts',
      "test.describe('roster', () => { test.step('opens it', async () => {}); });",
    );
  });

  it('does not check an argument that is not the title', () => {
    accepted('e2e/a.spec.ts', "test('shows it', async () => { await page.goto('/issue 12'); });");
    accepted('e2e/a.spec.ts', "someOther('issue 12', () => {});");
    accepted('e2e/a.spec.ts', "test.use({ name: 'issue 12' });");
  });
});

describe('the scan cost', () => {
  it('stays linear in the number of comments in a file', () => {
    const text = `${'// a why\n'.repeat(100_000)}// see #12\n`;
    const started = performance.now();
    assert.deepEqual(lines('src/a.ts', text), [100_001]);
    assert.ok(performance.now() - started < 10_000);
  });
});

describe('the skip reasons', () => {
  const reasons = [
    "test.skip(isMobile, 'one browser project (ADR 0013)');",
    "test.fixme(isMobile, 'not yet, see #12');",
    "test.skip(({ browserName }) => browserName === 'webkit', 'issue 12');",
    "test.describe.fixme(true, 'PR 90');",
    'test.skip(true, `x ${name} (ADR 0005)`);',
  ];

  for (const form of reasons) {
    it(`flags a tracker reference in ${form.slice(0, form.indexOf('('))} with a condition`, () => {
      flagged('e2e/a.spec.ts', form);
    });
  }

  it('reports the line of the reason', () => {
    assert.deepEqual(lines('e2e/a.spec.ts', "test.skip(\n  isMobile,\n  'issue 12',\n);"), [3]);
  });

  it('accepts a reason that gives a why', () => {
    accepted(
      'e2e/a.spec.ts',
      "test.skip(isMobile, 'one browser project only, to save CI minutes');",
    );
  });

  it('does not check the second argument of a call that is not a test', () => {
    accepted('e2e/a.spec.ts', "other.skip(isMobile, 'issue 12');");
  });
});

describe('the ESLint rule messages', () => {
  it('flags a message property and a message constant', () => {
    flagged(
      'eslint.config.mjs',
      "export default [{ rules: { x: ['error', { message: 'no (ADR 0010).' }] } }];",
    );
    flagged('eslint.config.mjs', "const REACT_MESSAGE = 'not approved (ADR 0008).';");
    flagged('eslint.config.mjs', "const rule = { message:\n 'see issue 12' };");
  });

  it('accepts a message that gives a why', () => {
    accepted(
      'eslint.config.mjs',
      "const rule = { message: 'Server-entry files must not read the environment.' };",
    );
  });

  it('checks only messages, and only in the ESLint config', () => {
    accepted('eslint.config.mjs', "const rule = { name: 'issue 12' };");
    accepted('scripts/a.mjs', "const rule = { message: 'issue 12' };");
  });
});

describe('the scope', () => {
  it('skips Markdown, docs, design, and agent files', () => {
    accepted('README.md', '<!-- see #12 -->');
    accepted('docs/process/a.md', '<!-- see #12 -->');
    accepted('design/mockups/a.html', '<!-- see #12 -->');
    accepted('.claude/agents/a.md', '# see #12');
    accepted('.github/ISSUE_TEMPLATE/a.yml', '# see #12');
    accepted('.github/pull_request_template.md', '<!-- see #12 -->');
  });
});

describe('the command', () => {
  const sandboxes = [];
  after(() => sandboxes.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  const run = (files) => {
    const dir = mkdtempSync(join(tmpdir(), 'comment-refs-'));
    sandboxes.push(dir);
    mkdirSync(join(dir, 'scripts'));
    copyFileSync(
      join(import.meta.dirname, 'comment-refs.mjs'),
      join(dir, 'scripts/comment-refs.mjs'),
    );
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return spawnSync(process.execPath, [join(dir, 'scripts/comment-refs.mjs')], {
      encoding: 'utf8',
    });
  };

  it('exits non-zero and prints path:line: text for each finding', () => {
    const result = run({ 'src/a.ts': 'const a = 1;\n// see #12\n' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^src\/a\.ts:2: \/\/ see #12$/m);
  });

  it('exits zero when the files are clean', () => {
    const result = run({ 'src/a.ts': '// A why.\nconst a = 1;\n' });
    assert.equal(result.status, 0, result.stderr);
  });
});

describe('the repository', () => {
  it('has no tracker reference in a comment or test title', () => {
    assert.deepEqual(checkRepo(root).map(describeFinding), []);
  });
});
