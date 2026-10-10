// Checks that the committed app icons match their SVG sources and the approved mockup (#80).
// Run with `npm run test:scripts` (node:test). Node built-ins only, no browser needed except for
// the re-render check, which skips itself where Chromium is not installed.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
  FAVICON,
  ICONS,
  MOCKUP,
  SOURCES,
  SOURCE_HASH_KEYWORD,
  mockupMasters,
  renderIcons,
} from './build-icons.mjs';
import { decodePng, pngHeader, readIco, sha256, textChunks } from './png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDIGO = [0x4f, 0x46, 0xe5];
const WHITE = [255, 255, 255];

const read = (path) => readFile(join(root, path));

/** The RGBA of the pixel at fractions (fx, fy) of the image. */
function pixelAt({ width, height, rgba }, fx, fy) {
  const x = Math.min(width - 1, Math.floor(fx * width));
  const y = Math.min(height - 1, Math.floor(fy * height));
  const at = (y * width + x) * 4;
  return [...rgba.subarray(at, at + 4)];
}

/** True when the pixel's colour is within `tolerance` (sum of channel differences) of `color`. */
function isColor([r, g, b, a], color, tolerance = 24) {
  return (
    a === 255 &&
    Math.abs(r - color[0]) + Math.abs(g - color[1]) + Math.abs(b - color[2]) <= tolerance
  );
}

describe('SVG sources', () => {
  it('are the SVG masters of the approved mockup, byte for byte', async () => {
    const masters = mockupMasters(await readFile(join(root, MOCKUP), 'utf8'));
    assert.deepEqual(Object.keys(masters).sort(), Object.keys(SOURCES).sort());
    for (const [name, path] of Object.entries(SOURCES)) {
      assert.equal((await read(path)).toString('utf8'), masters[name] + '\n', path);
    }
  });
});

describe('committed icon files', () => {
  for (const icon of ICONS) {
    describe(icon.path, () => {
      it('is a PNG of the declared pixel size', async () => {
        const header = pngHeader(await read(icon.path));
        assert.equal(header.width, icon.size);
        assert.equal(header.height, icon.size);
      });

      it('records the hash of the SVG it was exported from (re-run `npm run icons` after editing it)', async () => {
        const text = textChunks(await read(icon.path));
        assert.equal(text[SOURCE_HASH_KEYWORD], sha256(await read(SOURCES[icon.source])));
      });

      it('has the art in the right place', async () => {
        const image = decodePng(await read(icon.path));
        // Trophy cup and base are white, the background around the top edge is indigo.
        assert.ok(isColor(pixelAt(image, 0.5, 0.39), WHITE), 'cup');
        assert.ok(isColor(pixelAt(image, 0.5, icon.maskable ? 0.676 : 0.713), WHITE), 'base');
        assert.ok(isColor(pixelAt(image, 0.5, 0.05), INDIGO), 'background');
        const corner = pixelAt(image, 0, 0);
        if (icon.rounded) {
          assert.equal(corner[3], 0, 'the rounded corner is transparent');
        } else {
          assert.ok(isColor(corner, INDIGO), 'the corner is opaque indigo');
        }
      });
    });
  }

  it('the maskable icon keeps every white pixel inside the 80% circle safe zone', async () => {
    const icon = ICONS.find(({ maskable }) => maskable);
    assert.ok(icon);
    const { width, height, rgba } = decodePng(await read(icon.path));
    const radius = 0.4 * width;
    let outside = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        // Anything lighter than the mid-point between indigo and white counts as trophy.
        const white = rgba[at] > 167 && rgba[at + 1] > 162;
        const distance = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2);
        if (white && distance > radius) outside++;
      }
    }
    assert.equal(outside, 0);
  });

  it('the apple-touch icon is opaque, because iOS fills transparency with black', async () => {
    const { rgba } = decodePng(await read('public/icons/apple-touch-icon.png'));
    for (let i = 3; i < rgba.length; i += 4) assert.equal(rgba[i], 255);
  });
});

describe('public/favicon.ico', () => {
  it('holds the favicon art at 16, 32, and 48 pixels', async () => {
    const images = readIco(await read(FAVICON.path));
    assert.deepEqual(
      images.map(({ width, height }) => [width, height]),
      FAVICON.sizes.map((size) => [size, size]),
    );
    const sourceHash = sha256(await read(SOURCES.favicon));
    for (const { png, width } of images) {
      assert.equal(textChunks(png)[SOURCE_HASH_KEYWORD], sourceHash, `${width}px source hash`);
      const image = decodePng(png);
      assert.equal(pixelAt(image, 0, 0)[3], 0, `${width}px rounded corner is transparent`);
      assert.ok(isColor(pixelAt(image, 0.5, 0.5), WHITE), `${width}px centre is white`);
      assert.ok(isColor(pixelAt(image, 0.5, 0.02), INDIGO, 80), `${width}px top edge is indigo`);
    }
  });
});

describe('re-rendering the SVG sources', () => {
  it('reproduces the committed files within anti-aliasing noise', async (t) => {
    // Needs Chromium (`npx playwright install --only-shell chromium`); skips where it is missing.
    try {
      await (await chromium.launch()).close();
    } catch {
      t.skip('Chromium is not installed');
      return;
    }
    const rendered = await renderIcons();
    assert.deepEqual(
      rendered.map(({ path }) => path),
      [...ICONS.map(({ path }) => path), FAVICON.path],
    );
    for (const { path, images } of rendered) {
      const committed = await read(path);
      const pairs = path.endsWith('.ico')
        ? readIco(committed).map(({ png }, i) => [decodePng(png), decodePng(images[i])])
        : [[decodePng(committed), decodePng(images[0])]];
      for (const [a, b] of pairs) {
        assert.equal(a.width, b.width, path);
        let total = 0;
        for (let i = 0; i < a.rgba.length; i++) total += Math.abs(a.rgba[i] - b.rgba[i]);
        assert.ok(total / a.rgba.length < 2, `${path}: mean channel difference`);
      }
    }
  });
});
