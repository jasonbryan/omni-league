import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  ALWAYS,
  AREAS,
  SESSION,
  deriveSessionSpecs,
  findUnmappedMockupReads,
  formatOutputs,
  selectSpecs,
} from './e2e-affected.mjs';

const script = join(import.meta.dirname, 'e2e-affected.mjs');
const repoRoot = join(import.meta.dirname, '..');
const sessionSpecs = deriveSessionSpecs(repoRoot);
const pr = { event: 'pull_request', base: 'main' };

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

function filesSelectedBy(filter, files) {
  const pattern = new RegExp(filter, 'i');
  return files.filter((file) => pattern.test(file));
}

/** @param {string[]} files @returns {string[]} */
function specsFor(files, context = pr) {
  const selection = selectSpecs(files, {
    sessionSpecs,
    root: repoRoot,
    warn: () => {},
    ...context,
  });
  return selection.scope === 'full' ? ['FULL'] : selection.specs;
}

const smokeAndHarness = ['e2e/convex-backend.spec.ts', 'e2e/harness/', 'e2e/smoke.spec.ts'];

const want = (...filters) => [...new Set([...filters, ...smokeAndHarness])].sort();

describe('selectSpecs: mapped areas', () => {
  it('maps an admin locations file to the specs that open the locations page', () => {
    assert.deepEqual(
      specsFor(['src/app/organizations/admin/location-row.ts']),
      want(
        'e2e/organization-admin.spec.ts',
        'e2e/sign-in-admin.spec.ts',
        'e2e/validate-on-blur.spec.ts',
      ),
    );
  });

  it('maps the publish dialog to the three league specs and the specs of the leagues page that opens it, not the staff specs', () => {
    assert.deepEqual(
      specsFor(['src/app/organizations/admin/publish-league-dialog.ts']),
      want(
        'e2e/organization-leagues-custom-level.spec.ts',
        'e2e/organization-leagues-division.spec.ts',
        'e2e/organization-leagues-mockup.spec.ts',
        'e2e/validate-on-blur.spec.ts',
        'e2e/organization-leagues-publish-states.spec.ts',
        'e2e/organization-leagues-publish.spec.ts',
        'e2e/organization-leagues.spec.ts',
      ),
    );
  });

  it('maps the leagues page and its create form to the league specs and the mockup spec', () => {
    // organization-leagues-mockup compares the real page text with the approved mockup.
    for (const file of ['admin-leagues', 'league-create-form']) {
      assert.deepEqual(
        specsFor([`src/app/organizations/admin/${file}.ts`]),
        want(
          'e2e/organization-leagues-custom-level.spec.ts',
          'e2e/organization-leagues-division.spec.ts',
          'e2e/organization-leagues-mockup.spec.ts',
          'e2e/organization-leagues-publish-states.spec.ts',
          'e2e/organization-leagues-publish.spec.ts',
          'e2e/organization-leagues.spec.ts',
          'e2e/validate-on-blur.spec.ts',
        ),
        file,
      );
    }
  });

  it('maps the shared sticky form footer to the league specs and the organizer league page specs, and to its importers', () => {
    const specs = specsFor(['src/app/organizations/admin/sticky-footer.ts']);
    assert.ok(!specs.includes('FULL'));
    for (const name of [
      'league-management-details',
      'league-management-mockup',
      'league-management-publish',
      'league-management',
      'organization-leagues-mockup',
      'organization-leagues-publish-states',
      'organization-leagues-publish',
      'organization-leagues',
    ]) {
      assert.ok(specs.includes(`e2e/${name}.spec.ts`), name);
    }
  });

  it('maps an admin staff file to the staff and accept-invite specs', () => {
    assert.deepEqual(
      specsFor(['src/app/organizations/admin/invite-form.ts']),
      want(
        'e2e/accept-invite.spec.ts',
        'e2e/organization-staff-undo.spec.ts',
        'e2e/organization-staff.spec.ts',
        'e2e/validate-on-blur.spec.ts',
      ),
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
      'organization-staff-undo',
      'sign-in-admin',
      'accept-invite',
      'create-organization',
    ]) {
      assert.ok(specs.includes(`e2e/${name}.spec.ts`), name);
    }
    assert.ok(specs.includes('e2e/organization-leagues-mockup.spec.ts'));
    assert.ok(!specs.includes('e2e/sign-in.spec.ts'));
  });

  it('maps an invites file to accept-invite.spec.ts only', () => {
    assert.deepEqual(
      specsFor(['src/app/invites/accept-invite-page.ts']),
      want('e2e/accept-invite.spec.ts'),
    );
  });

  it('maps the sign-in, sign-up, account, and users code to every spec that signs a user up or in', () => {
    const expected = want(...sessionSpecs);
    for (const file of [
      'src/app/sign-in/sign-in-page.ts',
      'src/app/sign-up/sign-up-page.ts',
      'src/app/account/account-page.ts',
      'src/app/account/account-settings-page.ts',
      'src/app/account/your-organizations.ts',
      'convex/users.ts',
    ]) {
      assert.deepEqual(specsFor([file]), expected, file);
    }
    const accountLink = specsFor(['src/app/shell/account-link.ts']);
    assert.ok(!accountLink.includes('FULL'));
    for (const spec of expected) assert.ok(accountLink.includes(spec), spec);
    for (const name of [
      'sign-in',
      'sign-in-admin',
      'sign-up',
      'auth-session',
      'top-bar',
      'account-settings',
    ]) {
      assert.ok(sessionSpecs.includes(`e2e/${name}.spec.ts`), name);
    }
  });

  it('maps the home page to the session specs and the specs that open /', () => {
    const specs = specsFor(['src/app/placeholder/placeholder.ts']);
    for (const name of ['install', 'pwa', 'pwa-kill-switch', 'auth-session', 'sign-in-admin']) {
      assert.ok(specs.includes(`e2e/${name}.spec.ts`), name);
    }
  });

  it('runs the full suite for a session area when the session specs are not known', () => {
    for (const file of ['src/app/sign-up/sign-up-page.ts', 'convex/users.ts']) {
      assert.deepEqual(specsFor([file], { ...pr, sessionSpecs: undefined }), ['FULL']);
      assert.deepEqual(specsFor([file], { ...pr, sessionSpecs: [] }), ['FULL']);
    }
  });

  it('maps the public organization page files to the specs that open that page', () => {
    const specs = specsFor(['src/app/organizations/organization-overview.ts']);
    for (const name of ['organization-page', 'offline', 'pwa']) {
      assert.ok(specs.includes(`e2e/${name}.spec.ts`), name);
    }
    assert.ok(!specs.includes('FULL'));
  });

  it('maps the public organization page files to the league page spec too, because the league rows link to it', () => {
    for (const file of [
      'src/app/organizations/organization-overview.ts',
      'src/app/organizations/organization-page.ts',
    ]) {
      const specs = specsFor([file]);
      assert.ok(specs.includes('e2e/league-page.spec.ts'), file);
      assert.ok(!specs.includes('FULL'), file);
    }
  });

  it('maps the public league page and its paths to the league page, season page, sport view, and cache-key specs', () => {
    for (const file of [
      'src/app/organizations/public-league/public-league-page.ts',
      'src/app/organizations/public-league/public-league-content.ts',
    ]) {
      assert.deepEqual(
        specsFor([file]),
        want(
          'e2e/cache-key.spec.ts',
          'e2e/league-page-offline.spec.ts',
          'e2e/league-page.spec.ts',
          'e2e/public-page-layout-shift.spec.ts',
          'e2e/season-page.spec.ts',
          'e2e/sport-view.spec.ts',
        ),
        file,
      );
    }
  });

  it('maps the numbered control and the page helper to the league page, sport view, and find page specs, and to their importers', () => {
    for (const file of ['src/app/organizations/page-control.ts', 'src/app/core/list-page.ts']) {
      const specs = specsFor([file]);
      assert.ok(!specs.includes('FULL'), file);
      for (const name of [
        'cache-key',
        'find-a-league',
        'find-organizations',
        'league-page-offline',
        'league-page',
        'public-page-layout-shift',
        'sport-view',
      ]) {
        assert.ok(specs.includes(`e2e/${name}.spec.ts`), `${file}: ${name}`);
      }
    }
  });

  it('maps the sport chips and the organization page to the sport view spec', () => {
    for (const file of [
      'src/app/organizations/sport-chips.ts',
      'src/app/organizations/organization-page.ts',
      'src/app/organizations/organization-overview.ts',
      'convex/organizations.ts',
    ]) {
      const specs = specsFor([file]);
      assert.ok(specs.includes('e2e/sport-view.spec.ts'), file);
      assert.ok(specs.includes('e2e/cache-key.spec.ts'), file);
      assert.ok(!specs.includes('FULL'), file);
    }
  });

  it('maps the find page and its Convex search to the find page, organizations list, and cache-key specs, and its unit specs to none', () => {
    for (const file of [
      'src/app/find/find-page.ts',
      'src/app/find/find-content.ts',
      'convex/search.ts',
      'convex/lib/searchQuery.ts',
    ]) {
      assert.deepEqual(
        specsFor([file]),
        want(
          'e2e/cache-key.spec.ts',
          'e2e/find-a-league.spec.ts',
          'e2e/find-organizations.spec.ts',
        ),
        file,
      );
    }
    assert.deepEqual(specsFor(['src/app/find/find-page.spec.ts']), want());
    assert.deepEqual(specsFor(['src/app/find/testing/find-data.ts']), want());
  });

  it('maps the form field-error helper to the specs that fill in a form, and its unit spec to none', () => {
    const specs = specsFor(['src/app/core/forms/shown-errors.ts']);
    assert.ok(!specs.includes('FULL'));
    for (const name of [
      'sign-up',
      'sign-in',
      'create-organization',
      'organization-admin',
      'organization-leagues',
      'organization-staff',
      'league-management',
    ]) {
      assert.ok(specs.includes(`e2e/${name}.spec.ts`), name);
    }
    assert.deepEqual(specsFor(['src/app/core/forms/shown-errors.spec.ts']), want());
  });

  it('runs the full suite for the focus handler, which moves focus after every route change', () => {
    assert.deepEqual(specsFor(['src/app/core/focus-main.ts']), ['FULL']);
    assert.deepEqual(specsFor(['src/app/app.config.ts']), ['FULL']);
  });

  it('maps the create organization page and the navigation spec to the specs that assert the Back and focus moves', () => {
    const specs = specsFor(['src/app/organizations/create-organization-page.ts']);
    assert.ok(specs.includes('e2e/create-organization.spec.ts'));
    assert.ok(specs.includes('e2e/navigation-focus.spec.ts'));
    assert.deepEqual(
      specsFor(['e2e/navigation-focus.spec.ts']),
      want('e2e/navigation-focus.spec.ts'),
    );
    for (const file of ['src/app/sign-in/sign-in-page.ts', 'src/app/sign-up/sign-up-page.ts']) {
      assert.ok(specsFor([file]).includes('e2e/navigation-focus.spec.ts'), file);
    }
  });

  it('maps the public season page, its content, and its paths to the season page, layout shift, and cache-key specs', () => {
    for (const file of [
      'src/app/organizations/public-season/public-season-page.ts',
      'src/app/organizations/public-season/public-season-content.ts',
      'src/app/organizations/public-season/public-season-view.ts',
    ]) {
      assert.deepEqual(
        specsFor([file]),
        want(
          'e2e/cache-key.spec.ts',
          'e2e/public-page-layout-shift.spec.ts',
          'e2e/season-page.spec.ts',
        ),
        file,
      );
    }
  });

  it('keeps the unit specs and test data of the season page out of the e2e run', () => {
    assert.deepEqual(
      specsFor(['src/app/organizations/public-season/public-season-page.spec.ts']),
      want(),
    );
    assert.deepEqual(
      specsFor(['src/app/organizations/public-season/public-season-page.server.spec.ts']),
      want(),
    );
    assert.deepEqual(
      specsFor(['src/app/organizations/public-season/public-season-page-offline.spec.ts']),
      want(),
    );
    assert.deepEqual(
      specsFor(['src/app/organizations/public-season/testing/season-data.ts']),
      want(),
    );
    assert.deepEqual(specsFor(['convex/seasonsPublicPage.test.ts']), want());
  });

  it('maps a changed season page spec to itself', () => {
    assert.deepEqual(specsFor(['e2e/season-page.spec.ts']), want('e2e/season-page.spec.ts'));
  });

  it('maps the not-found and offline views to the league page and season page specs that assert them', () => {
    const notFound = specsFor(['src/app/not-found/not-found-view.ts']);
    assert.ok(notFound.includes('e2e/league-page.spec.ts'));
    assert.ok(notFound.includes('e2e/season-page.spec.ts'));
    const offline = specsFor(['src/app/offline/not-saved-view.ts']);
    for (const name of ['league-page', 'league-page-offline', 'season-page']) {
      assert.ok(offline.includes(`e2e/${name}.spec.ts`), name);
    }
    assert.ok(!notFound.includes('FULL') && !offline.includes('FULL'));
  });

  it('keeps the other core files in the full suite, and the test data of the league page out of it', () => {
    assert.deepEqual(specsFor(['src/app/core/list-page.spec.ts']), want());
    assert.deepEqual(specsFor(['src/app/core/focus-main.spec.ts']), want());
    assert.deepEqual(specsFor(['src/app/organizations/page-control.spec.ts']), want());
    assert.deepEqual(
      specsFor(['src/app/organizations/public-league/testing/league-data.ts']),
      want(),
    );
    assert.deepEqual(specsFor(['src/app/core/focus-main.ts', 'src/app/core/page-meta.ts']), [
      'FULL',
    ]);
  });

  it('maps convex/seasons.ts to the league page and league management specs', () => {
    const specs = specsFor(['convex/seasons.ts']);
    for (const name of [
      'league-page',
      'league-page-offline',
      'cache-key',
      'league-management',
      'league-management-publish',
      'league-management-mockup',
    ]) {
      assert.ok(specs.includes(`e2e/${name}.spec.ts`), name);
    }
    assert.ok(!specs.includes('FULL'));
    assert.ok(specsFor(['convex/leagues.ts']).includes('e2e/league-page.spec.ts'));
    assert.ok(specsFor(['convex/organizations.ts']).includes('e2e/league-page.spec.ts'));
  });

  it('maps convex/seasons.ts and convex/organizations.ts to the season page specs', () => {
    for (const file of ['convex/seasons.ts', 'convex/organizations.ts']) {
      const specs = specsFor([file]);
      assert.ok(specs.includes('e2e/season-page.spec.ts'), file);
      assert.ok(specs.includes('e2e/cache-key.spec.ts'), file);
      assert.ok(!specs.includes('FULL'), file);
    }
  });

  it('maps the shared initials helper to the admin specs and the public page specs, without the full suite', () => {
    const specs = specsFor(['src/app/organizations/initials.ts']);
    assert.ok(specs.includes('e2e/organization-admin.spec.ts'));
    assert.ok(specs.includes('e2e/organization-page.spec.ts'));
    assert.ok(!specs.includes('FULL'));
  });

  it('maps the public layout to its own spec, the specs that open a public page, and every session spec', () => {
    const specs = specsFor(['src/app/public-layout/public-layout.ts']);
    for (const name of [
      'public-layout',
      'organization-page',
      'league-page',
      'season-page',
      'not-found',
      'accept-invite',
      'smoke',
      'offline',
      'sign-in',
      'sign-up',
    ]) {
      assert.ok(specs.includes(`e2e/${name}.spec.ts`), name);
    }
    assert.ok(!specs.includes('FULL'));
  });

  it('maps the public layout and the page skeletons to the layout shift spec', () => {
    for (const file of [
      'src/app/public-layout/public-layout.ts',
      'src/app/organizations/organization-skeleton.ts',
      'src/app/organizations/public-league/public-league-skeleton.ts',
      'src/app/organizations/public-season/public-season-skeleton.ts',
    ]) {
      assert.ok(specsFor([file]).includes('e2e/public-page-layout-shift.spec.ts'), file);
    }
  });

  it('maps each mockup that a spec reads to that spec, and every other design file to nothing', () => {
    const mockups = {
      '66-69-organization-leagues.html': 'organization-leagues-mockup',
      '125-126-seasons.html': 'league-management-mockup',
      '141-app-leagues.html': 'app-leagues',
    };
    for (const [file, spec] of Object.entries(mockups)) {
      assert.deepEqual(specsFor([`design/mockups/${file}`]), want(`e2e/${spec}.spec.ts`), file);
    }
    assert.deepEqual(
      specsFor(['design/mockups/80-app-icon.html', 'design/mockup-kit/x.css']),
      want(),
    );
  });

  it('maps the chip classes and the mockup whose kit block the chip spec reads to that spec', () => {
    const chipClasses = specsFor(['src/app/ui/chip/chip-classes.ts']);
    assert.ok(chipClasses.includes('e2e/chip-classes.spec.ts'));
    assert.ok(!chipClasses.includes('FULL'));
    assert.deepEqual(
      specsFor(['design/mockups/300-public-site-league-form.html']),
      want('e2e/chip-classes.spec.ts'),
    );
    assert.deepEqual(specsFor(['src/app/ui/chip/chip-classes.spec.ts']), want());
  });

  it('maps Convex modules to the specs that exercise them', () => {
    const admin = [
      'organization-admin',
      'organization-leagues',
      'organization-leagues-mockup',
      'organization-leagues-publish',
      'organization-leagues-publish-states',
      'organization-staff',
      'organization-staff-undo',
      'sign-in-admin',
      'accept-invite',
      'create-organization',
    ];
    // The admin overview queries invites, leagues, and locations, so each runs every admin spec.
    for (const file of ['convex/invites.ts', 'convex/leagues.ts', 'convex/locations.ts']) {
      const specs = specsFor([file]);
      for (const name of admin)
        assert.ok(specs.includes(`e2e/${name}.spec.ts`), `${file}: ${name}`);
    }
    assert.ok(specsFor(['convex/leagues.ts']).includes('e2e/organization-page.spec.ts'));
    assert.ok(specsFor(['convex/locations.ts']).includes('e2e/organization-page.spec.ts'));
    assert.ok(specsFor(['convex/seed.ts']).includes('e2e/pwa.spec.ts'));
    assert.ok(specsFor(['convex/organizations.ts']).includes('e2e/organization-page.spec.ts'));
    for (const file of sessionSpecs) {
      assert.ok(specsFor(['convex/organizations.ts']).includes(file), file);
    }
    assert.ok(specsFor(['convex/memberships.ts']).includes('e2e/organization-staff.spec.ts'));
  });

  it('maps the offline views to the public-page specs', () => {
    const specs = specsFor(['src/app/offline/saved-copy-note.ts']);
    for (const name of ['offline', 'organization-page', 'top-bar']) {
      assert.ok(specs.includes(`e2e/${name}.spec.ts`), name);
    }
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
      want(
        'e2e/accept-invite.spec.ts',
        'e2e/organization-staff-undo.spec.ts',
        'e2e/organization-staff.spec.ts',
        ...sessionSpecs,
      ),
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
    '.github/workflows/staging-rebuild.yml',
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
    'src/app/core/auth/auth.service.ts',
    'src/app/core/data/convex/inject-query.ts',
    'src/app/core/service-worker/app-updates.ts',
    'src/app/core/url-serializer.ts',
    'src/app/ui/button/button.ts',
    'src/app/core/auth/guards.ts',
    'src/app/app.config.ts',
    'src/server.ts',
    'src/main.ts',
    'src/index.html',
    'src/styles.css',
    'src/styles/tokens.css',
    'public/manifest.webmanifest',
    'convex/schema.ts',
    'convex/lib/slugs.ts',
    'convex/auth.ts',
    'convex/http.ts',
    'convex/testing.ts',
    'convex/signInThrottle.ts',
    'convex/convex.config.ts',
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
      specsFor(['src/app/invites/accept-invite-page.ts', 'src/app/core/auth/auth.service.ts']),
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
      for (const name of area.specs) {
        if (name !== 'self' && name !== SESSION) filters.add(`e2e/${name}.spec.ts`);
      }
    }
    for (const file of sessionSpecs) {
      filters.add(file);
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
  // cache-key.spec.ts is mapped to the public league page and the season page, which have their own
  // samples in it.
  const FULL_SUITE_ONLY = ['e2e/screenshot.spec.ts'];

  it('maps every other spec to at least one source area, or lists it as full-suite only', () => {
    const mapped = new Set();
    for (const area of AREAS) {
      for (const name of area.specs) {
        if (name !== 'self' && name !== SESSION) mapped.add(`e2e/${name}.spec.ts`);
      }
    }
    for (const file of sessionSpecs) mapped.add(file);
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
      'e2e_scope=affected\ne2e_specs=e2e/accept-invite.spec.ts e2e/convex-backend.spec.ts e2e/harness/ e2e/smoke.spec.ts\n',
    );
  });

  it('prints every session spec for a sign-up change, derived from the real specs', () => {
    const result = run('src/app/sign-up/sign-up-page.ts\n');
    assert.equal(result.status, 0);
    for (const file of sessionSpecs) assert.ok(result.stdout.includes(file), file);
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
    assert.equal(run('src/app/core/auth/auth.service.ts\n').stdout, 'e2e_scope=full\ne2e_specs=\n');
  });
});

