// Fails when a code comment, test title, skip reason, or ESLint rule message references this
// repo's tracker (issues, PRs, ADRs, reviews, agent roles). Those belong in commits, PRs, and ADRs (AGENTS.md, Code comments).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import ts from 'typescript';

const REFERENCE_PATTERNS = [
  /\bPR\s+#?\d+/,
  /\bissues?\s+#?\d+/i,
  /\bADR[\s-]+\d{3,4}\b/,
  /\b(?:Tester|Reviewer|Implementer|Planner) \(/,
  /github\.com\/jasonbryan\/omni-league\/(?:issues|pull)\//,
];

// A trailing letter keeps hex colours (`#1a2b3c`) out of the match.
const ISSUE_NUMBER = /(?<!&)#\d+(?![\w])/g;

const COLOUR_DECLARATION =
  /(?:^|[\s;{`'"(])(?:--[\w-]+|[\w-]*(?:color|background|border|outline|fill|stroke|shadow)[\w-]*)\s*:([^;{}]*)$/i;
const CSS_VALUE_BEFORE_COLOUR =
  /^\s*(?:(?:-?[\d.]+[a-z%]*|solid|dashed|dotted|double|inset|none|transparent|,)\s*)*$/i;

const URL_BEFORE_HASH = /https?:\/\/\S*$/;
const FILE_PATH_BEFORE_HASH = /[\w/-]\.[A-Za-z0-9]+$/;

const SCRIPT_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const HASH_EXTENSIONS = new Set(['.yml', '.yaml', '.toml', '.sh']);
const HASH_DOTFILES = new Set(['.npmrc', '.env.example', '.gitignore', '.prettierignore']);

const TITLE_ROOTS = new Set(['it', 'test', 'describe']);
const TITLE_MEMBERS = new Set([
  'describe',
  'step',
  'skip',
  'only',
  'each',
  'fixme',
  'fail',
  'slow',
  'serial',
  'parallel',
  'todo',
  'concurrent',
]);

// `test.skip(condition, 'reason')`: the second argument is prose a reader sees in the report.
const REASON_MEMBERS = new Set(['skip', 'fixme', 'fail', 'slow']);

// ESLint rule messages reach the developer whose code a rule rejects.
const RULE_MESSAGE_FILE = 'eslint.config.mjs';

const SCAN_DIRECTORIES = ['src', 'convex', 'e2e', 'scripts', '.github/workflows'];
const SCAN_ROOT_FILES = [
  '.github/dependabot.yml',
  'playwright.config.ts',
  'netlify.toml',
  'eslint.config.mjs',
  '.npmrc',
  '.env.example',
  '.gitignore',
  '.prettierignore',
];
const SCAN_ROOT_PATTERNS = [/^vitest.*\.mts$/, /^tsconfig.*\.json$/];
const SKIPPED_DIRECTORIES = new Set(['node_modules', '_generated']);

function inScope(repoPath) {
  const parts = repoPath.split('/');
  if (parts.some((part) => SKIPPED_DIRECTORIES.has(part))) return false;
  return (
    SCAN_DIRECTORIES.some((directory) => repoPath.startsWith(`${directory}/`)) ||
    SCAN_ROOT_FILES.includes(repoPath) ||
    (parts.length === 1 && SCAN_ROOT_PATTERNS.some((pattern) => pattern.test(repoPath)))
  );
}

function isColourValue(before) {
  const value = COLOUR_DECLARATION.exec(before)?.[1];
  return value !== undefined && CSS_VALUE_BEFORE_COLOUR.test(value);
}

function referencesIn(line) {
  const hits = REFERENCE_PATTERNS.filter((pattern) => pattern.test(line));
  const issueNumber = [...line.matchAll(ISSUE_NUMBER)].some(({ index }) => {
    const before = line.slice(0, index);
    const token = /\S*$/.exec(before)[0];
    if (URL_BEFORE_HASH.test(token) || FILE_PATH_BEFORE_HASH.test(token)) return false;
    return !isColourValue(before);
  });
  return hits.length > 0 || issueNumber;
}

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

function reporter(path, source, findings) {
  const lineAt = lineFinder(source);
  return (text, start) => {
    const firstLine = lineAt(start);
    text.split('\n').forEach((line, offset) => {
      if (referencesIn(line)) {
        findings.push({ path, line: firstLine + offset, text: line.trim() });
      }
    });
  };
}

function htmlComments(text) {
  return [...text.matchAll(/<!--[\s\S]*?-->/g)].map((match) => ({
    text: match[0],
    start: match.index,
  }));
}

// `//` starts a comment only in SCSS.
function cssComments(text, { lineComments = false } = {}) {
  const comments = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' || char === "'") {
      index++;
      while (index < text.length && text[index] !== char && text[index] !== '\n') {
        index += text[index] === '\\' ? 2 : 1;
      }
      index++;
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2);
      const stop = end === -1 ? text.length : end + 2;
      comments.push({ text: text.slice(index, stop), start: index });
      index = stop;
    } else if (lineComments && char === '/' && next === '/') {
      const end = text.indexOf('\n', index);
      const stop = end === -1 ? text.length : end;
      comments.push({ text: text.slice(index, stop), start: index });
      index = stop;
    } else {
      index++;
    }
  }
  return comments;
}

// `#` starts a comment at the line start or after whitespace, outside quotes. A quote opens only
// where no word character precedes it and does not carry over a line break, because YAML prose
// and shell comments hold stray apostrophes.
function hashComments(text) {
  const comments = [];
  let lineStart = 0;
  for (const line of text.split('\n')) {
    let quote = null;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (quote) {
        if (char === '\\' && quote === '"') index++;
        else if (char === quote) quote = null;
      } else if (char === '\\') {
        index++;
      } else if ((char === '"' || char === "'") && !/\w/.test(line[index - 1] ?? '')) {
        quote = char;
      } else if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) {
        comments.push({ text: line.slice(index), start: lineStart + index });
        break;
      }
    }
    lineStart += line.length + 1;
  }
  return comments;
}

