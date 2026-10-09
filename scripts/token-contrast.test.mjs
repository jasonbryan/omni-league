// Unit tests for scripts/token-contrast.mjs (#58). Run with `npm run test:scripts` (node:test).
// The failing fixture is a test input: the test passes when the checker reports its bad pairs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  PAIRS,
  checkTokens,
  contrastRatio,
  formatResult,
  parseColor,
  parseRootTokens,
} from './token-contrast.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tokensCss = () => readFile(join(here, '..', 'src', 'styles', 'tokens.css'), 'utf8');
const failingCss = () =>
  readFile(join(here, 'fixtures', 'token-contrast', 'failing-tokens.css'), 'utf8');

/** Each channel within 2/255 of the expected 8-bit sRGB value. */
function assertRgb(color, [r, g, b]) {
  const actual = [color.r, color.g, color.b].map((v) => v * 255);
  [r, g, b].forEach((expected, i) => {
    assert.ok(Math.abs(actual[i] - expected) <= 2, `channel ${i}: ${actual[i]} vs ${expected}`);
  });
}

describe('parseColor', () => {
  it('reads 6-digit and 3-digit hex', () => {
    assertRgb(parseColor('#ffffff'), [255, 255, 255]);
    assertRgb(parseColor('#1a2b3c'), [0x1a, 0x2b, 0x3c]);
    assertRgb(parseColor('#fa0'), [255, 170, 0]);
  });

  it('reads oklch() and converts it to sRGB (spartan presets)', () => {
    assertRgb(parseColor('oklch(1 0 0)'), [255, 255, 255]);
    assertRgb(parseColor('oklch(0 0 0)'), [0, 0, 0]);
    assertRgb(parseColor('oklch(0.205 0 0)'), [0x17, 0x17, 0x17]);
    assertRgb(parseColor('oklch(0.985 0 0)'), [0xfa, 0xfa, 0xfa]);
    assertRgb(parseColor('oklch(0.577 0.245 27.325)'), [0xe7, 0x00, 0x0b]);
  });

  it('accepts a percentage lightness and a hue unit', () => {
    assertRgb(parseColor('oklch(20.5% 0 0)'), [0x17, 0x17, 0x17]);
    assertRgb(parseColor('oklch(0.577 0.245 27.325deg)'), [0xe7, 0x00, 0x0b]);
  });

  it('rejects a colour it cannot turn into a contrast ratio', () => {
    assert.throws(() => parseColor('oklch(0.5 0 0 / 0.5)'), /alpha/i);
    assert.throws(() => parseColor('rebeccapurple'), /rebeccapurple/);
    assert.throws(() => parseColor('var(--x)'), /var\(--x\)/);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white and 1:1 for a colour on itself', () => {
    const white = parseColor('#fff');
    const black = parseColor('#000');
    assert.ok(Math.abs(contrastRatio(black, white) - 21) < 0.001);
    assert.ok(Math.abs(contrastRatio(white, white) - 1) < 0.001);
  });

  it('matches the WCAG value for #767676 on white (4.54:1)', () => {
    const ratio = contrastRatio(parseColor('#767676'), parseColor('#ffffff'));
    assert.ok(Math.abs(ratio - 4.54) < 0.01, String(ratio));
  });
});

describe('parseRootTokens', () => {
  it('reads custom properties from :root only', async () => {
    const tokens = parseRootTokens(await failingCss());
    assert.equal(tokens.get('--background'), '#ffffff');
    assert.equal(tokens.get('--foreground'), 'oklch(0.145 0 0)');
  });
});

describe('PAIRS', () => {
  it('lists the pairs from the issue with their WCAG thresholds', () => {
    const names = PAIRS.map(({ fg, bg, min }) => `${fg} on ${bg} ${min}`);
    assert.deepEqual(names, [
      '--foreground on --background 4.5',
      '--card-foreground on --card 4.5',
      '--popover-foreground on --popover 4.5',
      '--primary-foreground on --primary 4.5',
      '--secondary-foreground on --secondary 4.5',
      '--accent-foreground on --accent 4.5',
      '--destructive-foreground on --destructive 4.5',
      '--muted-foreground on --background 4.5',
      '--muted-foreground on --muted 4.5',
      '--ring on --background 3',
      '--input on --background 3',
      '--primary on --background 3',
      '--sidebar-foreground on --sidebar 4.5',
      '--sidebar-primary-foreground on --sidebar-primary 4.5',
      '--sidebar-accent-foreground on --sidebar-accent 4.5',
      '--sidebar-ring on --sidebar 3',
    ]);
  });

  it('does not check --border (decorative separators, WCAG 1.4.11 does not cover them)', () => {
    assert.ok(!PAIRS.some(({ fg, bg }) => fg === '--border' || bg === '--border'));
  });
});

describe('checkTokens on src/styles/tokens.css', () => {
  it('meets the ratio of every listed pair', async () => {
    const { results, problems } = checkTokens(await tokensCss());
    assert.deepEqual(problems, []);
    const failed = results.filter((r) => !r.ok).map(formatResult);
    assert.deepEqual(failed, []);
    assert.ok(results.length >= 15, 'the pairs were actually checked');
  });
});

describe('checkTokens on the failing fixture', () => {
  it('reports exactly the bad pairs, by name, with the ratio and the threshold', async () => {
    const { results } = checkTokens(await failingCss());
    const failed = results.filter((r) => !r.ok);
    assert.deepEqual(
      failed.map((r) => `${r.fg} on ${r.bg}`),
      [
        '--muted-foreground on --background',
        '--muted-foreground on --muted',
        '--input on --background',
      ],
    );
    for (const result of failed) {
      assert.match(formatResult(result), new RegExp(`^FAIL ${result.fg} on ${result.bg}: `));
      assert.match(formatResult(result), /\d+\.\d\d:1 \(needs (4\.5|3):1\)/);
    }
  });

  it('skips --destructive-foreground when the token set does not define it', async () => {
    const css = (await failingCss()).replace(/--destructive-foreground:[^;]*;/, '');
    const { results, problems } = checkTokens(css);
    assert.deepEqual(problems, []);
    assert.ok(!results.some((r) => r.fg === '--destructive-foreground'));
  });
});

describe('checkTokens problems', () => {
  it('reports a missing required token', () => {
    const { problems } = checkTokens(':root { --foreground: #000; }');
    assert.ok(problems.some((p) => p.includes('--background')));
  });

  it('reports a value it cannot parse, naming the token', async () => {
    const css = (await failingCss()).replace('--ring: oklch(0.5 0 0)', '--ring: var(--other)');
    const { problems } = checkTokens(css);
    assert.ok(problems.some((p) => p.includes('--ring') && p.includes('var(--other)')));
  });
});
