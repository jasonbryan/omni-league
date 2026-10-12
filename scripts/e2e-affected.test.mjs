// Unit tests for scripts/e2e-affected.mjs (#186). Run with `npm run test:scripts` (node:test).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ALWAYS, AREAS, formatOutputs, selectSpecs } from './e2e-affected.mjs';

const script = join(import.meta.dirname, 'e2e-affected.mjs');
const repoRoot = join(import.meta.dirname, '..');
const pr = { event: 'pull_request', base: 'main' };

/** Every e2e spec file on disk, repo-relative (`e2e/smoke.spec.ts`, `e2e/harness/a11y-helper.spec.ts`). */
function specFilesOnDisk() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.spec.ts')) found.push(path);
    }
  };
  walk('e2e');
  return found.sort();
}

/** The spec files a Playwright filter selects: it is a case-insensitive regex on the file path. */
function filesSelectedBy(filter, files) {
  const pattern = new RegExp(filter, 'i');
  return files.filter((file) => pattern.test(file));
}

/** @param {string[]} files @returns {string[]} The filters selected, or ['FULL']. */
function specsFor(files, context = pr) {
  const selection = selectSpecs(files, context);
  return selection.scope === 'full' ? ['FULL'] : selection.specs;
}

const smokeAndHarness = ['e2e/harness/', 'e2e/smoke.spec.ts'];

/** The expected selection: the given filters and the always-on ones, sorted, as the script prints. */
const want = (...filters) => [...new Set([...filters, ...smokeAndHarness])].sort();

