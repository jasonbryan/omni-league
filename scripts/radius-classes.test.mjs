import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { checkRepo, describeFinding, findRadiusConflicts } from './radius-classes.mjs';

const root = join(import.meta.dirname, '..');

const scan = (text, path = 'src/a.ts') => findRadiusConflicts([{ path, text }]);
const template = (classes) => `const view = \`<span class="${classes}"></span>\`;\n`;

const flagged = (text, classes) => {
  const findings = scan(text);
  assert.equal(findings.length, 1, `not flagged: ${text}`);
  assert.deepEqual(findings[0].classes, classes);
};
const accepted = (text) => assert.deepEqual(scan(text), [], `flagged: ${text}`);

describe('findRadiusConflicts', () => {
  it('flags two radius classes in a class attribute, with the line and both classes', () => {
    const findings = scan(template('rounded-md size-9 rounded-lg'));
    assert.deepEqual(findings, [
      { path: 'src/a.ts', line: 1, classes: ['rounded-md', 'rounded-lg'] },
    ]);
  });

  it('flags a conflict that a same-file constant brings in', () => {
    flagged(`const PULSE = 'rounded-md bg-muted';\n${template('${PULSE} rounded-lg')}`, [
      'rounded-md',
      'rounded-lg',
    ]);
  });

  it('resolves a constant written as a template without substitutions', () => {
    flagged(`const PULSE = \`rounded-md bg-muted\`;\n${template('${PULSE} rounded-full')}`, [
      'rounded-md',
      'rounded-full',
    ]);
  });

  it('resolves a constant that uses an earlier constant', () => {
    flagged(
      "const BASE = 'rounded-md';\nconst BAR = `block ${BASE}`;\n" + template('${BAR} rounded-lg'),
      ['rounded-md', 'rounded-lg'],
    );
  });

  it('flags a class property of a host object', () => {
    flagged("@Component({ host: { class: 'rounded-md rounded-full' } })\nexport class A {}\n", [
      'rounded-md',
      'rounded-full',
    ]);
  });

  it('flags a class property whose key is a string literal', () => {
    flagged("const host = { 'class': 'rounded-md rounded-full' };\n", [
      'rounded-md',
      'rounded-full',
    ]);
  });

  it('flags a class property written as a template with a constant', () => {
    flagged("const PULSE = 'rounded-md';\nconst host = { class: `${PULSE} rounded-full` };\n", [
      'rounded-md',
      'rounded-full',
    ]);
  });

  it('flags the bare rounded class, a size, and an arbitrary value', () => {
    flagged(template('rounded rounded-lg'), ['rounded', 'rounded-lg']);
    flagged(template('rounded-[4px] rounded-lg'), ['rounded-[4px]', 'rounded-lg']);
    flagged(template('rounded-none rounded-2xl'), ['rounded-none', 'rounded-2xl']);
    flagged(template('rounded-(--card-radius) rounded-xs'), [
      'rounded-(--card-radius)',
      'rounded-xs',
    ]);
  });

  it('flags two radius classes that share a variant prefix', () => {
    flagged(template('md:rounded-md md:rounded-xl'), ['md:rounded-md', 'md:rounded-xl']);
    flagged(template('md:hover:rounded-md md:hover:rounded-xl'), [
      'md:hover:rounded-md',
      'md:hover:rounded-xl',
    ]);
  });

  it('reports every class of a list with three radius classes', () => {
    flagged(template('rounded-sm rounded-md rounded-lg'), [
      'rounded-sm',
      'rounded-md',
      'rounded-lg',
    ]);
  });

  it('reports one finding per prefix group in a list', () => {
    const findings = scan(template('rounded-md rounded-lg md:rounded-sm md:rounded-xl'));
    assert.deepEqual(
      findings.map((finding) => finding.classes),
      [
        ['rounded-md', 'rounded-lg'],
        ['md:rounded-sm', 'md:rounded-xl'],
      ],
    );
  });

  it('counts the line of the attribute in a multi-line template', () => {
    const text = [
      'const view = `',
      '  <div class="rounded-lg">',
      '    <span',
      '      aria-hidden="true"',
      '      class="rounded-md rounded-full"',
      '    ></span>',
      '  </div>',
      '`;',
      '',
    ].join('\n');
    assert.deepEqual(
      scan(text).map((finding) => finding.line),
      [5],
    );
  });

  it('reads a single-quoted class attribute', () => {
    flagged("const view = `<span class='rounded-md rounded-full'></span>`;\n", [
      'rounded-md',
      'rounded-full',
    ]);
  });

  it('accepts one radius class per prefix', () => {
    accepted(template('rounded-lg md:rounded-xl'));
    accepted(template('rounded-full'));
    accepted(template('rounded-md md:rounded-lg lg:rounded-xl'));
  });

  it('accepts a repeated identical class', () => {
    accepted(template('rounded-md rounded-md'));
  });

  it('does not count side and corner classes', () => {
    accepted(template('rounded-t-lg rounded-md'));
    accepted(template('rounded-tl-md rounded-br-xl rounded-full'));
    accepted(template('rounded-s-lg rounded-e-md rounded-lg'));
  });

  it('counts an unknown substitution as no classes', () => {
    accepted(template('${x} rounded-lg'));
    accepted(template('${this.pulse} rounded-lg'));
  });

  it('counts a constant defined in another file as no classes', () => {
    accepted(template('${PULSE} rounded-lg'));
  });

  it('ignores class-like names that are not a class attribute', () => {
    accepted('const view = `<span data-class="rounded-md rounded-lg"></span>`;\n');
    accepted('const view = `<span [class]="\'rounded-md rounded-lg\'"></span>`;\n');
    accepted("const text = 'rounded-md rounded-lg';\n");
    accepted("const host = { style: 'rounded-md rounded-lg' };\n");
  });

  it('accepts a file with no class attribute', () => {
    accepted('export const a = 1;\n');
  });

  it('reports each file by its path, sorted by path and line', () => {
    const bad = template('rounded-md rounded-lg');
    const findings = findRadiusConflicts([
      { path: 'src/b.ts', text: bad },
      { path: 'src/a.ts', text: `\n${bad}${bad}` },
    ]);
    assert.deepEqual(
      findings.map(({ path, line }) => [path, line]),
      [
        ['src/a.ts', 2],
        ['src/a.ts', 3],
        ['src/b.ts', 1],
      ],
    );
  });

  it('describes a finding as path:line with the classes', () => {
    assert.equal(
      describeFinding({ path: 'src/a.ts', line: 3, classes: ['rounded-md', 'rounded-lg'] }),
      'src/a.ts:3: two radius classes (rounded-md, rounded-lg)',
    );
  });
});

