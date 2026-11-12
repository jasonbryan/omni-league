import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { format, resolveConfig } from 'prettier';

const root = join(import.meta.dirname, '..');
const conventionsFile = 'docs/conventions/angular.md';
const componentMapRow = /^\| Popover /;
const widerThanAnyCell = 'longer than the widest cell '.repeat(30);

const proseWrapOf = async (path) => (await resolveConfig(join(root, path))).proseWrap;

const differingLines = (before, after) => {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  assert.equal(afterLines.length, beforeLines.length, 'line count changed');
  return afterLines.filter((line, index) => line !== beforeLines[index]);
};

describe('the Prettier markdown config', () => {
  it('resolves proseWrap to never for the convention docs', async () => {
    assert.equal(await proseWrapOf(conventionsFile), 'never');
  });

  it('keeps preserve for every other markdown file', async () => {
    for (const path of [
      'docs/decisions/0002-lint-and-format.md',
      'docs/process/dev-cycle.md',
      'README.md',
      'AGENTS.md',
    ]) {
      assert.equal(await proseWrapOf(path), 'preserve', path);
    }
  });

  it('changes one line when one component map cell is lengthened', async () => {
    const options = { ...(await resolveConfig(join(root, conventionsFile))), parser: 'markdown' };
    const source = readFileSync(join(root, conventionsFile), 'utf8');
    const edited = source
      .split('\n')
      .map((line) =>
        componentMapRow.test(line) ? line.replace(/ \|$/, ` ${widerThanAnyCell} |`) : line,
      )
      .join('\n');
    assert.notEqual(edited, source, 'component map row not found');
    const formattedSource = await format(source, options);
    const formattedEdit = await format(edited, options);
    assert.equal(formattedSource, source, 'angular.md is not formatted');
    assert.equal(differingLines(formattedSource, formattedEdit).length, 1);
  });
});