describe('selectSpecs: mapped areas', () => {
  it('maps an admin locations file to the specs that open the locations page', () => {
    assert.deepEqual(
      specsFor(['src/app/organizations/admin/location-row.ts']),
      want('e2e/organization-admin.spec.ts', 'e2e/sign-in-admin.spec.ts'),
    );
  });

  it('maps an admin leagues file to the three league specs, not the staff or mockup specs', () => {
    assert.deepEqual(
      specsFor(['src/app/organizations/admin/publish-league-dialog.ts']),
      want(
        'e2e/organization-leagues-publish-states.spec.ts',
        'e2e/organization-leagues-publish.spec.ts',
        'e2e/organization-leagues.spec.ts',
      ),
    );
  });

  it('maps an admin staff file to the staff and accept-invite specs', () => {
    assert.deepEqual(
      specsFor(['src/app/organizations/admin/invite-form.ts']),
      want('e2e/accept-invite.spec.ts', 'e2e/organization-staff.spec.ts'),
    );
  });

  it('maps a shared admin file to every spec that opens the admin area', () => {
    const specs = specsFor(['src/app/organizations/admin/admin-area.ts']);
    for (const name of [
      'organization-admin',
      'organization-leagues',
      'organization-leagues-publish',
      'organization-leagues-publish-states',
      'organization-staff',
      'sign-in-admin',
      'accept-invite',
      'create-organization',
    ]) {
      assert.ok(specs.includes(`e2e/${name}.spec.ts`), name);
    }
    assert.ok(!specs.includes('e2e/organization-leagues-mockup.spec.ts'));
    assert.ok(!specs.includes('e2e/sign-in.spec.ts'));
  });

  it('maps an invites file to accept-invite.spec.ts only', () => {
    assert.deepEqual(
      specsFor(['src/app/invites/accept-invite-page.ts']),
      want('e2e/accept-invite.spec.ts'),
    );
  });

  it('maps the sign-in and sign-up pages to their own specs', () => {
    assert.deepEqual(
      specsFor(['src/app/sign-in/sign-in-page.ts']),
      want('e2e/sign-in-admin.spec.ts', 'e2e/sign-in.spec.ts'),
    );
    assert.deepEqual(specsFor(['src/app/sign-up/sign-up-page.ts']), want('e2e/sign-up.spec.ts'));
  });

  it('maps the public organization page files to the specs that open that page', () => {
    const specs = specsFor(['src/app/organizations/organization-overview.ts']);
    for (const name of ['organization-page', 'organization-page-links', 'offline', 'pwa']) {
      assert.ok(specs.includes(`e2e/${name}.spec.ts`), name);
    }
    assert.ok(!specs.includes('FULL'));
  });

  it('maps the leagues mockup to its spec, and every other design file to nothing', () => {
    assert.deepEqual(
      specsFor(['design/mockups/66-69-organization-leagues.html']),
      want('e2e/organization-leagues-mockup.spec.ts'),
    );
    assert.deepEqual(
      specsFor(['design/mockups/80-app-icon.html', 'design/mockup-kit/x.css']),
      want(),
    );
  });

  it('maps Convex modules to the specs that exercise them', () => {
    assert.deepEqual(
      specsFor(['convex/invites.ts']),
      want(
        'e2e/accept-invite.spec.ts',

        'e2e/organization-staff.spec.ts',
      ),
    );
    assert.ok(specsFor(['convex/leagues.ts']).includes('e2e/organization-leagues-publish.spec.ts'));
    assert.ok(specsFor(['convex/locations.ts']).includes('e2e/organization-admin.spec.ts'));
    assert.ok(specsFor(['convex/users.ts']).includes('e2e/sign-in.spec.ts'));
    assert.ok(specsFor(['convex/seed.ts']).includes('e2e/pwa.spec.ts'));
    assert.ok(specsFor(['convex/organizations.ts']).includes('e2e/organization-page.spec.ts'));
    assert.ok(specsFor(['convex/memberships.ts']).includes('e2e/organization-staff.spec.ts'));
  });

  it('runs a changed spec itself, in the harness directory too', () => {
    assert.deepEqual(specsFor(['e2e/sign-up.spec.ts']), want('e2e/sign-up.spec.ts'));
    assert.deepEqual(
      specsFor(['e2e/harness/netlify-drawer.spec.ts']),
      want('e2e/harness/netlify-drawer.spec.ts'),
    );
  });

  it('unions the specs of several changed files and lists each once, sorted', () => {
    const specs = specsFor([
      'src/app/invites/invite-token-store.ts',
      'convex/invites.ts',
      'src/app/sign-up/sign-up-page.ts',
    ]);
    assert.deepEqual(specs, [...specs].sort());
    assert.equal(new Set(specs).size, specs.length);
    assert.deepEqual(
      specs,
      want('e2e/accept-invite.spec.ts', 'e2e/organization-staff.spec.ts', 'e2e/sign-up.spec.ts'),
    );
  });

  it('keeps the smoke and harness specs on every affected run', () => {
    for (const files of [
      ['src/app/invites/capture-invite-token.ts'],
      ['src/app/organizations/admin/admin-staff.spec.ts'],
      ['docs/process/ci.md'],
      ['convex/invites.test.ts'],
    ]) {
      const specs = specsFor(files);
      for (const always of ALWAYS) assert.ok(specs.includes(always), `${files} lacks ${always}`);
    }
  });
});

describe('selectSpecs: files that cannot change an e2e result', () => {
  const quiet = [
    'src/app/invites/accept-invite-page.spec.ts',
    'src/app/core/auth/guards.spec.ts',
    'src/app/shell/shell.spec.ts',
    'src/app/shell/testing/test-pages.ts',
    'src/app/organizations/admin/testing/admin-harness.ts',
    'src/app/core/data/convex/testing/fake-convex-client.ts',
    'convex/invites.test.ts',
    'convex/lib/slugs.test.ts',
    'convex/test.setup.ts',
    'scripts/ci-scope.test.mjs',
    'docs/process/ci.md',
    'docs/decisions/0009-ci-pipeline.md',
    '.claude/agents/implementer.md',
    'README.md',
    'AGENTS.md',
    'convex/README.md',
    'design/mockups/12-roster.html',
    '.github/pull_request_template.md',
    '.github/dependabot.yml',
    '.github/workflows/clean-previews.yml',
    '.github/ISSUE_TEMPLATE/feature.yml',
    'e2e/harness/probes/skipped.probe.ts',
  ];
  for (const file of quiet) {
    it(`runs only the smoke and harness specs for ${file}`, () => {
      assert.deepEqual(specsFor([file]), want());
    });
  }
});

