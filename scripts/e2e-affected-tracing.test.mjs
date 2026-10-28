import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import {
  ALWAYS,
  PUBLIC_QUERIES,
  buildImportGraph,
  deriveSessionSpecs,
  findPublicPageSpecs,
  readsPublicPage,
  selectSpecs,
} from './e2e-affected.mjs';

const repoRoot = join(import.meta.dirname, '..');
const sessionSpecs = deriveSessionSpecs(repoRoot);
const pr = { event: 'pull_request', base: 'main' };
const FULL = 'FULL';
const accept = 'e2e/accept-invite.spec.ts';
const findPage = 'e2e/find-a-league.spec.ts';
const findOrganizations = 'e2e/find-organizations.spec.ts';
const withAlways = (...filters) => [...new Set([...ALWAYS, ...filters])].sort();

/**
 * @param {string} root
 * @param {string[]} files
 * @returns {{ specs: string[], reasons: string[] }}
 */
function select(root, files) {
  const reasons = [];
  const selection = selectSpecs(files, {
    ...pr,
    root,
    sessionSpecs,
    warn: (reason) => reasons.push(reason),
  });
  return { specs: selection.scope === 'full' ? [FULL] : selection.specs, reasons };
}

/** @param {string[]} files */
const realSpecs = (files) => select(repoRoot, files).specs;

/**
 * @param {Record<string, string>} files
 * @param {(root: string) => void} body
 */
