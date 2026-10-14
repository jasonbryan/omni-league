import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT_OUTPUT = join(root, 'dist', 'mockup-kit', 'browser');
const MOCKUPS_DIR = join(root, 'design', 'mockups');
// The kit's `@source` scans this copy of the mockups with their kit blocks removed: scanning a block
// would turn words in the CSS into utilities and keep classes removed from the markup, so a second run
// would change the file.
export const KIT_SOURCES = join(root, 'dist', 'mockup-kit-source');

const MIME = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

// A mockup opens offline as a single file, so fonts are inlined as `data:` URIs.
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

// The Latin subset is about 65 KB; the other subsets would add hundreds of KB.
export function keepLatinFontFaces(css) {
  return css.replace(/@font-face\s*\{[^}]*\}/g, (rule) => {
    const range = /unicode-range\s*:\s*([^;}]+)/i.exec(rule);
    return !range || /U\+0{1,4}-00FF/i.test(range[1]) ? rule : '';
  });
}

const BLOCK =
  /(?:<!-- prettier-ignore -->[ \t]*\r?\n[ \t]*)?<style id="mockup-kit">[\s\S]*?<\/style>/;

export function stripKitFromHtml(html) {
  return html.replace(new RegExp(`[ \\t]*${BLOCK.source}[ \\t]*\\r?\\n?`, 'g'), '');
}

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

export async function prepareKitSources(mockupsDir, destDir) {
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });
  const files = await htmlFilesUnder(mockupsDir);
  for (const file of files) {
    const target = join(destDir, relative(mockupsDir, file));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, stripKitFromHtml(await readFile(file, 'utf8')));
  }
  return files.length;
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

export async function main(
  argv,
  {
    mockupsDir = MOCKUPS_DIR,
    kitSources = KIT_SOURCES,
    kitOutput = KIT_OUTPUT,
    build = buildKit,
    log = console.log,
  } = {},
) {
  const skipBuild = argv.includes('--skip-build');
  const files = argv.filter((arg) => !arg.startsWith('--')).map((file) => resolve(file));
  if (!skipBuild) {
    await prepareKitSources(mockupsDir, kitSources);
    await build();
  }
  const targets = files.length > 0 ? files : await htmlFilesUnder(mockupsDir);
  const cssPath = join(kitOutput, 'mockup-kit.css');
  for (const target of targets) {
    const changed = await inlineKitIntoFile(target, cssPath);
    log(`mockup-kit: ${changed ? 'updated' : 'unchanged'} ${target}`);
  }
  if (targets.length === 0) log('mockup-kit: no mockups in design/mockups/');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
