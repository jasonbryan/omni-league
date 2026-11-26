import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  excludedEntries,
  hasDarkVariant,
  OTHER_EXCLUDED,
  withoutCssComments,
} from './dark-exclusion.mjs';
import { HELM_VARIANT_CLASSES, HELM_VARIANT_GROUPS } from './helm-variant-classes.mjs';

const PREFIX = 'helm-variant-exclusion:';
const CHECK = 'scripts/helm-variant-exclusion.mjs';
const STYLES = 'src/styles.css';
const GROUP_NAMES = {
  sheet: 'sheet sides',
  badge: 'badge as a control',
  file: 'file input',
  button: 'small helm buttons',
  other: 'helm variant exclusion',
};

const SHEET_DIRECTORY = 'src/app/ui/sheet/';
const INPUT_DIRECTORY = 'src/app/ui/input/';
const UI_DIRECTORY = 'src/app/ui/';
const SHEET_CONTENT_FILE = 'src/app/ui/sheet/hlm-sheet-content.ts';
const BUTTON_FILE = 'src/app/ui/button/hlm-button.ts';
// The one call whose values come from the `hlmBtn` inputs and `provideBrnButtonConfig`, which the
// rules below already cover.
const BUTTON_OWN_CALL_ARGUMENTS = '{ variant: this.variant(), size: this.size() }';
const squash = (text) => text.replace(/[\s,]+/g, '');

const ALLOWED_SIDES = new Set(['left', 'bottom']);
const SMALL_BUTTON_SIZES = new Set(['xs', 'sm', 'icon-xs', 'icon-sm']);
const FOCUSABLE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);
const FOCUS_OR_VALIDITY_ATTRIBUTES = new Set([
  'href',
  'routerlink',
  'tabindex',
  'contenteditable',
  'aria-invalid',
]);
const HOST_DIRECTIVES_NEEDING_VARIANTS = ['HlmButton', 'HlmBadge', 'HlmInput'];

const fix = `remove that group's classes from the exclusion in ${STYLES}`;
const message = (file, group, what, remedy = fix) =>
  `${PREFIX} ${file}: ${what} (group: ${group}; fix: ${remedy}; check: ${CHECK})`;

/**
 * Tailwind reads a class wherever it stands between delimiters, so a class is "in" a text unless the
 * characters around it extend it into a longer class.
 * @param {string} text
 * @param {string} className
 * @returns {number} index of the first occurrence, or -1
 */
