// Which e2e specs a `ci` run executes (#186, docs/process/ci.md). Node built-ins only: the
// `e2e specs` step runs before setup-node, on the Node the runner image ships.
//
// A PR into `main` runs the specs its changed files map to (see AREAS), plus the smoke and harness
// specs (ALWAYS). The full suite runs when:
// - the event is not a pull request, or the PR targets `production` (a release);
// - the changed-file list is empty or holds a path that is not plainly relative;
// - any changed file is shared code (src/app/shell, src/app/core, src/app/ui, the server entry
//   points, styles, tokens), shared Convex code (convex/schema.ts, convex/lib, auth, testing.ts),
//   e2e/support, the Playwright config, package files, angular.json, the CI files, or anything
//   else no rule below names. A path with no rule is never skipped.
// - detection throws or prints nothing (the workflow step falls back to the full suite).
// The nightly run on `main` (the `schedule` event) is the full suite by the same rule.
//
// A rule's spec list may hold `@session`: the specs that sign a user up or in, derived from the
// e2e sources (see deriveSessionSpecs), not listed by hand. A change to the sign-up, sign-in,
// account, or `users` code, or to the home page, runs all of them, because they drive those pages.
//
// A rule names the specs it adds. A rule with no specs says the file cannot change an e2e result
// (documentation, unit specs and their test doubles); `ALWAYS` still runs.
//
// Spec names are Playwright file filters (regular expressions matched against the test file
// path), so `e2e/sign-in.spec.ts` selects that file only; scripts/e2e-affected.test.mjs checks
// every entry selects exactly the files it names.
//
// Usage: `git diff --no-renames --name-only HEAD^1 HEAD | node scripts/e2e-affected.mjs`, with
// GITHUB_EVENT_NAME and GITHUB_BASE_REF in the environment. It prints `key=value` lines for
// $GITHUB_OUTPUT: `e2e_scope=full|affected` and `e2e_specs=<space-separated filters>`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** A spec file name under e2e/ (`organization-staff` is e2e/organization-staff.spec.ts). */
const spec = (name) => `e2e/${name}.spec.ts`;

/** Specs that run on every PR: the smoke test and the harness self-tests (a directory filter). */
export const ALWAYS = [spec('smoke'), 'e2e/harness/'];

// Spec groups, by the part of the product they exercise. The same spec can be in several.
const LEAGUE_ADMIN = [
  'organization-leagues',
  'organization-leagues-publish',
  'organization-leagues-publish-states',
];
const LOCATION_ADMIN = ['organization-admin', 'sign-in-admin'];
const STAFF = ['organization-staff', 'accept-invite'];
/** Every spec that opens the admin area. */
const ADMIN = [
  ...new Set([
    'organization-admin',
    ...LEAGUE_ADMIN,
    'organization-staff',
    'sign-in-admin',
    'accept-invite',
    'create-organization',
    'organization-leagues-mockup',
  ]),
];
/** Every spec that opens the public organization page. */
const PUBLIC_PAGE = [
  'organization-page',
  'organization-page-links',
  'organization-admin',
  'organization-leagues-publish',
  'organization-leagues-publish-states',
  'create-organization',
  'offline',
  'offline-note-height',
  'pwa',
  'top-bar',
  'auth-session',
];

/**
 * Every spec that opens the public league page (#127), directly or from the organization page: its
 * own spec, its offline spec (saved pages), and the cache-key samples of its `?page=N` parameter.
 */
const LEAGUE_PAGE = ['league-page', 'league-page-offline', 'cache-key'];
/**
 * Every spec that opens the sport view (#114), directly or from the organization or league page: its
 * own spec, the tester's focus, sheet, and offline probes, and the cache-key samples of its
 * `?page=N` parameter. The league page links to it from
 * its sidebar and breadcrumb, and the organization page lists the sports in its sidebar.
 */
const SPORT_VIEW = ['sport-view', 'sport-view-tester', 'cache-key'];
/** Every spec that opens the organizer's league page (#125, #126), where seasons are created and published. */
const LEAGUE_MANAGEMENT = [
  'league-management',
  'league-management-publish',
  'league-management-mockup',
];

/** The token in a rule's `specs` for the specs that sign a user up or in (deriveSessionSpecs). */
export const SESSION = '@session';

/**
 * The names (no extension) of the e2e/support modules that sign a user up or in: `session` and
 * `users` (`signUp`/`otherUser`, `newUser`/`seedUser`), and any support module that imports one of
 * them, directly or through other support modules.
 * @param {string} root Repository root.
 * @returns {Set<string>}
 */
