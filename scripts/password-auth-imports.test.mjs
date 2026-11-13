// The password requests and refusal mapping leave the initial bundle only while no eager file
// imports `password-auth.ts` at runtime and both pages import it statically.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { describe, it } from 'node:test';
import ts from 'typescript';

const ROOT = join(import.meta.dirname, '..');
const APP = join(ROOT, 'src', 'app');
const TARGET = join(APP, 'core', 'auth', 'password-auth.ts');
const PAGES = ['src/app/sign-in/sign-in-page.ts', 'src/app/sign-up/sign-up-page.ts'];

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

const namesTarget = (file, specifier) => resolve(dirname(file), specifier) === TARGET.slice(0, -3);

/** Every import of the module outside specs: how it is imported, by file. */
function importsOfTarget() {
  const found = [];
  for (const file of sourceFiles(APP)) {
    const tree = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        namesTarget(file, node.moduleSpecifier.text)
      ) {
        const typeOnly = node.importClause?.isTypeOnly === true;
        found.push({ file: relative(ROOT, file), kind: typeOnly ? 'type' : 'static' });
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        namesTarget(file, node.arguments[0].text)
      ) {
        found.push({ file: relative(ROOT, file), kind: 'dynamic' });
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return found.sort((a, b) => a.file.localeCompare(b.file));
}

describe('password-auth.ts imports', () => {
  const imports = importsOfTarget();

  it('are static in the Sign in and Create an account pages, so the code arrives with their route chunks', () => {
    for (const page of PAGES) {
      assert.deepEqual(
        imports.filter((entry) => entry.file === page).map((entry) => entry.kind),
        ['static'],
        page,
      );
    }
  });

  it('are types only in auth.service.ts, so the eager bundle has no runtime import', () => {
    assert.deepEqual(
      imports.filter((entry) => entry.file === 'src/app/core/auth/auth.service.ts'),
      [{ file: 'src/app/core/auth/auth.service.ts', kind: 'type' }],
    );
  });

  it('are never a dynamic import(), which a worker that dropped the chunk after a deploy could fail on', () => {
    assert.deepEqual(
      imports.filter((entry) => entry.kind === 'dynamic'),
      [],
    );
  });

  it('come from no other file, so nothing eager can start a signed-in session', () => {
    assert.deepEqual(
      imports.map((entry) => entry.file),
      ['src/app/core/auth/auth.service.ts', ...PAGES.toSorted()].toSorted(),
    );
  });
});