function commentRanges(sourceFile) {
  const text = sourceFile.text;
  const seen = new Set();
  const ranges = [];
  const add = (range) => {
    if (!range || seen.has(range.pos)) return;
    seen.add(range.pos);
    ranges.push({ text: text.slice(range.pos, range.end), start: range.pos });
  };
  const visit = (node) => {
    const position = node.getFullStart();
    ts.getLeadingCommentRanges(text, position)?.forEach(add);
    ts.getTrailingCommentRanges(text, position)?.forEach(add);
    node.getChildren(sourceFile).forEach(visit);
  };
  visit(sourceFile);
  return ranges;
}

const stringLike = (node) =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isTemplateExpression(node);

// The raw source of each literal piece, so a line number counts the file's lines and not the
// line breaks an escape such as `\n` spells.
function literalPieces(node, sourceFile) {
  const pieces = ts.isTemplateExpression(node)
    ? [node.head, ...node.templateSpans.map((span) => span.literal)]
    : [node];
  return pieces.map((piece) => ({
    text: piece
      .getText(sourceFile)
      .slice(1, ts.isTemplateHead(piece) || ts.isTemplateMiddle(piece) ? -2 : -1),
    start: piece.getStart(sourceFile) + 1,
  }));
}

function isTestCallee(expression) {
  const names = [];
  let current = expression;
  while (!ts.isIdentifier(current)) {
    if (ts.isPropertyAccessExpression(current)) {
      names.unshift(current.name.text);
      current = current.expression;
    } else if (ts.isTaggedTemplateExpression(current)) {
      current = current.tag;
    } else if (ts.isCallExpression(current)) {
      current = current.expression;
    } else {
      return false;
    }
  }
  return TITLE_ROOTS.has(current.text) && names.every((member) => TITLE_MEMBERS.has(member));
}

function isReasonCall(node) {
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    REASON_MEMBERS.has(callee.name.text) &&
    isTestCallee(callee)
  );
}

function isRuleMessage(node) {
  const owner = node.parent;
  if (ts.isPropertyAssignment(owner)) return owner.name.getText() === 'message';
  return (
    ts.isVariableDeclaration(owner) &&
    ts.isIdentifier(owner.name) &&
    /message$/i.test(owner.name.text)
  );
}

function insideComponentDecorator(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (
      ts.isDecorator(current) &&
      ts.isCallExpression(current.expression) &&
      ts.isIdentifier(current.expression.expression) &&
      current.expression.expression.text === 'Component'
    ) {
      return true;
    }
  }
  return false;
}

