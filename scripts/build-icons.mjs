// The export uses the Chromium that Playwright already installs for the e2e tests, so it adds no
// package. Each PNG carries a `tEXt` chunk with the SHA-256 of the SVG it came from, which
// build-icons.test.mjs compares with the committed SVG: an edited source without a re-run fails
// `npm run test:scripts` on any machine, with no browser.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { chromium } from '@playwright/test';
import { addTextChunk, buildIco, sha256 } from './png.mjs';

const ROOT = join(import.meta.dirname, '..');

export const MOCKUP = 'design/mockups/80-app-icon.html';
export const SOURCE_HASH_KEYWORD = 'Source-SHA256';

export const SOURCES = {
  any: 'design/icons/any.svg',
  maskable: 'design/icons/maskable.svg',
  'apple-touch': 'design/icons/apple-touch.svg',
  favicon: 'design/icons/favicon.svg',
};

const MASTER_HEADINGS = {
  any: 'Any (192, 512)',
  maskable: 'Maskable (512)',
  'apple-touch': 'Apple touch (180)',
  favicon: 'Favicon (16, 32, 48)',
};

export const ICONS = [
  { path: 'public/icons/icon-192.png', source: 'any', size: 192, rounded: true, maskable: false },
  { path: 'public/icons/icon-512.png', source: 'any', size: 512, rounded: true, maskable: false },
  {
    path: 'public/icons/icon-maskable-512.png',
    source: 'maskable',
    size: 512,
    rounded: false,
    maskable: true,
  },
  {
    path: 'public/icons/apple-touch-icon.png',
    source: 'apple-touch',
    size: 180,
    rounded: false,
    maskable: false,
  },
];

export const FAVICON = { path: 'public/favicon.ico', source: 'favicon', sizes: [16, 32, 48] };

const unescapeHtml = (text) =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');

export function mockupMasters(html) {
  const start = html.indexOf('id="masters"');
  if (start < 0) throw new Error('the mockup has no "SVG masters" section');
  const section = html.slice(start);
  const out = {};
  for (const [name, heading] of Object.entries(MASTER_HEADINGS)) {
    const at = section.indexOf(`>${heading}</h3>`);
    const code = at < 0 ? undefined : /<code>([\s\S]*?)<\/code>/.exec(section.slice(at));
    if (!code) throw new Error(`the mockup has no master for "${heading}"`);
    out[name] = unescapeHtml(code[1]);
  }
  return out;
}

async function rasterize(browser, svg, size) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  try {
    await page.setContent(
      `<!doctype html><body style="margin:0;background:transparent">${svg.replace(
        '<svg ',
        `<svg width="${size}" height="${size}" style="display:block" `,
      )}</body>`,
    );
    return await page.screenshot({ omitBackground: true, type: 'png' });
  } finally {
    await page.close();
  }
}

export async function renderIcons() {
  const svgs = {};
  for (const [name, path] of Object.entries(SOURCES)) svgs[name] = await readFile(join(ROOT, path));
  const stamp = (png, source) => addTextChunk(png, SOURCE_HASH_KEYWORD, sha256(svgs[source]));
  const browser = await chromium.launch();
  try {
    const out = [];
    for (const { path, source, size } of ICONS) {
      const png = stamp(await rasterize(browser, svgs[source].toString('utf8'), size), source);
      out.push({ path, file: png, images: [png] });
    }
    const images = [];
    for (const size of FAVICON.sizes) {
      images.push(
        stamp(
          await rasterize(browser, svgs[FAVICON.source].toString('utf8'), size),
          FAVICON.source,
        ),
      );
    }
    out.push({ path: FAVICON.path, file: buildIco(images), images });
    return out;
  } finally {
    await browser.close();
  }
}

export async function buildIcons() {
  const masters = mockupMasters(await readFile(join(ROOT, MOCKUP), 'utf8'));
  for (const [name, path] of Object.entries(SOURCES)) {
    await mkdir(dirname(join(ROOT, path)), { recursive: true });
    await writeFile(join(ROOT, path), masters[name] + '\n');
  }
  for (const { path, file } of await renderIcons()) {
    await mkdir(dirname(join(ROOT, path)), { recursive: true });
    await writeFile(join(ROOT, path), file);
    console.log(`build-icons: wrote ${path}`);
  }
}

if (import.meta.main) await buildIcons();
