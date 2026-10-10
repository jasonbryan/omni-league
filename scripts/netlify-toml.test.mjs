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

/** The TOML-escaped quoted name a context passes to `--preview-create`. */
const PREVIEW_NAME = {
  'deploy-preview': String.raw`\"pr-$REVIEW_ID\"`,
  'branch-deploy': String.raw`\"$HEAD\"`,
};

describe('netlify.toml demo seed (#97)', () => {
  for (const [context, name] of Object.entries(PREVIEW_NAME)) {
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
        steps[deploy].includes(`--preview-create ${name}`),
        `the deploy creates the preview ${name}`,
      );
      assert.ok(check > deploy, 'the environment check runs after the deploy');
      assert.ok(seed > check, 'seed:demo runs after the environment check, on the same preview');
      assert.equal(cmd.match(/seed:demo/g)?.length, 1);
    });
  }

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