// Strings in a component's `template` and `styles` hold real HTML and CSS comments.
function inlineKind(node) {
  let assignment = node.parent;
  if (assignment && ts.isArrayLiteralExpression(assignment)) assignment = assignment.parent;
  if (!assignment || !ts.isPropertyAssignment(assignment)) return null;
  const name = ts.isIdentifier(assignment.name) ? assignment.name.text : null;
  if (name !== 'template' && name !== 'styles') return null;
  return insideComponentDecorator(node) ? name : null;
}

function scanScript(path, text, findings) {
  const kind = extname(path) === '.json' ? ts.ScriptKind.JSON : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const report = reporter(path, text, findings);
  const checkLiteral = (node) => {
    for (const piece of literalPieces(node, sourceFile)) report(piece.text, piece.start);
  };
  for (const comment of commentRanges(sourceFile)) report(comment.text, comment.start);
  const visit = (node) => {
    if (ts.isCallExpression(node) && isTestCallee(node.expression)) {
      const [title] = node.arguments;
      if (title && stringLike(title)) checkLiteral(title);
    }
    if (ts.isCallExpression(node) && isReasonCall(node)) {
      const [, reason] = node.arguments;
      if (reason && stringLike(reason)) checkLiteral(reason);
    }
    if (basename(path) === RULE_MESSAGE_FILE && stringLike(node) && isRuleMessage(node)) {
      checkLiteral(node);
    }
    if (stringLike(node)) {
      const inline = inlineKind(node);
      const start = node.getStart(sourceFile) + 1;
      const raw = node.getText(sourceFile).slice(1, -1);
      const comments =
        inline === 'template' ? htmlComments(raw) : inline === 'styles' ? cssComments(raw) : [];
      for (const comment of comments) report(comment.text, start + comment.start);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

const isScript = (path) => SCRIPT_EXTENSIONS.has(extname(path)) || extname(path) === '.json';

const isHash = (path) => HASH_EXTENSIONS.has(extname(path)) || HASH_DOTFILES.has(basename(path));

const isScannable = (path) =>
  isScript(path) || isHash(path) || ['.html', '.css', '.scss'].includes(extname(path));

function commentsOf(path, text) {
  const extension = extname(path);
  if (extension === '.html') return htmlComments(text);
  if (extension === '.css') return cssComments(text);
  if (extension === '.scss') return cssComments(text, { lineComments: true });
  return isHash(path) ? hashComments(text) : [];
}

export function findReferences(files) {
  const findings = [];
  for (const { path, text } of files) {
    if (!inScope(path.replaceAll('\\', '/')) || !isScannable(path)) continue;
    if (isScript(path)) {
      scanScript(path, text, findings);
      continue;
    }
    const report = reporter(path, text, findings);
    for (const comment of commentsOf(path, text)) report(comment.text, comment.start);
  }
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

export function repoFiles(root) {
  const paths = SCAN_DIRECTORIES.flatMap((directory) => walk(join(root, directory)));
  for (const entry of readdirSync(root)) {
    if (SCAN_ROOT_PATTERNS.some((pattern) => pattern.test(entry))) paths.push(join(root, entry));
  }
  for (const file of SCAN_ROOT_FILES) {
    const path = join(root, file);
    if (statSync(path, { throwIfNoEntry: false })?.isFile()) paths.push(path);
  }
  return [...new Set(paths)]
    .filter(isScannable)
    .map((path) => ({ path, text: readFileSync(path, 'utf8') }));
}

export function checkRepo(root) {
  const files = repoFiles(root).map(({ path, text }) => ({ path: relative(root, path), text }));
  return findReferences(files);
}

export function describeFinding({ path, line, text }) {
  return `${path}:${line}: ${text}`;
}

if (import.meta.main) {
  const findings = checkRepo(join(import.meta.dirname, '..'));
  if (findings.length > 0) {
    for (const finding of findings) console.error(describeFinding(finding));
    console.error(
      `${findings.length} tracker reference(s) in comments, test titles, skip reasons, or ESLint rule messages. Move them to the commit, PR, or ADR (AGENTS.md, Code comments).`,
    );
    process.exitCode = 1;
  }
}
