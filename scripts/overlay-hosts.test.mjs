import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const rootDirectiveUse = (...names) => {
  const kebab = names.map((name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
  const pascal = names.map((name) => name[0].toUpperCase() + name.slice(1));
  return new RegExp(
    [
      `<brn-(?:${kebab.join('|')})[\\s>/]`,
      `[\\s\\[]brn(?:${pascal.join('|')})(?=[\\s=\\]>/])`,
      `\\bextends Brn(?:${pascal.join('|')})\\b`,
      `\\bdirective:\\s*Brn(?:${pascal.join('|')})\\b`,
    ].join('|'),
  );
};

const directInject = (service) => `\\binject\\(${service}\\)`;
const either = (...sources) => new RegExp(sources.join('|'));

const KINDS = [
  {
    kind: 'dialog',
    host: either(
      rootDirectiveUse('dialog', 'alertDialog', 'sheet', 'drawer').source,
      directInject('BrnDialogService'),
    ),
    openers: ['Dialog', 'BrnDialogService'],
  },
  {
    kind: 'popover',
    host: either(
      rootDirectiveUse('popover', 'overlay', 'select', 'combobox', 'autocomplete').source,
      directInject('BrnOverlayService'),
    ),
    openers: ['BrnOverlayService'],
  },
  { kind: 'CDK dialog', host: either(directInject('Dialog')), openers: ['Dialog'] },
  {
    kind: 'CDK overlay',
    host: either(
      rootDirectiveUse('tooltip', 'hoverCard', 'navigationMenu').source,
      '\\bcdk(?:MenuTriggerFor|ConnectedOverlay|ContextMenuTriggerFor)\\b',
      directInject('Overlay'),
    ),
    openers: [],
  },
];

/**
 * @param {string} text
 * @returns {string[]}
 */
function overlayDefaultProblems(text) {
  const call = text.match(/\bprovideSpartanOverlay\(([^)]*)\)/);
  const passed = new Set((call?.[1] ?? '').split(',').map((name) => name.trim()));
  return KINDS.filter(({ host }) => host.test(text))
    .filter(({ openers }) => !call || openers.some((name) => !passed.has(name)))
    .map(
      ({ kind, openers }) => `${kind} host without provideSpartanOverlay(${openers.join(', ')})`,
    );
}

async function appSources() {
  const entries = await readdir(join(root, 'src', 'app'), { recursive: true });
  return entries
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.spec.ts'))
    .map((entry) => join(root, 'src', 'app', entry));
}

describe('overlay hosts', () => {
  it('names the kind of host and the call it lacks', () => {
    assert.deepEqual(overlayDefaultProblems('template: `<brn-alert-dialog [state]="s">`'), [
      'dialog host without provideSpartanOverlay(Dialog, BrnDialogService)',
    ]);
    assert.deepEqual(overlayDefaultProblems('export class HlmSheet extends BrnSheet {}'), [
      'dialog host without provideSpartanOverlay(Dialog, BrnDialogService)',
    ]);
    assert.deepEqual(overlayDefaultProblems('hostDirectives: [{ directive: BrnPopover }]'), [
      'popover host without provideSpartanOverlay(BrnOverlayService)',
    ]);
    assert.deepEqual(
      overlayDefaultProblems('providers: [provideSpartanOverlay()], template: `<div brnSelect>`'),
      ['popover host without provideSpartanOverlay(BrnOverlayService)'],
    );
    assert.deepEqual(overlayDefaultProblems('template: `<button brnTooltip="Tip">`'), [
      'CDK overlay host without provideSpartanOverlay()',
    ]);
    assert.deepEqual(overlayDefaultProblems('readonly overlay = inject(Overlay);'), [
      'CDK overlay host without provideSpartanOverlay()',
    ]);
    assert.deepEqual(
      overlayDefaultProblems('providers: [provideSpartanOverlay()], dialog = inject(Dialog);'),
      ['CDK dialog host without provideSpartanOverlay(Dialog)'],
    );
    assert.deepEqual(
      overlayDefaultProblems(
        'providers: [provideSpartanOverlay(BrnDialogService)], dialogs = inject(BrnDialogService);',
      ),
      ['dialog host without provideSpartanOverlay(Dialog, BrnDialogService)'],
    );
    assert.deepEqual(
      overlayDefaultProblems(
        'providers: [provideSpartanOverlay()], overlays = inject(BrnOverlayService);',
      ),
      ['popover host without provideSpartanOverlay(BrnOverlayService)'],
    );
  });

  it('passes a host with the call its kind needs, and the parts and wrappers of a host', () => {
    assert.deepEqual(
      overlayDefaultProblems(
        'providers: [provideSpartanOverlay(Dialog, BrnDialogService)], template: `<brn-alert-dialog>`',
      ),
      [],
    );
    assert.deepEqual(
      overlayDefaultProblems(
        'providers: [provideSpartanOverlay(BrnOverlayService)], template: `<brn-popover>`',
      ),
      [],
    );
    assert.deepEqual(
      overlayDefaultProblems(
        'providers: [provideSpartanOverlay()], template: `<button brnTooltip="x">`',
      ),
      [],
    );
    assert.deepEqual(
      overlayDefaultProblems(
        'providers: [provideSpartanOverlay(Dialog)], dialog = inject(Dialog);',
      ),
      [],
    );
    assert.deepEqual(
      overlayDefaultProblems(
        'providers: [provideSpartanOverlay(Dialog, BrnDialogService)], dialogs = inject(BrnDialogService);',
      ),
      [],
    );
    assert.deepEqual(
      overlayDefaultProblems(
        'providers: [provideSpartanOverlay(BrnOverlayService)], overlays = inject(BrnOverlayService);',
      ),
      [],
    );
    assert.deepEqual(
      overlayDefaultProblems(
        'providers: [provideSpartanOverlay(BrnOverlayService)], hostDirectives: [{ directive: BrnPopover }]',
      ),
      [],
    );
    assert.deepEqual(overlayDefaultProblems('template: `<div *brnAlertDialogContent>`'), []);
    assert.deepEqual(
      overlayDefaultProblems('hostDirectives: [{ directive: BrnPopoverContent }]'),
      [],
    );
    assert.deepEqual(
      overlayDefaultProblems('export class HlmSheetClose extends BrnSheetClose {}'),
      [],
    );
    assert.deepEqual(overlayDefaultProblems('template: `<hlm-sheet>`'), []);
  });

  it('every host in src/app provides the overlay default, so its overlay stays out of the popover top layer', async () => {
    const problems = [];
    for (const file of await appSources()) {
      for (const problem of overlayDefaultProblems(await readFile(file, 'utf8'))) {
        problems.push(`${relative(root, file)}: ${problem}`);
      }
    }
    assert.deepEqual(problems, []);
  });
});