describe('selectSpecs: the full suite', () => {
  const shared = [
    'src/app/shell/shell.ts',
    'src/app/core/auth/auth.service.ts',
    'src/app/core/data/convex/inject-query.ts',
    'src/app/core/service-worker/app-updates.ts',
    'src/app/core/url-serializer.ts',
    'src/app/ui/button/button.ts',
    'src/app/app.routes.ts',
    'src/app/app.routes.server.ts',
    'src/app/app.config.ts',
    'src/server.ts',
    'src/main.ts',
    'src/index.html',
    'src/styles.css',
    'src/styles/tokens.css',
    'public/manifest.webmanifest',
    'convex/schema.ts',
    'convex/lib/access.ts',
    'convex/lib/slugs.ts',
    'convex/auth.ts',
    'convex/http.ts',
    'convex/testing.ts',
    'convex/signInThrottle.ts',
    'convex/_generated/api.d.ts',
    'convex/convex.config.ts',
    'e2e/support/fixtures.ts',
    'e2e/support/convex.ts',
    'e2e/global-setup.ts',
    'playwright.config.ts',
    'package.json',
    'package-lock.json',
    'angular.json',
    'netlify.toml',
    'tsconfig.json',
    '.github/workflows/ci.yml',
    'scripts/ci-scope.mjs',
    'scripts/e2e-affected.mjs',
    'scripts/e2e.mjs',
    'scripts/serve-ssr.mjs',
  ];
  for (const file of shared) {
    it(`is full for ${file}`, () => {
      assert.deepEqual(specsFor([file]), ['FULL']);
    });
  }

  it('is full when one shared file is among mapped ones', () => {
    assert.deepEqual(
      specsFor(['src/app/invites/accept-invite-page.ts', 'src/app/shell/shell.ts']),
      ['FULL'],
    );
  });

  it('is full for a source file that no rule names', () => {
    assert.deepEqual(specsFor(['src/app/standings/standings-page.ts']), ['FULL']);
    assert.deepEqual(specsFor(['convex/registrations.ts']), ['FULL']);
    assert.deepEqual(specsFor(['something-new.txt']), ['FULL']);
  });

  it('is full for a file in a mapped directory that only looks mapped', () => {
    assert.deepEqual(specsFor(['src/app/organizations/standings.ts']), ['FULL']);
    assert.deepEqual(specsFor(['convex/lib/invites.ts']), ['FULL']);
    assert.deepEqual(specsFor(['e2e/support/invites.spec.ts']), ['FULL']);
  });

  it('is full for every event but a pull request', () => {
    const files = ['src/app/invites/accept-invite-page.ts'];
    for (const event of ['schedule', 'workflow_dispatch', 'push', undefined]) {
      assert.deepEqual(specsFor(files, { event, base: 'main' }), ['FULL'], String(event));
    }
  });

  it('is full for a release PR into production', () => {
    assert.deepEqual(
      specsFor(['src/app/invites/accept-invite-page.ts'], { ...pr, base: 'production' }),
      ['FULL'],
    );
  });

  it('is full when detection has nothing to go on', () => {
    assert.deepEqual(specsFor(undefined), ['FULL']);
    assert.deepEqual(specsFor([]), ['FULL']);
    assert.deepEqual(specsFor(/** @type {any} */ ('src/app/invites/x.ts')), ['FULL']);
    assert.deepEqual(specsFor(/** @type {any} */ ([null])), ['FULL']);
  });

  const odd = [
    '/etc/passwd',
    '../outside.ts',
    'src/../convex/schema.ts',
    'src//app/invites/x.ts',
    './src/app/invites/x.ts',
    '"src/app/invites/caf\\303\\251.ts"',
    'src\\app\\invites\\x.ts',
    '',
  ];
  for (const file of odd) {
    it(`is full for the path ${JSON.stringify(file)}`, () => {
      assert.deepEqual(specsFor(['src/app/invites/accept-invite-page.ts', file]), ['FULL']);
    });
  }
});

