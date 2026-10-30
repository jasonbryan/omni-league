import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const OVERLAY_HOST =
  /<brn-(?:alert-dialog|dialog|sheet)[\s>]|\bextends Brn(?:AlertDialog|Dialog|Sheet)\b/;
const PROVIDES_OVERLAY = /\bprovideSpartanOverlay\(\)/;

/**
 * @param {string} text
 * @returns {boolean}
 */
function missesOverlayDefault(text) {
  return OVERLAY_HOST.test(text) && !PROVIDES_OVERLAY.test(text);
}

async function appSources() {
  const entries = await readdir(join(root, 'src', 'app'), { recursive: true });
  return entries
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))
    .map((entry) => join(root, 'src', 'app', entry));
}

describe('overlay hosts', () => {
  it('flags a brain dialog, alert dialog, or sheet host without provideSpartanOverlay()', () => {
    assert.equal(missesOverlayDefault('template: `<brn-alert-dialog [state]="s">`'), true);
    assert.equal(missesOverlayDefault('export class HlmSheet extends BrnSheet {}'), true);
    assert.equal(
      missesOverlayDefault('providers: [provideSpartanOverlay()], template: `<brn-alert-dialog>`'),
      false,
    );
    assert.equal(missesOverlayDefault('template: `<hlm-sheet>`'), false);
  });

  it('every host in src/app provides the overlay default, so its overlay stays out of the popover top layer', async () => {
    const missing = [];
    for (const file of await appSources()) {
      if (missesOverlayDefault(await readFile(file, 'utf8'))) missing.push(relative(root, file));
    }
    assert.deepEqual(missing, []);
  });
});