function sessionHelpers(root) {
  const dir = join(root, 'e2e', 'support');
  /** @type {Map<string, string[]>} Support module name -> the support modules it imports. */
  const imports = new Map();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const text = readFileSync(join(dir, entry.name), 'utf8');
    const names = [...text.matchAll(SUPPORT_SIBLING_IMPORT)].map((match) => match[1]);
    imports.set(entry.name.slice(0, -'.ts'.length), names);
  }
  const helpers = new Set(['session', 'users']);
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, names] of imports) {
      if (!helpers.has(name) && names.some((imported) => helpers.has(imported))) {
        helpers.add(name);
        grew = true;
      }
    }
  }
  return helpers;
}
/** An import of a sibling module from a file in e2e/support: `from './session'`. */
const SUPPORT_SIBLING_IMPORT = /from '\.\/([\w-]+)'/g;
/** An import of a support module from a spec: `from './support/session'` or `'../support/users'`. */
const SPEC_SUPPORT_IMPORT = /from '\.{1,2}\/support\/([\w-]+)'/g;

/**
 * The e2e specs that sign a user up or in: those that import a session helper (see
 * sessionHelpers) or open the sign-in or sign-up page. Derived from the spec and support files, so
 * a new spec, or a new helper that wraps `signUp`, is selected without a change here. Throws when
 * e2e/ cannot be read or no spec matches, so the caller runs the full suite.
 * @param {string} root Repository root.
 * @returns {string[]} Repo-relative spec paths, sorted.
 */
export function deriveSessionSpecs(root) {
  const helpers = sessionHelpers(root);
  const found = [];
  for (const dir of ['e2e', 'e2e/harness']) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.spec.ts')) continue;
      const text = readFileSync(join(root, dir, entry.name), 'utf8');
      const usesHelper = [...text.matchAll(SPEC_SUPPORT_IMPORT)].some((match) =>
        helpers.has(match[1]),
      );
      if (usesHelper || SIGN_IN_OR_UP_PAGE.test(text)) found.push(`${dir}/${entry.name}`);
    }
  }
  if (found.length === 0) throw new Error('no e2e spec signs a user in; the specs are unreadable');
  return found.sort();
}
const SIGN_IN_OR_UP_PAGE = /goto\([^)]*\/sign-(?:in|up)\b/;

/**
 * @typedef {{ name: string, test: (file: string) => boolean, specs: string[] }} Rule
 * The first rule whose `test` is true decides a file. `specs` are spec names (no directory or
 * extension) or, for a rule that lists full paths, already-formed filters starting `e2e/`.
 */

const inDir =
  (...dirs) =>
  (file) =>
    dirs.some((dir) => file.startsWith(dir));
const named = (dir, names) => (file) => names.some((name) => file === `${dir}${name}.ts`);
const matching = (pattern) => (file) => pattern.test(file);

