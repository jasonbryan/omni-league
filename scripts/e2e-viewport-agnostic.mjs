// A test or `test.describe` that passes `VIEWPORT_AGNOSTIC` runs in one Chromium project instead of
// two, so it must not check anything that depends on the screen: layout, accessibility,
// screenshots, focus, or responsive behaviour.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

export const TAG_IDENTIFIER = 'VIEWPORT_AGNOSTIC';

// A name matches an identifier or a property name anywhere in the scope, so `page.screenshot(...)`
// and `screenshot(page, ...)` both count.
export const FORBIDDEN = {
  'accessibility (axe)': [
    'AxeBuilder',
    'axeScan',
    'describeViolations',
    'expectAccessible',
    'tabWalk',
  ],
  layout: ['boundingBox', 'toBeInViewport'],
  reflow: ['checkReflow'],
  screenshots: ['screenshot', 'toHaveScreenshot', 'toMatchSnapshot'],
  'viewport or device': ['setViewportSize', 'viewportSize', 'isMobile', 'hasTouch', 'isDesktop'],
  focus: ['toBeFocused', 'tabKey', 'activeElement', "'Tab'", "'Shift+Tab'"],
};

const TAB_KEYS = new Set(['Tab', 'Shift+Tab']);

const TAG_TEXT = '@viewport-agnostic';

const HOOK_NAMES = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll']);

const REASON_BY_NAME = new Map(
  Object.entries(FORBIDDEN).flatMap(([reason, names]) => names.map((name) => [name, reason])),
);

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

function identifiersIn(node, aliases = new Map()) {
  const names = [];
  const visit = (child) => {
    if (ts.isIdentifier(child) || ts.isPrivateIdentifier(child)) {
      names.push(aliases.get(child.text) ?? child.text);
    } else if (ts.isStringLiteralLike(child) && TAB_KEYS.has(child.text)) {
      names.push(`'${child.text}'`);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

function importAliases(parsed) {
  const aliases = new Map();
  const visit = (node) => {
    if (ts.isImportSpecifier(node) && node.propertyName) {
      aliases.set(node.name.text, node.propertyName.text);
    }
    ts.forEachChild(node, visit);
  };
  for (const { sourceFile } of parsed) visit(sourceFile);
  return aliases;
}

function tagNames(parsed, aliases) {
  const tags = new Set([TAG_IDENTIFIER]);
  const declarations = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.push(node);
    }
    ts.forEachChild(node, visit);
  };
  for (const { sourceFile } of parsed) visit(sourceFile);
  for (let changed = true; changed;) {
    changed = false;
    for (const declaration of declarations) {
      if (tags.has(declaration.name.text)) continue;
      if (identifiersIn(declaration.initializer, aliases).some((name) => tags.has(name))) {
        tags.add(declaration.name.text);
        changed = true;
      }
    }
  }
  return tags;
}

function carriesTag(node, tags, aliases) {
  if (identifiersIn(node, aliases).some((name) => tags.has(name))) return true;
  let found = false;
  const visit = (child) => {
    if (ts.isStringLiteralLike(child) && child.text.includes(TAG_TEXT)) found = true;
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function namedFunctions(sourceFile, aliases) {
  const functions = new Map();
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      functions.set(node.name.text, identifiersIn(node.body, aliases));
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isFunctionLike(node.initializer)
    ) {
      functions.set(node.name.text, identifiersIn(node.initializer, aliases));
    } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
      functions.set(node.name.text, identifiersIn(node.body, aliases));
    } else if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      isFunctionLike(node.initializer)
    ) {
      functions.set(node.name.text, identifiersIn(node.initializer, aliases));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return functions;
}

// Matching is by name across all files, so a same-named helper in another file is treated alike (a
// false positive fails safe).
function sensitiveHelpers(parsed, aliases) {
  const functions = new Map();
  for (const { sourceFile } of parsed) {
    for (const [name, names] of namedFunctions(sourceFile, aliases)) {
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

// `base` is the plain test in auth-session.spec.ts.
const TEST_NAMES = new Set(['test', 'base']);

function isTestCall(node) {
  if (!ts.isCallExpression(node)) return false;
  let callee = node.expression;
  while (ts.isPropertyAccessExpression(callee)) callee = callee.expression;
  return ts.isIdentifier(callee) && TEST_NAMES.has(callee.text);
}

const callbackOf = (call) => call.arguments.findLast((argument) => isFunctionLike(argument));

function isHook(node) {
  if (!isTestCall(node)) return false;
  const callee = node.expression;
  return ts.isPropertyAccessExpression(callee) && HOOK_NAMES.has(callee.name.text);
}

function taggedScopes(sourceFile, tags, aliases) {
  const hooks = [];
  const collect = (node) => {
    if (isHook(node)) {
      const callback = callbackOf(node);
      let owner = node.parent;
      while (owner && !isTestCall(owner)) owner = owner.parent;
      if (callback) hooks.push({ callback, owner });
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const scopes = [];
  const visit = (node, inside) => {
    let nowInside = inside;
    if (isTestCall(node) && !isHook(node) && !inside) {
      const details = node.arguments.filter((argument) => !isFunctionLike(argument));
      if (details.some((argument) => carriesTag(argument, tags, aliases))) {
        const callback = callbackOf(node);
        if (callback) {
          const ancestors = new Set();
          for (let up = node.parent; up; up = up.parent) ancestors.add(up);
          const around = hooks.filter(({ owner }) => owner === undefined || ancestors.has(owner));
          scopes.push({
            call: node,
            callbacks: [
              { callback, hook: false },
              ...around.map(({ callback: hook }) => ({ callback: hook, hook: true })),
            ],
          });
        }
        nowInside = true;
      }
    }
    ts.forEachChild(node, (child) => visit(child, nowInside));
  };
  visit(sourceFile, false);
  return scopes;
}

function titleOf(call) {
  const first = call.arguments[0];
  if (first && (ts.isStringLiteralLike(first) || ts.isTemplateExpression(first))) {
    return first.getText().slice(1, -1);
  }
  return first ? first.getText().slice(0, 60) : '(untitled)';
}

export function findViolations(files) {
  const parsed = files.map(({ path, text }) => ({
    path,
    sourceFile: ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  }));
  const aliases = importAliases(parsed);
  const tags = tagNames(parsed, aliases);
  const sensitive = sensitiveHelpers(parsed, aliases);
  const violations = [];
  for (const { path, sourceFile } of parsed) {
    for (const { call, callbacks } of taggedScopes(sourceFile, tags, aliases)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
      const seen = new Set();
      for (const { callback, hook } of callbacks) {
        for (const name of identifiersIn(callback, aliases)) {
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
            hook,
          });
        }
      }
    }
  }
  return violations;
}

export function describeViolation(violation, root) {
  const how = violation.via
    ? `calls ${violation.name}(), which reaches ${violation.reason}`
    : `uses ${violation.name} (${violation.reason})`;
  const where = violation.hook ? ' in a hook that runs around it' : '';
  return `${relative(root, violation.file)}:${violation.line}: "${violation.title}" is ${TAG_IDENTIFIER} but ${how}${where}`;
}

export function checkE2eDirectory(e2eDir) {
  const files = sourceFiles(e2eDir).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  return findViolations(files);
}
