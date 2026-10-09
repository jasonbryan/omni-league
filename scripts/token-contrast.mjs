// WCAG contrast check for the design tokens in src/styles/tokens.css (#58). Node built-ins only.
// Run `node scripts/token-contrast.mjs [tokens.css]` for a table; `npm run test:scripts` runs the
// tests in token-contrast.test.mjs.
//
// Colour formats: hex (#rgb, #rrggbb) and oklch() (spartan's presets), converted to sRGB in this
// file. Anything else (named colours, var(), alpha) is reported as a problem, because a contrast
// ratio cannot be computed for it. Only the `:root` block is read; a `.dark` block is ignored until
// the owner approves a dark theme.
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEXT = 4.5; // WCAG 1.4.3, text
const UI = 3; // WCAG 1.4.11, user interface components

/**
 * Pairs the issue requires. `--border` is not listed: it marks decorative separators and card
 * edges, which 1.4.11 does not cover. A control bounded only by `--border` must use `--input`.
 * `optional` pairs are skipped when the foreground token is not defined.
 */
export const PAIRS = [
  { fg: '--foreground', bg: '--background', min: TEXT },
  { fg: '--card-foreground', bg: '--card', min: TEXT },
  { fg: '--popover-foreground', bg: '--popover', min: TEXT },
  { fg: '--primary-foreground', bg: '--primary', min: TEXT },
  { fg: '--secondary-foreground', bg: '--secondary', min: TEXT },
  { fg: '--accent-foreground', bg: '--accent', min: TEXT },
  { fg: '--destructive-foreground', bg: '--destructive', min: TEXT, optional: true },
  { fg: '--muted-foreground', bg: '--background', min: TEXT },
  { fg: '--muted-foreground', bg: '--muted', min: TEXT },
  { fg: '--ring', bg: '--background', min: UI },
  { fg: '--input', bg: '--background', min: UI },
  { fg: '--primary', bg: '--background', min: UI },
];

/** Custom properties declared in `:root` blocks, as a Map of name to the raw value. */
export function parseRootTokens(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = new Map();
  for (const block of withoutComments.matchAll(/(?:^|[}\s]):root\s*\{([^}]*)\}/g)) {
    for (const declaration of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) {
      tokens.set(declaration[1], declaration[2]);
    }
  }
  return tokens;
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const clip = (c) => Math.min(1, Math.max(0, c));

function parseHex(value) {
  const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
  if (!digits) return null;
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join('') : digits;
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255);
  return { r, g, b };
}

function parseOklch(value) {
  const match = /^oklch\(\s*([^\s/)]+)\s+([^\s/)]+)\s+([^\s/)]+)\s*(?:\/\s*([^)]+?)\s*)?\)$/i.exec(
    value,
  );
  if (!match) return null;
  const [, rawL, rawC, rawH, alpha] = match;
  if (alpha !== undefined && !/^(1|1\.0+|100%)$/.test(alpha)) {
    throw new Error(`alpha is not supported in "${value}": contrast depends on what is behind it`);
  }
  const number = (raw, percentScale) => {
    if (raw === 'none') return 0;
    const parsed = Number.parseFloat(raw);
    if (Number.isNaN(parsed)) throw new Error(`cannot read "${raw}" in "${value}"`);
    return raw.endsWith('%') ? (parsed / 100) * percentScale : parsed;
  };
  const L = number(rawL, 1);
  const C = number(rawC, 0.4);
  const hue = number(rawH.replace(/deg$/i, ''), 360);
  const a = C * Math.cos((hue * Math.PI) / 180);
  const b = C * Math.sin((hue * Math.PI) / 180);
  // OKLab to linear sRGB (Björn Ottosson), then clipped to the sRGB gamut.
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const [r, g, bl] = linear.map((c) => toGamma(clip(c)));
  return { r, g, b: bl };
}

/** Parses a hex or oklch() colour into gamma-encoded sRGB channels `{ r, g, b }` in 0..1. */
export function parseColor(value) {
  const text = value.trim();
  const color = parseHex(text) ?? parseOklch(text);
  if (!color) throw new Error(`unsupported colour "${text}" (use hex or oklch())`);
  return color;
}

/** WCAG relative luminance. */
function luminance({ r, g, b }) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio, from 1 to 21. */
export function contrastRatio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Checks every pair in PAIRS against the `:root` tokens of `css`.
 * `results` has one entry per pair that could be computed; `problems` lists missing or unreadable
 * tokens, which also fail the check.
 */
export function checkTokens(css) {
  const tokens = parseRootTokens(css);
  const results = [];
  const problems = [];
  const read = (name) => {
    try {
      return parseColor(tokens.get(name));
    } catch (error) {
      problems.push(`${name}: ${error.message}`);
      return null;
    }
  };
  for (const { fg, bg, min, optional } of PAIRS) {
    if (optional && !tokens.has(fg)) continue;
    const missing = [fg, bg].filter((name) => !tokens.has(name));
    for (const name of missing) {
      const message = `${name} is not defined in :root (needed for ${fg} on ${bg})`;
      if (!problems.includes(message)) problems.push(message);
    }
    if (missing.length > 0) continue;
    const foreground = read(fg);
    const background = read(bg);
    if (!foreground || !background) continue;
    const ratio = contrastRatio(foreground, background);
    results.push({ fg, bg, min, ratio, ok: ratio >= min });
  }
  return { results, problems: [...new Set(problems)] };
}

/** One line per pair: `PASS --a on --b: 12.63:1 (needs 4.5:1)`. */
export function formatResult({ fg, bg, min, ratio, ok }) {
  return `${ok ? 'PASS' : 'FAIL'} ${fg} on ${bg}: ${ratio.toFixed(2)}:1 (needs ${min}:1)`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file =
    process.argv[2] ??
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles', 'tokens.css');
  const { results, problems } = checkTokens(await readFile(file, 'utf8'));
  for (const result of results) console.log(formatResult(result));
  for (const problem of problems) console.log(`FAIL ${problem}`);
  if (problems.length > 0 || results.some((result) => !result.ok)) process.exitCode = 1;
}
