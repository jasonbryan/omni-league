import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';
import { EXCEPTIONS, PENDING, controlsIn, findControlFindings } from './ui-controls.mjs';

const root = join(import.meta.dirname, '..');
const appDir = join(root, 'src', 'app');
const uiDir = join(appDir, 'ui');

const PATH = 'src/app/example/example.ts';

const inTemplate = (body) => `export const template = \`${body}\`;\n`;
const scan = (body, path = PATH) => findControlFindings(path, inTemplate(body));

describe('native controls outside src/app/ui', () => {
  const failing = [
    {
      name: 'a select',
      body: '<div></div>\n<select>\n</select>',
      line: 2,
      element: '<select>',
      component: 'brain select + helm select',
    },
    {
      name: 'a textarea without hlmTextarea',
      body: '<textarea rows="3"></textarea>',
      line: 1,
      element: '<textarea>',
      component: 'ui/textarea (hlmTextarea)',
    },
    {
      name: 'a bare text input',
      body: '<p></p>\n<p></p>\n<input type="text" name="q" />',
      line: 3,
      element: '<input type="text">',
      component: 'ui/input (hlmInput)',
    },
    {
      name: 'an input with no type and no hlmInput',
      body: '<input name="q" />',
      line: 1,
      element: '<input>',
      component: 'ui/input (hlmInput)',
    },
    {
      name: 'a radio',
      body: '<input type="radio" name="size" />',
      line: 1,
      element: '<input type="radio">',
      component: 'ui/radio-group',
    },
    {
      name: 'a radio that carries hlmInput',
      body: '<input hlmInput type="radio" name="size" />',
      line: 1,
      element: '<input type="radio">',
      component: 'ui/radio-group',
    },
    {
      name: 'a checkbox in an unlisted file',
      body: '<input type="checkbox" name="open" />',
      line: 1,
      element: '<input type="checkbox">',
      component: 'ui/checkbox (app-checkbox)',
    },
    {
      name: 'a file input without hlmInput in an unlisted file',
      body: '<input type="file" />',
      line: 1,
      element: '<input type="file">',
      component: 'ui/input (hlmInput)',
    },
    {
      name: 'a search input without hlmInput in an unlisted file',
      body: '<input type="search" />',
      line: 1,
      element: '<input type="search">',
      component: 'ui/input (hlmInput)',
    },
    {
      name: 'a control split across a substitution',
      body: '<p></p>\n<input ${attrs}>',
      line: 2,
      element: '<input',
      component: 'control element split across ${...}; keep the element in one template piece',
    },
  ];
  for (const { name, body, line, element, component } of failing) {
    it(`fails on ${name}, naming the file, the line, and the component`, () => {
      const findings = scan(body);
      assert.equal(findings.length, 1, JSON.stringify(findings));
      const [finding] = findings;
      assert.equal(finding.path, PATH);
      assert.equal(finding.line, line);
      assert.ok(finding.message.startsWith(`${PATH}:${line}: ${element}`), finding.message);
      assert.ok(finding.message.includes(component), finding.message);
    });
  }

  const passing = [
    [
      'a multi-line input with hlmInput on a later line',
      '<input\n  type="text"\n  name="q"\n  hlmInput\n/>',
    ],
    ['a select inside a // comment', '`;\n// <select></select>\nexport const x = `'],
    ['a select inside a /* */ comment', '`;\n/* <select></select> */\nexport const x = `'],
    ['a select inside a template comment', '<!-- <select></select> -->'],
    ['a multi-line template comment around a textarea', '<!--\n<textarea></textarea>\n-->'],
    [
      'a selector string that names the checkbox type',
      '\'input[type="checkbox"], a[href], button\'',
    ],
    ['a hidden input in an unlisted file', '<input type="hidden" name="page" value="1" />'],
    ['a textarea with hlmTextarea', '<textarea hlmTextarea></textarea>'],
    [
      'an input with a bound type and hlmInput',
      `<input hlmInput [type]="showPassword() ? 'text' : 'password'" />`,
    ],
    [
      'an input with > inside a quoted binding',
      '<input hlmInput [disabled]="count() > 0" name="q" />',
    ],
    ['an input with a static type and hlmInput', '<input hlmInput type="email" />'],
    ['a file input with hlmInput', '<input hlmInput type="file" />'],
    ['a search input with hlmInput', '<input hlmInput type="search" />'],
    [
      'a substitution around an input',
      '<div class="${PANEL}">\n<input hlmInput name="q" />\n</div>',
    ],
    ['an element name that only starts with input', '<input-group></input-group>'],
  ];
  for (const [name, body] of passing) {
    it(`passes ${name}`, () => {
      const text = body.startsWith('`;') ? `export const first = \`${body}\`;\n` : inTemplate(body);
      assert.deepEqual(findControlFindings(PATH, text), []);
    });
  }

  it('does not read a substitution that surrounds an input as part of the input', () => {
    const text = 'export const t = `<div class="${PANEL}"><input hlmInput name="q" /></div>`;\n';
    assert.deepEqual(findControlFindings(PATH, text), []);
  });

  it('reports the line of the opening < for an element that spans lines', () => {
    const findings = scan('<p></p>\n<input\n  name="q"\n/>');
    assert.deepEqual(
      findings.map(({ line }) => line),
      [2],
    );
  });

  it('keeps line numbers across a template comment', () => {
    const findings = scan('<!--\n\n-->\n<select></select>');
    assert.deepEqual(
      findings.map(({ line }) => line),
      [4],
    );
  });

  it('reads a template piece before and after a substitution', () => {
    const text = 'export const t = `<a>${x}</a><select></select>${y}<textarea></textarea>`;\n';
    assert.deepEqual(
      findControlFindings(PATH, text).map(({ message }) => message.split(': ')[1]),
      ['<select>', '<textarea>'],
    );
  });

  it('reads a plain string literal', () => {
    const text = "export const t = '<select></select>';\n";
    assert.equal(findControlFindings(PATH, text).length, 1);
  });

  it('reads a whole .html file as template text', () => {
    const findings = findControlFindings(
      'src/app/example/example.html',
      '<p></p>\n<select></select>\n',
    );
    assert.deepEqual(
      findings.map(({ line }) => line),
      [2],
    );
  });

  it('passes a select only in a pending file', () => {
    const [pending] = PENDING;
    assert.deepEqual(scan('<select></select>', pending), []);
    assert.equal(scan('<select></select>').length, 1);
  });

  it('lists pending files and exception files by repo-relative src/app path', () => {
    const paths = [...PENDING, ...EXCEPTIONS.flatMap(({ files }) => files)];
    for (const path of paths) assert.match(path, /^src\/app\/.+\.ts$/);
  });

  describe('exceptions', () => {
    const byType = (type) => EXCEPTIONS.find((exception) => exception.type === type);

    for (const [type, element] of [
      ['checkbox', '<input type="checkbox" />'],
      ['file', '<input type="file" />'],
      ['search', '<input type="search" />'],
    ]) {
      it(`passes ${type} in each listed file and fails it elsewhere unless it has hlmInput`, () => {
        const { files } = byType(type);
        for (const file of files) assert.deepEqual(scan(element, file), [], file);
        if (type === 'checkbox') assert.equal(scan(element).length, 1);
        else {
          assert.equal(scan(element).length, 1);
          assert.deepEqual(scan(element.replace('<input', '<input hlmInput')), []);
        }
      });
    }

    it('names the league filter files for the checkbox', () => {
      assert.deepEqual(byType('checkbox').files, [
        'src/app/organizations/league-filter-overlays.ts',
        'src/app/organizations/league-filters.ts',
      ]);
    });

    it('names the logo upload for the file input', () => {
      assert.deepEqual(byType('file').files, ['src/app/organizations/admin/admin-logo.ts']);
    });

    it('names the two GET form search inputs', () => {
      assert.deepEqual(byType('search').files, [
        'src/app/find/find-content.ts',
        'src/app/public-layout/top-bar-find.ts',
      ]);
    });

    it('gives every exception a one-line reason', () => {
      for (const { reason } of EXCEPTIONS) {
        assert.ok(reason.length > 0 && !reason.includes('\n'), reason);
      }
    });
  });

  describe('files that are not checked', () => {
    it('skips a file under src/app/ui', () => {
      assert.deepEqual(scan('<select></select><input type="radio" />', 'src/app/ui/x/x.ts'), []);
    });

    it('skips a .spec.ts file', () => {
      assert.deepEqual(scan('<select></select>', 'src/app/example/example.spec.ts'), []);
    });
  });
});

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path !== uiDir) yield* sourceFiles(path);
    } else if (/\.(?:ts|html)$/.test(entry.name) && !entry.name.endsWith('.spec.ts')) {
      yield path;
    }
  }
}

