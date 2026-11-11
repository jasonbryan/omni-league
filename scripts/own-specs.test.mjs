import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { SCREEN_SPEC_CAP, main, ownSpecs } from './own-specs.mjs';

const repoRoot = join(import.meta.dirname, '..');
const DIFF = ['diff', '--no-renames', '--name-only', 'origin/main...HEAD'];
const SMOKE = 'e2e/smoke.spec.ts';
const STUB_EXIT_CODE = 7;

const gitReturning = (files) => () => files.join('\n') + '\n';
const specNames = (count) =>
  Array.from({ length: count }, (_, i) => `e2e/screen-${String(i).padStart(2, '0')}.spec.ts`);

// A selector that answers every file with the same specs, plus the always set the real one adds.
const selectingFor = (specs) => () => ({
  scope: 'affected',
  specs: [SMOKE, 'e2e/convex-backend.spec.ts', 'e2e/harness/', ...specs],
});

function listFor(files, options = {}) {
  return ownSpecs({
    root: repoRoot,
    runGit: gitReturning(files),
    ciScope: () => 'app',
    ...options,
  });
}

describe('ownSpecs: screen specs of the changed src and design files', () => {
  it('lists the specs that read the Overview tiles when the Overview changes', () => {
    const list = listFor([
      'convex/organizations.ts',
      'docs/glossary.md',
      'e2e/organization-admin.spec.ts',
      'e2e/organization-leagues.spec.ts',
      'src/app/organizations/admin/admin-attention.ts',
      'src/app/organizations/admin/admin-overview.ts',
      'src/app/organizations/admin/attention-text.ts',
    ]);
    assert.ok(list.includes('e2e/organization-staff.spec.ts'));
    assert.ok(list.includes('e2e/shell-sheet.spec.ts'));
    assert.ok(list.includes('e2e/organization-admin.spec.ts'));
  });

  it('lists only the mockup specs for a change whose screen specs pass the cap', () => {
    const list = listFor([
      'src/app/core/forms/slug-availability.ts',
      'src/app/organizations/admin/league-create-form.ts',
      'src/app/organizations/admin/league-form.ts',
      'src/app/organizations/admin/web-address-preview.ts',
      'src/app/organizations/admin/web-address-status.ts',
      'src/app/organizations/create-organization-page.ts',
      'src/app/organizations/league/league-management.ts',
      'src/app/organizations/league/season-create-form.ts',
      'src/app/organizations/league/season-form.ts',
    ]);
    assert.deepEqual(list, [
      'e2e/league-management-mockup.spec.ts',
      'e2e/organization-leagues-mockup.spec.ts',
    ]);
  });

  it('adds every screen spec when the union is exactly the cap', () => {
    const specs = specNames(SCREEN_SPEC_CAP);
    const mockup = 'e2e/a-mockup.spec.ts';
    const list = listFor(['src/app/cap-first.ts'], {
      select: selectingFor([...specs.slice(1), mockup]),
      buildGraph: () => ({}),
    });
    assert.deepEqual(list, [...specs.slice(1), mockup].sort());
    assert.equal(list.length, SCREEN_SPEC_CAP);
  });

  it('adds only the mockup specs when the union is one over the cap', () => {
    const specs = specNames(SCREEN_SPEC_CAP);
    const mockup = 'e2e/a-mockup.spec.ts';
    const list = listFor(['src/app/cap-first.ts'], {
      select: selectingFor([...specs, mockup]),
      buildGraph: () => ({}),
    });
    assert.deepEqual(list, [mockup]);
  });

  it('counts the union over every changed file, not each file alone', () => {
    const specs = specNames(SCREEN_SPEC_CAP);
    const mockup = 'e2e/a-mockup.spec.ts';
    const select = (files) =>
      files[0] === 'src/app/cap-first.ts'
        ? selectingFor([...specs.slice(0, 10), mockup])()
        : selectingFor(specs.slice(10))();
    const list = listFor(['src/app/cap-first.ts', 'src/app/cap-second.ts'], {
      select,
      buildGraph: () => ({}),
    });
    assert.deepEqual(list, [mockup]);
  });

  it('selects each changed file on its own', () => {
    const seen = [];
    listFor(['src/app/cap-first.ts', 'design/mockups/cap-third.html', 'docs/cap-note.md'], {
      select: (files) => {
        seen.push(files);
        return { scope: 'affected', specs: [] };
      },
      buildGraph: () => ({}),
    });
    assert.deepEqual(seen, [['src/app/cap-first.ts'], ['design/mockups/cap-third.html']]);
  });

  it('adds nothing for a file whose selection is the full suite', () => {
    const list = listFor(['src/styles/tokens.css'], { ciScope: () => 'app' });
    assert.deepEqual(list, [SMOKE]);
  });

  it('lists the find page specs, not the full suite, for tokens.css with the find page', () => {
    const list = listFor(['src/styles/tokens.css', 'src/app/find/find-page.ts']);
    assert.ok(list.includes('e2e/find-a-league.spec.ts'));
    assert.ok(list.includes('e2e/find-organizations.spec.ts'));
    assert.ok(!list.includes('e2e/waitlist.spec.ts'));
    assert.ok(list.length < SCREEN_SPEC_CAP + 1);
  });

  it('leaves out the always set', () => {
    const list = listFor(['src/app/find/find-page.ts']);
    assert.ok(!list.includes('e2e/convex-backend.spec.ts'));
    assert.ok(!list.includes('e2e/harness/'));
  });

  it('adds nothing for convex and docs files, and builds no graph', () => {
    let selected = 0;
    let built = 0;
    const list = listFor(['convex/organizations.ts', 'docs/glossary.md'], {
      ciScope: () => 'docs',
      select: () => {
        selected += 1;
        return { scope: 'affected', specs: ['e2e/x.spec.ts'] };
      },
      buildGraph: () => {
        built += 1;
        return {};
      },
    });
    assert.deepEqual(list, []);
    assert.equal(selected, 0);
    assert.equal(built, 0);
  });
});

