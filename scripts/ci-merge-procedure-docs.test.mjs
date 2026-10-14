import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = join(import.meta.dirname, '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

/**
 * The text from a heading to the next heading of the same or a higher level.
 * @param {string} markdown
 * @param {string} heading the heading line without the leading hashes
 */
function section(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.findIndex(
    (line) => /^#+ /.test(line) && line.replace(/^#+ /, '') === heading,
  );
  assert.ok(start !== -1, `heading not found: ${heading}`);
  const level = /^#+/.exec(lines[start])[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const match = /^(#+) /.exec(lines[i]);
    if (match && match[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

const devCycle = read('docs/process/dev-cycle.md');
const ci = read('docs/process/ci.md');
const skill = read('.claude/skills/dev-cycle/SKILL.md');
const adr = read('docs/decisions/0009-ci-pipeline.md');
const glossary = read('docs/glossary.md');

describe('the merge procedure, as written in every place that states it', () => {
  const merge = section(devCycle, '7. Merge');
  const procedure = section(ci, 'Merge procedure');
  const skillStep = skill.split('\n').find((line) => line.startsWith('7. **Merge.**')) ?? '';

  it('tells the orchestrator to update while draft, mark ready, label, wait for ci, then merge by SHA', () => {
    for (const [name, text] of [
      ['dev-cycle.md Phase 7', merge],
      ['ci.md Merge procedure', procedure],
    ]) {
      const order = [
        'gh pr update-branch',
        'gh pr ready <n>`',
        '--add-label ready-to-merge',
        'gh pr checks',
        '--match-head-commit',
      ].map((needle) => text.indexOf(needle));
      assert.ok(
        order.every((index) => index !== -1),
        `${name}: ${order.join()}`,
      );
      assert.deepEqual(
        order,
        [...order].sort((a, b) => a - b),
        name,
      );
    }
    for (const needle of [
      'update the branch from `main` while still draft',
      '`gh pr ready <n>`',
      '--add-label ready-to-merge',
      'gh pr checks <n> --watch',
      '--match-head-commit',
    ]) {
      assert.ok(skillStep.includes(needle), `SKILL.md step 7 lacks: ${needle}`);
    }
  });

  it('says that marking ready runs nothing', () => {
    assert.match(merge, /`gh pr ready <n>` runs nothing/);
    assert.match(procedure, /`gh pr ready <n>`\. This runs nothing/);
    assert.match(skillStep, /`gh pr ready <n>` \(runs nothing\)/);
  });

  it('gives Dependabot PRs the label too', () => {
    assert.match(merge, /Dependabot PRs open ready[^.]*get the same label/);
    assert.match(section(ci, 'Merge procedure'), /get `ready-to-merge` like any PR/);
    assert.match(skillStep, /Dependabot PRs get the label too/);
  });

  it('removes the label and converts to draft when ci fails or main moves', () => {
    for (const [name, text] of [
      ['dev-cycle.md', merge],
      ['ci.md', procedure],
    ]) {
      assert.match(text, /--remove-label ready-to-merge/, name);
      assert.match(text, /gh pr ready <n> --undo/, name);
    }
    assert.match(skillStep, /remove the label, run `gh pr ready <n> --undo`/);
  });

  it('removes and re-adds the label after a cancelled ci or a stale merge ref', () => {
    for (const [name, text] of [
      ['dev-cycle.md', merge],
      ['ci.md', procedure],
      ['SKILL.md', skillStep],
    ]) {
      assert.match(text, /cancelled/, name);
      assert.match(text, /stale merge ref/, name);
      assert.match(text, /remove the label[^.]*and add it again/, name);
    }
  });
});

describe('the local checks as the per-push check', () => {
  const implementer = read('.claude/agents/implementer.md');
  const tester = read('.claude/agents/tester.md');

  it('requires npm run e2e:affected before reporting, with its output in Evidence', () => {
    const implement = section(devCycle, '4. Implement');
    const test = section(devCycle, '5. Test');
    assert.match(implement, /`npm run e2e:affected` before reporting[^.]*Evidence block/);
    assert.match(test, /`npm run e2e:affected` before reporting[^.]*Evidence block/);
    assert.match(implementer, /`npm run e2e:affected`[^.]*Evidence block/);
    assert.match(tester, /`npm run e2e:affected` before reporting[^.]*Evidence block/);
  });

  it('keeps the line that CI does not run on drafts and names the local checks as the per-push check', () => {
    assert.match(
      section(devCycle, '4. Implement'),
      /CI does not run on drafts[\s\S]{0,80}local checks plus the affected e2e specs are the per-push check/,
    );
    assert.match(
      implementer,
      /CI does not run on drafts, so the local checks and `npm run e2e:affected` are the per-push check/,
    );
  });
});

describe('the label and the vocabulary', () => {
  it('creates the ready-to-merge label in the setup script', () => {
    assert.match(read('scripts/setup-github.sh'), /^label "ready-to-merge" "[0-9a-f]{6}" ".+"$/m);
  });

  it('lists the label in the dev cycle and defines it in the glossary', () => {
    assert.match(section(devCycle, 'Labels'), /\*\*Merge:\*\* `ready-to-merge`/);
    assert.match(glossary, /^- \*\*`ready-to-merge`:\*\* /m);
  });

  it('explains the check name by event in the glossary, the required check, and the run table', () => {
    assert.match(
      glossary,
      /^- \*\*CI \(the `ci` check\):\*\*.*named `ci` when it runs the full suite/m,
    );
    assert.match(section(ci, 'Required check'), /`checks` is not required either/);
    assert.match(
      section(ci, 'What runs when'),
      /`ready_for_review` \(`gh pr ready`\)[^\n]*not a trigger/,
    );
  });

  it('keeps the owner settings checklist on the label and an unchanged ruleset', () => {
    const checklist = section(ci, 'Owner settings checklist');
    assert.match(checklist, /The `ready-to-merge` label exists/);
    assert.match(checklist, /keeps `ci` required and strict/);
  });
});

describe('the ADR amendment', () => {
  const amendment = section(
    adr,
    'Amendment: fast checks on every push, e2e once at merge, nightly once per commit (2026-10-14)',
  );

  it('quotes the owner decision', () => {
    assert.ok(amendment.includes('> "B and wait for Nov 1"'));
  });

  it('says drafts stay free and the local checks plus affected e2e are the per-push check', () => {
    assert.match(amendment, /\*\*Per-push check\.\*\* A draft push costs no minutes/);
    assert.match(amendment, /`npm run e2e:affected`/);
  });

  it('compares the label with draft-to-ready and with a merge queue', () => {
    assert.match(amendment, /\*\*The label, compared\.\*\*/);
    assert.match(amendment, /Draft to ready \(`ready_for_review`\)/);
    assert.match(amendment, /merge queue/i);
  });

  it('replaces the sentence that a night after a failed night runs again', () => {
    const quiet = section(
      adr,
      'Amendment: affected e2e specs on PRs, full suite nightly (2026-10-12)',
    );
    assert.doesNotMatch(quiet, /A night after a failed night runs again/);
    assert.match(quiet, /Replaced on 2026-10-14/);
  });

  it('gives the minutes estimate and links the amendment from the status list', () => {
    assert.match(amendment, /\*\*Minutes\.\*\* A fast run is about 5 billed minutes/);
    assert.match(adr, /^- \*\*Amended:\*\* 2026-10-14 \(#302\)/m);
  });
});
