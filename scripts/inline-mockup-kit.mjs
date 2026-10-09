// Writes the built mockup kit into each static mockup (ADR 0007, "How a self-contained mockup gets
// the same tokens and styles"; #58). Node built-ins only.
//
//   npm run design:css                      build the kit, then inline it into design/mockups/**/*.html
//   npm run design:css -- --skip-build      reuse dist/mockup-kit/browser from an earlier build
//   npm run design:css -- a.html b.html     inline into these files instead of design/mockups/
//
// The kit is `ng build --configuration production,mockup-kit`, which emits mockup-kit.css beside the
// normal output without referencing it from index.html. Each mockup gets one
// `<!-- prettier-ignore --><style id="mockup-kit">…</style>` block in its <head>, with every font
// url(...) rewritten as a base64 data: URI, so the file still opens offline as a single file. Only
// the Latin @font-face rules are kept (about 65 KB); the other subsets would add hundreds of KB.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT_OUTPUT = join(root, 'dist', 'mockup-kit', 'browser');
const MOCKUPS_DIR = join(root, 'design', 'mockups');

const MIME = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

/** Rewrites every `url(...)` in `css` as a base64 `data:` URI, reading files relative to `baseDir`. */
export function inlineFonts(css, baseDir) {
  return css.replace(/url\(\s*(['"]?)([^'")]+?)\1\s*\)/g, (match, quote, ref) => {
    if (ref.startsWith('data:')) return match;
    if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(ref)) {
      throw new Error(
        `mockup kit: remote url(${ref}) cannot be inlined; a mockup must open offline`,
      );
    }
    const file = ref.split(/[?#]/)[0];
    const mime = MIME[extname(file).toLowerCase()];
    if (!mime) throw new Error(`mockup kit: url(${ref}) is not a font file this script can inline`);
    const path = resolve(baseDir, file);
    let bytes;
    try {
      bytes = readFileSync(path);
    } catch {
      throw new Error(`mockup kit: font file not found for url(${ref}): ${path}`);
    }
    return `url(data:${mime};base64,${bytes.toString('base64')})`;
  });
}

/** Drops `@font-face` rules whose `unicode-range` has no Latin (U+0000-00FF) part. */
export function keepLatinFontFaces(css) {
  return css.replace(/@font-face\s*\{[^}]*\}/g, (rule) => {
    const range = /unicode-range\s*:\s*([^;}]+)/i.exec(rule);
    return !range || /U\+0{1,4}-00FF/i.test(range[1]) ? rule : '';
  });
}

const BLOCK =
  /(?:<!-- prettier-ignore -->[ \t]*\r?\n[ \t]*)?<style id="mockup-kit">[\s\S]*?<\/style>/;

/** Puts `css` into `html` as the mockup-kit block, replacing an earlier block if there is one. */
export function inlineKitIntoHtml(html, css) {
  const oneLine = css.trim();
  const make = (indent) =>
    `<!-- prettier-ignore -->\n${indent}<style id="mockup-kit">${oneLine}</style>`;
  const existing = BLOCK.exec(html);
  if (existing) {
    const indent = /([ \t]*)(?:<!-- prettier-ignore -->|<style id="mockup-kit">)/.exec(
      html.slice(html.lastIndexOf('\n', existing.index) + 1),
    )?.[1];
    return html.replace(BLOCK, () => make(indent ?? ''));
  }
  const head = /^([ \t]*)<\/head>/m.exec(html);
  if (!head) throw new Error('mockup kit: the page has no </head> line to put the kit before');
  const indent = `${head[1]}  `;
  return html.replace(/^([ \t]*)<\/head>/m, () => `${indent}${make(indent)}\n${head[0]}`);
}

/** Inlines the kit CSS file (and its fonts) into one HTML file. Returns true when the file changed. */
export async function inlineKitIntoFile(htmlPath, cssPath) {
  const css = inlineFonts(keepLatinFontFaces(await readFile(cssPath, 'utf8')), dirname(cssPath));
  const before = await readFile(htmlPath, 'utf8');
  const after = inlineKitIntoHtml(before, css);
  if (after === before) return false;
  await writeFile(htmlPath, after);
  return true;
}

async function htmlFilesUnder(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

function buildKit() {
  const ng = join(root, 'node_modules', '@angular', 'cli', 'bin', 'ng.js');
  const args = [
    ng,
    'build',
    '--configuration',
    'production,mockup-kit',
    '--output-path',
    join('dist', 'mockup-kit'),
  ];
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
    child.on('error', fail);
    child.on('exit', (code) =>
      code === 0 ? done() : fail(new Error(`ng build exited with code ${code}`)),
    );
  });
}

async function main(argv) {
  const skipBuild = argv.includes('--skip-build');
  const files = argv.filter((arg) => !arg.startsWith('--')).map((file) => resolve(file));
  if (!skipBuild) await buildKit();
  const targets = files.length > 0 ? files : await htmlFilesUnder(MOCKUPS_DIR);
  const cssPath = join(KIT_OUTPUT, 'mockup-kit.css');
  for (const target of targets) {
    const changed = await inlineKitIntoFile(target, cssPath);
    console.log(`mockup-kit: ${changed ? 'updated' : 'unchanged'} ${target}`);
  }
  if (targets.length === 0) console.log('mockup-kit: no mockups in design/mockups/');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