function withRepo(files, body) {
  const root = mkdtempSync(join(tmpdir(), 'e2e-affected-'));
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, dirname(path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// src/app/invites/ is mapped to accept-invite, so a chain that ends there selects that spec.
const PAGE = 'src/app/invites/page.ts';
const page = (text) => ({ [PAGE]: text });

describe('tracing a file with no rule to the files that import it', () => {
  it('follows a chain of importers to the first file with a rule', () => {
    withRepo(
      {
        'src/app/util/a.ts': 'export const a = 1;\n',
        'src/app/util/b.ts': "import { a } from './a';\nexport const b = a;\n",
        ...page("import { b } from '../util/b';\n"),
      },
      (root) => {
        assert.deepEqual(select(root, ['src/app/util/a.ts']).specs, withAlways(accept));
      },
    );
  });

  it('unites the specs of every importer', () => {
    withRepo(
      {
        'src/app/util/a.ts': 'export const a = 1;\n',
        ...page("import { a } from '../util/a';\n"),
        'src/app/find/find-page.ts': "import { a } from '../util/a';\n",
      },
      (root) => {
        assert.deepEqual(
          select(root, ['src/app/util/a.ts']).specs,
          withAlways(accept, 'e2e/cache-key.spec.ts', findPage, findOrganizations),
        );
      },
    );
  });

  it('survives a cycle that a file with a rule imports', () => {
    withRepo(
      {
        'src/app/util/a.ts': "import { b } from './b';\nexport const a = 1;\n",
        'src/app/util/b.ts': "import { a } from './a';\nexport const b = 1;\n",
        ...page("import { a } from '../util/a';\n"),
      },
      (root) => {
        assert.deepEqual(select(root, ['src/app/util/b.ts']).specs, withAlways(accept));
      },
    );
  });

  it('runs the full suite for a cycle that no file with a rule imports', () => {
    withRepo(
      {
        'src/app/util/a.ts': "import { b } from './b';\nexport const a = 1;\n",
        'src/app/util/b.ts': "import { a } from './a';\nexport const b = 1;\n",
        ...page('export const x = 1;\n'),
      },
      (root) => {
        const result = select(root, ['src/app/util/a.ts']);
        assert.deepEqual(result.specs, [FULL]);
        assert.match(result.reasons.join('\n'), /cycle/);
      },
    );
  });

  const forms = {
    'a named import over several lines': "import {\n  a,\n  b,\n} from '../util/a';\n",
    'a double-quoted import': 'import { a } from "../util/a";\n',
    'an import type': "import type { A } from '../util/a';\n",
    'a side-effect import': "import '../util/a';\n",
    'a re-export': "export { a } from '../util/a';\n",
    'an export star': "export * from '../util/a';\n",
    'a multi-line re-export': "export {\n  a,\n  b,\n} from '../util/a';\n",
  };
  for (const [name, line] of Object.entries(forms)) {
    it(`counts ${name} as an import`, () => {
      withRepo({ 'src/app/util/a.ts': 'export const a = 1;\n', ...page(line) }, (root) => {
        assert.deepEqual(select(root, ['src/app/util/a.ts']).specs, withAlways(accept));
      });
    });
  }

  it('resolves a .js specifier that names a .ts file, as convex/_generated/api.d.ts writes them', () => {
    withRepo(
      { 'src/app/util/a.ts': 'export const a = 1;\n', ...page("import '../util/a.js';\n") },
      (root) => {
        assert.deepEqual(select(root, ['src/app/util/a.ts']).specs, withAlways(accept));
      },
    );
  });

  it('resolves a .mjs specifier that names a .mts file', () => {
    withRepo(
      { 'src/app/util/a.mts': 'export const a = 1;\n', ...page("import '../util/a.mjs';\n") },
      (root) => {
        assert.deepEqual(select(root, ['src/app/util/a.mts']).specs, withAlways(accept));
      },
    );
  });

  it('resolves a directory import to its index.ts', () => {
    withRepo(
      {
        'src/app/core/data/index.ts': 'export const a = 1;\n',
        ...page("import { a } from '../core/data';\n"),
      },
      (root) => {
        assert.deepEqual(select(root, ['src/app/core/data/index.ts']).specs, withAlways(accept));
      },
    );
  });

  it('resolves the exact file name, including a non-code file', () => {
    withRepo(
      { 'src/app/util/data.json': '{}\n', ...page("import data from '../util/data.json';\n") },
      (root) => {
        const result = select(root, ['src/app/util/a.ts']);
        assert.deepEqual(result.specs, [FULL]);
        assert.deepEqual(
          [...buildImportGraph(root).importers.get('src/app/util/data.json')],
          [PAGE],
        );
      },
    );
  });

  it('runs the full suite, with the reason, when a relative specifier resolves to no file', () => {
    withRepo(
      {
        'src/app/util/a.ts': 'export const a = 1;\n',
        ...page("import { a } from '../util/a';\nimport { gone } from '../util/gone';\n"),
      },
      (root) => {
        const result = select(root, ['src/app/util/a.ts']);
        assert.deepEqual(result.specs, [FULL]);
        assert.match(result.reasons.join('\n'), /'..\/util\/gone', which resolves to no file/);
      },
    );
  });

  it('ignores a bare package specifier', () => {
    withRepo(
      {
        'src/app/util/a.ts': 'export const a = 1;\n',
        ...page("import { a } from '../util/a';\nimport { x } from '@angular/core';\n"),
      },
      (root) => {
        assert.deepEqual(select(root, ['src/app/util/a.ts']).specs, withAlways(accept));
      },
    );
  });

  it('runs the full suite for a file that no file imports', () => {
    withRepo({ 'src/app/util/a.ts': 'export const a = 1;\n', ...page('export {};\n') }, (root) => {
      const result = select(root, ['src/app/util/a.ts']);
      assert.deepEqual(result.specs, [FULL]);
      assert.match(result.reasons.join('\n'), /no file imports/);
    });
  });

  it('runs the full suite when an importer chain ends at a file with no rule and no importer', () => {
    withRepo(
      {
        'src/app/util/a.ts': 'export const a = 1;\n',
        'src/app/util/b.ts': "import { a } from './a';\n",
        'src/app/util/c.ts': "import { b } from './b';\n",
      },
      (root) => {
        assert.deepEqual(select(root, ['src/app/util/a.ts']).specs, [FULL]);
      },
    );
  });

  it('runs the full suite when one importer chain ends in nothing even if another reaches a rule', () => {
    withRepo(
      {
        'src/app/util/a.ts': 'export const a = 1;\n',
        'src/app/util/orphan.ts': "import { a } from './a';\n",
        ...page("import { a } from '../util/a';\n"),
      },
      (root) => {
        assert.deepEqual(select(root, ['src/app/util/a.ts']).specs, [FULL]);
      },
    );
  });

  it('runs the full suite for a file that is not on disk', () => {
    withRepo(page('export {};\n'), (root) => {
      const result = select(root, ['src/app/util/deleted.ts']);
      assert.deepEqual(result.specs, [FULL]);
      assert.match(result.reasons.join('\n'), /not on disk/);
    });
  });

  it('runs the full suite for a non-code file that no rule names, even when code imports it', () => {
    withRepo(
      { 'src/app/util/data.json': '{}\n', ...page("import data from '../util/data.json';\n") },
      (root) => {
        const result = select(root, ['src/app/util/data.json']);
        assert.deepEqual(result.specs, [FULL]);
        assert.match(result.reasons.join('\n'), /not a code file/);
      },
    );
  });

  it('keeps the rule of an imported file that has one, and adds the specs of its importer', () => {
    withRepo(
      {
        'src/app/find/find-page.ts': 'export const a = 1;\n',
        ...page("import { a } from '../find/find-page';\n"),
      },
      (root) => {
        assert.deepEqual(
          select(root, ['src/app/find/find-page.ts']).specs,
          withAlways(accept, 'e2e/cache-key.spec.ts', findPage, findOrganizations),
        );
      },
    );
  });

  describe('dynamic imports', () => {
    it('runs the full suite for the target of an import(), even with a static importer', () => {
      withRepo(
        {
          'src/app/util/lazy.ts': 'export const a = 1;\n',
          'src/app/util/loader.ts': "export const load = () => import('./lazy');\n",
          ...page("import type { a } from '../util/lazy';\n"),
        },
        (root) => {
          const result = select(root, ['src/app/util/lazy.ts']);
          assert.deepEqual(result.specs, [FULL]);
          assert.match(result.reasons.join('\n'), /dynamic import/);
        },
      );
    });

    it('runs the full suite for the target of a typeof import()', () => {
      withRepo(
        {
          'src/app/util/lazy.ts': 'export const a = 1;\n',
          ...page("export type Lazy = typeof import('../util/lazy');\n"),
        },
        (root) => {
          assert.deepEqual(select(root, ['src/app/util/lazy.ts']).specs, [FULL]);
        },
      );
    });

    it('runs the full suite when a file in the chain is the target of an import()', () => {
      withRepo(
        {
          'src/app/util/a.ts': 'export const a = 1;\n',
          'src/app/util/lazy.ts': "import { a } from './a';\n",
          'src/app/util/loader.ts': "export const load = () => import('./lazy');\n",
          ...page("import { a } from '../util/lazy';\n"),
        },
        (root) => {
          assert.deepEqual(select(root, ['src/app/util/a.ts']).specs, [FULL]);
        },
      );
    });

    it('keeps the rule of a routed page that is loaded with an import()', () => {
      withRepo(
        {
          'src/app/find/find-page.ts': 'export const a = 1;\n',
          'src/app/app.routes.ts': "export const r = () => import('./find/find-page');\n",
        },
        (root) => {
          assert.deepEqual(
            select(root, ['src/app/find/find-page.ts']).specs,
            withAlways('e2e/cache-key.spec.ts', findPage, findOrganizations),
          );
        },
      );
    });

    it('runs the full suite for an import() of a computed relative path', () => {
      withRepo(
        {
          'src/app/util/a.ts': 'export const a = 1;\n',
          ...page(
            "import { a } from '../util/a';\nexport const l = (n) => import(`../util/${n}`);\n",
          ),
        },
        (root) => {
          const result = select(root, ['src/app/util/a.ts']);
          assert.deepEqual(result.specs, [FULL]);
          assert.match(result.reasons.join('\n'), /computed path/);
        },
      );
    });
  });

  describe('files that are not importers', () => {
    const unit = {
      'a unit spec': 'src/app/util/a.spec.ts',
      'a Convex test': 'convex/a.test.ts',
      'a script test': 'scripts/a.test.mjs',
      'a test double': 'src/app/util/testing/double.ts',
      'the Convex test setup': 'convex/test.setup.ts',
      'a generated Convex type file': 'convex/_generated/api.d.ts',
    };
    for (const [name, path] of Object.entries(unit)) {
      it(`does not count ${name} as an importer`, () => {
        withRepo(
          {
            'src/app/util/a.ts': 'export const a = 1;\n',
            [path]: `import '${relativeTo(path, 'src/app/util/a')}';\n`,
          },
          (root) => {
            const result = select(root, ['src/app/util/a.ts']);
            assert.deepEqual(result.specs, [FULL]);
            assert.match(result.reasons.join('\n'), /no file imports/);
          },
        );
      });
    }

    it('adds nothing for a unit spec that imports a file a page also imports', () => {
      withRepo(
        {
          'src/app/util/a.ts': 'export const a = 1;\n',
          'src/app/util/a.spec.ts': "import './a';\n",
          ...page("import { a } from '../util/a';\n"),
        },
        (root) => {
          assert.deepEqual(select(root, ['src/app/util/a.ts']).specs, withAlways(accept));
        },
      );
    });

    it('does not read a unit spec for a specifier that resolves to no file', () => {
      withRepo(
        {
          'src/app/util/a.ts': 'export const a = 1;\n',
          'src/app/util/a.spec.ts': "import './gone';\n",
          ...page("import { a } from '../util/a';\n"),
        },
        (root) => {
          assert.deepEqual(select(root, ['src/app/util/a.ts']).specs, withAlways(accept));
        },
      );
    });

    it('counts an e2e spec as an importer', () => {
      withRepo(
        {
          'e2e/support/helper.ts': 'export const h = 1;\n',
          'e2e/thing.spec.ts': "import { h } from './support/helper';\n",
        },
        (root) => {
          assert.deepEqual(
            select(root, ['e2e/support/helper.ts']).specs,
            withAlways('e2e/thing.spec.ts'),
          );
        },
      );
    });

    it('does not scan node_modules, dot directories, or build output for importers', () => {
      withRepo(
        {
          'src/app/util/a.ts': 'export const a = 1;\n',
          ...page("import { a } from '../util/a';\n"),
          'node_modules/pkg/x.ts': "import '../../src/app/util/a';\n",
          '.claude/worktrees/w/src/app/invites/page.ts':
            "import '../../../../../src/app/util/a';\n",
          'dist/x.mjs': "import '../src/app/util/a';\n",
        },
        (root) => {
          assert.deepEqual(select(root, ['src/app/util/a.ts']).specs, withAlways(accept));
        },
      );
    });

    for (const directory of [
      'node_modules',
      '.angular',
      '.convex-e2e',
      'dist',
      'out-tsc',
      'coverage',
      'tmp',
      'test-results',
      'playwright-report',
      'blob-report',
    ]) {
      it(`does not read the unresolved specifiers of ${directory}`, () => {
        withRepo(
          {
            'src/app/util/a.ts': 'export const a = 1;\n',
            ...page("import { a } from '../util/a';\n"),
            [`${directory}/x.ts`]: "import './missing';\n",
          },
          (root) => {
            assert.deepEqual(select(root, ['src/app/util/a.ts']).specs, withAlways(accept));
          },
        );
      });
    }
  });

  describe('roots', () => {
    it('runs the full suite for a Convex module reached only through convex/_generated', () => {
      withRepo(
        {
          'convex/widgets.ts': 'export const list = 1;\n',
          'convex/_generated/api.d.ts': 'import type * as widgets from "../widgets.js";\n',
          ...page('export {};\n'),
        },
        (root) => {
          const result = select(root, ['convex/widgets.ts']);
          assert.deepEqual(result.specs, [FULL]);
          assert.match(result.reasons.join('\n'), /Convex module/);
        },
      );
    });

    it('runs the full suite for a lib file that only an unmapped Convex module imports', () => {
      withRepo(
        {
          'convex/lib/helper.ts': 'export const h = 1;\n',
          'convex/widgets.ts': "import { h } from './lib/helper';\n",
          'convex/organizations.ts': 'export const o = 1;\n',
        },
        (root) => {
          assert.deepEqual(select(root, ['convex/lib/helper.ts']).specs, [FULL]);
        },
      );
    });

    it('selects the specs of the mapped Convex module that imports a lib file', () => {
      withRepo(
        {
          'convex/lib/helper.ts': 'export const h = 1;\n',
          'convex/search.ts': "import { h } from './lib/helper';\n",
        },
        (root) => {
          assert.deepEqual(
            select(root, ['convex/lib/helper.ts']).specs,
            withAlways('e2e/cache-key.spec.ts', findPage, findOrganizations),
          );
        },
      );
    });

    for (const importer of ['playwright.config.ts', 'vitest.config.mts', 'scripts/tool.mjs']) {
      it(`runs the full suite for a file that ${importer} imports`, () => {
        withRepo(
          {
            'e2e/support/helper.ts': 'export const h = 1;\n',
            [importer]: `import '${relativeTo(importer, 'e2e/support/helper')}';\n`,
            'e2e/thing.spec.ts': "import { h } from './support/helper';\n",
          },
          (root) => {
            assert.deepEqual(select(root, ['e2e/support/helper.ts']).specs, [FULL]);
          },
        );
      });
    }
  });

  describe('when the graph cannot be read', () => {
    it('runs the full suite, with the reason, when the repo cannot be read', () => {
      const result = select(join(tmpdir(), 'e2e-affected-missing-root'), ['src/app/util/a.ts']);
      assert.deepEqual(result.specs, [FULL]);
      assert.match(result.reasons.join('\n'), /import graph cannot be read/);
    });

    it('runs the full suite when the caller gives no repo root', () => {
      const selection = selectSpecs(['src/app/util/a.ts'], { ...pr, warn: () => {} });
      assert.deepEqual(selection, { scope: 'full' });
    });

    it('does not read the graph for files that have a rule', () => {
      const selection = selectSpecs(['convex/search.ts'], {
        ...pr,
        root: join(tmpdir(), 'e2e-affected-missing-root'),
      });
      assert.deepEqual(selection, {
        scope: 'affected',
        specs: withAlways('e2e/cache-key.spec.ts', findPage),
      });
    });
  });
});

/**
 * @param {string} from
 * @param {string} to
 */
function relativeTo(from, to) {
  const up = dirname(from) === '.' ? './' : '../'.repeat(dirname(from).split('/').length);
  return `${up}${to}`;
}

describe('the rules for files that tracing cannot place', () => {
  const want = (...filters) => withAlways(...filters);

  it('runs the full suite for the Convex modules that Convex loads by file name', () => {
    for (const file of [
      'convex/schema.ts',
      'convex/testing.ts',
      'convex/http.ts',
      'convex/health.ts',
    ]) {
      assert.deepEqual(realSpecs([file]), [FULL], file);
    }
  });

  it('runs the full suite for the Playwright config and the support files it imports', () => {
    for (const file of [
      'playwright.config.ts',
      'e2e/support/viewport-agnostic.ts',
      'e2e/support/raw-http.ts',
      'e2e/support/env.ts',
      'e2e/global-setup.ts',
    ]) {
      assert.deepEqual(realSpecs([file]), [FULL], file);
    }
  });

  it('runs only the always set for the generated type files', () => {
    for (const file of ['api.d.ts', 'dataModel.d.ts', 'server.d.ts']) {
      assert.deepEqual(realSpecs([`convex/_generated/${file}`]), want(), file);
    }
  });

  it('runs the full suite for every other generated file', () => {
    for (const file of ['api.js', 'server.js', 'ai/ai-files.state.json']) {
      assert.deepEqual(realSpecs([`convex/_generated/${file}`]), [FULL], file);
    }
  });

  it('runs only the always set for the e2e run tooling', () => {
    for (const file of ['e2e-lock', 'e2e-affected', 'e2e-affected-local']) {
      assert.deepEqual(realSpecs([`scripts/${file}.mjs`]), want(), file);
    }
  });

  it('runs the full suite for the scripts that set the backend and the build environment', () => {
    for (const file of ['e2e', 'e2e-convex']) {
      assert.deepEqual(realSpecs([`scripts/${file}.mjs`]), [FULL], file);
    }
  });

  it('puts the backend spec in the always set', () => {
    assert.ok(ALWAYS.includes('e2e/convex-backend.spec.ts'));
  });

  describe('the e2e support files', () => {
    const e2eDir = join(repoRoot, 'e2e');
    const supportDir = join(e2eDir, 'support');
    const read = (path) => readFileSync(join(repoRoot, path), 'utf8');
    const supportNames = readdirSync(supportDir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => name.slice(0, -3));
    const specFiles = ['e2e', 'e2e/harness'].flatMap((dir) =>
      readdirSync(join(repoRoot, dir))
        .filter((name) => name.endsWith('.spec.ts'))
        .map((name) => `${dir}/${name}`),
    );

    // Written separately from the tracing: a support file reaches a spec through the specs that name
    // it in an import, or through another support file that does.
    function specsReaching(name) {
      const reaching = new Set([name]);
      for (let grew = true; grew;) {
        grew = false;
        for (const other of supportNames) {
          if (reaching.has(other)) continue;
          const text = read(`e2e/support/${other}.ts`);
          if ([...reaching].some((target) => new RegExp(`from '\\./${target}'`).test(text))) {
            reaching.add(other);
            grew = true;
          }
        }
      }
      return specFiles.filter((file) =>
        [...reaching].some((target) =>
          new RegExp(`from '[^']*support/${target}'`).test(read(file)),
        ),
      );
    }

    for (const name of ['tenant', 'hold-queries']) {
      it(`runs exactly the specs that import ${name}.ts, directly or through another support file`, () => {
        const expected = specsReaching(name);
        assert.ok(expected.length >= 5, expected.join(', '));
        assert.deepEqual(realSpecs([`e2e/support/${name}.ts`]), want(...expected));
      });
    }

    it('runs the full suite for the support files that global setup imports', () => {
      assert.deepEqual(realSpecs(['e2e/support/convex.ts']), [FULL]);
    });
  });

  describe('convex/customLevels.ts', () => {
    // Written separately from the rule: the non-test src/ files that name api.customLevels.
    const srcFiles = (dir) =>
      readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return entry.name === 'testing' ? [] : srcFiles(path);
        return /\.ts$/.test(path) && !/\.spec\.ts$/.test(path) ? [path] : [];
      });
    const users = srcFiles('src').filter((file) =>
      /\bapi\.customLevels\b/.test(readFileSync(join(repoRoot, file), 'utf8')),
    );

    it('finds the src files that reference api.customLevels', () => {
      assert.ok(
        users.includes('src/app/organizations/admin/league-division-fields.ts'),
        users.join(', '),
      );
      assert.ok(users.includes('src/app/organizations/admin/custom-level-panel.ts'));
    });

    it('runs the custom level specs, the league management specs, and the specs of each src file that references it', () => {
      const specs = realSpecs(['convex/customLevels.ts']);
      assert.ok(!specs.includes(FULL));
      for (const name of [
        'organization-leagues-custom-level',
        'organization-leagues-division',
        'league-management',
        'league-management-details',
        'league-management-publish',
        'league-management-mockup',
        'organization-leagues',
        'organization-leagues-publish',
        'organization-leagues-publish-states',
        'organization-leagues-mockup',
      ]) {
        assert.ok(specs.includes(`e2e/${name}.spec.ts`), name);
      }
      for (const file of users) {
        for (const filter of realSpecs([file])) {
          assert.ok(specs.includes(filter), `${file}: ${filter}`);
        }
      }
    });
  });
});

