// Checks of netlify.toml's build commands (#60). Run with `npm run test:scripts` (node:test).
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

describe('netlify.toml demo seed (#60)', () => {
  for (const context of ['deploy-preview', 'branch-deploy']) {
    it(`${context} runs seed:demo after the Convex deploy, before the environment check`, () => {
      const cmd = command(context);
      assert.ok(cmd, `[context.${context}] has a command`);
      const deploy = cmd.indexOf('npx convex deploy');
      const seed = cmd.indexOf('--preview-run seed:demo');
      const check = cmd.indexOf('node scripts/check-deploy-env.mjs preview');
      assert.ok(deploy >= 0 && seed > deploy, 'seed:demo is a flag of `npx convex deploy`');
      assert.ok(check > seed, 'the environment check still runs after the deploy');
      assert.equal(cmd.match(/--preview-run/g)?.length, 1);
    });
  }

  it('production never passes --preview-run', () => {
    const cmd = command('production');
    assert.ok(cmd, '[context.production] has a command');
    assert.doesNotMatch(cmd, /--preview-run/);
    assert.doesNotMatch(cmd, /seed:/);
  });

  it('no other line of netlify.toml names the seed outside a comment', () => {
    const lines = toml
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#') && /seed:demo|--preview-run/.test(line));
    assert.equal(lines.length, 2);
  });
});