/** @type {Rule[]} */
export const AREAS = [
  // Cannot change an e2e result: unit specs, their test doubles (imported by specs only), and files
  // no test or build reads.
  { name: 'unit specs', test: matching(/^(?:src|convex)\/.+\.(?:spec|test)\.ts$/), specs: [] },
  { name: 'convex test setup', test: (file) => file === 'convex/test.setup.ts', specs: [] },
  { name: 'script tests', test: matching(/^scripts\/[^/]+\.test\.mjs$/), specs: [] },
  { name: 'unit test doubles', test: matching(/^src\/app\/.*\/testing\/[^/]+\.ts$/), specs: [] },
  {
    name: 'markdown outside the app',
    test: (file) => /\.md$/.test(file) && !inDir('src/', 'public/', 'e2e/')(file),
    specs: [],
  },
  { name: 'docs and agent files', test: inDir('docs/', '.claude/'), specs: [] },
  {
    name: 'GitHub files other than ci.yml',
    test: (file) =>
      inDir('.github/ISSUE_TEMPLATE/')(file) ||
      [
        '.github/pull_request_template.md',
        '.github/dependabot.yml',
        '.github/workflows/clean-previews.yml',
      ].includes(file),
    specs: [],
  },

  // The one design file an e2e spec opens; every other file under design/ is read by no spec.
  {
    name: 'leagues mockup',
    test: (file) => file === 'design/mockups/66-69-organization-leagues.html',
    specs: ['organization-leagues-mockup'],
  },
  { name: 'design files', test: inDir('design/'), specs: [] },

  // A changed spec runs itself. The harness probes run inside console-fixture.spec.ts.
  {
    name: 'harness probes',
    test: inDir('e2e/harness/probes/'),
    specs: [],
  },
  { name: 'e2e spec', test: matching(/^e2e\/(?:harness\/)?[\w-]+\.spec\.ts$/), specs: ['self'] },

  // Source areas.
  {
    name: 'admin locations',
    test: (file) =>
      named('src/app/organizations/admin/', [
        'add-location-form',
        'admin-locations',
        'location-edit-form',
        'location-fields',
        'location-form',
        'location-row',
      ])(file),
    specs: LOCATION_ADMIN,
  },
  {
    // The mockup spec compares the real leagues page text with the approved mockup, so a changed
    // label, hint, or error in these files must run it. It strips the Publish buttons, so the
    // publish dialog is not here.
    name: 'admin leagues page',
    test: named('src/app/organizations/admin/', [
      'admin-leagues',
      'league-create-form',
      'league-form',
    ]),
    specs: [...LEAGUE_ADMIN, 'organization-leagues-mockup'],
  },
  {
    name: 'admin leagues publish dialog',
    test: named('src/app/organizations/admin/', ['publish-league-dialog']),
    specs: LEAGUE_ADMIN,
  },
  {
    name: 'admin staff',
    test: named('src/app/organizations/admin/', [
      'admin-staff',
      'invite-form',
      'staff-invite-panel',
      'format-day',
    ]),
    specs: STAFF,
  },
  { name: 'admin area', test: inDir('src/app/organizations/admin/'), specs: ADMIN },
  {
    name: 'create organization',
    test: named('src/app/organizations/', ['create-organization-page']),
    specs: ['create-organization'],
  },
  {
    name: 'public organization page',
    test: named('src/app/organizations/', [
      'organization-page',
      'organization-overview',
      'organization-path',
      'organization-sidebar',
    ]),
    // The admin area imports `initials` from organization-sidebar, and the league rows link to the
    // public league page (#127), which league-page.spec.ts reaches from here.
    specs: [...PUBLIC_PAGE, ...ADMIN, ...LEAGUE_PAGE, ...SPORT_VIEW],
  },
  {
    // The public league page (#127): its page, content, sidebar, paths, and test data. Its sidebar
    // and breadcrumb link to the sport view (#114).
    name: 'public league page',
    test: inDir('src/app/organizations/public-league/'),
    specs: [...LEAGUE_PAGE, ...SPORT_VIEW],
  },
  {
    // The sport view (#114): its page, content, paths, and test data. The organization sidebar it
    // shows is the public organization page's rule above.
    name: 'sport view',
    test: inDir('src/app/organizations/sport-view/'),
    specs: SPORT_VIEW,
  },
  {
    // The numbered control (#127, shared with #103's lists): the league page's seasons and the
    // sport view's leagues (#114).
    name: 'numbered page control',
    test: named('src/app/organizations/', ['page-control']),
    specs: [...LEAGUE_PAGE, ...SPORT_VIEW],
  },
  {
    // `parseListPage` and the page query (#127) and the focus move after a route change (#127,
    // #114).
    name: 'list page and focus helpers',
    test: named('src/app/core/', ['list-page', 'focus-main']),
    specs: [...LEAGUE_PAGE, ...SPORT_VIEW],
  },
  { name: 'invites', test: inDir('src/app/invites/'), specs: ['accept-invite'] },
  { name: 'sign-in page', test: inDir('src/app/sign-in/'), specs: [SESSION] },
  { name: 'sign-up page', test: inDir('src/app/sign-up/'), specs: [SESSION] },
  {
    name: 'account page',
    test: inDir('src/app/account/'),
    specs: [SESSION],
  },
  {
    name: 'not-found view',
    test: inDir('src/app/not-found/'),
    // league-page.spec.ts asserts the league page's 404 (#127), sport-view.spec.ts the sport
    // view's (#114).
    specs: ['not-found', 'organization-page', 'league-page', 'sport-view', ...ADMIN],
  },
  {
    name: 'offline views',
    test: inDir('src/app/offline/'),
    // The league page's saved-copy note and not-saved view (#127).
    specs: [
      'offline',
      'offline-note-height',
      'pwa',
      ...PUBLIC_PAGE,
      'league-page',
      'league-page-offline',
    ],
  },
  {
    name: 'placeholder home',
    test: inDir('src/app/placeholder/'),
    specs: ['install', 'pwa', 'pwa-kill-switch', SESSION],
  },

  // Convex modules that e2e specs exercise through the app or through `convexRun`. Anything else
  // under convex/ (schema, lib, auth, http, testing, health, _generated, config) is shared or
  // unmapped and runs the full suite.
  {
    name: 'convex organizations',
    test: named('convex/', ['organizations']),
    specs: [...PUBLIC_PAGE, ...ADMIN, ...LEAGUE_PAGE, ...SPORT_VIEW, SESSION],
  },
  {
    name: 'convex locations',
    test: named('convex/', ['locations']),
    specs: [...ADMIN, ...LOCATION_ADMIN, ...PUBLIC_PAGE],
  },
  {
    name: 'convex leagues',
    test: named('convex/', ['leagues']),
    specs: [
      ...ADMIN,
      ...LEAGUE_ADMIN,
      ...PUBLIC_PAGE,
      ...LEAGUE_PAGE,
      ...SPORT_VIEW,
      ...LEAGUE_MANAGEMENT,
    ],
  },
  {
    // `seasons.create`, `publish`, `listForOrganizer` (the organizer's league page) and
    // `listPublic` (the public league page).
    name: 'convex seasons',
    test: named('convex/', ['seasons']),
    specs: [...LEAGUE_PAGE, ...LEAGUE_MANAGEMENT],
  },
  { name: 'convex invites', test: named('convex/', ['invites']), specs: [...ADMIN, ...STAFF] },
  {
    name: 'convex memberships',
    test: named('convex/', ['memberships']),
    specs: ADMIN,
  },
  { name: 'convex users', test: named('convex/', ['users']), specs: [SESSION] },
  { name: 'convex demo seed', test: named('convex/', ['seed']), specs: ['pwa'] },
];

