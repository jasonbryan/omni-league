// A test or `test.describe` that passes `VIEWPORT_AGNOSTIC` runs in one Chromium project instead of
// two, so it must not check anything that depends on the screen: layout, accessibility,
// screenshots, focus, or responsive behaviour.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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

function importAliases(sourceFile) {
  const aliases = new Map();
  const visit = (node) => {
    if (ts.isImportSpecifier(node) && node.propertyName) {
      aliases.set(node.name.text, node.propertyName.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return aliases;
}

function tagNames(parsed) {
  const tags = new Set([TAG_IDENTIFIER]);
  const declarations = [];
  for (const { sourceFile, aliases } of parsed) {
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        declarations.push({ node, aliases });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const { node: declaration, aliases } of declarations) {
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

const isExported = (node) =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

function declaredFunctions(sourceFile) {
  const functions = [];
  const add = (name, body, member) => functions.push({ name, body, member });
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      add(node.name.text, node.body, false);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isFunctionLike(node.initializer)
    ) {
      add(node.name.text, node.initializer, false);
    } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
      add(node.name.text, node.body, true);
    } else if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      isFunctionLike(node.initializer)
    ) {
      add(node.name.text, node.initializer, true);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return functions;
}

function moduleExports(sourceFile) {
  const names = new Map();
  const reexports = [];
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && isExported(statement)) {
      const isDefault = statement.modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      names.set(isDefault ? 'default' : statement.name.text, statement.name.text);
    } else if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const { name } of statement.declarationList.declarations) {
        if (ts.isIdentifier(name)) names.set(name.text, name.text);
      }
    } else if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier?.text;
      const elements =
        statement.exportClause && ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements
          : undefined;
      if (specifier === undefined) {
        for (const element of elements ?? []) {
          names.set(element.name.text, (element.propertyName ?? element.name).text);
        }
      } else if (elements) {
        for (const element of elements) {
          reexports.push({
            specifier,
            exported: element.name.text,
            original: (element.propertyName ?? element.name).text,
          });
        }
      } else {
        reexports.push({ specifier, exported: undefined, original: undefined });
      }
    }
  }
  return { names, reexports };
}

function moduleImports(sourceFile) {
  const imports = new Map();
  const specifiers = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    specifiers.push(specifier);
    const clause = statement.importClause;
    if (!clause) continue;
    const record = (name, exportName) =>
      imports.set(name, [...(imports.get(name) ?? []), { specifier, exportName }]);
    if (clause.name) record(clause.name.text, 'default');
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        const original = (element.propertyName ?? element.name).text;
        record(original, original);
      }
    }
  }
  return { imports, specifiers };
}

