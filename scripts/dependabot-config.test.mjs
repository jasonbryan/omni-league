import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const dependabot = readFileSync(join(root, '.github', 'dependabot.yml'), 'utf8');
const ciDoc = readFileSync(join(root, 'docs', 'process', 'ci.md'), 'utf8');

const PUSH_PACKAGE = '@block65/webcrypto-web-push';

/** The lines of one Dependabot group, from its name to the next sibling key. No YAML package is allowed. */
function groupBlock(name) {
  const lines = dependabot.split('\n');
  const start = lines.findIndex((line) => line.trim() === `${name}:`);
  assert.notEqual(start, -1, `${name} group exists`);
  const indent = lines[start].search(/\S/);
  const end = lines.findIndex((line, i) => i > start && line.trim() && line.search(/\S/) <= indent);
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

describe('Dependabot keeps the Web Push package out of grouped updates', () => {
  it('npm-minor-patch excludes the package, so a version change gets its own PR', () => {
    assert.match(
      groupBlock('npm-minor-patch'),
      /^\s*exclude-patterns:\s*\[\s*['"]?@block65\/webcrypto-web-push['"]?\s*\]\s*$/m,
    );
  });

  it('the exclusion sits in the npm group, not the github-actions one', () => {
    assert.doesNotMatch(groupBlock('actions-minor-patch'), /exclude-patterns/);
  });

  it('the CI doc requires an npm diff and a provenance check for a version change of either package', () => {
    const rule = /\*\*Web Push packages\*\*[^\n]*/.exec(ciDoc)?.[0] ?? '';
    for (const needle of [
      PUSH_PACKAGE,
      'uint8array-extras',
      'npm diff',
      'provenance',
      'gate:technology',
    ]) {
      assert.ok(rule.includes(needle), `the rule names ${needle}`);
    }
  });
});