/** @param {string} path */
function isPlainPath(path) {
  return (
    path !== '' &&
    !/["\\\0]/.test(path) &&
    !path.startsWith('/') &&
    !path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  );
}

/** The filters a rule adds for `file`: spec names become paths, `self` is the changed spec. */
function filtersFor(rule, file, sessionSpecs) {
  return rule.specs.flatMap((name) => {
    if (name === 'self') return [file];
    if (name === SESSION) return sessionSpecs;
    return [spec(name)];
  });
}

/**
 * @param {string[] | undefined} files Changed paths, one entry per path.
 * @param {{ event?: string, base?: string, sessionSpecs?: string[] | (() => string[]) }} [context]
 * `sessionSpecs` is a list, or a function that derives it, called only when a changed file needs it.
 * @returns {{ scope: 'full' } | { scope: 'affected', specs: string[] }}
 */
export function selectSpecs(files, { event, base, sessionSpecs } = {}) {
  const full = { scope: /** @type {const} */ ('full') };
  if (event !== 'pull_request' || base === 'production') return full;
  if (!Array.isArray(files) || files.length === 0) return full;
  const selected = new Set(ALWAYS);
  for (const file of files) {
    if (typeof file !== 'string' || !isPlainPath(file)) return full;
    const rule = AREAS.find((area) => area.test(file));
    if (!rule) return full;
    // A rule that needs the derived session specs runs everything when they are not known.
    let session = [];
    if (rule.specs.includes(SESSION)) {
      session = (typeof sessionSpecs === 'function' ? sessionSpecs() : sessionSpecs) ?? [];
      if (session.length === 0) return full;
    }
    for (const filter of filtersFor(rule, file, session)) selected.add(filter);
  }
  return { scope: 'affected', specs: [...selected].sort() };
}

/** The lines the `e2e specs` step appends to $GITHUB_OUTPUT. */
export function formatOutputs(selection) {
  return selection.scope === 'full'
    ? 'e2e_scope=full\ne2e_specs=\n'
    : `e2e_scope=affected\ne2e_specs=${selection.specs.join(' ')}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const context = { event: process.env.GITHUB_EVENT_NAME, base: process.env.GITHUB_BASE_REF };
  let selection;
  try {
    const files = readFileSync(0, 'utf8').split('\n').filter(Boolean);
    selection = selectSpecs(files, {
      ...context,
      sessionSpecs: () => deriveSessionSpecs(join(import.meta.dirname, '..')),
    });
  } catch (error) {
    // Cannot tell what changed: the full suite runs.
    process.stderr.write(`e2e-affected: ${error instanceof Error ? error.message : error}\n`);
    selection = { scope: 'full' };
  }
  process.stdout.write(formatOutputs(selection));
}