// A name that is only mentioned, not called or handed to a call (`expect.poll(helper)`), does not
// reach the helper.
function referencedHelpers(node, aliases) {
  const references = [];
  const nameOf = (identifier) => aliases.get(identifier.text) ?? identifier.text;
  const visit = (child) => {
    if (ts.isCallExpression(child)) {
      const callee = child.expression;
      if (ts.isIdentifier(callee)) references.push({ name: nameOf(callee), member: false });
      else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name)) {
        references.push({ name: callee.name.text, member: true });
      }
      for (const argument of child.arguments) {
        if (ts.isIdentifier(argument)) references.push({ name: nameOf(argument), member: false });
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return references;
}

function resolveModule(fromPath, specifier, modules) {
  if (!specifier.startsWith('.')) return undefined;
  const base = resolve(dirname(fromPath), specifier);
  return [base, `${base}.ts`, join(base, 'index.ts')].find((path) => modules.has(path));
}

function buildModules(parsed) {
  const modules = new Map();
  for (const { path, sourceFile, aliases } of parsed) {
    const functions = declaredFunctions(sourceFile).map((declared) => ({
      ...declared,
      file: resolve(path),
      directs: identifiersIn(declared.body, aliases).filter((name) => REASON_BY_NAME.has(name)),
      references: referencedHelpers(declared.body, aliases),
    }));
    modules.set(resolve(path), {
      path: resolve(path),
      functions,
      ...moduleExports(sourceFile),
      ...moduleImports(sourceFile),
    });
  }
  for (const module of modules.values()) {
    module.targets = module.specifiers
      .map((specifier) => resolveModule(module.path, specifier, modules))
      .filter((target) => target !== undefined);
    for (const reexport of module.reexports) {
      reexport.target = resolveModule(module.path, reexport.specifier, modules);
    }
  }
  return modules;
}

function exportedHelper(modules, path, exportName, seen = new Set()) {
  const key = `${path}#${exportName}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  const module = modules.get(path);
  const local = module.names.get(exportName);
  if (local !== undefined) {
    return module.functions.filter((fn) => !fn.member && fn.name === local);
  }
  for (const { target, exported, original } of module.reexports) {
    if (target === undefined || (exported !== undefined && exported !== exportName)) continue;
    const found = exportedHelper(modules, target, original ?? exportName, seen);
    if (found?.length) return found;
  }
  return undefined;
}

function reachableModules(modules, path) {
  const reached = new Set([path]);
  const queue = [path];
  while (queue.length) {
    for (const target of modules.get(queue.pop()).targets) {
      if (!reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
  }
  return reached;
}

function createHelperResolver(modules) {
  const reachable = new Map();
  const reachableFrom = (path) => {
    if (!reachable.has(path)) reachable.set(path, reachableModules(modules, path));
    return reachable.get(path);
  };
  return (path, { name, member }) => {
    const module = modules.get(resolve(path));
    if (member) {
      return [...reachableFrom(module.path)].flatMap((reached) =>
        modules.get(reached).functions.filter((fn) => fn.name === name && fn.member),
      );
    }
    const local = module.functions.filter((fn) => !fn.member && fn.name === name);
    if (local.length) return local;
    return (module.imports.get(name) ?? []).flatMap(({ specifier, exportName }) => {
      const target = resolveModule(module.path, specifier, modules);
      return (target && exportedHelper(modules, target, exportName)) ?? [];
    });
  };
}

function sensitiveHelpers(parsed) {
  const modules = buildModules(parsed);
  const resolveHelper = createHelperResolver(modules);
  const sensitive = new Map();
  const all = [...modules.values()].flatMap((module) => module.functions);
  for (const fn of all) {
    if (fn.directs.length) sensitive.set(fn, REASON_BY_NAME.get(fn.directs[0]));
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const fn of all) {
      if (sensitive.has(fn)) continue;
      for (const reference of fn.references) {
        const hit = resolveHelper(fn.file, reference).find((helper) => sensitive.has(helper));
        if (hit === undefined) continue;
        sensitive.set(fn, sensitive.get(hit));
        changed = true;
        break;
      }
    }
  }
  return (path, reference) => {
    const hit = resolveHelper(path, reference).find((helper) => sensitive.has(helper));
    return hit && sensitive.get(hit);
  };
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
  const parsed = files.map(({ path, text }) => {
    const sourceFile = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    return { path, sourceFile, aliases: importAliases(sourceFile) };
  });
  const tags = tagNames(parsed);
  const helperReason = sensitiveHelpers(parsed);
  const violations = [];
  for (const { path, sourceFile, aliases } of parsed) {
    for (const { call, callbacks } of taggedScopes(sourceFile, tags, aliases)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(call.getStart());
      const seen = new Set();
      const report = (name, reason, via, hook) => {
        if (reason === undefined || seen.has(name)) return;
        seen.add(name);
        violations.push({
          file: path,
          line: line + 1,
          title: titleOf(call),
          name,
          reason,
          via,
          hook,
        });
      };
      for (const { callback, hook } of callbacks) {
        for (const name of identifiersIn(callback, aliases)) {
          report(name, REASON_BY_NAME.get(name), undefined, hook);
        }
        for (const reference of referencedHelpers(callback, aliases)) {
          if (REASON_BY_NAME.has(reference.name)) continue;
          report(reference.name, helperReason(path, reference), reference.name, hook);
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
