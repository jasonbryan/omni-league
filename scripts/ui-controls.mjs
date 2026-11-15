import ts from 'typescript';

export const PENDING = [
  'src/app/organizations/admin/custom-level-panel.ts',
  'src/app/organizations/admin/league-division-fields.ts',
];

export const EXCEPTIONS = [
  { type: 'hidden', files: [], reason: 'carries GET form state; not a visible control' },
  {
    type: 'checkbox',
    files: [
      'src/app/organizations/league-filter-overlays.ts',
      'src/app/organizations/league-filters.ts',
    ],
    reason: 'league filter checkbox chips in a server-rendered GET form',
  },
  {
    type: 'file',
    files: ['src/app/organizations/admin/admin-logo.ts'],
    reason: 'spartan has no file input',
  },
  {
    type: 'search',
    files: ['src/app/find/find-content.ts', 'src/app/public-layout/top-bar-find.ts'],
    reason: 'server-rendered GET forms that work before hydration',
  },
];

const ADVICE = {
  select:
    'use brain select + helm select, copied into src/app/ui/select (angular.md, Copying a missing component)',
  textarea: 'use ui/textarea (hlmTextarea)',
  radio: 'use ui/radio-group',
  checkbox: 'use ui/checkbox (app-checkbox)',
  input: 'use ui/input (hlmInput)',
  split: 'control element split across ${...}; keep the element in one template piece',
};

const CONTROL_START = /<(input|select|textarea)(?=[\s/>]|$)/g;
const ATTRIBUTE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const TEMPLATE_COMMENT = /<!--[\s\S]*?-->/g;

const isChecked = (path) => !path.startsWith('src/app/ui/') && !path.endsWith('.spec.ts');

const newlinesIn = (text) => text.split('\n').length - 1;

const blankOut = (comment) => comment.replace(/[^\n]/g, ' ');

function literalPieces(path, text) {
  if (path.endsWith('.html')) return [{ text, line: 1 }];
  const sourceFile = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const pieces = [];
  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      pieces.push({ text: node.text ?? '', line: line + 1 });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return pieces;
}

function elementEnd(text, from) {
  let quote = null;
  for (let index = from; index < text.length; index++) {
    const char = text[index];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index;
    }
  }
  return -1;
}

function attributesOf(source) {
  const names = new Set();
  let type;
  for (const match of source.matchAll(ATTRIBUTE)) {
    names.add(match[1]);
    if (match[1] === 'type') type = (match[2] ?? match[3] ?? match[4] ?? '').trim().toLowerCase();
  }
  return { names, type };
}

export function controlsIn(path, text) {
  const controls = [];
  for (const piece of literalPieces(path, text)) {
    const source = piece.text.replace(TEMPLATE_COMMENT, blankOut);
    CONTROL_START.lastIndex = 0;
    let match;
    while ((match = CONTROL_START.exec(source)) !== null) {
      const tag = match[1];
      const line = piece.line + newlinesIn(source.slice(0, match.index));
      const attributesStart = match.index + match[0].length;
      const end = elementEnd(source, attributesStart);
      if (end === -1) {
        controls.push({ tag, line, split: true, names: new Set(), type: undefined });
        break;
      }
      const { names, type } = attributesOf(source.slice(attributesStart, end));
      controls.push({ tag, line, split: false, names, type });
      CONTROL_START.lastIndex = end;
    }
  }
  return controls;
}

const exceptionFor = (type) => EXCEPTIONS.find((exception) => exception.type === type);

const labelOf = ({ tag, type, split }) => {
  if (split) return `<${tag} ...>`;
  return type === undefined || tag !== 'input' ? `<${tag}>` : `<input type="${type}">`;
};

function adviceFor(path, control) {
  if (control.split) return ADVICE.split;
  const { tag, type, names } = control;
  if (tag === 'select') return PENDING.includes(path) ? null : ADVICE.select;
  if (tag === 'textarea') return names.has('hlmTextarea') ? null : ADVICE.textarea;
  if (type === 'hidden') return null;
  if (type === 'radio') return ADVICE.radio;
  if (type === 'checkbox')
    return exceptionFor('checkbox').files.includes(path) ? null : ADVICE.checkbox;
  const listed = type !== undefined && (exceptionFor(type)?.files ?? []).includes(path);
  return listed || names.has('hlmInput') ? null : ADVICE.input;
}

export function findControlFindings(path, text) {
  if (!isChecked(path)) return [];
  const findings = [];
  for (const control of controlsIn(path, text)) {
    const advice = adviceFor(path, control);
    if (advice === null) continue;
    findings.push({
      path,
      line: control.line,
      message: `${path}:${control.line}: ${labelOf(control)}: ${advice}`,
    });
  }
  return findings;
}