describe('the public-page specs', () => {
  const readSpec = (file) => readFileSync(join(repoRoot, file), 'utf8');
  const found = findPublicPageSpecs(repoRoot);

  // A change to the finder cannot drop one unnoticed.
  const KNOWN_PUBLIC_PAGE_SPECS = [
    'organization-admin',
    'organization-details',
    'organization-leagues-publish',
    'organization-leagues-publish-states',
    'league-management-publish',
    'top-bar',
    'navigation-focus',
    'create-organization',
    'pwa',
    'offline-note-height',
  ].map((name) => `e2e/${name}.spec.ts`);

  it('finds the known public-page specs', () => {
    for (const file of KNOWN_PUBLIC_PAGE_SPECS) assert.ok(found.includes(file), file);
  });

  it('finds every spec on disk that opens a public path, calls a public query, or uses a tenant path', () => {
    const specFiles = ['e2e', 'e2e/harness'].flatMap((dir) =>
      readdirSync(join(repoRoot, dir))
        .filter((name) => name.endsWith('.spec.ts'))
        .map((name) => `${dir}/${name}`),
    );
    const expected = specFiles.filter((file) => {
      const text = readSpec(file);
      return (
        /[`'"]\/organizations\//.test(text) ||
        PUBLIC_QUERIES.some((query) => text.includes(query)) ||
        /[`'"]search:/.test(text) ||
        (text.includes('seedTenant') && /\b\w*[tT]enant\w*\.path\b|\b\w+\.path\}/.test(text))
      );
    });
    assert.ok(expected.length >= KNOWN_PUBLIC_PAGE_SPECS.length, expected.join(', '));
    assert.deepEqual(
      found.filter((file) => expected.includes(file)),
      expected,
    );
  });

  it('does not find a spec that reads no public page', () => {
    for (const file of ['e2e/smoke.spec.ts', 'e2e/sign-in.spec.ts', 'e2e/chip-classes.spec.ts']) {
      assert.ok(!found.includes(file), file);
    }
  });

  describe('readsPublicPage', () => {
    it('reads a string or template literal that starts /organizations/', () => {
      assert.ok(readsPublicPage("await page.goto('/organizations/acme');"));
      assert.ok(readsPublicPage('await page.goto("/organizations/acme");'));
      assert.ok(readsPublicPage('await page.goto(`/organizations/${slug}`);'));
    });

    it('does not read an admin path', () => {
      assert.ok(!readsPublicPage("await page.goto('/app/organizations/acme');"));
      assert.ok(!readsPublicPage('await page.goto(`/app/organizations/${slug}`);'));
    });

    it('reads the path of a seedTenant result', () => {
      assert.ok(
        readsPublicPage('const tenant = await seedTenant();\nawait page.goto(tenant.path);'),
      );
      assert.ok(readsPublicPage('const { path } = await seedTenant();\nawait page.goto(path);'));
      assert.ok(!readsPublicPage('const tenant = await seedTenant();\nawait page.goto("/app");'));
      assert.ok(!readsPublicPage('await page.goto(tenant.path);'));
    });

    it('reads a public query by name and any search function', () => {
      for (const query of PUBLIC_QUERIES) {
        assert.ok(readsPublicPage(`await convexQuery('${query}', {});`), query);
      }
      assert.ok(readsPublicPage("await convexQuery('search:leagues', {});"));
      assert.ok(!readsPublicPage("await convexQuery('organizations:listMine', {});"));
    });
  });

  describe('the public query list', () => {
    const convexDir = join(repoRoot, 'convex');
    const publicPageText = readFileSync(join(convexDir, 'lib', 'publicPage.ts'), 'utf8');
    const publicExports = new Set(
      [...publicPageText.matchAll(/^export const (\w+)/gm)].map((match) => match[1]),
    );

    // Each `export const name = query({ … })` block ends at the next top-level export.
    const queries = [];
    for (const file of readdirSync(convexDir).filter((name) =>
      /^(?!.*\.test\.).*\.ts$/.test(name),
    )) {
      const text = readFileSync(join(convexDir, file), 'utf8');
      const blocks = text.split(/^export /m).slice(1);
      for (const block of blocks) {
        const head = /^const (\w+) = query\(/.exec(block);
        if (!head) continue;
        queries.push({
          name: `${file.slice(0, -3)}:${head[1]}`,
          returns: /returns:\s*(\w+)/.exec(block)?.[1],
        });
      }
    }

    it('finds the Convex queries', () => {
      assert.ok(queries.length > 10, JSON.stringify(queries));
      assert.ok(publicExports.has('publicPageValidator'));
    });

    it('lists every query that returns a validator from convex/lib/publicPage.ts', () => {
      const returnsPublic = queries.filter((query) => publicExports.has(query.returns ?? ''));
      assert.ok(returnsPublic.length >= 7, JSON.stringify(returnsPublic));
      for (const { name } of returnsPublic) {
        assert.ok(
          PUBLIC_QUERIES.includes(name) || name.startsWith('search:'),
          `${name} returns a public page validator but is not in PUBLIC_QUERIES`,
        );
      }
    });

    it('lists every Convex function that uses an export of a convex/lib/public*.ts file', () => {
      const helperExports = ['publicPage', 'publicLeague', 'publicSeason', 'publicList'].flatMap(
        (name) =>
          [
            ...readFileSync(join(convexDir, 'lib', `${name}.ts`), 'utf8').matchAll(
              /^export (?:async )?(?:const|function) (\w+)/gm,
            ),
          ].map((match) => match[1]),
      );
      assert.ok(helperExports.length > 10, helperExports.join(', '));
      const users = [];
      for (const file of readdirSync(convexDir).filter((name) =>
        /^(?!.*\.test\.).*\.ts$/.test(name),
      )) {
        const blocks = readFileSync(join(convexDir, file), 'utf8')
          .split(/^export /m)
          .slice(1);
        for (const block of blocks) {
          const head = /^(?:async )?(?:const|function) (\w+)/.exec(block);
          if (head && helperExports.some((name) => new RegExp(`\\b${name}\\b`).test(block))) {
            users.push(`${file.slice(0, -3)}:${head[1]}`);
          }
        }
      }
      assert.ok(users.length >= 7, users.join(', '));
      for (const name of users) {
        assert.ok(
          PUBLIC_QUERIES.includes(name) || name.startsWith('search:'),
          `${name} uses a public read helper but is not in PUBLIC_QUERIES`,
        );
      }
    });

    it('lists only queries that exist', () => {
      const names = queries.map((query) => query.name);
      for (const name of PUBLIC_QUERIES) assert.ok(names.includes(name), name);
    });
  });

  describe('convex/lib/public*.ts', () => {
    const groups = [
      'e2e/organization-page.spec.ts',
      'e2e/league-page.spec.ts',
      'e2e/season-page.spec.ts',
      'e2e/sport-view.spec.ts',
      'e2e/find-a-league.spec.ts',
      'e2e/cache-key.spec.ts',
    ];

    for (const file of ['publicPage', 'publicLeague', 'publicSeason', 'publicList']) {
      it(`runs the page groups and every spec the finder found for convex/lib/${file}.ts`, () => {
        const specs = realSpecs([`convex/lib/${file}.ts`]);
        assert.ok(!specs.includes(FULL));
        for (const spec of [...groups, ...found]) assert.ok(specs.includes(spec), spec);
      });
    }
  });

  describe('a change across the public league, season, and organization pages', () => {
    const changes = {
      'the public league page': [
        'convex/leagues.ts',
        'convex/leaguesPublic.test.ts',
        'convex/lib/publicLeague.ts',
        'convex/lib/publicPage.ts',
        'convex/seasons.ts',
        'convex/seasonsPublic.test.ts',
        'convex/seed.test.ts',
        'docs/glossary.md',
        'e2e/cache-key.spec.ts',
        'e2e/league-page.spec.ts',
        'src/app/organizations/public-league/league-seasons.spec.ts',
        'src/app/organizations/public-league/league-seasons.ts',
        'src/app/organizations/public-league/public-league-content.ts',
        'src/app/organizations/public-league/public-league-page-offline.spec.ts',
        'src/app/organizations/public-league/public-league-page.server.spec.ts',
        'src/app/organizations/public-league/public-league-page.spec.ts',
        'src/app/organizations/public-league/public-league-page.ts',
        'src/app/organizations/public-league/public-league-skeleton.ts',
        'src/app/organizations/public-league/testing/league-data.ts',
        'src/app/organizations/season-status.ts',
      ],
      'the public season page restyle': [
        'convex/_generated/api.d.ts',
        'convex/lib/publicPage.ts',
        'convex/lib/publicSeason.ts',
        'convex/seasons.ts',
        'convex/seasonsPublicPage.test.ts',
        'convex/seed.test.ts',
        'docs/glossary.md',
        'e2e/league-page.spec.ts',
        'e2e/organization-page.spec.ts',
        'e2e/public-layout.spec.ts',
        'e2e/season-page.spec.ts',
        'src/app/organizations/organization-overview.ts',
        'src/app/organizations/organization-page-open-seasons.spec.ts',
        'src/app/organizations/public-league/public-league-content.ts',
        'src/app/organizations/public-league/public-league-page.spec.ts',
        'src/app/organizations/public-season/public-season-content.ts',
        'src/app/organizations/public-season/public-season-page-offline.spec.ts',
        'src/app/organizations/public-season/public-season-page.server.spec.ts',
        'src/app/organizations/public-season/public-season-page.spec.ts',
        'src/app/organizations/public-season/public-season-page.ts',
        'src/app/organizations/public-season/public-season-registration.spec.ts',
        'src/app/organizations/public-season/public-season-registration.ts',
        'src/app/organizations/public-season/public-season-skeleton.ts',
        'src/app/organizations/public-season/public-season-view.ts',
        'src/app/organizations/public-season/testing/season-data.ts',
      ],
    };
    for (const [name, files] of Object.entries(changes)) {
      it(`selects affected specs that include every spec the finder found for ${name}`, () => {
        const specs = realSpecs(files);
        assert.ok(!specs.includes(FULL), 'the change runs the full suite');
        for (const spec of findPublicPageSpecs(repoRoot)) {
          assert.ok(specs.includes(spec), spec);
        }
      });
    }
  });
});

describe('convex/lib', () => {
  // Every non-test file under convex/lib that runs the full suite, and why. A file that moves in or
  // out of this list changes how much a pull request tests, so the list changes with it.
  const CONVEX_LIB_FULL = {
    'authOrigins.ts': 'imported by convex/auth.ts',
    'divisions.ts': 'reached from convex/testing.ts',
    'inviteInput.ts': 'imported by convex/testing.ts',
    'inviteStatus.ts': 'imported by convex/schema.ts',
    'inviteToken.ts': 'imported by convex/testing.ts',
    'leagueDivision.ts': 'imported by convex/lib/tenantWrites.ts',
    'leagueInput.ts': 'reached from convex/testing.ts',
    'leagueStatus.ts': 'imported by convex/testing.ts',
    'memberships.ts': 'imported by convex/testing.ts',
    'organizationInput.ts': 'reached from convex/testing.ts',
    'password.ts': 'imported by convex/auth.ts',
    'previewOrigin.ts': 'loaded with import() by scripts/e2e-convex.mjs',
    'roles.ts': 'imported by convex/testing.ts',
    'seasonStatus.ts': 'imported by convex/testing.ts',
    'signInThrottle.ts': 'imported by convex/auth.ts',
    'slugs.ts': 'reached from convex/testing.ts',
    'sports.ts': 'reached from convex/testing.ts',
    'tenantWrites.ts': 'imported by convex/testing.ts',
    'testOnly.ts': 'imported by convex/testing.ts',
    'users.ts': 'imported by convex/auth.ts',
  };

  it('runs the full suite for exactly the files listed in CONVEX_LIB_FULL', () => {
    const files = readdirSync(join(repoRoot, 'convex', 'lib')).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    const full = files.filter((name) => realSpecs([`convex/lib/${name}`]).includes(FULL));
    assert.deepEqual(full.sort(), Object.keys(CONVEX_LIB_FULL).sort());
    for (const reason of Object.values(CONVEX_LIB_FULL)) assert.ok(reason.length > 0);
  });
});

describe('the command line', () => {
  it('prints the reason to stderr when a file with no rule needs the full suite', () => {
    const result = spawnSync(process.execPath, [join(import.meta.dirname, 'e2e-affected.mjs')], {
      input: 'convex/schema.ts\n',
      encoding: 'utf8',
      env: { PATH: process.env.PATH, GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' },
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'e2e_scope=full\ne2e_specs=\n');
    assert.match(result.stderr, /convex\/schema\.ts is a Convex module with no rule/);
  });

  it('traces a file with no rule in the real repo', () => {
    const result = spawnSync(process.execPath, [join(import.meta.dirname, 'e2e-affected.mjs')], {
      input: 'e2e/support/hold-queries.ts\n',
      encoding: 'utf8',
      env: { PATH: process.env.PATH, GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' },
    });
    assert.equal(result.status, 0);
    assert.match(
      result.stdout,
      /^e2e_scope=affected\ne2e_specs=.*e2e\/organization-page\.spec\.ts/,
    );
  });
});