describe('the mapping', () => {
  const onDisk = specFilesOnDisk();

  it('finds the specs on disk', () => {
    assert.ok(onDisk.includes('e2e/smoke.spec.ts'), onDisk.join(', '));
    assert.ok(onDisk.length > 20);
  });

  it('selects, with every filter it can emit, exactly the files it names', () => {
    const filters = new Set(ALWAYS);
    for (const area of AREAS) {
      for (const name of area.specs) if (name !== 'self') filters.add(`e2e/${name}.spec.ts`);
    }
    for (const filter of filters) {
      const selected = filesSelectedBy(filter, onDisk);
      if (filter.endsWith('/')) {
        assert.ok(selected.length > 0, `${filter} selects nothing`);
        assert.ok(
          selected.every((file) => file.startsWith(filter)),
          `${filter} selects ${selected.join(', ')}`,
        );
      } else {
        assert.deepEqual(selected, [filter], `${filter} selects ${selected.join(', ')}`);
      }
    }
  });

  it('selects every spec of a changed spec file, and only that spec', () => {
    for (const file of onDisk) {
      const selection = selectSpecs([file], pr);
      assert.equal(selection.scope, 'affected', file);
      const own = selection.specs.filter((filter) => !ALWAYS.includes(filter));
      assert.ok(
        selection.specs.some((filter) => filesSelectedBy(filter, onDisk).includes(file)),
        file,
      );
      assert.ok(own.length <= 1, `${file} selects ${own.join(', ')}`);
    }
  });

  // These specs run in no source-area rule. They run when changed, in the nightly full run, and
  // whenever a shared file changes. A new spec fails here until it is mapped or added on purpose.
  const FULL_SUITE_ONLY = [
    'e2e/cache-key.spec.ts',
    'e2e/convex-backend.spec.ts',
    'e2e/screenshot.spec.ts',
  ];

  it('maps every other spec to at least one source area, or lists it as full-suite only', () => {
    const mapped = new Set();
    for (const area of AREAS) {
      for (const name of area.specs) if (name !== 'self') mapped.add(`e2e/${name}.spec.ts`);
    }
    for (const always of ALWAYS)
      for (const file of filesSelectedBy(always, onDisk)) mapped.add(file);
    const unowned = onDisk.filter((file) => !mapped.has(file)).sort();
    assert.deepEqual(unowned, [...FULL_SUITE_ONLY].sort());
  });

  it('names every area once', () => {
    const names = AREAS.map((area) => area.name);
    assert.equal(new Set(names).size, names.length);
  });
});

describe('formatOutputs', () => {
  it('prints the full scope with no specs', () => {
    assert.equal(formatOutputs({ scope: 'full' }), 'e2e_scope=full\ne2e_specs=\n');
  });

  it('prints the affected specs on one space-separated line', () => {
    assert.equal(
      formatOutputs({ scope: 'affected', specs: ['e2e/a.spec.ts', 'e2e/harness/'] }),
      'e2e_scope=affected\ne2e_specs=e2e/a.spec.ts e2e/harness/\n',
    );
  });
});

describe('the command line', () => {
  /** @param {string} input @param {Record<string, string>} env */
  function run(input, env = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' }) {
    const result = spawnSync(process.execPath, [script], {
      input,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...env },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it('prints the affected specs for a PR into main', () => {
    const result = run('src/app/invites/accept-invite-page.ts\n');
    assert.equal(result.status, 0);
    assert.equal(
      result.stdout,
      'e2e_scope=affected\ne2e_specs=e2e/accept-invite.spec.ts e2e/harness/ e2e/smoke.spec.ts\n',
    );
  });

  it('prints the full scope for an empty list', () => {
    assert.equal(run('').stdout, 'e2e_scope=full\ne2e_specs=\n');
  });

  it('prints the full scope without the PR environment', () => {
    assert.equal(
      run('src/app/invites/accept-invite-page.ts\n', {}).stdout,
      'e2e_scope=full\ne2e_specs=\n',
    );
  });

  it('prints the full scope for a shared file', () => {
    assert.equal(run('src/app/shell/shell.ts\n').stdout, 'e2e_scope=full\ne2e_specs=\n');
  });
});
