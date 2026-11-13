// Keeps the dark-variant rules, which no page can use, out of the production stylesheet.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const PREFIX = 'dark-exclusion:';
const CHECK = 'scripts/dark-exclusion.mjs';
const STYLES = 'src/styles.css';
const TOKENS = 'src/styles/tokens.css';
const EXCLUSION = `the exclusion, @source not inline() in ${STYLES}`;
const DARK_SELECTOR = ':is(.dark *)';

// Entries that drop classes unrelated to the dark variant, so they need no dark variant.
const OTHER_EXCLUDED = new Set(['outline-destructive', 'outline-muted']);

const SPEC_FILE = /\.spec\.ts$/;
const TESTING_DIRECTORY = /(?:^|\/)testing\//;
const NOT_PART_OF_CLASS = /[\s"'`]/;
const DEPTH_ZERO_DELIMITERS = new Set(['<', '>', ';', ',', '{', '}', '(', ')']);

const withoutCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * A `>` or `,` inside an arbitrary value such as `has-[>[data-slot=a]]` does not end the class.
 * @param {string} text
 * @returns {string[]}
 */
function candidates(text) {
  const found = [];
  let token = '';
  let depth = 0;
  const flush = () => {
    if (token) found.push(token.replace(/\.+$/, ''));
    token = '';
    depth = 0;
  };
  for (const char of text) {
    if (NOT_PART_OF_CLASS.test(char)) {
      flush();
    } else if (char === '[' || (char === '(' && token.endsWith('-'))) {
      depth += 1;
      token += char;
    } else if ((char === ']' || char === ')') && depth > 0) {
      depth -= 1;
      token += char;
    } else if (depth === 0 && DEPTH_ZERO_DELIMITERS.has(char)) {
      flush();
    } else {
      token += char;
    }
  }
  flush();
  return found;
}

/**
 * A `:` inside an arbitrary value is not a variant separator.
 * @param {string} candidate
 * @returns {{ variants: string[], utility: string }}
 */
function splitVariants(candidate) {
  const parts = [];
  let part = '';
  let depth = 0;
  for (const char of candidate) {
    if (char === '[' || char === '(') depth += 1;
    else if ((char === ']' || char === ')') && depth > 0) depth -= 1;
    if (char === ':' && depth === 0) {
      parts.push(part);
      part = '';
    } else {
      part += char;
    }
  }
  return { variants: parts, utility: part };
}

const hasDarkVariant = (candidate) => {
  const { variants, utility } = splitVariants(candidate);
  return utility !== '' && variants.includes('dark');
};

/**
 * @param {Record<string, string>} sources file path to text
 * @returns {Map<string, string[]>} dark-variant class to the files that use it
 */
function darkClassesIn(sources) {
  const used = new Map();
  for (const [file, text] of Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))) {
    for (const candidate of new Set(candidates(text))) {
      if (hasDarkVariant(candidate)) used.set(candidate, [...(used.get(candidate) ?? []), file]);
    }
  }
  return used;
}

/**
 * @param {string} stylesCss
 * @returns {string[]} every entry of every `@source not inline()`
 */
function excludedEntries(stylesCss) {
  const directive = /@source\s+not\s+inline\(\s*(['"])([\s\S]*?)\1\s*\)/g;
  return [...withoutCssComments(stylesCss).matchAll(directive)].flatMap(([, , list]) =>
    list.split(/\s+/).filter(Boolean),
  );
}

const hasDarkSelector = (tokensCss) => /\.dark(?![\w-])/.test(withoutCssComments(tokensCss));

const fail = (file, message) => `${PREFIX} ${file}: ${message} (${EXCLUSION}; check: ${CHECK})`;

/**
 * @param {{ sources: Record<string, string>, stylesCss: string, tokensCss: string }} inputs
 * @returns {string[]} one line per problem
 */
export function darkExclusionProblems({ sources, stylesCss, tokensCss }) {
  const problems = [];
  const entries = excludedEntries(stylesCss).filter((entry) => !OTHER_EXCLUDED.has(entry));
  const listed = new Set(entries);

  for (const entry of entries) {
    if (/[{}]/.test(entry)) {
      problems.push(
        fail(STYLES, `the entry "${entry}" uses brace expansion; list each class one by one`),
      );
    } else if (!hasDarkVariant(entry)) {
      problems.push(
        fail(
          STYLES,
          `the entry "${entry}" has no dark variant, so it could drop a rule a page uses`,
        ),
      );
    }
  }

  for (const [candidate, files] of darkClassesIn(sources)) {
    if (listed.has(candidate)) continue;
    for (const file of files) {
      problems.push(fail(file, `the class "${candidate}" has a dark variant and is not excluded`));
    }
  }

  if (entries.length > 0 && hasDarkSelector(tokensCss)) {
    problems.push(
      fail(
        TOKENS,
        `a .dark selector exists while the exclusion still lists ${entries.length} dark classes; ` +
          'remove the exclusion and this check in the same change as the dark theme',
      ),
    );
  }
  return problems;
}

async function filesTailwindScans(root) {
  const sourceDir = join(root, 'src');
  const files = [];
  for (const entry of await readdir(sourceDir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = relative(root, join(entry.parentPath, entry.name)).split(sep).join('/');
    if (path === STYLES || SPEC_FILE.test(path) || TESTING_DIRECTORY.test(path)) continue;
    files.push(path);
  }
  return files.sort();
}

/**
 * @param {string} root repository root
 */
export async function readDarkExclusionInputs(root) {
  const sources = {};
  for (const file of await filesTailwindScans(root)) {
    sources[file] = await readFile(join(root, file), 'utf8');
  }
  return {
    sources,
    stylesCss: await readFile(join(root, STYLES), 'utf8'),
    tokensCss: await readFile(join(root, TOKENS), 'utf8'),
  };
}

/**
 * Checks Tailwind's actual output, not a copy of its class extractor.
 * @param {string} browserDir `dist/<project>/browser`
 * @returns {Promise<string[]>} one line per problem
 */
export async function builtStylesheetProblems(browserDir) {
  // The development build, which e2e runs, writes `styles.css` with no hash.
  const stylesheets = (await readdir(browserDir))
    .filter((name) => /^styles(?:-[^/]+)?\.css$/.test(name))
    .sort();
  if (stylesheets.length === 0) {
    return [
      `${PREFIX} no styles.css or styles-*.css in ${browserDir}, so the dark rules cannot be checked`,
    ];
  }
  const problems = [];
  for (const name of stylesheets) {
    if ((await readFile(join(browserDir, name), 'utf8')).includes(DARK_SELECTOR)) {
      problems.push(
        `${PREFIX} ${name} contains ${DARK_SELECTOR}; a class with a dark variant is missing ` +
          `from ${EXCLUSION}, or a utility such as shimmer carries one (check: ${CHECK})`,
      );
    }
  }
  return problems;
}