const posix = (path) => relative(root, path).split(sep).join('/');

const repoFiles = [...sourceFiles(appDir)].map((path) => ({
  path: posix(path),
  text: readFileSync(path, 'utf8'),
}));

describe('src/app', () => {
  it('holds no native control outside the exceptions', () => {
    const findings = repoFiles.flatMap(({ path, text }) => findControlFindings(path, text));
    assert.deepEqual(
      findings.map(({ message }) => message),
      [],
    );
  });

  it('lists a pending file only while the file still holds a select', () => {
    const holding = new Set(
      repoFiles
        .filter(({ path, text }) => controlsIn(path, text).some(({ tag }) => tag === 'select'))
        .map(({ path }) => path),
    );
    assert.deepEqual(
      PENDING.filter((path) => !holding.has(path)),
      [],
    );
  });

  it('lists an exception file only while the file still holds its element', () => {
    const stale = [];
    for (const { type, files } of EXCEPTIONS) {
      for (const file of files) {
        const source = repoFiles.find(({ path }) => path === file);
        const holds =
          source !== undefined &&
          controlsIn(source.path, source.text).some(
            (control) => control.tag === 'input' && control.type === type,
          );
        if (!holds) stale.push(`${file} (${type})`);
      }
    }
    assert.deepEqual(stale, []);
  });
});

describe('docs/conventions/angular.md component map', () => {
  const conventions = readFileSync(join(root, 'docs', 'conventions', 'angular.md'), 'utf8');
  const start = conventions.indexOf('### Component map');
  const componentMap = conventions.slice(
    start,
    conventions.indexOf('\n## ', start) === -1 ? undefined : conventions.indexOf('\n## ', start),
  );

  it('has a Component map section', () => {
    assert.notEqual(start, -1);
  });

  it('names every exception file with its reason', () => {
    const missing = [];
    for (const { files, reason } of EXCEPTIONS) {
      for (const file of files) {
        if (!componentMap.includes(basename(file))) missing.push(`${file} is not in the map`);
      }
      if (!componentMap.includes(reason)) missing.push(`the map lacks the reason: ${reason}`);
    }
    assert.deepEqual(missing, []);
  });

  it('names every pending file', () => {
    const missing = PENDING.filter((file) => !componentMap.includes(basename(file)));
    assert.deepEqual(missing, []);
  });
});
