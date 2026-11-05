// Fails when one class list holds two border-radius classes. Tailwind emits `rounded-full`,
// `rounded-lg`, `rounded-md`, `rounded-sm`, `rounded-xl` in that order, so the later rule wins
// whatever order the classes have in the attribute, and a second radius class can silently lose.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const VARIANTS = String.raw`(?:(?:\[[^\]\s]*\]|[^\s:\[\]])+:)*`;
const SIZES = String.raw`none|xs|sm|md|lg|xl|2xl|3xl|4xl|full|\[[^\]\s]+\]|\([^)\s]+\)`;
const RADIUS_CLASS = new RegExp(`^(${VARIANTS})(rounded(?:-(?:${SIZES}))?)$`);

const CLASS_ATTRIBUTE = /(?<![\w$.\-[])class\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const SUBSTITUTION = /\$\{([^}]*)\}/g;
const IDENTIFIER = /^\s*([A-Za-z_$][\w$]*)\s*$/;

const SKIPPED_DIRECTORIES = new Set(['node_modules', '_generated']);

const stringLike = (node) =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isTemplateExpression(node);

function lineFinder(source) {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index++) {
    if (source.charCodeAt(index) === 10) lineStarts.push(index + 1);
  }
  return (position) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lineStarts[middle] <= position) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}

function substitute(text, constants) {
  return text.replace(SUBSTITUTION, (_, expression) => {
    const name = IDENTIFIER.exec(expression)?.[1];
    return (name !== undefined && constants.get(name)) || '';
  });
}

function evaluate(node, constants) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  const parts = [node.head.text];
  for (const span of node.templateSpans) {
    const name = ts.isIdentifier(span.expression) ? span.expression.text : undefined;
    parts.push((name !== undefined && constants.get(name)) || '', span.literal.text);
  }
  return parts.join('');
}

function sameFileConstants(sourceFile) {
  const constants = new Map();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      stringLike(node.initializer) &&
      node.parent.flags & ts.NodeFlags.Const
    ) {
      constants.set(node.name.text, evaluate(node.initializer, constants));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return constants;
}

function radiusConflictsIn(classList) {
  const byPrefix = new Map();
  for (const token of classList.split(/\s+/)) {
    const match = RADIUS_CLASS.exec(token);
    if (!match) continue;
    const group = byPrefix.get(match[1]) ?? [];
    if (!group.includes(token)) group.push(token);
    byPrefix.set(match[1], group);
  }
  return [...byPrefix.values()].filter((group) => group.length > 1);
}

function isClassKey(name) {
  return (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === 'class';
}

function scanFile(path, text, findings) {
  const sourceFile = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const constants = sameFileConstants(sourceFile);
  const lineAt = lineFinder(text);
  const report = (classList, position) => {
    for (const classes of radiusConflictsIn(classList)) {
      findings.push({ path, line: lineAt(position), classes });
    }
  };
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && isClassKey(node.name) && stringLike(node.initializer)) {
      report(evaluate(node.initializer, constants), node.initializer.getStart(sourceFile));
    }
    if (stringLike(node)) {
      const start = node.getStart(sourceFile);
      for (const match of node.getText(sourceFile).matchAll(CLASS_ATTRIBUTE)) {
        report(substitute(match[1] ?? match[2], constants), start + match.index);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

export function findRadiusConflicts(files) {
  const findings = [];
  for (const { path, text } of files) scanFile(path, text, findings);
  return findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

function walk(directory) {
  const files = [];
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const isComponentSource = (path) => path.endsWith('.ts') && !path.endsWith('.spec.ts');

export function checkRepo(root) {
  const files = walk(join(root, 'src'))
    .filter(isComponentSource)
    .map((path) => ({ path: relative(root, path), text: readFileSync(path, 'utf8') }));
  return findRadiusConflicts(files);
}

export function describeFinding({ path, line, classes }) {
  return `${path}:${line}: two radius classes (${classes.join(', ')})`;
}

if (import.meta.main) {
  const findings = checkRepo(join(import.meta.dirname, '..'));
  if (findings.length > 0) {
    for (const finding of findings) console.error(describeFinding(finding));
    console.error(
      `${findings.length} class list(s) with two radius classes. Keep one per variant: the later rule in the stylesheet wins, not the later class.`,
    );
    process.exitCode = 1;
  }
}
