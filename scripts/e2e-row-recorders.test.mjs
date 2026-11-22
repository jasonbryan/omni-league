import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';

const root = join(import.meta.dirname, '..');
const fixtures = join(import.meta.dirname, 'fixtures', 'e2e-row-recorders');

const ROW_HELPER = /(^|\/)registered-rows$/;
const RECORDER_GLOBALS = new Set(['__recorder', '__rowRecorder']);

const parse = (text) => ts.createSourceFile('file.ts', text, ts.ScriptTarget.Latest, true);

const importsRowHelper = (source) =>
  source.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      ROW_HELPER.test(statement.moduleSpecifier.text),
  );

function functionName(node) {
  if (
    (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
    node.name !== undefined
  ) {
    return node.name.text;
  }
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text;
  }
  return undefined;
}

const callsAnimationFrameWith = (node, name) =>
  ts.isCallExpression(node) &&
  /(^|\.)requestAnimationFrame$/.test(node.expression.getText()) &&
  node.arguments.some((argument) => ts.isIdentifier(argument) && argument.text === name);

function containsNode(root, matches) {
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (matches(node)) found = true;
    else ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
  return found;
}

function violations(text) {
  const source = parse(text);
  if (!importsRowHelper(source)) return [];
  const found = [];
  const visit = (node) => {
    const name = functionName(node);
    if (name !== undefined && containsNode(node, (inner) => callsAnimationFrameWith(inner, name))) {
      found.push(`\`${name}\` schedules itself with requestAnimationFrame`);
    }
    const global =
      (ts.isIdentifier(node) && node.text) ||
      (ts.isStringLiteralLike(node) && node.text) ||
      undefined;
    if (global !== undefined && RECORDER_GLOBALS.has(global)) {
      found.push(`holds the \`${global}\` global`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...new Set(found)];
}

function tsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...tsFiles(path));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

const fixture = (name) => readFileSync(join(fixtures, name), 'utf8');

describe('the row recorder rule', () => {
  it('flags a declared function that passes itself to requestAnimationFrame', () => {
    assert.deepEqual(violations(fixture('declared-sampler.txt')), [
      '`sample` schedules itself with requestAnimationFrame',
    ]);
  });

  it('flags an arrow function that passes itself to requestAnimationFrame', () => {
    assert.deepEqual(violations(fixture('arrow-sampler.txt')), [
      '`sample` schedules itself with requestAnimationFrame',
    ]);
  });

  it('flags a __rowRecorder global', () => {
    assert.deepEqual(violations(fixture('global-recorder.txt')), [
      'holds the `__rowRecorder` global',
    ]);
  });

  it('accepts the two-frame settle', () => {
    assert.deepEqual(violations(fixture('two-frame-settle.txt')), []);
  });

  it('accepts a single requestAnimationFrame(resolve)', () => {
    assert.deepEqual(violations(fixture('single-frame.txt')), []);
  });

  it('accepts the shared helper calls', () => {
    assert.deepEqual(violations(fixture('shared-helper-calls.txt')), []);
  });

  it('leaves a file that does not import the row helper alone', () => {
    assert.deepEqual(violations(fixture('no-import.txt')), []);
  });

  it('holds for every e2e file outside e2e/support', () => {
    const support = join(root, 'e2e', 'support') + sep;
    const found = tsFiles(join(root, 'e2e'))
      .filter((path) => !path.startsWith(support))
      .flatMap((path) =>
        violations(readFileSync(path, 'utf8')).map(
          (reason) => `${relative(root, path)}: ${reason}`,
        ),
      );
    assert.deepEqual(found, [], 'use recordRowFrames() from e2e/support/registered-rows.ts');
  });
});
