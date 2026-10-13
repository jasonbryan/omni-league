// Checks of netlify.toml's build commands (#60, #97). Run with `npm run test:scripts` (node:test).
// Node built-ins only: each context's `command` is read with a regular expression, not a TOML parser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const toml = readFileSync(join(import.meta.dirname, '..', 'netlify.toml'), 'utf8');

/** The `command` of `[context.<name>]`, or undefined when the table or its command is missing. */
function command(context) {
  const table = new RegExp(
    `^\\[context\\.${context}\\]\\s*$([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`,
    'm',
  );
  const body = table.exec(toml)?.[1] ?? '';
  return /^\s*command\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/m.exec(body)?.[1];
}

/**
 * What each context passes to `npx convex deploy`: the TOML-escaped quoted preview name and the
 * flag. PR previews use `--preview-create` (a fresh backend per push); staging uses
 * `--preview-name`, which reuses the `main` deployment and its data (#222).
 */
const PREVIEW = {
  'deploy-preview': { name: String.raw`\"pr-$REVIEW_ID\"`, flag: '--preview-create' },
  'branch-deploy': { name: String.raw`\"$HEAD\"`, flag: '--preview-name' },
};

// The app registers the service worker only when `scripts/ng-convex.mjs` passes
// `__SERVICE_WORKER__=true` (#81, PR #119); a plain `ng build` keeps angular.json's `false`, so a
// deploy built that way would ship the worker but never register it, and skip sw-config-check.
describe('netlify.toml builds through npm run build (#81)', () => {
  for (const context of ['deploy-preview', 'branch-deploy', 'production']) {
    it(`${context} builds with npm run build and never with ng build`, () => {
      const cmd = command(context);
      assert.ok(cmd, `[context.${context}] has a command`);
      assert.match(cmd, /--cmd 'npm run build'/);
      assert.doesNotMatch(cmd, /\bng build\b/);
    });
  }
});

describe('netlify.toml demo seed (#97)', () => {
  for (const [context, { name, flag }] of Object.entries(PREVIEW)) {
    it(`${context} runs seed:demo on its preview after the deploy and the environment check`, () => {
      const cmd = command(context);
      assert.ok(cmd, `[context.${context}] has a command`);
      const steps = cmd.split(' && ');
      const deploy = steps.findIndex((step) => step.startsWith('npx convex deploy '));
      const check = steps.indexOf(
        `node scripts/check-deploy-env.mjs preview --preview-name ${name}`,
      );
      const seed = steps.indexOf(`npx convex run seed:demo --preview-name ${name}`);
      assert.ok(deploy >= 0, '`npx convex deploy` is a step');
      assert.ok(
        steps[deploy].includes(`${flag} ${name}`),
        `the deploy targets the preview ${name} with ${flag}`,
      );
      assert.ok(check > deploy, 'the environment check runs after the deploy');
      assert.ok(seed > check, 'seed:demo runs after the environment check, on the same preview');
      assert.equal(cmd.match(/seed:demo/g)?.length, 1);
    });
  }

  it('only deploy previews recreate their backend; staging reuses it and its data (#222)', () => {
    const recreating = Object.keys(PREVIEW).filter((context) =>
      /--preview-create\b/.test(command(context) ?? ''),
    );
    assert.deepEqual(recreating, ['deploy-preview']);
    assert.doesNotMatch(command('production') ?? '', /--preview-(create|name)/);
  });

  it('no context passes --preview-run (it seeds only a newly created preview)', () => {
    const lines = toml
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#') && /--preview-run/.test(line));
    assert.deepEqual(lines, []);
  });

  it('production never seeds and never runs a function', () => {
    const cmd = command('production');
    assert.ok(cmd, '[context.production] has a command');
    assert.doesNotMatch(cmd, /seed:/);
    assert.doesNotMatch(cmd, /convex run/);
  });

  it('no other line of netlify.toml names the seed outside a comment', () => {
    const lines = toml
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#') && /seed:|convex run/.test(line));
    assert.equal(lines.length, 2);
  });
});

// Static files added for installing the app (#80). Only content-hashed build outputs may be
// cached for a year; the manifest and the icons keep Netlify's default `max-age=0,
// must-revalidate`, so a changed icon or name reaches users on the next load.

/** The `[[headers]]` tables as `{ for, values }`, read with regular expressions. */
function headerRules() {
  return [...toml.matchAll(/^\[\[headers\]\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/gm)].map(
    ([, body]) => ({
      for: /^\s*for\s*=\s*"([^"]*)"/m.exec(body)?.[1],
      values: Object.fromEntries(
        [...body.matchAll(/^\s+([A-Za-z-]+)\s*=\s*"([^"]*)"\s*$/gm)]
          .filter((m) => m[1] !== 'for')
          .map((m) => [m[1], m[2]]),
      ),
    }),
  );
}

/** True when a Netlify `for` pattern (`*` matches anything, including `/`) matches `path`. */
function matches(pattern, path) {
  const source = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${source}$`).test(path);
}

describe('netlify.toml install files (#80)', () => {
  const rules = headerRules();

  it('serves the manifest as application/manifest+json', () => {
    const rule = rules.find((r) => r.for === '/manifest.webmanifest');
    assert.equal(rule?.values['Content-Type'], 'application/manifest+json');
  });

  for (const path of [
    '/manifest.webmanifest',
    '/favicon.ico',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-maskable-512.png',
    '/icons/apple-touch-icon.png',
  ]) {
    it(`${path} is not cached for longer than a revalidation`, () => {
      const cached = rules.filter(
        (r) =>
          r.for &&
          matches(r.for, path) &&
          /immutable|max-age=[1-9]/.test(r.values['Cache-Control'] ?? ''),
      );
      assert.deepEqual(cached, []);
    });
  }
});
