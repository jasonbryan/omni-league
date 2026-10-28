import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { describe, it } from 'node:test';
import {
  ALWAYS,
  AREAS,
  OFFLINE_QUERY_GROUP_SPECS,
  ROUTE_SPECS,
  deriveSessionSpecs,
  findLeagueManagementPageSpecs,
  selectSpecs,
} from './e2e-affected.mjs';

const repoRoot = join(import.meta.dirname, '..');
const sessionSpecs = deriveSessionSpecs(repoRoot);
const pr = { event: 'pull_request', base: 'main' };
const FULL = 'FULL';
const read = (file) => readFileSync(join(repoRoot, file), 'utf8');
const specFile = (name) => `e2e/${name}.spec.ts`;
const withAlways = (...filters) => [...new Set([...ALWAYS, ...filters])].sort();

/**
 * @param {string[]} files
 * @param {string} [root]
 * @returns {string[]}
 */
function specsFor(files, root = repoRoot) {
  const selection = selectSpecs(files, { ...pr, root, sessionSpecs, warn: () => {} });
  return selection.scope === 'full' ? [FULL] : selection.specs;
}

/**
 * @param {Record<string, string>} files
 * @param {(root: string) => void} body
 */
function withRepo(files, body) {
  const root = mkdtempSync(join(tmpdir(), 'e2e-affected-app-'));
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

/** @param {string} dir @returns {string[]} */
function filesUnder(dir) {
  return readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

const isUnitTestFile = (file) => /\.spec\.ts$/.test(file) || file.includes('/testing/');
const appSources = filesUnder('src/app')
  .filter((file) => file.endsWith('.ts') && !isUnitTestFile(file))
  .sort();

const specNames = ['e2e', 'e2e/harness'].flatMap((dir) =>
  readdirSync(join(repoRoot, dir))
    .filter((name) => name.endsWith('.spec.ts'))
    .map((name) => `${dir}/${name}`),
);

describe('the league management page specs', () => {
  const found = findLeagueManagementPageSpecs(repoRoot);

  const OPEN_THE_PAGE = [
    'after-sign-in',
    'accept-invite',
    'app-leagues',
    'organization-leagues',
    'touch-targets',
    'validate-on-blur',
    'league-management',
    'league-management-details',
    'league-management-mockup',
    'league-management-publish',
  ];

  it('finds the 10 specs that open the page today', () => {
    for (const name of OPEN_THE_PAGE) assert.ok(found.includes(specFile(name)), name);
  });

  it('takes a spec with both an organization admin path and a league segment, built from variables or not', () => {
    withRepo(
      {
        'e2e/literal.spec.ts': "await page.goto('/app/organizations/x/leagues/y');\n",
        'e2e/variable.spec.ts':
          'const base = `/app/organizations/${slug}`;\nawait page.goto(`${base}/leagues/${COED}`);\n',
        'e2e/dollar.spec.ts': "const a = '/app/organizations/';\nconst b = '/leagues/$';\n",
        'e2e/harness/h.spec.ts': "const a = '/app/organizations/';\nconst b = '/leagues/z';\n",
      },
      (root) => {
        assert.deepEqual(findLeagueManagementPageSpecs(root), [
          'e2e/dollar.spec.ts',
          'e2e/harness/h.spec.ts',
          'e2e/literal.spec.ts',
          'e2e/variable.spec.ts',
        ]);
      },
    );
  });

  it('skips the public league page, the leagues list, and a spec with only one of the strings', () => {
    withRepo(
      {
        'e2e/public.spec.ts': 'await page.goto(`${tenant.path}/leagues/${slug}`);\n',
        'e2e/list.spec.ts': "await page.goto('/app/organizations/x/leagues');\n",
        'e2e/other.spec.ts': "await page.goto('/app/organizations/x');\n",
        'e2e/segment.spec.ts': "await page.goto('/leagues/1/');\n",
        'e2e/harness/readme.ts': 'export {};\n',
      },
      (root) => {
        assert.deepEqual(findLeagueManagementPageSpecs(root), []);
      },
    );
  });

  it('runs those specs for every non-test file under src/app/organizations/league/', () => {
    const files = appSources.filter((file) => file.startsWith('src/app/organizations/league/'));
    assert.ok(files.length >= 10, files.join(', '));
    for (const file of files) {
      const specs = specsFor([file]);
      assert.ok(!specs.includes(FULL), file);
      for (const spec of found) assert.ok(specs.includes(spec), `${file}: ${spec}`);
    }
  });

  it('keeps the unit specs and test doubles of the league management page out of the e2e run', () => {
    assert.deepEqual(specsFor(['src/app/organizations/league/league-page.spec.ts']), withAlways());
    assert.deepEqual(
      specsFor(['src/app/organizations/league/testing/league-fixtures.ts']),
      withAlways(),
    );
  });
});

describe('the specs of the importers outside a hand rule', () => {
  it('runs the specs of the pages that show the season dates', () => {
    const specs = specsFor(['src/app/organizations/league/season-dates.ts']);
    for (const name of ['organization-page', 'sport-view', 'league-page', 'season-page']) {
      assert.ok(specs.includes(specFile(name)), name);
    }
  });

  it('runs the specs of the admin leagues page and create form for the league path helper', () => {
    const specs = specsFor(['src/app/organizations/league/league-path.ts']);
    for (const name of [
      'organization-leagues',
      'organization-leagues-mockup',
      'validate-on-blur',
    ]) {
      assert.ok(specs.includes(specFile(name)), name);
    }
  });

  it('runs the league management specs for the admin files that league files import', () => {
    const league = findLeagueManagementPageSpecs(repoRoot);
    for (const name of [
      'league-division',
      'league-division-fields',
      'admin-alert',
      'button-classes',
      'field-classes',
      'admin-sidebar',
      'admin-path',
      'league-form',
    ]) {
      const specs = specsFor([`src/app/organizations/admin/${name}.ts`]);
      for (const spec of league) assert.ok(specs.includes(spec), `${name}: ${spec}`);
    }
  });

  describe('every hand rule in src/app', () => {
    /** @type {Record<string, string>} */
    const IMPORTER_EXCEPTIONS = {};

    const importerEdge = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"`])(\.{1,2}\/[^'"`\n$]*)\1/g;
    const candidates = (base) => [`${base}.ts`, `${base}/index.ts`, base];

    /** Written apart from the tracing: each non-test importer of a file, by a scan of the static specifiers. */
    function staticImporters() {
      const files = new Set(
        [...filesUnder('src'), ...filesUnder('e2e')].filter((file) => file.endsWith('.ts')),
      );
      /** @type {Map<string, Set<string>>} */
      const importers = new Map();
      for (const file of files) {
        if (!file.startsWith('src/app/') || isUnitTestFile(file)) continue;
        if (file === 'src/app/app.routes.ts' || file === 'src/app/app.routes.server.ts') continue;
        for (const match of read(file).matchAll(importerEdge)) {
          const base = posix.normalize(posix.join(posix.dirname(file), match[2]));
          const target = candidates(base).find((candidate) => files.has(candidate));
          if (target === undefined || target === file) continue;
          const set = importers.get(target) ?? new Set();
          set.add(file);
          importers.set(target, set);
        }
      }
      return importers;
    }

    const importers = staticImporters();
    const ruleOf = (file) => AREAS.find((area) => area.test(file));
    const isHandRule = (rule) => rule !== undefined && (rule.specs.length > 0 || rule.derive);

    /** @param {string[]} files */
    function checkImporters(files) {
      let checked = 0;
      for (const file of files) {
        const rule = ruleOf(file);
        if (!isHandRule(rule)) continue;
        for (const importer of importers.get(file) ?? []) {
          const importerRule = ruleOf(importer);
          if (!isHandRule(importerRule) || importerRule === rule) continue;
          checked += 1;
          const key = `${file} <- ${importer}`;
          const own = specsFor([file]);
          const theirs = specsFor([importer]);
          if (key in IMPORTER_EXCEPTIONS) {
            assert.ok(IMPORTER_EXCEPTIONS[key].length > 0, key);
            continue;
          }
          if (theirs.includes(FULL)) {
            assert.deepEqual(own, [FULL], `${key}: the importer runs the full suite`);
          } else {
            for (const spec of theirs) assert.ok(own.includes(spec), `${key}: ${spec}`);
          }
        }
      }
      return checked;
    }

    it('selects at least the specs of each ruled importer outside its own match', () => {
      assert.ok(checkImporters(appSources) > 50);
    });

    it('does so for every file under src/app/organizations/league/', () => {
      const files = appSources.filter((file) => file.startsWith('src/app/organizations/league/'));
      assert.ok(checkImporters(files) > 0);
    });

    it('lists no exception today, and each one it lists carries a reason', () => {
      assert.deepEqual(Object.keys(IMPORTER_EXCEPTIONS), []);
    });

    it('opts out of the importer specs only for the route tables and the saved query list, which a full-suite file imports', () => {
      const optedOut = AREAS.filter((area) => area.widen === false).map((area) => area.name);
      assert.deepEqual(optedOut.sort(), [
        'offline saved queries',
        'route table',
        'server route table',
      ]);
      for (const file of [
        'src/app/app.routes.ts',
        'src/app/app.routes.server.ts',
        'src/app/core/data/convex/offline-saved-queries.ts',
      ]) {
        for (const importer of importers.get(file) ?? []) {
          assert.ok(!isHandRule(ruleOf(importer)), `${importer} has a rule and imports ${file}`);
        }
      }
    });

    it('follows importers inside the same rule to the importers outside it', () => {
      withRepo(
        {
          'src/app/invites/a.ts': 'export const a = 1;\n',
          'src/app/invites/b.ts': "import { a } from './a';\n",
          'src/app/find/c.ts': "import { b } from '../invites/b';\n",
        },
        (root) => {
          assert.deepEqual(
            specsFor(['src/app/invites/a.ts'], root),
            withAlways(
              specFile('accept-invite'),
              specFile('cache-key'),
              specFile('find-a-league'),
              specFile('find-organizations'),
            ),
          );
        },
      );
    });

    it('stops at an importer cycle between two rules', () => {
      withRepo(
        {
          'src/app/invites/a.ts': "import { b } from '../find/b';\nexport const a = 1;\n",
          'src/app/find/b.ts': "import { a } from '../invites/a';\nexport const b = 1;\n",
        },
        (root) => {
          assert.deepEqual(
            specsFor(['src/app/invites/a.ts'], root),
            withAlways(
              specFile('accept-invite'),
              specFile('cache-key'),
              specFile('find-a-league'),
              specFile('find-organizations'),
            ),
          );
        },
      );
    });

    it('runs the full suite when an importer with no rule ends at a file with no importer', () => {
      withRepo(
        {
          'src/app/invites/a.ts': 'export const a = 1;\n',
          'src/app/util/b.ts': "import { a } from '../invites/a';\n",
        },
        (root) => {
          assert.deepEqual(specsFor(['src/app/invites/a.ts'], root), [FULL]);
        },
      );
    });

    it('takes the specs of an importer with no rule from the files that import it', () => {
      withRepo(
        {
          'src/app/invites/a.ts': 'export const a = 1;\n',
          'src/app/util/b.ts': "import { a } from '../invites/a';\n",
          'src/app/find/c.ts': "import { b } from '../util/b';\n",
        },
        (root) => {
          assert.deepEqual(
            specsFor(['src/app/invites/a.ts'], root),
            withAlways(
              specFile('accept-invite'),
              specFile('cache-key'),
              specFile('find-a-league'),
              specFile('find-organizations'),
            ),
          );
        },
      );
    });

    it('runs the full suite when the repo root is not known', () => {
      const selection = selectSpecs(['src/app/invites/accept-invite-page.ts'], {
        ...pr,
        warn: () => {},
      });
      assert.deepEqual(selection, { scope: 'full' });
    });

    it('adds nothing for an importer that is a unit spec or a test double', () => {
      withRepo(
        {
          'src/app/invites/a.ts': 'export const a = 1;\n',
          'src/app/util/a.spec.ts': "import '../invites/a';\n",
          'src/app/util/testing/double.ts': "import '../../invites/a';\n",
        },
        (root) => {
          assert.deepEqual(
            specsFor(['src/app/invites/a.ts'], root),
            withAlways(specFile('accept-invite')),
          );
        },
      );
    });
  });
});

describe('the admin area specs', () => {
  const ADMIN_FORM_SPECS = [
    'organization-details',
    'organization-leagues-division',
    'organization-leagues-custom-level',
  ];

  it('runs the details page and the create-league form specs for every admin area file', () => {
    for (const file of [
      'admin/admin-area.ts',
      'admin/admin-details.ts',
      'admin/admin-sidebar.ts',
      'admin/league-division-fields.ts',
      'admin/custom-level-panel.ts',
      'league/season-dates.ts',
    ]) {
      const specs = specsFor([`src/app/organizations/${file}`]);
      for (const name of ADMIN_FORM_SPECS)
        assert.ok(specs.includes(specFile(name)), `${file}: ${name}`);
    }
  });

  it('runs the division and custom level specs for the leagues page and its forms', () => {
    for (const file of ['admin-leagues', 'league-create-form', 'league-form']) {
      const specs = specsFor([`src/app/organizations/admin/${file}.ts`]);
      for (const name of ['organization-leagues-division', 'organization-leagues-custom-level']) {
        assert.ok(specs.includes(specFile(name)), `${file}: ${name}`);
      }
    }
  });
});

describe('the route tables', () => {
  /**
   * Written apart from the rule: each `path:` of the file with the full path of its route, and the guards on that route.
   * @param {string} text
   * @returns {{ path: string, guards: string[] }[]}
   */
  function readRoutes(text) {
    const source = text.replace(/^\s*\/\/.*$/gm, '');
    /** @type {{ path?: string, guards: string[] }[]} */
    const stack = [];
    const routes = [];
    const token = /\{|\}|\bpath:\s*'([^']*)'|\bcanActivate:\s*\[([^\]]*)\]/g;
    for (const match of source.matchAll(token)) {
      if (match[0] === '{') {
        stack.push({ guards: [] });
      } else if (match[0] === '}') {
        stack.pop();
      } else if (match[0].startsWith('path')) {
        const top = stack.at(-1);
        assert.ok(top, 'a path outside a route object');
        top.path = match[1];
        const full = stack.filter((route) => route.path !== undefined).map((route) => route.path);
        routes.push({ path: full.join('/'), guards: top.guards });
      } else {
        stack.at(-1)?.guards.push(...match[2].split(',').map((name) => name.trim()));
      }
    }
    return routes;
  }

  const routes = readRoutes(read('src/app/app.routes.ts'));

  const GUARD_SPECS = {
    requireSignedIn: ['after-sign-in'],
    redirectSignedIn: ['sign-in', 'sign-up', 'auth-session'],
    captureInviteToken: ['accept-invite'],
  };

  it('reads every path of the route table, nested ones with their parents', () => {
    const paths = routes.map((route) => route.path);
    for (const path of [
      '',
      'leagues',
      'sign-in',
      'sign-up',
      'invites/accept',
      'app',
      'app/',
      'app/organizations/new',
      'app/organizations/:orgSlug/leagues/:leagueSlug',
      'app/organizations/:slug',
      'app/organizations/:slug/',
      'app/organizations/:slug/locations',
      'app/organizations/:slug/leagues',
      'app/organizations/:slug/staff',
      'app/organizations/:slug/details',
      'app/**',
      '**',
    ]) {
      assert.ok(paths.includes(path), path);
    }
    assert.equal(new Set(paths).size, paths.length, 'two routes have the same full path');
  });

  it('maps every path to a spec, and lists no path the file lacks', () => {
    const paths = routes.map((route) => route.path);
    for (const path of paths) {
      assert.ok(
        ROUTE_SPECS[path]?.length > 0,
        `${JSON.stringify(path)} has no spec in ROUTE_SPECS`,
      );
    }
    for (const path of Object.keys(ROUTE_SPECS)) {
      assert.ok(paths.includes(path), `${JSON.stringify(path)} is not in the route table`);
    }
  });

  it('maps a path with canActivate to a spec that exercises its guard', () => {
    const guarded = routes.filter((route) => route.guards.length > 0);
    assert.ok(guarded.length >= 6, guarded.map((route) => route.path).join(', '));
    for (const route of guarded) {
      for (const guard of route.guards) {
        const specs = GUARD_SPECS[guard];
        assert.ok(specs, `${guard} on ${route.path} has no guard spec`);
        assert.ok(
          specs.some((name) => ROUTE_SPECS[route.path].includes(name)),
          `${JSON.stringify(route.path)} lists no spec for ${guard}`,
        );
      }
    }
  });

  it('maps sign-in and sign-up each to its own spec and the session spec', () => {
    for (const path of ['sign-in', 'sign-up']) {
      for (const name of [path, 'auth-session']) {
        assert.ok(ROUTE_SPECS[path].includes(name), `${path}: ${name}`);
      }
    }
  });

  it('maps every path behind requireSignedIn to the after-sign-in spec, and invites/accept to the accept-invite spec', () => {
    const signedIn = routes.filter((route) => route.guards.includes('requireSignedIn'));
    assert.ok(signedIn.length >= 3, signedIn.map((route) => route.path).join(', '));
    for (const route of signedIn) {
      assert.ok(ROUTE_SPECS[route.path].includes('after-sign-in'), route.path);
    }
    assert.ok(ROUTE_SPECS['invites/accept'].includes('accept-invite'));
  });

  it('names only specs that exist', () => {
    for (const [path, names] of Object.entries(ROUTE_SPECS)) {
      for (const name of names) assert.ok(specNames.includes(specFile(name)), `${path}: ${name}`);
    }
  });

  it('runs every spec in ROUTE_SPECS, navigation-focus, and not-found for the route table, not the full suite', () => {
    const specs = specsFor(['src/app/app.routes.ts']);
    assert.ok(!specs.includes(FULL));
    for (const name of [...Object.values(ROUTE_SPECS).flat(), 'navigation-focus', 'not-found']) {
      assert.ok(specs.includes(specFile(name)), name);
    }
  });

  it('runs the route table specs, cache-key, and every spec that imports a raw HTTP helper for the server route table', () => {
    const specs = specsFor(['src/app/app.routes.server.ts']);
    assert.ok(!specs.includes(FULL));
    for (const spec of specsFor(['src/app/app.routes.ts'])) assert.ok(specs.includes(spec), spec);
    assert.ok(specs.includes(specFile('cache-key')));
    const importsRaw = specNames.filter((file) =>
      /from '[^']*support\/raw-(?:html|get|http)'/.test(read(file)),
    );
    assert.ok(importsRaw.length >= 10, importsRaw.join(', '));
    for (const file of importsRaw) assert.ok(specs.includes(file), file);
  });

  it('does not take the route table as an importer, so a file only it imports runs the full suite', () => {
    withRepo(
      {
        'src/app/app.routes.ts': "import { guard } from './core/new-guard';\n",
        'src/app/core/new-guard.ts': 'export const guard = 1;\n',
        'src/app/invites/page.ts': 'export {};\n',
      },
      (root) => {
        assert.deepEqual(specsFor(['src/app/core/new-guard.ts'], root), [FULL]);
      },
    );
  });

  it('still runs the full suite for the target of a dynamic import in the route table', () => {
    withRepo(
      {
        'src/app/app.routes.ts': "export const r = () => import('./pages/lazy');\n",
        'src/app/pages/lazy.ts': 'export const a = 1;\n',
      },
      (root) => {
        assert.deepEqual(specsFor(['src/app/pages/lazy.ts'], root), [FULL]);
      },
    );
  });
});

describe('the offline saved query list', () => {
  const file = 'src/app/core/data/convex/offline-saved-queries.ts';
  const groups = [...read(file).matchAll(/^const (\w+_PAGE_QUERIES)\b/gm)].map((match) => match[1]);

  it('reads the page groups of the list', () => {
    assert.ok(groups.length >= 4, groups.join(', '));
  });

  it('maps every page group to a spec, and lists no group the file lacks', () => {
    for (const group of groups) {
      assert.ok(
        OFFLINE_QUERY_GROUP_SPECS[group]?.length > 0,
        `${group} has no spec in OFFLINE_QUERY_GROUP_SPECS`,
      );
    }
    assert.deepEqual(Object.keys(OFFLINE_QUERY_GROUP_SPECS).sort(), [...groups].sort());
  });

  it('runs the offline, PWA, and cache-key specs, and the spec of every group, not the full suite', () => {
    const specs = specsFor([file]);
    assert.ok(!specs.includes(FULL));
    for (const name of [
      'offline',
      'offline-note-height',
      'league-page-offline',
      'pwa',
      'cache-key',
      'organization-page',
      'sport-view',
      'league-page',
      'season-page',
      'find-a-league',
      ...Object.values(OFFLINE_QUERY_GROUP_SPECS).flat(),
    ]) {
      assert.ok(specs.includes(specFile(name)), name);
    }
  });

  it('names only specs that exist', () => {
    for (const [group, names] of Object.entries(OFFLINE_QUERY_GROUP_SPECS)) {
      for (const name of names) assert.ok(specNames.includes(specFile(name)), `${group}: ${name}`);
    }
  });
});

describe('Markdown under src/', () => {
  it('runs only the always set, because no build input is Markdown', () => {
    assert.deepEqual(specsFor(['src/app/core/data/convex/README.md']), withAlways());
    assert.deepEqual(specsFor(['src/README.md']), withAlways());
  });
});

describe('the files under src/app that run the full suite', () => {
  const MAIN_SERVER = 'reaches src/main.server.ts, which no file imports';
  const SHEET = 'reaches shell-sheet.ts, which a dynamic import() loads';
  const SRC_FULL = {
    'src/app/app.config.server.ts': MAIN_SERVER,
    'src/app/app.config.ts': MAIN_SERVER,
    'src/app/app.ts': MAIN_SERVER,
    'src/app/core/auth/auth-client.ts': MAIN_SERVER,
    'src/app/core/auth/auth.service.ts': MAIN_SERVER,
    'src/app/core/auth/guards.ts':
      'imported only by app.routes.ts, and its redirects reach every signed-in and sign-in path',
    'src/app/core/auth/make-auth-client.ts': 'loaded with a dynamic import()',
    'src/app/core/auth/return-to.ts': 'imported only by guards.ts',
    'src/app/core/changes-in-flight.ts': MAIN_SERVER,
    'src/app/core/data/convex/client-token.ts': MAIN_SERVER,
    'src/app/core/data/convex/connection.ts': MAIN_SERVER,
    'src/app/core/data/convex/convex-client.ts': MAIN_SERVER,
    'src/app/core/data/convex/convex-url.ts': MAIN_SERVER,
    'src/app/core/data/convex/errors.ts': MAIN_SERVER,
    'src/app/core/data/convex/index.ts': MAIN_SERVER,
    'src/app/core/data/convex/inject-call.ts': MAIN_SERVER,
    'src/app/core/data/convex/inject-query.ts': MAIN_SERVER,
    'src/app/core/data/convex/matches-validator.ts': MAIN_SERVER,
    'src/app/core/data/convex/saved-copies.ts': MAIN_SERVER,
    'src/app/core/data/convex/server-query-loader.ts': MAIN_SERVER,
    'src/app/core/data/convex/transfer.ts': MAIN_SERVER,
    'src/app/core/focus-main.ts': MAIN_SERVER,
    'src/app/core/service-worker/app-updates.ts': MAIN_SERVER,
    'src/app/core/service-worker/page-safety.ts': MAIN_SERVER,
    'src/app/core/service-worker/reload-guard.ts': MAIN_SERVER,
    'src/app/core/service-worker/service-worker-build.ts': MAIN_SERVER,
    'src/app/core/url-serializer.ts': MAIN_SERVER,
    'src/app/shell/follow-link.ts': SHEET,
    'src/app/shell/sheet-links.ts': SHEET,
    'src/app/shell/update-prompt.ts': MAIN_SERVER,
    'src/app/ui/button/hlm-button.token.ts': SHEET,
    'src/app/ui/button/hlm-button.ts': SHEET,
    'src/app/ui/button/index.ts': SHEET,
    'src/app/ui/sheet/hlm-sheet-close.ts': SHEET,
    'src/app/ui/sheet/hlm-sheet-content.ts': SHEET,
    'src/app/ui/sheet/hlm-sheet-description.ts': SHEET,
    'src/app/ui/sheet/hlm-sheet-footer.ts': SHEET,
    'src/app/ui/sheet/hlm-sheet-header.ts': SHEET,
    'src/app/ui/sheet/hlm-sheet-overlay.ts': SHEET,
    'src/app/ui/sheet/hlm-sheet-portal.ts': SHEET,
    'src/app/ui/sheet/hlm-sheet-title.ts': SHEET,
    'src/app/ui/sheet/hlm-sheet-trigger.ts': SHEET,
    'src/app/ui/sheet/hlm-sheet.ts': SHEET,
    'src/app/ui/sheet/index.ts': SHEET,
    'src/app/ui/utils/hlm.ts': SHEET,
    'src/app/ui/utils/index.ts': SHEET,
    'src/app/ui/utils/provide-spartan-hlm.ts': MAIN_SERVER,
  };

  it('lists the files whose outcome is the full suite, each with a reason', () => {
    const full = appSources.filter((file) => specsFor([file]).includes(FULL));
    assert.deepEqual(full, Object.keys(SRC_FULL).sort());
    for (const [file, reason] of Object.entries(SRC_FULL)) assert.ok(reason.length > 0, file);
  });

  it('keeps the button, the sheet parts, and the helpers the phone sheet imports in the full suite', () => {
    for (const file of [
      'src/app/ui/button/hlm-button.ts',
      'src/app/ui/button/index.ts',
      'src/app/ui/sheet/hlm-sheet.ts',
      'src/app/ui/utils/hlm.ts',
      'src/app/shell/follow-link.ts',
      'src/app/shell/sheet-links.ts',
    ]) {
      assert.deepEqual(specsFor([file]), [FULL], file);
    }
  });

  it('keeps a file with a rule of its own in the full suite when only the phone sheet imports it', () => {
    withRepo(
      {
        'src/app/shell/shell-sidebar.ts': 'export const sidebar = 1;\n',
        'src/app/shell/shell-sheet.ts': "import { sidebar } from './shell-sidebar';\n",
      },
      (root) => {
        assert.deepEqual(specsFor(['src/app/shell/shell-sidebar.ts'], root), [FULL]);
      },
    );
  });

  it('maps the phone sheet itself to the shell specs', () => {
    const specs = specsFor(['src/app/shell/shell-sheet.ts']);
    assert.ok(!specs.includes(FULL));
    for (const spec of ['e2e/app-shell.spec.ts', 'e2e/shell-sheet.spec.ts']) {
      assert.ok(specs.includes(spec), spec);
    }
  });

  it('lists only files that exist', () => {
    for (const file of Object.keys(SRC_FULL)) assert.ok(appSources.includes(file), file);
  });

  it('runs the full suite for the app config, the focus handler, the URL serializer, the guards, the styles, the page, and the entry point', () => {
    for (const file of [
      'src/app/app.config.ts',
      'src/app/core/focus-main.ts',
      'src/app/core/url-serializer.ts',
      'src/app/core/auth/guards.ts',
      'src/index.html',
      'src/main.ts',
      ...filesUnder('src/styles').filter((path) => path.endsWith('.css')),
    ]) {
      assert.deepEqual(specsFor([file]), [FULL], file);
    }
  });

  it('keeps the guards in the full suite when the only importer is a file with a rule', () => {
    withRepo(
      {
        'src/app/core/auth/guards.ts': 'export const guard = 1;\n',
        'src/app/invites/page.ts': "import { guard } from '../core/auth/guards';\n",
      },
      (root) => {
        assert.deepEqual(specsFor(['src/app/core/auth/guards.ts'], root), [FULL]);
      },
    );
  });

  it('keeps the guards in the full suite even when a file with a rule imports them', () => {
    withRepo(
      {
        'src/app/core/auth/guards.ts': 'export const guard = 1;\n',
        'src/app/invites/page.ts': "import { guard } from '../core/auth/guards';\n",
        'src/app/core/auth/return-to.ts': "import { guard } from './guards';\n",
      },
      (root) => {
        assert.deepEqual(specsFor(['src/app/core/auth/guards.ts'], root), [FULL]);
        assert.deepEqual(specsFor(['src/app/core/auth/return-to.ts'], root), [FULL]);
      },
    );
  });
});

describe('earlier pull requests', () => {
  const league = findLeagueManagementPageSpecs(repoRoot);

  const LEAGUE_FORM_PR_FILES = [
    'design/mockups/125-126-seasons.html',
    'design/mockups/300-public-site-league-form.html',
    'design/mockups/66-69-organization-leagues.html',
    'docs/glossary.md',
    'e2e/organization-leagues-mockup.spec.ts',
    'e2e/organization-leagues.spec.ts',
    'src/app/organizations/admin/admin-leagues.spec.ts',
    'src/app/organizations/admin/league-create-form.ts',
    'src/app/organizations/league/league-details-form.spec.ts',
    'src/app/organizations/league/league-details-form.ts',
    'src/app/organizations/league/league-management.ts',
    'src/app/organizations/league/league-page.spec.ts',
    'src/app/organizations/league/season-create-form.spec.ts',
    'src/app/organizations/league/season-create-form.ts',
  ];
  const ROUTES_PR_FILES = [
    'convex/organizations.test.ts',
    'convex/organizations.ts',
    'docs/glossary.md',
    'e2e/cache-key.spec.ts',
    'e2e/league-page.spec.ts',
    'e2e/organization-page.spec.ts',
    'e2e/sport-view.spec.ts',
    'scripts/e2e-affected.mjs',
    'scripts/e2e-affected.test.mjs',
    'src/app/app.routes.server.spec.ts',
    'src/app/app.routes.server.ts',
    'src/app/app.routes.ts',
    'src/app/organizations/organization-overview.ts',
    'src/app/organizations/organization-page.server.spec.ts',
    'src/app/organizations/organization-page.spec.ts',
    'src/app/organizations/organization-page.ts',
    'src/app/organizations/organization-path.spec.ts',
    'src/app/organizations/organization-path.ts',
    'src/app/organizations/organization-skeleton.ts',
    'src/app/organizations/organization-sport-view-offline.spec.ts',
    'src/app/organizations/organization-sport-view.spec.ts',
    'src/app/organizations/public-league/public-league-content.ts',
    'src/app/organizations/public-league/public-league-page.spec.ts',
    'src/app/organizations/sport-chips.spec.ts',
    'src/app/organizations/sport-chips.ts',
    'src/app/organizations/testing/pages.ts',
  ];
  const FORM_ERRORS_PR_FILES = [
    'e2e/create-organization.spec.ts',
    'e2e/sign-up.spec.ts',
    'e2e/validate-on-blur.spec.ts',
    'scripts/e2e-affected.mjs',
    'scripts/e2e-affected.test.mjs',
    'src/app/core/forms/shown-errors.spec.ts',
    'src/app/core/forms/shown-errors.ts',
    'src/app/organizations/admin/add-location-form.ts',
    'src/app/organizations/admin/admin-leagues.spec.ts',
    'src/app/organizations/admin/admin-locations.spec.ts',
    'src/app/organizations/admin/admin-staff.spec.ts',
    'src/app/organizations/admin/invite-form.ts',
    'src/app/organizations/admin/league-create-form.ts',
    'src/app/organizations/admin/league-form.ts',
    'src/app/organizations/admin/location-edit-form.ts',
    'src/app/organizations/admin/location-fields.ts',
    'src/app/organizations/admin/location-form.ts',
    'src/app/organizations/admin/staff-invite-panel.ts',
    'src/app/organizations/create-organization-page.spec.ts',
    'src/app/organizations/create-organization-page.ts',
    'src/app/organizations/league/season-create-form.spec.ts',
    'src/app/organizations/league/season-create-form.ts',
    'src/app/organizations/league/season-form.ts',
    'src/app/sign-in/sign-in-page.spec.ts',
    'src/app/sign-in/sign-in-page.ts',
    'src/app/sign-up/sign-up-page.spec.ts',
    'src/app/sign-up/sign-up-page.ts',
  ];

  const routeSet = [...Object.values(ROUTE_SPECS).flat(), 'navigation-focus', 'not-found'].map(
    specFile,
  );

  it('runs the league management specs for the league form change', () => {
    const specs = specsFor(LEAGUE_FORM_PR_FILES);
    assert.ok(!specs.includes(FULL));
    for (const spec of league) assert.ok(specs.includes(spec), spec);
  });

  it('runs the route table specs for the change that added the sport route', () => {
    const specs = specsFor(ROUTES_PR_FILES);
    assert.ok(!specs.includes(FULL));
    for (const spec of routeSet) assert.ok(specs.includes(spec), spec);
  });

  it('runs the league management specs for the form errors change', () => {
    const specs = specsFor(FORM_ERRORS_PR_FILES);
    assert.ok(!specs.includes(FULL));
    for (const spec of league) assert.ok(specs.includes(spec), spec);
  });
});