describe('the specs that sign a user up or in', () => {
  const onDisk = specFilesOnDisk();
  const read = (file) => readFileSync(join(repoRoot, file), 'utf8');

  // Written separately from deriveSessionSpecs: a spec that drives the sign-up form through a support
  // helper. A support file is a helper when its source uses `signUp`, `otherUser`, `newUser`, or
  // `seedUser`, or imports a helper, directly or through other support files; a spec is a user of it
  // when it imports it by path.
  const supportDir = join(repoRoot, 'e2e', 'support');
  const supportSources = new Map(
    readdirSync(supportDir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => [name.slice(0, -3), readFileSync(join(supportDir, name), 'utf8')]),
  );
  const helperNames = new Set(
    [...supportSources]
      .filter(([, text]) => /\b(?:signUp|otherUser|newUser|seedUser)\b/.test(text))
      .map(([name]) => name),
  );
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, text] of supportSources) {
      const importsHelper = [...helperNames].some((helper) => text.includes(`'./${helper}'`));
      if (!helperNames.has(name) && importsHelper) {
        helperNames.add(name);
        grew = true;
      }
    }
  }
  const importsSessionHelper = onDisk.filter((file) =>
    [...helperNames].some((name) => new RegExp(`from '[^']*support/${name}'`).test(read(file))),
  );

  it('finds the specs that import a sign-up helper', () => {
    assert.ok(helperNames.has('session') && helperNames.has('users'), [...helperNames].join(', '));
    assert.ok(importsSessionHelper.length >= 9, importsSessionHelper.join(', '));
    assert.ok(importsSessionHelper.includes('e2e/sign-in-admin.spec.ts'));
  });

  it('derives every spec that imports a sign-up helper, and the specs that open the sign-in or sign-up page', () => {
    for (const file of importsSessionHelper) assert.ok(sessionSpecs.includes(file), file);
    for (const file of ['e2e/sign-in.spec.ts', 'e2e/sign-up.spec.ts', 'e2e/auth-session.spec.ts']) {
      assert.ok(sessionSpecs.includes(file), file);
    }
  });

  for (const area of [
    'src/app/sign-up/sign-up-page.ts',
    'src/app/sign-in/sign-in-page.ts',
    'src/app/account/account-page.ts',
    'convex/users.ts',
    'src/app/placeholder/placeholder.ts',
  ]) {
    it(`selects every one of them for ${area}`, () => {
      const selection = selectSpecs([area], { ...pr, root: repoRoot, sessionSpecs });
      assert.equal(selection.scope, 'affected');
      for (const file of importsSessionHelper) {
        assert.ok(
          selection.specs.some((filter) => filesSelectedBy(filter, onDisk).includes(file)),
          `${area} does not select ${file}`,
        );
      }
    });
  }

  it('derives a new spec that signs in without a change to the mapping', () => {
    const root = mkdtempSync(join(tmpdir(), 'session-specs-'));
    try {
      mkdirSync(join(root, 'e2e', 'harness'), { recursive: true });
      mkdirSync(join(root, 'e2e', 'support'), { recursive: true });
      writeFileSync(
        join(root, 'e2e', 'new.spec.ts'),
        "import { signUp } from './support/session';\n",
      );
      writeFileSync(
        join(root, 'e2e', 'plain.spec.ts'),
        "import { test } from './support/fixtures';\n",
      );
      writeFileSync(
        join(root, 'e2e', 'page.spec.ts'),
        "await page.goto('/sign-in?returnTo=%2Fapp');\n",
      );
      writeFileSync(
        join(root, 'e2e', 'harness', 'h.spec.ts'),
        "import { newUser } from '../support/users';\n",
      );
      assert.deepEqual(deriveSessionSpecs(root), [
        'e2e/harness/h.spec.ts',
        'e2e/new.spec.ts',
        'e2e/page.spec.ts',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('derives a spec that imports only a support helper wrapping signUp, however deeply', () => {
    const root = mkdtempSync(join(tmpdir(), 'session-specs-'));
    try {
      mkdirSync(join(root, 'e2e', 'harness'), { recursive: true });
      mkdirSync(join(root, 'e2e', 'support'), { recursive: true });
      const support = (name, text) => writeFileSync(join(root, 'e2e', 'support', name), text);
      support('session.ts', 'export async function signUp() {}\n');
      support('users.ts', 'export function newUser() {}\n');
      support('wrapper.ts', "import { signUp } from './session';\n");
      support('outer.ts', "import { wrap } from './wrapper';\n");
      support('plain.ts', "import { x } from './env';\n");
      const spec = (path, text) => writeFileSync(join(root, 'e2e', path), text);
      spec('via-wrapper.spec.ts', "import { wrap } from './support/wrapper';\n");
      spec('via-outer.spec.ts', "import { outer } from './support/outer';\n");
      spec('harness/via-outer.spec.ts', "import { outer } from '../support/outer';\n");
      spec('unrelated.spec.ts', "import { x } from './support/plain';\n");
      assert.deepEqual(deriveSessionSpecs(root), [
        'e2e/harness/via-outer.spec.ts',
        'e2e/via-outer.spec.ts',
        'e2e/via-wrapper.spec.ts',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws, so the step runs the full suite, when no spec signs in or e2e/ is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'session-specs-'));
    try {
      assert.throws(() => deriveSessionSpecs(root));
      mkdirSync(join(root, 'e2e', 'harness'), { recursive: true });
      mkdirSync(join(root, 'e2e', 'support'), { recursive: true });
      assert.throws(() => deriveSessionSpecs(root), /no e2e spec signs a user in/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('findUnmappedMockupReads', () => {
  function inFixtureRepo(files, check) {
    const root = mkdtempSync(join(tmpdir(), 'mockup-reads-'));
    try {
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), text);
      }
      check(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  const mockupFiles = {
    'design/mockups/999-new.html': '<html></html>\n',
    'design/mockups/66-69-organization-leagues.html': '<html></html>\n',
  };
  const readsMockup = (name) =>
    `readFileSync(join(process.cwd(), 'design', 'mockups', '${name}'), 'utf8');\n`;

  it('finds no unmapped read in the repo', () => {
    assert.deepEqual(findUnmappedMockupReads(repoRoot), []);
  });

  it('reports a spec that reads a mockup no rule maps', () => {
    inFixtureRepo(
      { ...mockupFiles, 'e2e/new-mockup.spec.ts': readsMockup('999-new.html') },
      (root) => {
        assert.deepEqual(findUnmappedMockupReads(root), ['new-mockup: 999-new.html']);
      },
    );
  });

  it('reports a harness spec by its path relative to e2e, which the harness filter does not cover', () => {
    inFixtureRepo(
      { ...mockupFiles, 'e2e/harness/new-mockup.spec.ts': readsMockup('999-new.html') },
      (root) => {
        assert.deepEqual(findUnmappedMockupReads(root), ['harness/new-mockup: 999-new.html']);
      },
    );
  });

  it('reports a spec that builds its mockup path from a template with no file name', () => {
    inFixtureRepo(
      {
        ...mockupFiles,
        'e2e/built-path.spec.ts': 'const path = `design/mockups/${name}`;\n',
      },
      (root) => {
        assert.deepEqual(findUnmappedMockupReads(root), ['built-path']);
      },
    );
  });

  it('reports a file under e2e that is not a spec and names a mockup or the word', () => {
    inFixtureRepo(
      {
        ...mockupFiles,
        'e2e/support/mockup-text.ts': "export const file = '66-69-organization-leagues.html';\n",
        'e2e/support/word.ts': "export const dir = 'mockups';\n",
        'e2e/global-setup.ts': readsMockup('999-new.html'),
        'e2e/harness/probes/p.ts': 'const dir = `design/mockups/${x}`;\n',
        'e2e/support/clean.ts': 'export const x = 1;\n',
      },
      (root) => {
        assert.deepEqual(findUnmappedMockupReads(root), [
          'global-setup.ts',
          'harness/probes/p.ts',
          'support/mockup-text.ts',
          'support/word.ts',
        ]);
      },
    );
  });

  it('reports nothing for a spec that reads a mockup a rule maps', () => {
    inFixtureRepo(
      {
        ...mockupFiles,
        'e2e/organization-leagues-mockup.spec.ts': readsMockup('66-69-organization-leagues.html'),
      },
      (root) => {
        assert.deepEqual(findUnmappedMockupReads(root), []);
      },
    );
  });
});
