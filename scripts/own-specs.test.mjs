import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { PLAYWRIGHT_TEST_OPTIONS, SCREEN_SPEC_CAP, main, ownSpecs } from './own-specs.mjs';

const repoRoot = join(import.meta.dirname, '..');
const DIFF = ['diff', '--no-renames', '--name-only', 'origin/main...HEAD'];
const SMOKE = 'e2e/smoke.spec.ts';
const STUB_EXIT_CODE = 7;

const gitReturning = (files) => () => files.join('\n') + '\n';
const specNames = (count, prefix = 'screen') =>
  Array.from({ length: count }, (_, i) => `e2e/${prefix}-${String(i).padStart(2, '0')}.spec.ts`);

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

  it('finds the specs that read the Overview tiles from the source files alone', () => {
    const list = listFor([
      'src/app/organizations/admin/admin-attention.ts',
      'src/app/organizations/admin/admin-open-seasons.ts',
      'src/app/organizations/admin/admin-overview.ts',
      'src/app/organizations/admin/attention-text.ts',
    ]);
    assert.ok(list.includes('e2e/organization-staff.spec.ts'));
    assert.ok(list.includes('e2e/shell-sheet.spec.ts'));
  });

  it('lists the mockup specs for the whole set of files that changed with the web address field', () => {
    const list = listFor([
      'convex/leagues.ts',
      'convex/lib/slugs.ts',
      'convex/organizations.ts',
      'docs/glossary.md',
      'src/app/core/forms/slug-availability.ts',
      'src/app/organizations/admin/league-create-form.ts',
      'src/app/organizations/create-organization-page.ts',
      'src/app/organizations/league/season-create-form.ts',
    ]);
    assert.ok(list.includes('e2e/league-management-mockup.spec.ts'));
    assert.ok(list.includes('e2e/organization-leagues-mockup.spec.ts'));
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

  it('adds only the mockup specs for a file that fits no tier when the union is one over the cap', () => {
    const specs = specNames(SCREEN_SPEC_CAP);
    const mockup = 'e2e/a-mockup.spec.ts';
    const list = listFor(['src/app/cap-first.ts'], {
      select: selectingFor([...specs, mockup]),
      buildGraph: () => ({}),
      routeSpecs: () => [],
    });
    assert.deepEqual(list, [mockup]);
  });

  it('applies the tiers to each file when the union passes the cap though each file fits alone', () => {
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
    assert.deepEqual(list, [...specs, mockup].sort());
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

describe('ownSpecs: past the screen-spec cap, each file keeps its closest specs', () => {
  const OVER = SCREEN_SPEC_CAP + 5;
  const ALWAYS_SPECS = [SMOKE, 'e2e/convex-backend.spec.ts', 'e2e/harness/'];
  const mockup = 'e2e/tier-mockup.spec.ts';

  const selecting =
    (byFile) =>
    (files, context = {}) => {
      const entry = byFile[files[0]];
      if (entry === 'full') return { scope: 'full' };
      return {
        scope: 'affected',
        specs: [...ALWAYS_SPECS, ...(context.narrow ? entry.narrow : entry.whole)],
      };
    };

  function run(byFile, routes = {}) {
    const lines = [];
    const asked = [];
    const list = listFor(Object.keys(byFile), {
      select: selecting(byFile),
      buildGraph: () => ({ graph: true }),
      routeSpecs: (file, context) => {
        asked.push({ file, context });
        return routes[file] ?? [];
      },
      sessionSpecs: () => [],
      log: (line) => lines.push(line),
    });
    return { list, lines, asked };
  }

  const OVER_ON_ALL_TIERS = 'src/app/padding.ts';
  const padding = { whole: [...specNames(OVER, 'pad'), mockup], narrow: specNames(OVER, 'pad') };

  it('adds the whole selection of a file whose selection fits the cap', () => {
    const whole = specNames(6, 'whole');
    const { list, lines } = run({
      'src/app/whole.ts': { whole, narrow: [] },
      [OVER_ON_ALL_TIERS]: padding,
    });
    assert.deepEqual(list, [...whole, mockup].sort());
    assert.ok(lines.includes('e2e:own: src/app/whole.ts: whole, 6 specs'), lines.join('\n'));
  });

  it('adds only the own rule specs of a file whose selection passes the cap and whose rule fits', () => {
    const own = specNames(4, 'own');
    const { list, lines, asked } = run({
      'src/app/rule.ts': { whole: [...specNames(OVER, 'importer'), ...own], narrow: own },
      [OVER_ON_ALL_TIERS]: padding,
    });
    assert.deepEqual(list, [...own, mockup].sort());
    assert.ok(lines.includes('e2e:own: src/app/rule.ts: own rule, 4 specs'), lines.join('\n'));
    assert.deepEqual(
      asked.map(({ file }) => file),
      [OVER_ON_ALL_TIERS],
    );
  });

  it('adds the route specs of a file whose rule passes the cap and whose routes fit', () => {
    const routes = specNames(3, 'route');
    const wide = specNames(OVER, 'wide');
    const { list, lines, asked } = run(
      { 'src/app/routes.ts': { whole: wide, narrow: wide }, [OVER_ON_ALL_TIERS]: padding },
      { 'src/app/routes.ts': routes },
    );
    assert.deepEqual(list, [...routes, mockup].sort());
    assert.ok(lines.includes('e2e:own: src/app/routes.ts: routes, 3 specs'), lines.join('\n'));
    const [call] = asked.filter(({ file }) => file === 'src/app/routes.ts');
    assert.deepEqual(call.context.graph, { graph: true });
  });

  it('adds nothing for a file that passes the cap on all three tiers', () => {
    const wide = specNames(OVER, 'wide');
    const { list, lines } = run(
      { 'src/app/none.ts': { whole: wide, narrow: wide }, [OVER_ON_ALL_TIERS]: padding },
      { 'src/app/none.ts': specNames(OVER, 'route') },
    );
    assert.deepEqual(list, [mockup]);
    assert.ok(lines.includes('e2e:own: src/app/none.ts: none'), lines.join('\n'));
  });

  it('goes on to the routes for a file whose rule has only session specs', () => {
    const routes = ['e2e/sign-in.spec.ts', 'e2e/auth-session.spec.ts', 'e2e/after-sign-in.spec.ts'];
    const { list, lines } = run(
      {
        'src/app/sign-in/sign-in-page.ts': { whole: specNames(OVER, 'session'), narrow: [] },
        [OVER_ON_ALL_TIERS]: padding,
      },
      { 'src/app/sign-in/sign-in-page.ts': routes },
    );
    assert.deepEqual(list, [...routes, mockup].sort());
    assert.ok(
      lines.includes('e2e:own: src/app/sign-in/sign-in-page.ts: routes, 3 specs'),
      lines.join('\n'),
    );
  });

  it('adds nothing for a file whose selection is empty, and tries no further tier for it', () => {
    const { list, lines, asked } = run(
      { 'src/app/unit.spec.ts': { whole: [], narrow: [] }, [OVER_ON_ALL_TIERS]: padding },
      { 'src/app/unit.spec.ts': specNames(2, 'route') },
    );
    assert.deepEqual(list, [mockup]);
    assert.ok(lines.includes('e2e:own: src/app/unit.spec.ts: none'), lines.join('\n'));
    assert.ok(!asked.some(({ file }) => file === 'src/app/unit.spec.ts'));
  });

  it('adds nothing for a file whose selection is the full suite, and tries no tier for it', () => {
    const { list, lines, asked } = run({
      'src/app/core/auth/guards.ts': 'full',
      [OVER_ON_ALL_TIERS]: padding,
    });
    assert.deepEqual(list, [mockup]);
    assert.ok(
      lines.includes(
        'e2e:own: src/app/core/auth/guards.ts selects the full suite, which the batch run covers',
      ),
      lines.join('\n'),
    );
    assert.ok(!asked.some(({ file }) => file === 'src/app/core/auth/guards.ts'));
  });

  it('lists the mockup specs of the union whichever tier each file takes', () => {
    const own = specNames(2, 'own');
    const { list } = run({
      'src/app/rule.ts': { whole: [...specNames(OVER, 'importer'), mockup], narrow: own },
    });
    assert.deepEqual(list, [...own, mockup].sort());
  });

  it('prints no tier line and runs no tier while the union is within the cap', () => {
    const whole = specNames(SCREEN_SPEC_CAP, 'whole');
    const { list, lines, asked } = run({ 'src/app/whole.ts': { whole, narrow: [] } });
    assert.deepEqual(list, whole);
    assert.deepEqual(lines, []);
    assert.deepEqual(asked, []);
  });

  it('keeps the specs a rule with only derive specs gives, and only the mockup spec of its importer', () => {
    const root = mkdtempSync(join(tmpdir(), 'own-specs-derive-'));
    const write = (path, text) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    try {
      write('src/app/organizations/league/lm.ts', 'export const lm = 1;\n');
      write(
        'src/app/organizations/organization-page.ts',
        "import { lm } from './league/lm';\nexport const page = lm;\n",
      );
      write('e2e/harness/placeholder.txt', '');
      write('e2e/lm-a.spec.ts', 'const path = `/app/organizations/${slug}/leagues/${league}`;\n');
      write('e2e/lm-b.spec.ts', 'const path = `/app/organizations/${slug}/leagues/${league}`;\n');
      const lines = [];
      const list = ownSpecs({
        root,
        runGit: gitReturning(['src/app/organizations/league/lm.ts']),
        ciScope: () => 'app',
        sessionSpecs: () => [],
        routeSpecs: () => [],
        log: (line) => lines.push(line),
      });
      assert.deepEqual(list, [
        'e2e/lm-a.spec.ts',
        'e2e/lm-b.spec.ts',
        'e2e/organization-leagues-mockup.spec.ts',
      ]);
      assert.ok(
        lines.includes('e2e:own: src/app/organizations/league/lm.ts: own rule, 2 specs'),
        lines.join('\n'),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads the route specs from the route table of the copy of HEAD', () => {
    const root = mkdtempSync(join(tmpdir(), 'own-specs-routes-'));
    const write = (path, text) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    try {
      write('src/app/sign-in/sign-in-page.ts', 'export const page = 1;\n');
      write(
        'src/app/app.routes.ts',
        `export const routes: Routes = [
  {
    path: 'sign-in',
    loadComponent: () => import('./sign-in/sign-in-page').then((m) => m.SignInPage),
  },
];
`,
      );
      const lines = [];
      const list = ownSpecs({
        root,
        runGit: gitReturning(['src/app/sign-in/sign-in-page.ts']),
        ciScope: () => 'app',
        sessionSpecs: () => specNames(OVER, 'session'),
        select: (files, context) => ({
          scope: 'affected',
          specs: context.narrow ? [] : [...ALWAYS_SPECS, ...specNames(OVER, 'session')],
        }),
        log: (line) => lines.push(line),
      });
      assert.deepEqual(list, [
        'e2e/after-sign-in.spec.ts',
        'e2e/auth-session.spec.ts',
        'e2e/sign-in.spec.ts',
      ]);
      assert.ok(
        lines.includes('e2e:own: src/app/sign-in/sign-in-page.ts: routes, 3 specs'),
        lines.join('\n'),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('names the reason and adds no route specs when the route table cannot be read', () => {
    const root = mkdtempSync(join(tmpdir(), 'own-specs-no-routes-'));
    try {
      mkdirSync(join(root, 'src/app'), { recursive: true });
      writeFileSync(join(root, 'src/app/page.ts'), 'export const page = 1;\n');
      const lines = [];
      const wide = specNames(OVER, 'wide');
      const list = ownSpecs({
        root,
        runGit: gitReturning(['src/app/page.ts']),
        ciScope: () => 'app',
        sessionSpecs: () => [],
        select: () => ({ scope: 'affected', specs: wide }),
        log: (line) => lines.push(line),
      });
      assert.deepEqual(list, [SMOKE]);
      assert.ok(
        lines.some((line) =>
          /^e2e:own: src\/app\/page\.ts: route table cannot be read: .+/.test(line),
        ),
        lines.join('\n'),
      );
      assert.ok(lines.includes('e2e:own: src/app/page.ts: none'), lines.join('\n'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('ownSpecs: the tiers on the real repo', () => {
  const ORGANIZATIONS = 'src/app/organizations';
  const ADMIN = `${ORGANIZATIONS}/admin`;
  const PR_ADMIN_FILES = [
    'admin-area',
    'admin-leagues',
    'admin-sidebar',
    'admin-tournaments',
    'create-form-landing',
    'custom-level-panel',
    'league-division-fields',
    'tournament-create-form',
    'tournament-form',
  ].map((name) => `${ADMIN}/${name}.ts`);
  const PR_PUBLIC_PAGE_FILES = [
    'organization-overview',
    'public-league/public-league-content',
    'public-league/public-page-names',
    'public-league/public-season-header-classes',
    'public-season/public-season-content',
    'public-season/public-season-page',
    'public-season/public-season-skeleton',
  ].map((name) => `${ORGANIZATIONS}/${name}.ts`);
  const PR_BUTTON_FILES = [
    `${ORGANIZATIONS}/organization-overview.ts`,
    'src/app/ui/button/button-classes.ts',
  ];
  const PR_LEAGUE_FILES = [
    'filter-draft',
    'league/league-details-form',
    'league/league-details-state',
    'league/season-create-form',
    'league/season-form',
  ].map((name) => `${ORGANIZATIONS}/${name}.ts`);
  const PR_SHELL_FILES = ['src/app/shell/shell.ts', 'src/app/account/account-page.ts'];

  function replay(files) {
    const lines = [];
    const list = ownSpecs({
      root: repoRoot,
      runGit: gitReturning(files),
      ciScope: () => 'app',
      log: (line) => lines.push(line),
    });
    return { names: list.map((spec) => spec.replace(/^e2e\/|\.spec\.ts$/g, '')), lines };
  }

  function assertReplay(files, include, atMost) {
    const { names, lines } = replay(files);
    for (const name of include) assert.ok(names.includes(name), `${name} in ${names.join(' ')}`);
    assert.ok(names.length <= atMost, `${names.length} specs: ${names.join(' ')}`);
    return lines;
  }

  it('keeps the shell, the shell sheet and the home specs for the shell and account page', () => {
    const lines = assertReplay(PR_SHELL_FILES, ['app-shell', 'shell-sheet', 'app-home'], 10);
    assert.ok(lines.includes('e2e:own: src/app/shell/shell.ts: own rule, 2 specs'));
  });

  it('keeps the admin specs for the nine admin files', () => {
    assertReplay(
      PR_ADMIN_FILES,
      [
        'organization-admin',
        'organization-leagues',
        'organization-staff',
        'organization-tournaments',
        'organization-leagues-division',
        'organization-leagues-custom-level',
        'organization-details',
        'navigation-focus',
        'organization-leagues-publish',
      ],
      20,
    );
  });

  it('keeps the public page specs for the seven public page files', () => {
    assertReplay(
      PR_PUBLIC_PAGE_FILES,
      [
        'season-page',
        'public-page-layout-shift',
        'league-page',
        'organization-page',
        'cache-key',
        'free-agent',
        'team-registration',
        'league-page-offline',
        'sport-view',
      ],
      15,
    );
  });

  it('keeps the organization page specs for the overview and the button classes', () => {
    const lines = assertReplay(
      PR_BUTTON_FILES,
      ['organization-page', 'organization-page-manage', 'sport-view'],
      10,
    );
    assert.ok(
      lines.includes('e2e:own: src/app/ui/button/button-classes.ts: none'),
      lines.join('\n'),
    );
  });

  it('keeps the league management specs for the five league files', () => {
    assertReplay(PR_LEAGUE_FILES, ['league-management', 'league-management-details'], 15);
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

  describe('with the real import graph', () => {
    const CHANGED = 'src/app/organizations/admin/attention-text.ts';
    const IMPORT_CHANGED = "import { text } from '../organizations/admin/attention-text';\n";

    function repositoryChangingOneSourceFile() {
      const { dir, git, runGit } = repositoryWithOneBranchCommit();
      const write = (path, text) => {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), text);
      };
      write(CHANGED, 'export const text = 1;');
      write('src/app/find/find-page.ts', 'export const page = 1;');
      write('e2e/find-a-league.spec.ts', 'test();');
      git('add', '.');
      git('commit', '-q', '-m', 'files');
      git('update-ref', 'refs/remotes/origin/main', 'HEAD');
      write(CHANGED, 'export const text = 2;');
      git('add', '.');
      git('commit', '-q', '-m', 'change');
      const list = () =>
        ownSpecs({ root: dir, runGit, ciScope: () => 'app', sessionSpecs: () => [] });
      return { dir, write, list };
    }

    it('gives the same list when an untracked source file imports a changed file', () => {
      const { dir, write, list } = repositoryChangingOneSourceFile();
      try {
        const before = list();
        write('src/app/find/untracked.ts', `${IMPORT_CHANGED}export const again = text;`);
        assert.deepEqual(list(), before);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('gives the same list when an uncommitted edit makes a source file import a changed file', () => {
      const { dir, write, list } = repositoryChangingOneSourceFile();
      try {
        const before = list();
        write('src/app/find/find-page.ts', `${IMPORT_CHANGED}export const page = text;`);
        assert.deepEqual(list(), before);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('gives the same list when an untracked spec imports a changed file', () => {
      const { dir, write, list } = repositoryChangingOneSourceFile();
      try {
        const before = list();
        write('e2e/untracked.spec.ts', "import '../src/app/organizations/admin/attention-text';");
        assert.deepEqual(list(), before);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
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

describe('ownSpecs: the copy of HEAD', () => {
  const COPY_PREFIX = 'own-specs-head-';

  function committedProject({ base, branch }) {
    const dir = mkdtempSync(join(tmpdir(), 'own-specs-head-test-'));
    const git = (...args) =>
      execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        encoding: 'utf8',
      });
    const write = (path, text) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    git('init', '-q', '-b', 'main');
    for (const [path, text] of Object.entries(base)) write(path, text);
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    git('checkout', '-q', '-b', 'branch');
    for (const [path, text] of Object.entries(branch)) {
      if (text === null) rmSync(join(dir, path));
      else write(path, text);
    }
    git('add', '.');
    git('commit', '-q', '-m', 'branch');
    return { dir, write };
  }

  // Assigning undefined to process.env stores the string "undefined".
  function restoreEnv(name, saved) {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }

  // os.tmpdir() reads TMPDIR on each call, so a private one shows the copies this call makes.
  function withPrivateTmpdir(task) {
    const scratch = mkdtempSync(join(tmpdir(), 'own-specs-scratch-'));
    const copies = () => readdirSync(scratch).filter((name) => name.startsWith(COPY_PREFIX));
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = scratch;
    try {
      return task(copies);
    } finally {
      restoreEnv('TMPDIR', saved);
      rmSync(scratch, { recursive: true, force: true });
    }
  }

  const screenChange = {
    base: { 'src/app/head-copy.ts': 'a', 'e2e/smoke.spec.ts': 'test();' },
    branch: { 'src/app/head-copy.ts': 'b' },
  };
  const options = (dir, more = {}) => ({
    root: dir,
    ciScope: () => 'app',
    buildGraph: () => ({}),
    ...more,
  });

  it('leaves TMPDIR unset after a private temp directory when it was unset before', () => {
    const saved = process.env.TMPDIR;
    delete process.env.TMPDIR;
    try {
      withPrivateTmpdir(() => {});
      assert.equal('TMPDIR' in process.env, false);
      const probe = mkdtempSync(join(tmpdir(), 'own-specs-unset-probe-'));
      rmSync(probe, { recursive: true, force: true });
    } finally {
      restoreEnv('TMPDIR', saved);
    }
  });

  it('removes the copy after a call that returns, and makes one during it', () => {
    const { dir } = committedProject(screenChange);
    try {
      withPrivateTmpdir((copies) => {
        const during = [];
        ownSpecs(
          options(dir, {
            select: () => {
              during.push(copies().length);
              return { scope: 'affected', specs: [] };
            },
          }),
        );
        assert.deepEqual(during, [1]);
        assert.deepEqual(copies(), []);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('removes the copy after a call that throws', () => {
    const { dir } = committedProject(screenChange);
    try {
      withPrivateTmpdir((copies) => {
        const select = () => {
          assert.equal(copies().length, 1);
          throw new Error('select failed');
        };
        assert.throws(() => ownSpecs(options(dir, { select })), /select failed/);
        assert.deepEqual(copies(), []);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps a changed spec that the working tree deleted but HEAD has', () => {
    const { dir } = committedProject({
      base: { 'e2e/smoke.spec.ts': 'test();' },
      branch: { 'e2e/kept.spec.ts': 'test();' },
    });
    try {
      rmSync(join(dir, 'e2e', 'kept.spec.ts'));
      assert.deepEqual(ownSpecs(options(dir)), ['e2e/kept.spec.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops a changed spec that HEAD deleted but the working tree has again', () => {
    const { dir, write } = committedProject({
      base: { 'e2e/smoke.spec.ts': 'test();', 'e2e/removed.spec.ts': 'test();' },
      branch: { 'e2e/removed.spec.ts': null },
    });
    try {
      write('e2e/removed.spec.ts', 'test();');
      assert.deepEqual(ownSpecs(options(dir, { ciScope: () => 'docs' })), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('the ci scope', () => {
    const referencing = (...scripts) =>
      JSON.stringify({ scripts: { run: scripts.map((name) => `node scripts/${name}`).join(' ') } });
    const fixture = (inHead) => ({
      base: {
        'package.json': referencing(...inHead),
        'netlify.toml': '',
        'angular.json': '',
        'playwright.config.ts': '',
        'e2e/smoke.spec.ts': 'test();',
        'scripts/tracked.mjs': 'a',
        'scripts/other.mjs': 'a',
      },
      branch: { 'scripts/tracked.mjs': 'b' },
    });
    const scopeOptions = (dir) => ({ root: dir });

    it('reads the scripts HEAD references, not the working tree edit', () => {
      const { dir, write } = committedProject(fixture(['tracked.mjs', 'other.mjs']));
      try {
        write('package.json', referencing('other.mjs'));
        assert.deepEqual(ownSpecs(scopeOptions(dir)), [SMOKE]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('ignores a script only the working tree references', () => {
      const { dir, write } = committedProject(fixture(['other.mjs']));
      try {
        write('package.json', referencing('tracked.mjs', 'other.mjs'));
        assert.deepEqual(ownSpecs(scopeOptions(dir)), []);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('the session specs', () => {
    const signsIn = "import { session } from './support/session';";
    const fixture = {
      base: {
        'src/app/head-copy.ts': 'a',
        'e2e/support/session.ts': 'export const session = 1;',
        'e2e/head-signs-in.spec.ts': signsIn,
        'e2e/harness/quiet.spec.ts': 'test();',
      },
      branch: { 'src/app/head-copy.ts': 'b' },
    };

    it('derives them from the specs in HEAD', () => {
      const { dir, write } = committedProject(fixture);
      try {
        write('e2e/head-signs-in.spec.ts', 'test();');
        write('e2e/working-tree-signs-in.spec.ts', signsIn);
        let seen;
        ownSpecs({
          root: dir,
          ciScope: () => 'app',
          buildGraph: () => ({}),
          select: (_files, context) => {
            seen = context.sessionSpecs();
            return { scope: 'affected', specs: [] };
          },
        });
        assert.deepEqual(seen, ['e2e/head-signs-in.spec.ts']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('a copy that cannot be made', () => {
    it('throws inside a repository whose HEAD has no commit', () => {
      const dir = mkdtempSync(join(tmpdir(), 'own-specs-head-test-'));
      try {
        execFileSync('git', ['-C', dir, 'init', '-q', '-b', 'main'], { stdio: 'pipe' });
        withPrivateTmpdir((copies) => {
          assert.throws(
            () => ownSpecs(options(dir, { runGit: gitReturning(['src/app/head-copy.ts']) })),
            /git archive/,
          );
          assert.deepEqual(copies(), []);
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('throws inside a repository when tar is missing, and leaves no copy', () => {
      const { dir } = committedProject(screenChange);
      const bin = mkdtempSync(join(tmpdir(), 'own-specs-bin-'));
      const savedPath = process.env.PATH;
      try {
        symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), join(bin, 'git'));
        withPrivateTmpdir((copies) => {
          process.env.PATH = bin;
          try {
            assert.throws(() => ownSpecs(options(dir, { select: selectingFor([]) })), /tar failed/);
          } finally {
            restoreEnv('PATH', savedPath);
          }
          assert.deepEqual(copies(), []);
        });
      } finally {
        restoreEnv('PATH', savedPath);
        rmSync(dir, { recursive: true, force: true });
        rmSync(bin, { recursive: true, force: true });
      }
    });

    it('reads the working tree outside a repository', () => {
      const dir = mkdtempSync(join(tmpdir(), 'own-specs-head-test-'));
      try {
        mkdirSync(join(dir, 'e2e'));
        writeFileSync(join(dir, 'e2e', 'plain.spec.ts'), 'test();');
        const list = ownSpecs(
          options(dir, { runGit: gitReturning(['e2e/plain.spec.ts']), ciScope: () => 'docs' }),
        );
        assert.deepEqual(list, ['e2e/plain.spec.ts']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
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

  it('lists every spec of fixtures.ts for console-guard.ts on the real repo', () => {
    const guard = ownSpecs({
      root: repoRoot,
      runGit: gitReturning(['e2e/support/console-guard.ts']),
    });
    const fixtures = ownSpecs({
      root: repoRoot,
      runGit: gitReturning(['e2e/support/fixtures.ts']),
    });
    assert.ok(fixtures.length > 0);
    for (const spec of fixtures) assert.ok(guard.includes(spec), spec);
  });
});

describe('ownSpecs: the import bullet on the real repo', () => {
  const realList = (files, options = {}) =>
    ownSpecs({ root: repoRoot, runGit: gitReturning(files), ...options });
  const PR_628_FILES = [
    'convex/leagues.test.ts',
    'convex/leagues.ts',
    'convex/lib/leagueInput.ts',
    'convex/lib/organizationInput.ts',
    'convex/lib/seasonInput.test.ts',
    'convex/lib/seasonInput.ts',
    'convex/lib/slugs.ts',
    'convex/lib/tenantWrites.ts',
    'convex/lib/webAddressMessages.test.ts',
    'convex/organizations.ts',
    'convex/organizationsCreate.test.ts',
    'convex/seasons.test.ts',
    'convex/seasons.ts',
    'convex/slugAvailability.test.ts',
    'docs/glossary.md',
    'e2e/create-organization.spec.ts',
    'e2e/league-management.spec.ts',
    'e2e/organization-leagues.spec.ts',
    'e2e/validate-on-blur.spec.ts',
    'e2e/web-address-availability.spec.ts',
    'src/app/core/forms/slug-availability.spec.ts',
    'src/app/core/forms/slug-availability.ts',
    'src/app/organizations/admin/admin-leagues-division.spec.ts',
    'src/app/organizations/admin/admin-leagues.spec.ts',
    'src/app/organizations/admin/league-create-form.ts',
    'src/app/organizations/admin/league-form.ts',
    'src/app/organizations/admin/web-address-preview.ts',
    'src/app/organizations/admin/web-address-status.ts',
    'src/app/organizations/create-organization-page.spec.ts',
    'src/app/organizations/create-organization-page.ts',
    'src/app/organizations/league/league-management.ts',
    'src/app/organizations/league/season-create-form.spec.ts',
    'src/app/organizations/league/season-create-form.ts',
    'src/app/organizations/league/season-form.ts',
  ];
  const PR_632_FILES = [
    'convex/_generated/api.d.ts',
    'convex/lib/adminAttention.ts',
    'convex/organizations.test.ts',
    'convex/organizations.ts',
    'docs/glossary.md',
    'e2e/organization-admin.spec.ts',
    'e2e/organization-leagues-publish-states.spec.ts',
    'e2e/organization-leagues-publish.spec.ts',
    'e2e/organization-leagues.spec.ts',
    'e2e/organization-staff.spec.ts',
    'e2e/shell-sheet.spec.ts',
    'src/app/organizations/admin/admin-attention.ts',
    'src/app/organizations/admin/admin-open-seasons.ts',
    'src/app/organizations/admin/admin-overview.spec.ts',
    'src/app/organizations/admin/admin-overview.ts',
    'src/app/organizations/admin/attention-text.spec.ts',
    'src/app/organizations/admin/attention-text.ts',
  ];
  const MAX_PR_SPECS = 20;
  // Past the cap each file adds its closest specs, so the union may pass the cap.
  const MAX_TIERED_PR_SPECS = 30;

  for (const file of ['convex/users.ts', 'convex/leagues.ts']) {
    it(`lists only the smoke spec for ${file}`, () => {
      assert.deepEqual(realList([file], { ciScope: () => 'app' }), [SMOKE]);
    });
  }

  for (const file of ['docs/conventions/angular.md', 'docs/conventions/convex.md']) {
    it(`lists nothing for ${file}`, () => {
      assert.deepEqual(realList([file]), []);
    });
  }

  it('lists the changed, imported and mockup specs of a change to web address fields', () => {
    const list = realList(PR_628_FILES);
    for (const spec of [
      'e2e/create-organization.spec.ts',
      'e2e/league-management.spec.ts',
      'e2e/organization-leagues.spec.ts',
      'e2e/validate-on-blur.spec.ts',
      'e2e/web-address-availability.spec.ts',
      'e2e/league-management-mockup.spec.ts',
      'e2e/organization-leagues-mockup.spec.ts',
      'e2e/league-page.spec.ts',
    ]) {
      assert.ok(list.includes(spec), spec);
    }
    for (const spec of ['e2e/cache-key.spec.ts', 'e2e/sport-view.spec.ts']) {
      assert.ok(!list.includes(spec), spec);
    }
    assert.ok(list.length <= MAX_TIERED_PR_SPECS, `${list.length} specs`);
  });

  it('lists the specs of an Overview change that the stem rule also found', () => {
    const list = realList(PR_632_FILES);
    for (const spec of ['e2e/organization-staff.spec.ts', 'e2e/shell-sheet.spec.ts']) {
      assert.ok(list.includes(spec), spec);
    }
    assert.ok(list.length <= MAX_PR_SPECS, `${list.length} specs`);
  });

  for (const file of ['public/manifest.webmanifest', 'public/icons/icon-maskable-512.png']) {
    it(`lists the install spec for ${file}`, () => {
      assert.ok(realList([file], { ciScope: () => 'app' }).includes('e2e/install.spec.ts'));
    });
  }

  it('lists the service worker kill switch spec for ngsw-config.json', () => {
    assert.ok(
      realList(['ngsw-config.json'], { ciScope: () => 'app' }).includes(
        'e2e/pwa-kill-switch.spec.ts',
      ),
    );
  });
});

describe('ownSpecs: how a spec refers to a changed file', () => {
  function project(files) {
    const dir = mkdtempSync(join(tmpdir(), 'own-specs-test-'));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  }
  function listIn(files, changed, ciScope = () => 'docs') {
    const dir = project(files);
    try {
      return ownSpecs({
        root: dir,
        runGit: gitReturning(changed),
        ciScope,
        buildGraph: () => ({}),
        select: () => ({ scope: 'affected', specs: [SMOKE] }),
        sessionSpecs: () => [],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  describe('a relative specifier', () => {
    const files = {
      'e2e/a.spec.ts': "import { users } from '../convex/users';",
      'e2e/b.spec.ts': "import { users } from './support/users';",
    };

    it('selects the spec that imports the changed convex file by path', () => {
      assert.deepEqual(listIn(files, ['convex/users.ts']), ['e2e/a.spec.ts']);
    });

    it('selects the spec that imports the changed helper by path', () => {
      assert.deepEqual(listIn(files, ['e2e/support/users.ts']), ['e2e/b.spec.ts']);
    });

    it('reads .js as .ts and .mjs as .mts', () => {
      const list = listIn(
        {
          'e2e/a.spec.ts': "import './support/one.js';",
          'e2e/b.spec.ts': "import './support/two.mjs';",
          'e2e/c.spec.ts': "import './support/three.js';",
        },
        ['e2e/support/one.ts', 'e2e/support/two.mts'],
      );
      assert.deepEqual(list, ['e2e/a.spec.ts', 'e2e/b.spec.ts']);
    });

    it('selects the spec for a specifier that keeps the extension', () => {
      const list = listIn({ 'e2e/a.spec.ts': "import data from './data.json';" }, [
        'e2e/data.json',
      ]);
      assert.deepEqual(list, ['e2e/a.spec.ts']);
    });
  });

  describe('a literal that is not a file name', () => {
    const files = {
      'e2e/a.spec.ts': [
        "import { ConvexHttpClient } from 'convex/browser';",
        "await page.goto('/leagues');",
        "const rows = ['leagues'];",
      ].join('\n'),
    };

    it('leaves a spec out when a route, a word and a package path share the changed stem', () => {
      assert.deepEqual(listIn(files, ['convex/leagues.ts']), []);
      assert.deepEqual(listIn(files, ['convex/browser.ts']), []);
    });
  });

  describe('a quoted file name', () => {
    const files = { 'e2e/a.spec.ts': "readFileSync(join(ROOT, 'angular.json'));" };

    it('selects the spec that quotes the changed file name', () => {
      assert.deepEqual(listIn(files, ['angular.json']), ['e2e/a.spec.ts']);
    });

    it('leaves the spec out for a docs file that shares the stem', () => {
      assert.deepEqual(listIn(files, ['docs/conventions/angular.md']), []);
    });

    it('selects the spec that opens a docs file by its name', () => {
      const list = listIn({ 'e2e/a.spec.ts': "readFileSync(join(ROOT, 'docs', 'guide.md'));" }, [
        'docs/guide.md',
      ]);
      assert.deepEqual(list, ['e2e/a.spec.ts']);
    });

    it('matches the last segment of an absolute or nested path', () => {
      const list = listIn(
        {
          'e2e/a.spec.ts': "await request.get('/manifest.webmanifest');",
          'e2e/b.spec.ts': "await request.get('icons/icon-maskable-512.png');",
        },
        ['public/manifest.webmanifest', 'public/icons/icon-maskable-512.png'],
      );
      assert.deepEqual(list, ['e2e/a.spec.ts', 'e2e/b.spec.ts']);
    });

    it('does not match a literal that merely contains the file name', () => {
      const list = listIn({ 'e2e/a.spec.ts': "await page.goto('/my-angular.json');" }, [
        'angular.json',
      ]);
      assert.deepEqual(list, []);
    });
  });

  describe('a TypeScript parse of the literals', () => {
    const files = {
      'e2e/a.spec.ts': [
        'const url = `/${icon.src}`;',
        "// the app's icon, see 'only-in-comment.png'",
        "await request.get('/icons/x.png');",
        "const config = join(ROOT, 'y.json');",
        "const pattern = /'z.json'/;",
      ].join('\n'),
    };

    it('finds a quoted name after a template with a substitution and an apostrophe in a comment', () => {
      assert.deepEqual(listIn(files, ['public/icons/x.png']), ['e2e/a.spec.ts']);
      assert.deepEqual(listIn(files, ['y.json']), ['e2e/a.spec.ts']);
    });

    it('does not read a comment or a regular expression as a literal', () => {
      assert.deepEqual(listIn(files, ['public/only-in-comment.png']), []);
      assert.deepEqual(listIn(files, ['z.json']), []);
    });

    it('reads the text of a template literal with no substitution and of a template head', () => {
      const list = listIn(
        {
          'e2e/a.spec.ts': 'await request.get(`/plain.png`);',
          'e2e/b.spec.ts': 'await request.get(`head.png${suffix}`);',
          'e2e/c.spec.ts': 'await request.get(`${prefix}tail.png`);',
          'e2e/d.spec.ts': 'await request.get(`${prefix}middle.png${suffix}`);',
        },
        ['public/plain.png', 'public/head.png', 'public/tail.png', 'public/middle.png'],
      );
      assert.deepEqual(list, ['e2e/a.spec.ts', 'e2e/b.spec.ts', 'e2e/c.spec.ts', 'e2e/d.spec.ts']);
    });
  });

  describe('files under e2e/ that are not scripts', () => {
    const files = {
      'e2e/support/env.ts': [
        "import backend from './backend.json';",
        "const assets = ['./page.html', './style.css', './notes.md'];",
        "import { helper } from './helper.mjs';",
      ].join('\n'),
      'e2e/support/helper.mjs': "export const helper = '../../src/m.ts';",
      'e2e/a.spec.ts': "import { env } from './support/env';",
      'e2e/support/backend.json': '{ "path": "../../src/x.ts" }',
      'e2e/support/page.html': '<a href="../../src/y.ts">y</a>',
      'e2e/support/style.css': '@import "../../src/z.ts";',
      'e2e/support/notes.md': 'See "../../src/w.ts".',
    };

    it('selects the specs that import a changed json file through its importer', () => {
      assert.deepEqual(listIn(files, ['e2e/support/backend.json']), ['e2e/a.spec.ts']);
    });

    it('reads a .mjs file under e2e/ for references', () => {
      assert.deepEqual(listIn(files, ['src/m.ts']), ['e2e/a.spec.ts']);
    });

    for (const target of ['src/x.ts', 'src/y.ts', 'src/z.ts', 'src/w.ts']) {
      it(`adds no reference from a json, html, css or md file that names ${target}`, () => {
        assert.deepEqual(listIn(files, [target]), []);
      });
    }
  });

  describe('the chain of importers', () => {
    it('follows a change through a helper to the specs that import it', () => {
      const list = listIn(
        {
          'e2e/support/guard.ts': 'export const guard = 1;',
          'e2e/support/fixtures.ts': "import { guard } from './guard';",
          'e2e/a.spec.ts': "import { test } from './support/fixtures';",
          'e2e/b.spec.ts': "import { other } from './support/other';",
        },
        ['e2e/support/guard.ts'],
      );
      assert.deepEqual(list, ['e2e/a.spec.ts']);
    });
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
    const logged = [];
    return {
      ran,
      printed,
      received,
      logged,
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
        log: (message) => logged.push(message),
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

  for (const flagArguments of [
    ['--project', 'chromium-desktop'],
    ['--workers', '1'],
    ['-g', 'sign in'],
    ['--shard', '1/2'],
    ['--repeat-each', '3', '--project=chromium-mobile'],
  ]) {
    it(`passes ${flagArguments.join(' ')} to Playwright in order and names no spec`, async () => {
      const { ran, received, result } = run(flagArguments, { specs: ['e2e/smoke.spec.ts'] });
      assert.equal(await result, 0);
      assert.deepEqual(received[0].named, []);
      assert.deepEqual(ran, [['e2e/smoke.spec.ts', ...flagArguments]]);
    });
  }

  it('names a spec path that follows a flag, and keeps the flag value', async () => {
    const { ran, received, result } = run(['--headed', 'e2e/x.spec.ts', '--workers', '1'], {
      specs: ['e2e/x.spec.ts'],
    });
    await result;
    assert.deepEqual(received[0].named, ['e2e/x.spec.ts']);
    assert.deepEqual(ran, [['e2e/x.spec.ts', '--headed', '--workers', '1']]);
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

  it('sends the tier lines to stderr, so --list stdout stays one spec per line', async () => {
    const { printed, logged, received, result } = run(['--list'], { specs: ['e2e/a.spec.ts'] });
    await result;
    received[0].log('e2e:own: src/app/x.ts: none');
    assert.deepEqual(printed, ['e2e/a.spec.ts']);
    assert.deepEqual(logged, ['e2e:own: src/app/x.ts: none']);
  });

  it('keeps --list out of the flags and the named specs', async () => {
    const { received, result } = run(['--list', 'e2e/x.spec.ts'], { specs: [] });
    await result;
    assert.deepEqual(received[0].named, ['e2e/x.spec.ts']);
  });

  describe('--help and -h', () => {
    for (const argv of [
      ['--help'],
      ['-h'],
      ['--help', 'e2e/x.spec.ts'],
      ['e2e/x.spec.ts', '-h'],
      ['--list', '--help'],
      ['--headed', '--help'],
      ['--foo', '--help'],
    ]) {
      it(`prints usage to stdout and returns 0 for ${argv.join(' ')}`, async () => {
        const { ran, printed, received, result } = run(argv, { specs: ['e2e/x.spec.ts'] });
        assert.equal(await result, 0);
        assert.deepEqual(received, []);
        assert.deepEqual(ran, []);
        assert.ok(printed.length > 0);
      });
    }

    it('names the command, the options, and where the rest is documented', async () => {
      const { printed, result } = run(['--help']);
      await result;
      const usage = printed.join('\n');
      for (const text of [
        'npm run e2e:own -- [--list] [spec ...] [playwright test options]',
        '--list',
        '-h, --help',
        'docs/process/dev-cycle.md (Own e2e specs)',
        'npx playwright test --help',
      ]) {
        assert.ok(usage.includes(text), `usage lacks ${text}`);
      }
    });

    it('treats -h as a value after an option that requires one', async () => {
      const { ran, printed, result } = run(['-g', '-h'], { specs: ['e2e/smoke.spec.ts'] });
      assert.equal(await result, 0);
      assert.deepEqual(printed, []);
      assert.deepEqual(ran, [['e2e/smoke.spec.ts', '-g', '-h']]);
    });

    it('treats --help after a bare -- as a test filter', async () => {
      const { ran, result } = run(['--', '--help'], { specs: ['e2e/smoke.spec.ts'] });
      assert.equal(await result, 0);
      assert.deepEqual(ran, [['e2e/smoke.spec.ts', '--', '--help']]);
    });
  });

  describe('unknown options', () => {
    for (const option of [
      '--foo',
      '--foo=1',
      '--lst',
      '--helpme',
      '-z',
      '-xj4',
      '--headed=1',
      '--list=1',
    ]) {
      it(`names ${option} on one stderr line and returns 2 without reading the diff or running`, async () => {
        const { ran, printed, received, logged, result } = run(['e2e/x.spec.ts', option], {
          specs: ['e2e/x.spec.ts'],
        });
        assert.equal(await result, 2);
        assert.deepEqual(received, []);
        assert.deepEqual(ran, []);
        assert.deepEqual(printed, []);
        assert.equal(logged.length, 1);
        assert.ok(logged[0].includes(option), logged[0]);
        assert.ok(logged[0].includes('npm run e2e:own -- --help'), logged[0]);
        assert.ok(!logged[0].includes('\n'));
      });
    }

    it('rejects an unknown option that follows an option with an optional value', async () => {
      const { ran, logged, result } = run(['--shuffle', '--foo'], { specs: [] });
      assert.equal(await result, 2);
      assert.deepEqual(ran, []);
      assert.ok(logged[0].includes('--foo'));
    });

    it('rejects an unknown option under --list too', async () => {
      const { printed, received, result } = run(['--list', '--foo'], { specs: [] });
      assert.equal(await result, 2);
      assert.deepEqual(received, []);
      assert.deepEqual(printed, []);
    });
  });

  describe('the Playwright options', () => {
    for (const { names, value } of PLAYWRIGHT_TEST_OPTIONS.filter(
      ({ names }) => !names.includes('--list'),
    )) {
      for (const name of names) {
        it(`passes ${name} after the specs${value === 'none' ? '' : ' with and without =value'}`, async () => {
          const forms =
            name.startsWith('--') && value !== 'none' ? [[`${name}=x`], [name, 'x']] : [[name]];
          for (const form of forms) {
            const { ran, logged, result } = run(['e2e/x.spec.ts', ...form], {
              specs: ['e2e/x.spec.ts'],
              code: STUB_EXIT_CODE,
            });
            assert.equal(await result, STUB_EXIT_CODE);
            assert.deepEqual(
              logged.filter((line) => !line.startsWith('e2e:own: running')),
              [],
            );
            assert.deepEqual(ran, [['e2e/x.spec.ts', ...form]]);
          }
        });
      }
    }

    it('lists --list as an option that takes no value', () => {
      const list = PLAYWRIGHT_TEST_OPTIONS.find(({ names }) => names.includes('--list'));
      assert.equal(list?.value, 'none');
    });
  });

  describe('forms Playwright reads', () => {
    for (const argv of [
      ['-j4'],
      ['-gtitle'],
      ['-uall'],
      ['-g', '-slow'],
      ['--grep', '-slow'],
      ['--grep', '-slow', 'e2e/x.spec.ts'],
      ['--shuffle', 'e2e/x.spec.ts', '--headed'],
      ['--', '--anything'],
      ['--', '--anything', '-z'],
      ['-j4', '--', '--foo=1'],
    ]) {
      it(`passes ${argv.join(' ')} to run in order and returns its code`, async () => {
        const { ran, result } = run(argv, { specs: ['e2e/smoke.spec.ts'], code: STUB_EXIT_CODE });
        assert.equal(await result, STUB_EXIT_CODE);
        assert.equal(ran.length, 1);
        assert.deepEqual(
          ran[0].slice(1).filter((arg) => !arg.startsWith('e2e/x')),
          argv.filter((arg) => !arg.startsWith('e2e/x')),
        );
      });
    }

    it('keeps a spec after a dash-leading value as a named spec', async () => {
      const { ran, received, result } = run(['--grep', '-slow', 'e2e/x.spec.ts'], {
        specs: ['e2e/x.spec.ts'],
      });
      await result;
      assert.deepEqual(received[0].named, ['e2e/x.spec.ts']);
      assert.deepEqual(ran, [['e2e/x.spec.ts', '--grep', '-slow']]);
    });

    it('keeps the words after a dash-leading value out of the named specs', async () => {
      const { received, result } = run(['-g', '-slow', 'checkout'], { specs: [] });
      await result;
      assert.deepEqual(received[0].named, ['checkout']);
    });
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
    symlinkSync(join(repoRoot, 'node_modules'), join(dir, 'node_modules'));
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

  const entry = (dir, args, tmp) =>
    spawnSync(process.execPath, [join(dir, 'scripts', 'own-specs.mjs'), ...args], {
      encoding: 'utf8',
      env: tmp === undefined ? process.env : { ...process.env, TMPDIR: tmp },
    });
  const ranWith = (file) => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return undefined;
    }
  };

  it('runs the smoke floor through the runner for an app-scope change, and exits with its code', () => {
    const { dir, ranFile } = project(['angular.json']);
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
    const { dir, ranFile } = project(['angular.json']);
    try {
      const result = entry(dir, ['--list']);
      assert.equal(result.status, 0);
      assert.equal(result.stdout, `${SMOKE}\n`);
      assert.equal(ranWith(ranFile), undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints the usage and starts nothing for --help', () => {
    const { dir, ranFile } = project(['angular.json']);
    const privateTmp = mkdtempSync(join(tmpdir(), 'own-specs-private-tmp-'));
    try {
      const result = entry(dir, ['--help'], privateTmp);
      assert.equal(result.status, 0);
      assert.ok(result.stdout.includes('npm run e2e:own -- [--list]'));
      assert.equal(ranWith(ranFile), undefined);
      assert.deepEqual(readdirSync(privateTmp), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(privateTmp, { recursive: true, force: true });
    }
  });

  it('exits 2 and starts nothing for an unknown option', () => {
    const { dir, ranFile } = project(['angular.json']);
    const privateTmp = mkdtempSync(join(tmpdir(), 'own-specs-private-tmp-'));
    try {
      const result = entry(dir, ['--foo'], privateTmp);
      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr.trim().split('\n').length, 1);
      assert.equal(ranWith(ranFile), undefined);
      assert.deepEqual(readdirSync(privateTmp), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(privateTmp, { recursive: true, force: true });
    }
  });
});

describe('PLAYWRIGHT_TEST_OPTIONS', () => {
  const OPTION_LINE = /^ {2}(-\S.*?)(?: {2,}|$)/;
  const VALUE_KIND = { '<': 'required', '[': 'optional' };

  function installedOptions() {
    const help = execFileSync(
      process.execPath,
      [join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '--help'],
      { encoding: 'utf8', cwd: repoRoot, env: { ...process.env, COLUMNS: '120' } },
    );
    const kinds = new Map();
    for (const line of help.split('\n')) {
      const flags = OPTION_LINE.exec(line)?.[1];
      if (flags === undefined || flags === '-h, --help') continue;
      const [, placeholder] = /\s([<[].*)$/.exec(flags) ?? [];
      const kind = VALUE_KIND[placeholder?.[0]] ?? 'none';
      for (const name of flags.replace(/\s[<[].*$/, '').split(', ')) kinds.set(name, kind);
    }
    return kinds;
  }

  it('equals the options of the installed playwright test, by name and value kind', () => {
    const installed = installedOptions();
    const listed = new Map(
      PLAYWRIGHT_TEST_OPTIONS.flatMap(({ names, value }) => names.map((name) => [name, value])),
    );
    const problems = [
      ...[...installed.keys()]
        .filter((name) => !listed.has(name))
        .map((name) => `added by Playwright: ${name}`),
      ...[...listed.keys()]
        .filter((name) => !installed.has(name))
        .map((name) => `removed by Playwright: ${name}`),
      ...[...listed]
        .filter(([name, kind]) => installed.has(name) && installed.get(name) !== kind)
        .map(
          ([name, kind]) =>
            `value kind of ${name}: listed ${kind}, installed ${installed.get(name)}`,
        ),
    ];
    assert.deepEqual(
      problems,
      [],
      `Update PLAYWRIGHT_TEST_OPTIONS in scripts/own-specs.mjs:\n${problems.join('\n')}`,
    );
  });

  it('parses the installed help into options, so an empty parse cannot pass', () => {
    assert.ok(installedOptions().size > 20);
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

  const OLD_WORDING = [
    /else only the/,
    /only the `\*-mockup\.spec\.ts` specs among them/,
    /only its `\*-mockup\.spec\.ts` specs are added/,
  ];

  for (const path of documents) {
    it(`${path} states the tiers, not the old mockup-only fallback`, () => {
      const text = read(path);
      assert.match(text, /closest|own rule/);
      assert.match(text, /mockup/);
      for (const pattern of OLD_WORDING) assert.doesNotMatch(text, pattern);
    });
  }

  it('dev-cycle.md names the cap constant, the three tiers, and the stderr lines', () => {
    const text = read('docs/process/dev-cycle.md');
    assert.match(text, /SCREEN_SPEC_CAP/);
    assert.match(text, /-mockup\.spec\.ts/);
    for (const tier of ['**Whole selection:**', '**Own rule:**', '**Routes:**']) {
      assert.ok(text.includes(tier), tier);
    }
    for (const line of [
      'whole, <n> specs',
      'own rule, <n> specs',
      'routes, <n> specs',
      ': none`',
    ]) {
      assert.ok(text.includes(line), line);
    }
    assert.match(text, /A tier with no specs does not fit/);
    assert.match(text, /A full-suite file tries no tier/);
  });

  describe('the import bullet of Own e2e specs', () => {
    const section = () => {
      const text = read('docs/process/dev-cycle.md');
      const start = text.indexOf('#### Own e2e specs');
      return text.slice(start, text.indexOf('### 5. Test', start));
    };
    const bullet = () => {
      const text = section();
      const start = text.indexOf('- every spec that');
      return text.slice(start, text.indexOf('- the screen specs', start));
    };

    it('states the relative specifier and the last segment match', () => {
      assert.match(bullet(), /relative specifier/);
      assert.match(bullet(), /last `\/` segment/);
    });

    it('says the literals come from a TypeScript parse of the e2e script files', () => {
      assert.match(bullet(), /createSourceFile/);
    });

    it('says docs and convex files match only by a literal that names them', () => {
      assert.match(bullet(), /`convex\/` or docs/);
    });

    it('has no git grep stem command', () => {
      assert.doesNotMatch(section(), /git grep/);
    });
  });

  it('the CI pipeline decision records the amendment with the owner answer and no technology gate', () => {
    const text = read('docs/decisions/0009-ci-pipeline.md');
    assert.match(text, /issues\/634#issuecomment-6786641125/);
    assert.match(text, /not a `gate:technology` change/);
  });

  it('the CI pipeline decision records the closest-per-file amendment with the owner answer', () => {
    const text = read('docs/decisions/0009-ci-pipeline.md');
    assert.match(text, /issues\/691#issuecomment-6829898486/);
    assert.match(text, /Amendment: past the cap, each file keeps its closest specs/);
  });

  it('package.json has the e2e:own script', () => {
    assert.equal(JSON.parse(read('package.json')).scripts['e2e:own'], 'node scripts/own-specs.mjs');
  });
});