describe('ownSpecs: one import graph per call', () => {
  it('builds the graph once for several changed src and design files', () => {
    let built = 0;
    const graphs = [];
    listFor(['src/app/cap-first.ts', 'src/app/cap-second.ts', 'design/mockups/cap-third.html'], {
      buildGraph: () => {
        built += 1;
        return { id: built };
      },
      select: (_files, context) => {
        graphs.push(context.graph);
        return { scope: 'affected', specs: [] };
      },
    });
    assert.equal(built, 1);
    assert.equal(graphs.length, 3);
    assert.ok(graphs.every((graph) => graph === graphs[0]));
  });
});

describe('ownSpecs: changed files', () => {
  function repositoryWithOneBranchCommit() {
    const dir = mkdtempSync(join(tmpdir(), 'own-specs-test-'));
    const calls = [];
    const git = (...args) =>
      execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        encoding: 'utf8',
      });
    git('init', '-q', '-b', 'main');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'base.ts'), 'a');
    writeFileSync(join(dir, 'src', 'tracked.ts'), 'a');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('checkout', '-q', '-b', 'branch');
    writeFileSync(join(dir, 'src', 'committed.ts'), 'a');
    git('add', '.');
    git('commit', '-q', '-m', 'branch');
    const runGit = (args) => {
      calls.push(args);
      return git(...args);
    };
    return { dir, git, runGit, calls };
  }

  it('reads only the committed diff against origin/main, never the working tree', () => {
    const { dir, runGit, calls } = repositoryWithOneBranchCommit();
    try {
      writeFileSync(join(dir, 'src', 'tracked.ts'), 'edited');
      writeFileSync(join(dir, 'src', 'untracked.ts'), 'new');
      const selected = [];
      const options = {
        root: dir,
        runGit,
        ciScope: () => 'app',
        buildGraph: () => ({}),
        select: (files) => {
          selected.push(...files);
          return { scope: 'affected', specs: [] };
        },
      };
      const list = ownSpecs(options);
      assert.deepEqual(selected, ['src/committed.ts']);
      assert.deepEqual(calls, [DIFF]);
      assert.deepEqual(list, [SMOKE]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('gives the same list with and without the uncommitted and untracked files', () => {
    const { dir, runGit } = repositoryWithOneBranchCommit();
    try {
      const options = {
        root: dir,
        runGit,
        ciScope: () => 'app',
        buildGraph: () => ({}),
        select: (files) => ({
          scope: 'affected',
          specs: [`e2e/${files[0].split('/').pop()}.spec.ts`],
        }),
      };
      const before = ownSpecs(options);
      writeFileSync(join(dir, 'src', 'tracked.ts'), 'edited');
      writeFileSync(join(dir, 'src', 'untracked.ts'), 'new');
      assert.deepEqual(ownSpecs(options), before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when origin/main does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'own-specs-test-'));
    try {
      execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main'], { stdio: 'pipe' });
      assert.throws(() => ownSpecs({ root: dir }));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('ownSpecs: changed and imported specs', () => {
  function projectWithSpecs() {
    const dir = mkdtempSync(join(tmpdir(), 'own-specs-test-'));
    const write = (path, text) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    write('e2e/support/console-guard.ts', 'export const guard = 1;');
    write('e2e/support/fixtures.ts', "import { guard } from './console-guard';");
    write('e2e/support/other.ts', 'export const other = 1;');
    write('e2e/uses-fixtures.spec.ts', "import { test } from './support/fixtures';");
    write('e2e/harness/uses-fixtures-too.spec.ts', "import { test } from '../support/fixtures';");
    write('e2e/uses-guard.spec.ts', "import { guard } from './support/console-guard.js';");
    write('e2e/uses-other.spec.ts', "import { other } from './support/other';");
    write('e2e/reads-mockup.spec.ts', "join(root, 'design', 'mockups', '125-126-seasons.html')");
    write('e2e/changed.spec.ts', 'test();');
    write('e2e/deleted.spec.ts', 'test();');
    return { dir, write };
  }
  const options = (dir, files, more = {}) => ({
    root: dir,
    runGit: gitReturning(files),
    ciScope: () => 'app',
    ...more,
  });

  it('returns every spec that imports a helper the changed helper feeds', () => {
    const { dir } = projectWithSpecs();
    try {
      const list = ownSpecs(options(dir, ['e2e/support/console-guard.ts']));
      assert.deepEqual(list, [
        'e2e/harness/uses-fixtures-too.spec.ts',
        'e2e/uses-fixtures.spec.ts',
        'e2e/uses-guard.spec.ts',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('finds a spec that opens a changed mockup by its quoted file name', () => {
    const { dir } = projectWithSpecs();
    try {
      const list = ownSpecs(
        options(dir, ['design/mockups/125-126-seasons.html'], {
          select: () => ({ scope: 'affected', specs: [SMOKE] }),
          buildGraph: () => ({}),
        }),
      );
      assert.deepEqual(list, ['e2e/reads-mockup.spec.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lists a changed spec, and leaves out one the change deleted', () => {
    const { dir } = projectWithSpecs();
    try {
      rmSync(join(dir, 'e2e', 'deleted.spec.ts'));
      const list = ownSpecs(options(dir, ['e2e/changed.spec.ts', 'e2e/deleted.spec.ts']));
      assert.deepEqual(list, ['e2e/changed.spec.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('follows a deleted helper to the specs that imported it', () => {
    const { dir } = projectWithSpecs();
    try {
      rmSync(join(dir, 'e2e', 'support', 'other.ts'));
      const list = ownSpecs(options(dir, ['e2e/support/other.ts']));
      assert.deepEqual(list, ['e2e/uses-other.spec.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('matches the documented git grep loop on the real repo', () => {
    const grep = (stem) => {
      const result = spawnSync('git', ['grep', '-lE', `[/']${stem}(\\.[a-z]+)?'`, '--', 'e2e/'], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      return result.stdout.split('\n').filter(Boolean);
    };
    const documented = (start) => {
      const files = new Set([start]);
      const specs = new Set();
      for (const file of files) {
        const stem = file
          .split('/')
          .pop()
          .replace(/\.[^.]+$/, '');
        for (const found of grep(stem)) {
          if (found.endsWith('.spec.ts')) specs.add(found);
          else files.add(found);
        }
      }
      return [...specs].sort();
    };
    for (const start of ['e2e/support/console-guard.ts', 'e2e/support/chip.ts']) {
      const list = ownSpecs({
        root: repoRoot,
        runGit: gitReturning([start]),
        ciScope: () => 'app',
      });
      assert.deepEqual(list, documented(start));
    }
    const guard = ownSpecs({
      root: repoRoot,
      runGit: gitReturning(['e2e/support/console-guard.ts']),
    });
    const fixtures = ownSpecs({
      root: repoRoot,
      runGit: gitReturning(['e2e/support/fixtures.ts']),
    });
    for (const spec of fixtures) assert.ok(guard.includes(spec), spec);
  });
});

describe('ownSpecs: the smoke floor and named specs', () => {
  it('lists the smoke spec for an app-scope change with nothing else to run', () => {
    const list = ownSpecs({
      root: repoRoot,
      runGit: gitReturning(['scripts/own-specs.mjs', 'package.json']),
      ciScope: () => 'app',
    });
    assert.deepEqual(list, [SMOKE]);
  });

  it('lists nothing for a docs-scope change', () => {
    const list = ownSpecs({
      root: repoRoot,
      runGit: gitReturning(['docs/glossary.md']),
      ciScope: () => 'docs',
    });
    assert.deepEqual(list, []);
  });

  it('lists nothing for a tooling-scope change', () => {
    const list = ownSpecs({
      root: repoRoot,
      runGit: gitReturning(['scripts/ci-scope.test.mjs']),
      ciScope: () => 'tooling',
    });
    assert.deepEqual(list, []);
  });

  it('classifies the scope from the changed files', () => {
    const scopes = [];
    ownSpecs({
      root: repoRoot,
      runGit: gitReturning(['docs/glossary.md']),
      ciScope: (files) => {
        scopes.push(files);
        return 'docs';
      },
    });
    assert.deepEqual(scopes, [['docs/glossary.md']]);
  });

  it('reads the real ci scope when none is given', () => {
    assert.deepEqual(
      ownSpecs({ root: repoRoot, runGit: gitReturning(['docs/process/ci.md']) }),
      [],
    );
    assert.deepEqual(ownSpecs({ root: repoRoot, runGit: gitReturning(['package.json']) }), [SMOKE]);
  });

  it('skips the smoke floor when another bullet found a spec', () => {
    const list = ownSpecs({
      root: repoRoot,
      runGit: gitReturning(['e2e/season-page.spec.ts']),
      ciScope: () => 'app',
    });
    assert.deepEqual(list, ['e2e/season-page.spec.ts']);
  });

  it('adds a named spec, and the named spec stops the smoke floor', () => {
    const list = ownSpecs({
      root: repoRoot,
      runGit: gitReturning(['package.json']),
      ciScope: () => 'app',
      named: ['e2e/x.spec.ts'],
    });
    assert.deepEqual(list, ['e2e/x.spec.ts']);
  });

  it('lists each spec once, sorted', () => {
    const list = ownSpecs({
      root: repoRoot,
      runGit: gitReturning(['e2e/season-page.spec.ts']),
      ciScope: () => 'app',
      named: ['e2e/season-page.spec.ts', 'e2e/a.spec.ts'],
    });
    assert.deepEqual(list, ['e2e/a.spec.ts', 'e2e/season-page.spec.ts']);
  });
});

describe('main', () => {
  const run = (argv, { specs, code = 0 } = {}) => {
    const ran = [];
    const printed = [];
    const received = [];
    return {
      ran,
      printed,
      received,
      result: main(argv, {
        own: (options) => {
          received.push(options);
          return specs;
        },
        run: async (args) => {
          ran.push(args);
          return code;
        },
        print: (line) => printed.push(line),
        log: () => {},
      }),
    };
  };

  it('runs the list through the runner and returns its exit code', async () => {
    const { ran, result } = run([], {
      specs: ['e2e/a.spec.ts', 'e2e/b.spec.ts'],
      code: STUB_EXIT_CODE,
    });
    assert.equal(await result, STUB_EXIT_CODE);
    assert.deepEqual(ran, [['e2e/a.spec.ts', 'e2e/b.spec.ts']]);
  });

  it('passes the named specs to the list and the other flags to Playwright', async () => {
    const { ran, received, result } = run(['e2e/x.spec.ts', '--project=chromium-desktop'], {
      specs: ['e2e/x.spec.ts'],
    });
    assert.equal(await result, 0);
    assert.deepEqual(received[0].named, ['e2e/x.spec.ts']);
    assert.deepEqual(ran, [['e2e/x.spec.ts', '--project=chromium-desktop']]);
  });

  it('runs nothing and exits 0 when the list is empty', async () => {
    const { ran, result } = run([], { specs: [] });
    assert.equal(await result, 0);
    assert.deepEqual(ran, []);
  });

  it('prints one spec per line, without running, for --list', async () => {
    const { ran, printed, result } = run(['--list'], {
      specs: ['e2e/a.spec.ts', 'e2e/b.spec.ts'],
      code: STUB_EXIT_CODE,
    });
    assert.equal(await result, 0);
    assert.deepEqual(printed, ['e2e/a.spec.ts', 'e2e/b.spec.ts']);
    assert.deepEqual(ran, []);
  });

  it('keeps --list out of the flags and the named specs', async () => {
    const { received, result } = run(['--list', 'e2e/x.spec.ts'], { specs: [] });
    await result;
    assert.deepEqual(received[0].named, ['e2e/x.spec.ts']);
  });
});

describe('npm run e2e:own entry point', () => {
  function project(files) {
    const dir = mkdtempSync(join(tmpdir(), 'own-specs-entry-test-'));
    const git = (...args) =>
      execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        encoding: 'utf8',
      });
    mkdirSync(join(dir, 'scripts'));
    for (const name of ['own-specs.mjs', 'e2e-affected.mjs', 'ci-scope.mjs']) {
      copyFileSync(join(import.meta.dirname, name), join(dir, 'scripts', name));
    }
    writeFileSync(
      join(dir, 'scripts', 'e2e.mjs'),
      `import { writeFileSync } from 'node:fs';\n` +
        `export async function runE2e(args) { writeFileSync(${JSON.stringify(join(dir, 'ran.json'))}, JSON.stringify(args)); return ${STUB_EXIT_CODE}; }\n`,
    );
    mkdirSync(join(dir, 'e2e'));
    writeFileSync(join(dir, 'e2e', 'smoke.spec.ts'), 'test();');
    writeFileSync(
      join(dir, 'package.json'),
      '{"scripts":{"e2e:own":"node scripts/own-specs.mjs"}}',
    );
    for (const name of ['netlify.toml', 'angular.json', 'playwright.config.ts']) {
      writeFileSync(join(dir, name), '');
    }
    writeFileSync(join(dir, 'README.md'), 'a');
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('checkout', '-q', '-b', 'branch');
    for (const file of files) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), 'changed');
    }
    git('add', '.');
    git('commit', '-q', '-m', 'branch');
    return { dir, ranFile: join(dir, 'ran.json') };
  }

  const entry = (dir, args) =>
    spawnSync(process.execPath, [join(dir, 'scripts', 'own-specs.mjs'), ...args], {
      encoding: 'utf8',
    });
  const ranWith = (file) => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return undefined;
    }
  };

  it('runs the smoke floor through the runner for an app-scope change, and exits with its code', () => {
    const { dir, ranFile } = project(['package.json']);
    try {
      const result = entry(dir, []);
      assert.equal(result.status, STUB_EXIT_CODE);
      assert.deepEqual(ranWith(ranFile), [SMOKE]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs a named spec through the runner', () => {
    const { dir, ranFile } = project(['README.md']);
    try {
      entry(dir, ['e2e/x.spec.ts']);
      assert.deepEqual(ranWith(ranFile), ['e2e/x.spec.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('starts no run and exits 0 for a docs-scope change', () => {
    const { dir, ranFile } = project(['docs/guide.md']);
    try {
      const result = entry(dir, []);
      assert.equal(result.status, 0);
      assert.equal(ranWith(ranFile), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints the list and starts no run for --list', () => {
    const { dir, ranFile } = project(['package.json']);
    try {
      const result = entry(dir, ['--list']);
      assert.equal(result.status, 0);
      assert.equal(result.stdout, `${SMOKE}\n`);
      assert.equal(ranWith(ranFile), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the rule in the docs', () => {
  const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
  const documents = [
    'docs/process/dev-cycle.md',
    'docs/process/ci.md',
    'docs/glossary.md',
    'README.md',
    '.claude/agents/implementer.md',
    '.claude/agents/tester.md',
    '.claude/agents/pr-reviewer.md',
  ];

  for (const path of documents) {
    it(`${path} names npm run e2e:own and the cap`, () => {
      const text = read(path);
      assert.match(text, /npm run e2e:own/);
      assert.match(text, /\b20\b/);
    });
  }

  it('dev-cycle.md names the cap constant and the mockup fallback', () => {
    const text = read('docs/process/dev-cycle.md');
    assert.match(text, /SCREEN_SPEC_CAP/);
    assert.match(text, /-mockup\.spec\.ts/);
  });

  it('the CI pipeline decision records the amendment with the owner answer and no technology gate', () => {
    const text = read('docs/decisions/0009-ci-pipeline.md');
    assert.match(text, /issues\/634#issuecomment-6786641125/);
    assert.match(text, /not a `gate:technology` change/);
  });

  it('package.json has the e2e:own script', () => {
    assert.equal(JSON.parse(read('package.json')).scripts['e2e:own'], 'node scripts/own-specs.mjs');
  });
});
