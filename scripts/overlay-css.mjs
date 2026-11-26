import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postcss from 'postcss';
import { format, resolveConfig } from 'prettier';

const COPY = 'src/styles/spartan-preset.css';
const UPSTREAM = 'node_modules/@spartan-ng/brain/hlm-tailwind-preset.css';
const CDK_IMPORT = "@import '@angular/cdk/overlay-prebuilt.css';\n";
const LOADER_CLASS = '_CdkOverlayStyleLoader';
const OVERLAY_LAYER = 'cdk-overlay';

const withoutCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

async function normalised(css, root) {
  const config = await resolveConfig(join(root, COPY));
  return format(withoutCssComments(css), { ...config, parser: 'css' });
}

/**
 * @param {{ copy: string, upstream: string, root: string }} input
 * @returns {Promise<string | null>}
 */
export async function presetDrift({ copy, upstream, root }) {
  const [copyCss, upstreamCss] = await Promise.all([
    normalised(copy, root),
    normalised(upstream.replace(CDK_IMPORT, ''), root),
  ]);
  if (copyCss === upstreamCss) return null;
  return [
    `${COPY} differs from ${UPSTREAM} (comments aside) beyond its removed CDK import.`,
    `Re-copy: take ${UPSTREAM}, drop the line ${CDK_IMPORT.trim()}, make the comment's issue`,
    `numbers links, run Prettier, and update the version in the header of ${COPY}.`,
  ].join(' ');
}

export async function readPresetInputs(root) {
  return {
    root,
    copy: await readFile(join(root, COPY), 'utf8'),
    upstream: await readFile(join(root, UPSTREAM), 'utf8'),
  };
}

function bodyAfter(source, start, end = '\n}\n') {
  const from = source.indexOf(start);
  if (from === -1) return '';
  const to = source.indexOf(end, from);
  return source.slice(from, to === -1 ? undefined : to);
}

const LOADS_STYLES = new RegExp(`\\.load\\(${LOADER_CLASS}\\)`);

/**
 * @param {string} chunk
 * @returns {{ createOverlayRef: boolean, getContainerElement: boolean }}
 */
export function loaderCalls(chunk) {
  const container = bodyAfter(chunk, 'class OverlayContainer ');
  const method = (name) => bodyAfter(container, `${name}() {`, '\n  }\n');
  const getContainerElement = method('getContainerElement');
  return {
    createOverlayRef: LOADS_STYLES.test(bodyAfter(chunk, 'function createOverlayRef(')),
    getContainerElement:
      LOADS_STYLES.test(getContainerElement) ||
      (/this\._loadStyles\(\)/.test(getContainerElement) &&
        LOADS_STYLES.test(method('_loadStyles'))),
  };
}

/**
 * @param {string} chunk
 * @returns {string | null}
 */
export function loaderStyles(chunk) {
  const component = bodyAfter(chunk, `class ${LOADER_CLASS} `);
  const literal = /styles:\s*(\["(?:[^"\\]|\\.)*"\])/.exec(component);
  return literal ? JSON.parse(literal[1]).join('\n') : null;
}

const collapse = (text) => text.replace(/\s+/g, ' ').trim();

/**
 * @param {string} css
 * @returns {Set<string>}
 */
export function declarations(css) {
  const found = new Set();
  postcss.parse(css).walkDecls((declaration) => {
    const context = [];
    for (let node = declaration.parent; node && node.type !== 'root'; node = node.parent) {
      if (node.type === 'rule') continue;
      const isLayer = node.name === 'layer' && node.params === OVERLAY_LAYER;
      if (!isLayer) context.unshift(`@${node.name} ${collapse(node.params)}`);
    }
    for (const selector of declaration.parent.selectors) {
      found.add(
        `${context.join(' ')} ${collapse(selector)} { ${declaration.prop}: ${collapse(declaration.value)} }`.trim(),
      );
    }
  });
  return found;
}

/**
 * @param {{ version: string, chunk: string, prebuilt: string }} input
 * @returns {string[]}
 */
export function cdkOverlayProblems({ version, chunk, prebuilt }) {
  const premise = `@angular/cdk ${version}: re-check the premise of src/styles.css leaving out the overlay rules, and restore the overlay-prebuilt.css import if the loader is gone.`;
  const problems = [];
  const calls = loaderCalls(chunk);
  if (!calls.createOverlayRef) {
    problems.push(`${premise} createOverlayRef no longer loads ${LOADER_CLASS}.`);
  }
  if (!calls.getContainerElement) {
    problems.push(
      `${premise} OverlayContainer.getContainerElement no longer loads ${LOADER_CLASS}.`,
    );
  }
  const styles = loaderStyles(chunk);
  if (styles === null) {
    problems.push(`${premise} ${LOADER_CLASS} has no styles.`);
  } else {
    const runtime = declarations(styles);
    for (const declaration of declarations(prebuilt)) {
      if (!runtime.has(declaration)) {
        problems.push(`${premise} ${LOADER_CLASS} styles lack ${declaration}.`);
      }
    }
  }
  return problems;
}

export async function readCdkInputs(root) {
  const directory = join(root, 'node_modules', '@angular', 'cdk');
  const { version } = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const chunks = join(directory, 'fesm2022');
  let chunk = '';
  for (const name of (await readdir(chunks)).filter((file) => file.endsWith('.mjs'))) {
    const text = await readFile(join(chunks, name), 'utf8');
    if (text.includes('function createOverlayRef(')) chunk = text;
  }
  return {
    version,
    chunk,
    prebuilt: await readFile(join(directory, 'overlay-prebuilt.css'), 'utf8'),
  };
}
