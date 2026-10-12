// Guard for the `VIEWPORT_AGNOSTIC` e2e tag (#181). A test or `test.describe` that passes
// `VIEWPORT_AGNOSTIC` (e2e/support/viewport-agnostic.ts) runs in one Chromium project instead of
// two, so it must not check anything that depends on the screen: layout, accessibility,
// screenshots, focus, or responsive behaviour. This module finds every tagged scope in the e2e
// sources and reports the calls that contradict the tag. Node built-ins and `typescript` only.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/** The name the specs import and pass as the test details. */
export const TAG_IDENTIFIER = 'VIEWPORT_AGNOSTIC';

/**
 * Names that make a test viewport-dependent, by reason. A name matches an identifier or a
 * property name anywhere in the scope, so `page.screenshot(...)` and `screenshot(page, ...)` both
 * count.
 */
export const FORBIDDEN = {
  'accessibility (axe)': [
    'AxeBuilder',
    'axeScan',
    'describeViolations',
    'expectAccessible',
    'tabWalk',
  ],
  reflow: ['checkReflow'],
  screenshots: ['screenshot', 'toHaveScreenshot', 'toMatchSnapshot'],
  'viewport or device': ['setViewportSize', 'viewportSize', 'isMobile', 'hasTouch', 'isDesktop'],
  focus: ['toBeFocused', 'tabKey'],
};

const REASON_BY_NAME = new Map(
  Object.entries(FORBIDDEN).flatMap(([reason, names]) => names.map((name) => [name, reason])),
);

/** Every `.ts` file under `dir`, recursively. */
export function sourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts')) files.push(path);
  }
  return files;
}

const isFunctionLike = (node) =>
  ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node);

/** Every identifier text (names and property names) under `node`. */
function identifiersIn(node) {
  const names = [];
  const visit = (child) => {
    if (ts.isIdentifier(child) || ts.isPrivateIdentifier(child)) names.push(child.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

/** `name -> identifiers in its body` for every named function or arrow function in a file. */
function namedFunctions(sourceFile) {
  const functions = new Map();
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      functions.set(node.name.text, identifiersIn(node.body));
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isFunctionLike(node.initializer)
    ) {
      functions.set(node.name.text, identifiersIn(node.initializer));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return functions;
}

/**
 * Helper names that reach a forbidden name through any chain of calls, with the reason of the
 * first forbidden name found. Matching is by name across all files, so a same-named helper in
 * another file is treated alike (a false positive fails safe).
 */
function sensitiveHelpers(parsed) {
  const functions = new Map();
  for (const { sourceFile } of parsed) {
    for (const [name, names] of namedFunctions(sourceFile)) {
      functions.set(name, [...(functions.get(name) ?? []), ...names]);
    }
  }
  const sensitive = new Map();
  for (let changed = true; changed;) {
    changed = false;
    for (const [name, names] of functions) {
      if (sensitive.has(name)) continue;
      const hit = names.find((used) => REASON_BY_NAME.has(used) || sensitive.has(used));
      if (hit === undefined) continue;
      sensitive.set(name, REASON_BY_NAME.get(hit) ?? sensitive.get(hit));
      changed = true;
    }
  }
  return sensitive;
}

/** The names the specs give Playwright's `test` (`base` is the plain one in auth-session.spec.ts). */
const TEST_NAMES = new Set(['test', 'base']);

/** True for `test(...)`, `test.describe(...)`, `test.describe.serial(...)`, `test.only(...)`. */
function isTestCall(node) {
  if (!ts.isCallExpression(node)) return false;
  let callee = node.expression;
  while (ts.isPropertyAccessExpression(callee)) callee = callee.expression;
  return ts.isIdentifier(callee) && TEST_NAMES.has(callee.text);
}

/** The call's callback (its last function argument), when it has one. */
const callbackOf = (call) => call.arguments.findLast((argument) => isFunctionLike(argument));

/**
 * Tagged scopes in one file: the calls with `VIEWPORT_AGNOSTIC` among their non-function
 * arguments, outermost first. A tag nested inside another tagged scope is covered by the outer one.
 */
function taggedScopes(sourceFile) {
  const scopes = [];
  const visit = (node, inside) => {
    let nowInside = inside;
    if (isTestCall(node) && !inside) {
      const details = node.arguments.filter((argument) => !isFunctionLike(argument));
      if (details.some((argument) => identifiersIn(argument).includes(TAG_IDENTIFIER))) {
        const callback = callbackOf(node);
        if (callback) scopes.push({ call: node, callback });
        nowInside = true;
      }
    }
    ts.forEachChild(node, (child) => visit(child, nowInside));
  };
  visit(sourceFile, false);
  return scopes;
}

/** The test title of a call, or its source text start when the title is not a literal. */
function titleOf(call) {
  const first = call.arguments[0];
  if (first && (ts.isStringLiteralLike(first) || ts.isTemplateExpression(first))) {
    return first.getText().slice(1, -1);
  }
  return first ? first.getText().slice(0, 60) : '(untitled)';
}

/**
 * Checks sources against the tag. `files` is `{ path, text }[]`: the spec files and the support
 * files they import. Returns one violation per tagged scope and forbidden name:
 * `{ file, line, title, name, reason, via }`, `via` naming the helper that reached it.
 */
export function findViolations(files) {
  const parsed = files.map(({ path, text }) => ({
    path,
    sourceFile: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  }));
  const sensitive = sensitiveHelpers(parsed);
  const violations = [];
  for (const { path, sourceFile } of parsed) {
    for (const { call, callback } of taggedScopes(sourceFile)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
      const seen = new Set();
      for (const name of identifiersIn(callback)) {
        const direct = REASON_BY_NAME.get(name);
        const reason = direct ?? sensitive.get(name);
        if (reason === undefined || seen.has(name)) continue;
        seen.add(name);
        violations.push({
          file: path,
          line: line + 1,
          title: titleOf(call),
          name,
          reason,
          via: direct === undefined ? name : undefined,
        });
      }
    }
  }
  return violations;
}

/** One line per violation, `path:line: ...`. */
export function describeViolation(violation, root) {
  const how = violation.via
    ? `calls ${violation.name}(), which reaches ${violation.reason}`
    : `uses ${violation.name} (${violation.reason})`;
  return `${relative(root, violation.file)}:${violation.line}: "${violation.title}" is ${TAG_IDENTIFIER} but ${how}`;
}

/** Reads the e2e sources under `e2eDir` and returns their violations. */
export function checkE2eDirectory(e2eDir) {
  const files = sourceFiles(e2eDir).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  return findViolations(files);
}