function indexOfClass(text, className) {
  const continues = /[\w\-:[\]!%@/*&]/;
  for (let from = text.indexOf(className); from !== -1; from = text.indexOf(className, from + 1)) {
    const before = text[from - 1];
    const after = text[from + className.length];
    if (
      (before === undefined || !continues.test(before)) &&
      (after === undefined || !continues.test(after))
    ) {
      return from;
    }
  }
  return -1;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/**
 * @typedef {{ name: string, value: string | null }} Attribute
 * @typedef {{ tag: string, attributes: Attribute[], index: number }} Element
 */

/**
 * Reads the open tag at `start` (a `<` followed by a letter). Returns null where the text is not a
 * tag, such as a comparison or a generic in TypeScript, so the scan skips it.
 * @param {string} text
 * @param {number} start
 * @returns {{ element: Element, end: number } | null}
 */
function readOpenTag(text, start) {
  const tagName = /^[A-Za-z][\w:.-]*/.exec(text.slice(start + 1, start + 80));
  if (!tagName) return null;
  const attributes = [];
  let i = start + 1 + tagName[0].length;
  const skipSpace = () => {
    while (/\s/.test(text[i] ?? '')) i += 1;
  };
  for (;;) {
    skipSpace();
    const char = text[i];
    if (char === undefined) return null;
    if (char === '>') {
      return { element: { tag: tagName[0], attributes, index: start }, end: i + 1 };
    }
    if (char === '/' && text[i + 1] === '>') {
      return { element: { tag: tagName[0], attributes, index: start }, end: i + 2 };
    }
    const name = /^[^\s=>"'/<{};`]+/.exec(text.slice(i, i + 200));
    if (!name) return null;
    i += name[0].length;
    skipSpace();
    let value = null;
    if (text[i] === '=') {
      i += 1;
      skipSpace();
      const quote = text[i];
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, i + 1);
        if (close === -1) return null;
        value = text.slice(i + 1, close);
        i = close + 1;
      } else {
        const bare = /^[^\s>]+/.exec(text.slice(i, i + 200));
        if (!bare) return null;
        value = bare[0];
        i += bare[0].length;
      }
    }
    attributes.push({ name: name[0], value });
  }
}

/**
 * @param {string} text
 * @returns {Element[]}
 */
function elementsIn(text) {
  const elements = [];
  for (let at = text.indexOf('<'); at !== -1; at = text.indexOf('<', at + 1)) {
    if (!/[A-Za-z]/.test(text[at + 1] ?? '')) continue;
    const read = readOpenTag(text, at);
    if (read) elements.push(read.element);
  }
  return elements;
}

/**
 * `[attr.type]`, `[type]`, and `type` all name `type`.
 * @param {string} name
 */
const baseName = (name) =>
  name
    .replace(/^\[(.*)\]$/, '$1')
    .replace(/^attr\./i, '')
    .toLowerCase();

/**
 * @param {Element} element
 * @param {string} name lower case
 * @returns {Attribute[]}
 */
const attributesNamed = (element, name) =>
  element.attributes.filter((attribute) => baseName(attribute.name) === name);

const hasAttribute = (element, name) => attributesNamed(element, name).length > 0;
const isBound = (attribute) => /^\[.*\]$/.test(attribute.name);

const STRING_LITERAL = /'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`/g;
const literalsIn = (expression) =>
  [...expression.matchAll(STRING_LITERAL)].map(
    ([, single, double, template]) => single ?? double ?? template,
  );

/**
 * @param {string} expression the code of a bound value or a property value
 * @param {(literal: string) => boolean} isAllowed
 * @returns {string | null} what is wrong with the value, or null
 */
function expressionProblem(expression, isAllowed) {
  const trimmed = expression.trim();
  const literals = literalsIn(trimmed);
  if (literals.length === 0)
    return `the value \`${trimmed}\` is not a string literal, so the check cannot read it`;
  const refused = literals.find((literal) => !isAllowed(literal));
  if (refused !== undefined) return `the value \`${trimmed}\` can be "${refused}"`;
  return null;
}

/**
 * @param {Attribute} attribute
 * @param {(literal: string) => boolean} isAllowed
 * @returns {string | null}
 */
function attributeProblem(attribute, isAllowed) {
  const value = attribute.value ?? '';
  if (isBound(attribute)) return expressionProblem(value, isAllowed);
  return isAllowed(value.trim()) ? null : `the value is "${value.trim()}"`;
}

/**
 * @param {string} text from an opening bracket
 * @param {number} open index of the opening bracket
 * @returns {number} index of its closing bracket, or -1
 */
function closingIndex(text, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (char === "'" || char === '"' || char === '`') {
      for (i += 1; i < text.length && text[i] !== char; i += 1) if (text[i] === '\\') i += 1;
    } else if (pairs[char]) {
      stack.push(pairs[char]);
    } else if (char === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

/** Splits at commas that are not inside brackets or strings. */
function topLevelParts(text) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "'" || char === '"' || char === '`') {
      for (i += 1; i < text.length && text[i] !== char; i += 1) if (text[i] === '\\') i += 1;
    } else if ('([{'.includes(char)) {
      i = closingIndex(text, i);
      if (i === -1) break;
    } else if (char === ',') {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

const isSmallButtonSizeAllowed = (literal) => !SMALL_BUTTON_SIZES.has(literal);
const isSideAllowed = (literal) => ALLOWED_SIDES.has(literal);
const isNotFile = (literal) => literal !== 'file';

/**
 * @param {string} file
 * @param {string} text
 * @returns {string[]}
 */
function elementProblems(file, text) {
  const found = [];
  const usesInputClasses = /\bINPUT_CLASSES\b/.test(text) && !file.startsWith(INPUT_DIRECTORY);
  const report = (element, group, what, remedy) =>
    found.push(message(`${file}:${lineOf(text, element.index)}`, group, what, remedy));

  for (const element of elementsIn(text)) {
    const tag = element.tag.toLowerCase();

    if (tag === 'hlm-sheet' || hasAttribute(element, 'brnsheet')) {
      const sides = attributesNamed(element, 'side');
      if (sides.length === 0) {
        report(element, GROUP_NAMES.sheet, `<${element.tag}> has no side, so it opens at the top`);
      }
      for (const side of sides) {
        const problem = attributeProblem(side, isSideAllowed);
        if (problem)
          report(
            element,
            GROUP_NAMES.sheet,
            `<${element.tag}> side: ${problem}; use left or bottom`,
          );
      }
    }

    if (hasAttribute(element, 'hlmsheettrigger') || hasAttribute(element, 'brnsheettrigger')) {
      for (const side of attributesNamed(element, 'side')) {
        const problem = attributeProblem(side, isSideAllowed);
        if (problem)
          report(
            element,
            GROUP_NAMES.sheet,
            `a sheet trigger's side: ${problem}; use left or bottom`,
          );
      }
    }

    if (hasAttribute(element, 'hlmbadge') || tag === 'hlm-badge') {
      const reasons = [];
      if (FOCUSABLE_TAGS.has(tag)) reasons.push(`it is a <${tag}>`);
      for (const attribute of element.attributes) {
        if (FOCUS_OR_VALIDITY_ATTRIBUTES.has(baseName(attribute.name))) {
          reasons.push(`it has ${attribute.name}`);
        }
      }
      if (reasons.length > 0) {
        report(element, GROUP_NAMES.badge, `a badge is a control: ${reasons.join(', ')}`);
      }
    }

    if (hasAttribute(element, 'hlminput') || (tag === 'input' && usesInputClasses)) {
      for (const type of attributesNamed(element, 'type')) {
        const problem = attributeProblem(type, isNotFile);
        if (problem) report(element, GROUP_NAMES.file, `an input's type: ${problem}`);
      }
    }

    const isCloseButton =
      file === SHEET_CONTENT_FILE &&
      element.attributes.some(
        (attribute) => attribute.name === 'size' && attribute.value === 'icon-sm',
      );
    if (hasAttribute(element, 'hlmbtn') && !isCloseButton) {
      for (const size of attributesNamed(element, 'size')) {
        const problem = attributeProblem(size, isSmallButtonSizeAllowed);
        if (problem) report(element, GROUP_NAMES.button, `a button's size: ${problem}`);
      }
    }

    if (tag === 'hlm-sheet-content') {
      const close = attributesNamed(element, 'showclosebutton')[0];
      const closesOff =
        close && (isBound(close) ? close.value?.trim() === 'false' : close.value === 'false');
      if (!closesOff) {
        report(
          element,
          GROUP_NAMES.button,
          '<hlm-sheet-content> must set [showCloseButton]="false"',
        );
      }
    }
  }
  return found;
}

/**
 * @param {string} file
 * @param {string} text
 * @returns {string[]}
 */
function callProblems(file, text) {
  const found = [];
  for (const match of text.matchAll(/\b(provideBrnButtonConfig|buttonVariants)\s*\(/g)) {
    const open = match.index + match[0].length - 1;
    if (/\bfunction\s+$/.test(text.slice(Math.max(0, match.index - 20), match.index))) continue;
    const close = closingIndex(text, open);
    if (close === -1) continue;
    const args = text.slice(open + 1, close).trim();
    const report = (what) =>
      found.push(
        message(
          `${file}:${lineOf(text, match.index)}`,
          GROUP_NAMES.button,
          `${match[1]}(): ${what}`,
        ),
      );
    if (args === '') continue;
    if (
      file === BUTTON_FILE &&
      match[1] === 'buttonVariants' &&
      squash(args) === squash(BUTTON_OWN_CALL_ARGUMENTS)
    ) {
      continue;
    }
    if (!args.startsWith('{')) {
      report(
        `the argument \`${args}\` is not an object literal, so the check cannot read its size`,
      );
      continue;
    }
    for (const property of topLevelParts(args.slice(1, args.lastIndexOf('}')))) {
      if (property.startsWith('...')) {
        report(`\`${property}\` spreads values the check cannot read`);
        continue;
      }
      if (/^size$/.test(property)) {
        report('a shorthand `size` is not a string literal, so the check cannot read it');
        continue;
      }
      const size = /^(?:size|'size'|"size")\s*:\s*([\s\S]*)$/.exec(property);
      if (!size) continue;
      const problem = expressionProblem(size[1], isSmallButtonSizeAllowed);
      if (problem) report(`size: ${problem}`);
    }
  }
  return found;
}

/**
 * @param {string} file
 * @param {string} text
 * @returns {string[]}
 */
function hostDirectiveProblems(file, text) {
  if (file.startsWith(UI_DIRECTORY)) return [];
  const found = [];
  for (const match of text.matchAll(/\bhostDirectives\s*:\s*\[/g)) {
    const open = match.index + match[0].length - 1;
    const close = closingIndex(text, open);
    if (close === -1) continue;
    const list = text.slice(open, close + 1);
    for (const directive of HOST_DIRECTIVES_NEEDING_VARIANTS) {
      if (new RegExp(`\\b${directive}\\b`).test(list)) {
        found.push(
          message(
            `${file}:${lineOf(text, match.index)}`,
            directive === 'HlmBadge'
              ? GROUP_NAMES.badge
              : directive === 'HlmInput'
                ? GROUP_NAMES.file
                : GROUP_NAMES.button,
            `${directive} in hostDirectives makes the host element a helm control the check cannot read`,
          ),
        );
      }
    }
  }
  return found;
}

/**
 * @param {string} file
 * @param {string} text
 * @returns {string[]}
 */
function sideStateProblems(file, text) {
  if (file.startsWith(SHEET_DIRECTORY)) return [];
  const found = [];
  for (const match of text.matchAll(/\bsideState\b(?!\s*\()/g)) {
    found.push(
      message(
        `${file}:${lineOf(text, match.index)}`,
        GROUP_NAMES.sheet,
        'sideState can be set to a side the exclusion drops; only a read, sideState(), is allowed outside ui/sheet',
      ),
    );
  }
  return found;
}

/**
 * @param {{ sources: Record<string, string>, stylesCss: string }} inputs
 * @returns {string[]} one line per problem
 */
export function helmVariantProblems({ sources, stylesCss }) {
  const found = [];
  const files = Object.keys(sources).sort();

  for (const group of HELM_VARIANT_GROUPS) {
    for (const file of files) {
      if (file === group.helmFile) continue;
      for (const className of group.classes) {
        const at = indexOfClass(sources[file], className);
        if (at !== -1) {
          found.push(
            message(
              `${file}:${lineOf(sources[file], at)}`,
              group.name,
              `the class "${className}" has no rule while the exclusion lists it`,
            ),
          );
        }
      }
    }
  }

  for (const file of files) {
    const text = sources[file];
    if (!/\.(?:ts|html)$/.test(file)) continue;
    found.push(
      ...elementProblems(file, text),
      ...callProblems(file, text),
      ...hostDirectiveProblems(file, text),
      ...sideStateProblems(file, text),
    );
  }

  const listed = new Set(excludedEntries(stylesCss));
  for (const group of HELM_VARIANT_GROUPS) {
    const helmText = sources[group.helmFile];
    for (const className of group.classes) {
      if (helmText === undefined || indexOfClass(helmText, className) === -1) {
        found.push(
          message(
            group.helmFile,
            group.name,
            `the class "${className}" is no longer in the helm file`,
            `remove it from the group in scripts/helm-variant-classes.mjs and from the exclusion in ${STYLES}`,
          ),
        );
      }
      if (!listed.has(className)) {
        found.push(
          message(
            STYLES,
            group.name,
            `the class "${className}" is missing from the exclusion`,
            `add it to a @source not inline() in ${STYLES}, or remove it from the group in scripts/helm-variant-classes.mjs`,
          ),
        );
      }
    }
  }
  for (const entry of listed) {
    if (HELM_VARIANT_CLASSES.has(entry) || OTHER_EXCLUDED.has(entry) || hasDarkVariant(entry))
      continue;
    found.push(
      message(
        STYLES,
        GROUP_NAMES.other,
        `the entry "${entry}" is owned by no check`,
        'remove it, or add it to a group in scripts/helm-variant-classes.mjs',
      ),
    );
  }
  return found;
}

const unescapeCss = (identifier) =>
  identifier
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/\\([\s\S])/g, '$1');

const CLASS_TOKEN = /\.((?:\\[0-9a-fA-F]{1,6}\s?|\\[\s\S]|[\w-]|\P{ASCII})+)/gu;

/**
 * Finds a class as a whole token anywhere in the stylesheet, as Tailwind escapes it and the
 * production build minifies it.
 * @param {string} css
 * @returns {Set<string>} the listed classes that have a rule
 */
export function helmVariantClassesIn(css) {
  const found = new Set();
  for (const [, token] of withoutCssComments(css).matchAll(CLASS_TOKEN)) {
    const className = unescapeCss(token);
    if (HELM_VARIANT_CLASSES.has(className)) found.add(className);
  }
  return found;
}

/**
 * Checks Tailwind's actual output, so a class the source check misses still fails the build.
 * @param {string} browserDir `dist/<project>/browser`
 * @returns {Promise<string[]>} one line per problem
 */
export async function builtHelmVariantProblems(browserDir) {
  // The development build, which e2e runs, writes `styles.css` with no hash.
  const stylesheets = (await readdir(browserDir))
    .filter((name) => /^styles(?:-[^/]+)?\.css$/.test(name))
    .sort();
  if (stylesheets.length === 0) {
    return [
      `${PREFIX} no styles.css or styles-*.css in ${browserDir}, so the helm variant rules cannot be checked`,
    ];
  }
  const found = [];
  for (const name of stylesheets) {
    const present = helmVariantClassesIn(await readFile(join(browserDir, name), 'utf8'));
    for (const group of HELM_VARIANT_GROUPS) {
      for (const className of group.classes) {
        if (!present.has(className)) continue;
        found.push(
          message(
            name,
            group.name,
            `contains a rule for "${className}", which no page can use`,
            `add it to the exclusion in ${STYLES}, or remove the group if a page now uses it`,
          ),
        );
      }
    }
  }
  return found;
}
