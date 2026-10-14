import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { changedFiles, e2eArgs } from './e2e-affected-local.mjs';
import { ALWAYS } from './e2e-affected.mjs';

const STUB_EXIT_CODE = 7;
const sessionSpecs = () => ['e2e/sign-in.spec.ts'];
const quiet = (task) => {
  const original = console.error;
  console.error = () => {};
  try {
    return task();
  } finally {
    console.error = original;
  }
};

describe('e2eArgs', () => {
  it('selects the specs of the changed files, plus the always-on ones', () => {
    const { args, specs } = e2eArgs(['src/app/invites/accept-invite-page.ts'], [], {
      sessionSpecs,
    });
    assert.deepEqual(args, ['e2e/accept-invite.spec.ts', ...ALWAYS].sort());
    assert.deepEqual(specs, args);
  });

  it('passes extra arguments to Playwright after the selected specs', () => {
    const { args } = e2eArgs(
      ['docs/glossary.md'],
      ['e2e/season-page.spec.ts', '--project=chromium-desktop'],
      {
        sessionSpecs,
      },
    );
    assert.deepEqual(args, [
      ...[...ALWAYS].sort(),
      'e2e/season-page.spec.ts',
      '--project=chromium-desktop',
    ]);
  });

  it('runs the full suite, with the extra arguments only, for a shared file', () => {
    const { args, specs } = e2eArgs(['src/app/shell/shell.ts'], ['--project=chromium-desktop'], {
      sessionSpecs,
    });
    assert.deepEqual(args, ['--project=chromium-desktop']);
    assert.equal(specs, undefined);
  });

  it('keeps every spec in a full run that also names a spec', () => {
    const { args, specs } = e2eArgs(
      ['src/app/shell/shell.ts'],
      ['e2e/season-page.spec.ts', '--project=chromium-desktop'],
      { sessionSpecs },
    );
    assert.deepEqual(args, ['e2e/', 'e2e/season-page.spec.ts', '--project=chromium-desktop']);
    assert.equal(specs, undefined);
  });

  it('runs the full suite when the changed files cannot be listed', () => {
    const { args, specs } = quiet(() =>
      e2eArgs(
        () => {
          throw new Error('no origin/main');
        },
        [],
        { sessionSpecs },
      ),
    );
    assert.deepEqual(args, []);
    assert.equal(specs, undefined);
  });

  it('runs the full suite when nothing changed', () => {
    assert.equal(e2eArgs([], [], { sessionSpecs }).specs, undefined);
  });

  it('expands the session specs for a sign-in page change', () => {
    const { specs } = e2eArgs(['src/app/sign-in/sign-in-page.ts'], [], { sessionSpecs });
    assert.ok(specs?.includes('e2e/sign-in.spec.ts'));
  });
});

describe('changedFiles', () => {
  function repositoryWithOneBranchCommit() {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-affected-local-test-'));
    const git = (...args) =>
      execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        encoding: 'utf8',
      });
    git('init', '-q', '-b', 'main');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'base.ts'), 'a');
    writeFileSync(join(dir, 'tracked.ts'), 'a');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('checkout', '-q', '-b', 'branch');
    writeFileSync(join(dir, 'src', 'committed.ts'), 'a');
    git('add', '.');
    git('commit', '-q', '-m', 'branch');
    return { dir, git };
  }

  it('lists committed, edited, and untracked files against the merge base with origin/main', () => {
    const { dir, git } = repositoryWithOneBranchCommit();
    try {
      writeFileSync(join(dir, 'tracked.ts'), 'edited');
      writeFileSync(join(dir, 'untracked.ts'), 'new');
      writeFileSync(join(dir, '.gitignore'), 'ignored.ts\n');
      writeFileSync(join(dir, 'ignored.ts'), 'x');
      const files = changedFiles((args) => git(...args));
      assert.deepEqual(files, ['.gitignore', 'src/committed.ts', 'tracked.ts', 'untracked.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores commits that landed on main after the branch left it', () => {
    const { dir, git } = repositoryWithOneBranchCommit();
    try {
      git('checkout', '-q', 'main');
      writeFileSync(join(dir, 'src', 'on-main.ts'), 'a');
      git('add', '.');
      git('commit', '-q', '-m', 'main moves on');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      git('checkout', '-q', 'branch');
      assert.deepEqual(
        changedFiles((args) => git(...args)),
        ['src/committed.ts'],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when origin/main does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-affected-local-test-'));
    try {
      const git = (...args) =>
        execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: 'pipe' });
      git('init', '-q', '-b', 'main');
      assert.throws(() => changedFiles((args) => git(...args)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('npm run e2e:affected entry point', () => {
  function projectWithStubE2eRun() {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-affected-entry-test-'));
    const git = (...args) =>
      execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        encoding: 'utf8',
      });
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'e2e'));
    for (const name of ['e2e-affected-local.mjs', 'e2e-affected.mjs']) {
      copyFileSync(join(import.meta.dirname, name), join(dir, 'scripts', name));
    }
    writeFileSync(
      join(dir, 'scripts', 'e2e.mjs'),
      `export async function runE2e(args) { console.log(JSON.stringify(args)); return ${STUB_EXIT_CODE}; }\n`,
    );
    writeFileSync(join(dir, 'README.md'), 'a');
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('checkout', '-q', '-b', 'branch');
    return { dir, git };
  }

  function run(dir, args) {
    return spawnSync(process.execPath, [join(dir, 'scripts', 'e2e-affected-local.mjs'), ...args], {
      encoding: 'utf8',
    });
  }

  it('runs the selected specs and the extra arguments, and exits with the run’s code', () => {
    const { dir } = projectWithStubE2eRun();
    try {
      writeFileSync(join(dir, 'README.md'), 'edited');
      const result = run(dir, ['--project=chromium-desktop']);
      assert.deepEqual(JSON.parse(result.stdout), [
        ...[...ALWAYS].sort(),
        '--project=chromium-desktop',
      ]);
      assert.equal(result.status, STUB_EXIT_CODE);
      assert.match(result.stderr, /e2e:affected: running /);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs the full suite when a changed file is shared code', () => {
    const { dir } = projectWithStubE2eRun();
    try {
      mkdirSync(join(dir, 'src', 'app', 'shell'), { recursive: true });
      writeFileSync(join(dir, 'src', 'app', 'shell', 'shell.ts'), 'new');
      const result = run(dir, []);
      assert.deepEqual(JSON.parse(result.stdout), []);
      assert.match(result.stderr, /need the full suite/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