describe('checkRepo', () => {
  const sandboxes = [];
  after(() => sandboxes.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  const sandbox = (files) => {
    const dir = mkdtempSync(join(tmpdir(), 'radius-classes-'));
    sandboxes.push(dir);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  };

  const bad = template('rounded-md rounded-lg');

  it('reports a conflict in src and skips specs and files outside src', () => {
    const dir = sandbox({
      'src/a.ts': bad,
      'src/a.spec.ts': bad,
      'scripts/b.ts': bad,
      'convex/c.ts': bad,
    });
    assert.deepEqual(checkRepo(dir), [
      { path: 'src/a.ts', line: 1, classes: ['rounded-md', 'rounded-lg'] },
    ]);
  });

  it('reads nested directories and skips files that are not TypeScript', () => {
    const dir = sandbox({
      'src/app/deep/er/b.ts': bad,
      'src/app/c.html': '<span class="rounded-md rounded-lg"></span>',
      'src/app/d.css': '.a { color: red; }',
    });
    assert.deepEqual(
      checkRepo(dir).map((finding) => finding.path),
      ['src/app/deep/er/b.ts'],
    );
  });

  it('returns nothing for a root without a src directory', () => {
    assert.deepEqual(checkRepo(sandbox({ 'README.md': 'x' })), []);
  });

  it('finds no conflict in this repository', () => {
    assert.deepEqual(checkRepo(root).map(describeFinding), []);
  });
});

describe('the command', () => {
  const sandboxes = [];
  after(() => sandboxes.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  const run = (files) => {
    const dir = mkdtempSync(join(tmpdir(), 'radius-classes-cli-'));
    sandboxes.push(dir);
    mkdirSync(join(dir, 'scripts'));
    copyFileSync(
      join(import.meta.dirname, 'radius-classes.mjs'),
      join(dir, 'scripts/radius-classes.mjs'),
    );
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return spawnSync(process.execPath, [join(dir, 'scripts/radius-classes.mjs')], {
      encoding: 'utf8',
    });
  };

  it('exits non-zero and prints path:line: two radius classes for each finding', () => {
    const result = run({ 'src/a.ts': template('rounded-md rounded-lg') });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^src\/a\.ts:1: two radius classes \(rounded-md, rounded-lg\)$/m);
  });

  it('exits zero when every list has one radius class', () => {
    const result = run({ 'src/a.ts': template('rounded-lg md:rounded-xl') });
    assert.equal(result.status, 0, result.stderr);
  });
});
