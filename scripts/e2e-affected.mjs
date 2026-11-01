// Node built-ins only, so it runs without an install.
import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

// Spec names are Playwright file filters: regular expressions matched against the test file path.
const spec = (name) => `e2e/${name}.spec.ts`;

// convex-backend needs no page: it checks IS_TEST and the backend URL the bundle was built with.
const HARNESS = 'e2e/harness/';
export const ALWAYS = [spec('smoke'), spec('convex-backend'), HARNESS];

const LEAGUE_ADMIN = [
  'organization-leagues',
  'organization-leagues-publish',
  'organization-leagues-publish-states',
];
const LOCATION_ADMIN = ['organization-admin', 'sign-in-admin'];
const STAFF = ['organization-staff', 'organization-staff-undo', 'accept-invite'];
const ADMIN = [
  ...new Set([
    'organization-admin',
    ...LEAGUE_ADMIN,
    'organization-staff',
    'organization-staff-undo',
    'sign-in-admin',
    'accept-invite',
    'create-organization',
    'organization-details',
    'organization-leagues-custom-level',
    'organization-leagues-division',
    'organization-leagues-mockup',
    'shell-sheet',
    'navigation-focus',
  ]),
];
const PUBLIC_PAGE = [
  'organization-page',
  'organization-filters',
  'organization-admin',
  'organization-leagues-publish',
  'organization-leagues-publish-states',
  'create-organization',
  'offline',
  'offline-note-height',
  'pwa',
  'top-bar',
  'auth-session',
  'public-layout',
  'public-page-layout-shift',
  'navigation-focus',
];

// cache-key samples the sport view's `?page=N` parameter. The league page's breadcrumb links to the sport view.
const SPORT_VIEW = ['sport-view', 'cache-key'];
// cache-key samples the league page's `?page=N` parameter.
const LEAGUE_PAGE = ['league-page', 'league-page-offline', 'public-page-layout-shift', 'cache-key'];
// cache-key samples the season route.
const SEASON_PAGE = ['season-page', 'public-page-layout-shift', 'cache-key'];
// The season page's registration card links to the register route, and the register route opens the team page.
const TEAM_REGISTRATION = ['team-registration'];
// cache-key samples the find page's `?q=` parameter. The public layout's footer links to it.
const FIND_PAGE = ['find-a-league', 'find-organizations', 'cache-key'];
const LEAGUE_MANAGEMENT = [
  'league-management',
  'league-management-details',
  'league-management-publish',
  'league-management-mockup',
];

export const SESSION = '@session';

// The key is the route's full path from `src/app/app.routes.ts`, with each parent's `path` joined by `/`, so a parent's empty child is `app/`.
// A path with `canActivate` lists a spec that exercises the guard.
export const ROUTE_SPECS = {
  '': ['install', 'pwa', 'pwa-kill-switch'],
  leagues: ['find-a-league'],
  'organizations/:orgSlug': [
    'organization-page',
    'organization-page-manage',
    'organization-filters',
  ],
  'organizations/:orgSlug/sports/:sport': ['sport-view'],
  'organizations/:orgSlug/leagues/:leagueSlug': ['league-page', 'league-page-offline'],
  'organizations/:orgSlug/leagues/:leagueSlug/seasons/:seasonSlug': ['season-page'],
  'sign-up': ['sign-up', 'auth-session', 'after-sign-in'],
  'sign-in': ['sign-in', 'auth-session', 'after-sign-in'],
  'invites/accept': ['accept-invite'],
  app: ['auth-session'],
  'app/': ['after-sign-in', 'auth-session', 'app-leagues'],
  'app/account': ['account-settings', 'after-sign-in'],
  'app/organizations/new': ['create-organization', 'after-sign-in'],
  'app/organizations/:orgSlug/leagues/:leagueSlug': [
    'league-management',
    'league-management-details',
    'league-management-publish',
    'league-management-mockup',
    'after-sign-in',
  ],
  'app/organizations/:slug': ['organization-admin', 'after-sign-in'],
  'app/organizations/:slug/': ['organization-admin', 'organization-details'],
  'app/organizations/:slug/locations': ['organization-admin'],
  'app/organizations/:slug/leagues': ['organization-leagues'],
  'app/organizations/:slug/staff': ['organization-staff'],
  'app/organizations/:slug/details': ['organization-details'],
  'app/register/:orgSlug/:leagueSlug/:seasonSlug/team': TEAM_REGISTRATION,
  'app/teams/:teamId': [...TEAM_REGISTRATION, 'after-sign-in'],
  'app/**': ['not-found'],
  '**': ['not-found'],
};

const ROUTE_TABLE_SPECS = [
  ...new Set([...Object.values(ROUTE_SPECS).flat(), 'navigation-focus', 'not-found']),
];
const RAW_HTTP_SUPPORT = [
  'e2e/support/raw-html.ts',
  'e2e/support/raw-get.ts',
  'e2e/support/raw-http.ts',
];

/**
 * @param {string} root
 * @returns {Set<string>}
 */
function sessionHelpers(root) {
  const dir = join(root, 'e2e', 'support');
  /** @type {Map<string, string[]>} */
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
const SUPPORT_SIBLING_IMPORT = /from '\.\/([\w-]+)'/g;
const SPEC_SUPPORT_IMPORT = /from '\.{1,2}\/support\/([\w-]+)'/g;

/**
 * @param {string} root
 * @returns {string[]}
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
const CUSTOM_LEVELS_API = /\bapi\.customLevels\b/;

// Every `search:` function is public too.
export const PUBLIC_QUERIES = [
  'organizations:getPublicPage',
  'organizations:listPublicLocations',
  'organizations:listPublicLeagues',
  'organizations:listPublicLeagueFacets',
  'leagues:getPublicPage',
  'seasons:listPublic',
  'seasons:getPublicPage',
  'seasons:listOpenForOrganization',
];
const PUBLIC_PATH_LITERAL = /[`'"]\/organizations\//;
const SEED_TENANT_PATH = /\.path\b|\{[^}]*\bpath\b[^}]*\}\s*=\s*(?:await\s+)?seedTenant\b/;
const SEARCH_QUERY = /[`'"]search:\w/;

/**
 * @param {string} text
 * @returns {boolean}
 */
export function readsPublicPage(text) {
  return (
    PUBLIC_PATH_LITERAL.test(text) ||
    (text.includes('seedTenant') && SEED_TENANT_PATH.test(text)) ||
    PUBLIC_QUERIES.some((name) => text.includes(name)) ||
    SEARCH_QUERY.test(text)
  );
}

/**
 * @param {string} root
 * @returns {string[]}
 */
export function findPublicPageSpecs(root) {
  const found = [];
  for (const dir of ['e2e', 'e2e/harness']) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.spec.ts')) continue;
      if (readsPublicPage(readFileSync(join(root, dir, entry.name), 'utf8'))) {
        found.push(`${dir}/${entry.name}`);
      }
    }
  }
  return found.sort();
}

const APP_ORGANIZATIONS_PATH = '/app/organizations/';
const LEAGUE_PATH_SEGMENT = /\/leagues\/[A-Za-z$]/;

/**
 * A spec can reach the league management page through a path built from variables or through a link, so the finder takes every spec
 * with both strings. A few extra specs are better than a missed one.
 * @param {string} root
 * @returns {string[]}
 */
export function findLeagueManagementPageSpecs(root) {
  const found = [];
  for (const dir of ['e2e', 'e2e/harness']) {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.spec.ts')) continue;
      const text = readFileSync(join(root, dir, entry.name), 'utf8');
      if (text.includes(APP_ORGANIZATIONS_PATH) && LEAGUE_PATH_SEGMENT.test(text)) {
        found.push(`${dir}/${entry.name}`);
      }
    }
  }
  return found.sort();
}

const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  'out-tsc',
  'coverage',
  'tmp',
  'test-results',
  'playwright-report',
  'blob-report',
]);
const CODE_FILE = /\.(?:ts|mts|mjs)$/;
// Unit tests, their doubles and setup, and the generated types never carry a page's behaviour.
const NON_IMPORTER = [
  /^(?:src|convex)\/.+\.(?:spec|test)\.ts$/,
  /^scripts\/[^/]+\.test\.mjs$/,
  /(?:^|\/)testing\//,
  /^convex\/test\.setup\.ts$/,
  /^convex\/_generated\//,
];
const isNonImporter = (file) => NON_IMPORTER.some((pattern) => pattern.test(file));
// A route table only wires a path to its page. Counting it as an importer would give every file it imports the route table's specs.
const ROUTE_TABLES = new Set(['src/app/app.routes.ts', 'src/app/app.routes.server.ts']);
// `import type`, `export … from`, `export * from`, and multi-line named imports all end in `from '…'`.
const FROM_SPECIFIER = /\bfrom\s*(['"])([^'"\n]+)\1/g;
const SIDE_EFFECT_IMPORT = /\bimport\s*(['"])([^'"\n]+)\1/g;
// Also matches `typeof import('…')`. The literal ends at its closing quote or at a `${`.
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(['"`])([^\n]*?)(\1|\$\{)/g;

/**
 * @typedef {{
 *   files: Set<string>,
 *   text: Map<string, string>,
 *   importers: Map<string, Set<string>>,
 *   dynamicTargets: Set<string>,
 *   unresolved: string[],
 * }} ImportGraph
 */

/**
 * @param {string} root
 * @param {string} dir
 * @param {Set<string>} into
 */
function listFiles(root, dir, into) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue;
    const path = dir === '' ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) listFiles(root, path, into);
    else into.add(path);
  }
}

/**
 * @param {Set<string>} files
 * @param {string} from
 * @param {string} specifier
 * @returns {string | undefined}
 */
function resolveSpecifier(files, from, specifier) {
  const path = specifier.replace(/[?#].*$/, '');
  const base = posix.normalize(posix.join(posix.dirname(from), path));
  const candidates = [base];
  for (const extension of ['.ts', '.mts', '.d.ts', '.js', '.mjs'])
    candidates.push(base + extension);
  for (const index of ['index.ts', 'index.mts', 'index.js']) candidates.push(`${base}/${index}`);
  // A `.js` or `.mjs` specifier may name the `.ts` or `.mts` file, as `convex/_generated/api.d.ts` writes them.
  const stem = base.replace(/\.m?js$/, '');
  if (stem !== base) candidates.push(`${stem}.ts`, `${stem}.mts`);
  return candidates.find((candidate) => files.has(candidate));
}

/**
 * @param {string} root
 * @returns {ImportGraph}
 */
export function buildImportGraph(root) {
  const files = new Set();
  listFiles(root, '', files);
  /** @type {ImportGraph} */
  const graph = {
    files,
    text: new Map(),
    importers: new Map(),
    dynamicTargets: new Set(),
    unresolved: [],
  };
  for (const file of files) {
    if (!CODE_FILE.test(file) || isNonImporter(file)) continue;
    const text = readFileSync(join(root, file), 'utf8');
    graph.text.set(file, text);
    const edge = (specifier, dynamic) => {
      if (!specifier.startsWith('.')) return;
      const target = resolveSpecifier(files, file, specifier);
      if (target === undefined) {
        graph.unresolved.push(`${file} imports '${specifier}', which resolves to no file`);
        return;
      }
      if (dynamic) graph.dynamicTargets.add(target);
      if (target === file || ROUTE_TABLES.has(file)) return;
      const set = graph.importers.get(target) ?? new Set();
      set.add(file);
      graph.importers.set(target, set);
    };
    for (const pattern of [FROM_SPECIFIER, SIDE_EFFECT_IMPORT]) {
      for (const match of text.matchAll(pattern)) edge(match[2], false);
    }
    for (const match of text.matchAll(DYNAMIC_IMPORT)) {
      if (match[3] === '${' && match[2].startsWith('.')) {
        graph.unresolved.push(`${file} imports a computed path starting '${match[2]}'`);
      } else {
        edge(match[2], true);
      }
    }
  }
  return graph;
}

/**
 * @typedef {{
 *   name: string,
 *   test: (file: string) => boolean,
 *   specs: string[],
 *   full?: boolean,
 *   directOnly?: boolean,
 *   widen?: boolean,
 *   derive?: (graph: ImportGraph, root: string) => { extraSpecs?: string[], filesToSelect?: string[] },
 * }} Rule
 */

/**
 * @param {ImportGraph} graph
 * @param {string[]} targets
 * @returns {string[]} the e2e specs that import a target, directly or through other files
 */
function specsImporting(graph, targets) {
  const seen = new Set(targets);
  const queue = [...targets];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    for (const importer of graph.importers.get(next) ?? []) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      queue.push(importer);
    }
  }
  return [...seen].filter((file) => /^e2e\/(?:harness\/)?[\w-]+\.spec\.ts$/.test(file)).sort();
}

// The sport route renders the organization page with the organization queries.
export const OFFLINE_QUERY_GROUP_SPECS = {
  ORGANIZATION_PAGE_QUERIES: ['organization-page', 'sport-view', 'organization-filters'],
  LEAGUE_PAGE_QUERIES: ['league-page'],
  SEASON_PAGE_QUERIES: ['season-page'],
  FIND_PAGE_QUERIES: ['find-a-league', 'find-organizations'],
};

const inDir =
  (...dirs) =>
  (file) =>
    dirs.some((dir) => file.startsWith(dir));
const named = (dir, names) => (file) => names.some((name) => file === `${dir}${name}.ts`);
const matching = (pattern) => (file) => pattern.test(file);

/** @type {Rule[]} */
export const AREAS = [
  // Rules with no specs cannot change an e2e result.
  { name: 'unit specs', test: matching(/^(?:src|convex)\/.+\.(?:spec|test)\.ts$/), specs: [] },
  { name: 'convex test setup', test: (file) => file === 'convex/test.setup.ts', specs: [] },
  { name: 'script tests', test: matching(/^scripts\/[^/]+\.test\.mjs$/), specs: [] },
  { name: 'unit test doubles', test: matching(/^src\/app\/.*\/testing\/[^/]+\.ts$/), specs: [] },
  {
    // No build input is Markdown, so a `README.md` beside the source changes no page.
    name: 'markdown outside public and e2e',
    test: (file) => /\.md$/.test(file) && !inDir('public/', 'e2e/')(file),
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
        '.github/workflows/staging-rebuild.yml',
      ].includes(file),
    specs: [],
  },

  {
    // They run the e2e command, not the app, so smoke and the harness are enough.
    name: 'e2e run tooling',
    test: (file) =>
      [
        'scripts/e2e-lock.mjs',
        'scripts/e2e-affected.mjs',
        'scripts/e2e-affected-local.mjs',
      ].includes(file),
    specs: [],
  },
  {
    // They set CONVEX_URL, IS_TEST, SITE_URL, and BETTER_AUTH_SECRET for every spec.
    name: 'e2e backend and build setup',
    test: (file) => ['scripts/e2e.mjs', 'scripts/e2e-convex.mjs'].includes(file),
    specs: [],
    full: true,
  },
  {
    // The type files only describe the modules; `typecheck` covers them.
    name: 'generated Convex types',
    test: matching(/^convex\/_generated\/(?:api|dataModel|server)\.d\.ts$/),
    specs: [],
  },
  { name: 'generated Convex code', test: inDir('convex/_generated/'), specs: [], full: true },

  // The design files an e2e spec opens; every other file under design/ is read by no spec.
  {
    name: 'leagues mockup',
    test: (file) => file === 'design/mockups/66-69-organization-leagues.html',
    specs: ['organization-leagues-mockup'],
  },
  {
    name: 'seasons mockup',
    test: (file) => file === 'design/mockups/125-126-seasons.html',
    specs: ['league-management-mockup'],
  },
  {
    name: 'app leagues mockup',
    test: (file) => file === 'design/mockups/141-app-leagues.html',
    specs: ['app-leagues'],
  },
  {
    // chip-classes.spec.ts takes the kit CSS from this mockup's inlined block.
    name: 'chip mockup',
    test: (file) => file === 'design/mockups/300-public-site-league-form.html',
    specs: ['chip-classes'],
  },
  { name: 'chip classes', test: inDir('src/app/ui/chip/'), specs: ['chip-classes'] },
  // The filter popovers of the organization page and its sport views are the only popovers.
  {
    name: 'helm popover',
    test: inDir('src/app/ui/popover/'),
    specs: ['organization-filters', 'sport-view'],
  },
  { name: 'design files', test: inDir('design/'), specs: [] },

  // The harness probes run inside console-fixture.spec.ts.
  {
    name: 'harness probes',
    test: inDir('e2e/harness/probes/'),
    specs: [],
  },
  { name: 'e2e spec', test: matching(/^e2e\/(?:harness\/)?[\w-]+\.spec\.ts$/), specs: ['self'] },

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
    // validate-on-blur fills in the location form and leaves its fields.
    specs: [...LOCATION_ADMIN, 'validate-on-blur'],
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
    specs: [
      ...LEAGUE_ADMIN,
      'organization-leagues-custom-level',
      'organization-leagues-division',
      'organization-leagues-mockup',
      'validate-on-blur',
    ],
  },
  {
    name: 'sticky form footer',
    test: named('src/app/organizations/admin/', ['sticky-footer', 'sticky-footer-focus']),
    specs: [
      ...LEAGUE_ADMIN,
      'organization-leagues-mockup',
      ...LEAGUE_MANAGEMENT,
      'organization-details',
    ],
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
    specs: [...STAFF, 'validate-on-blur'],
  },
  { name: 'admin area', test: inDir('src/app/organizations/admin/'), specs: ADMIN },
  {
    name: 'create organization',
    test: named('src/app/organizations/', ['create-organization-page']),
    specs: ['create-organization', 'navigation-focus'],
  },
  {
    name: 'public organization page',
    test: named('src/app/organizations/', [
      'organization-page',
      'organization-overview',
      'organization-mark',
      'organization-skeleton',
      'organization-path',
      'division-filters',
      'filter-draft',
      'league-filters',
      'league-filter-overlays',
      'sport-list',
      'sport-chips',
      'initials',
    ]),
    specs: [...PUBLIC_PAGE, ...ADMIN, ...LEAGUE_PAGE, ...SEASON_PAGE, ...SPORT_VIEW],
  },
  {
    // The season page builds its links from the league page's paths, and the league page's rows link
    // to it.
    name: 'public league page',
    test: inDir('src/app/organizations/public-league/'),
    specs: [...LEAGUE_PAGE, ...SEASON_PAGE, ...SPORT_VIEW],
  },
  {
    name: 'public season page',
    test: inDir('src/app/organizations/public-season/'),
    specs: [...SEASON_PAGE, ...TEAM_REGISTRATION],
  },
  {
    // The season page imports the register route's path from here.
    name: 'team pages',
    test: inDir('src/app/teams/'),
    specs: [...TEAM_REGISTRATION, 'season-page'],
  },
  {
    name: 'helm input and field',
    test: inDir('src/app/ui/input/', 'src/app/ui/field/'),
    specs: TEAM_REGISTRATION,
  },
  {
    name: 'find a league page',
    test: inDir('src/app/find/'),
    specs: FIND_PAGE,
  },
  {
    name: 'numbered page control',
    test: named('src/app/organizations/', ['page-control']),
    specs: [...LEAGUE_PAGE, ...SPORT_VIEW, ...FIND_PAGE, 'page-control-widths'],
  },
  {
    name: 'list page helper',
    test: named('src/app/core/', ['list-page']),
    specs: [...LEAGUE_PAGE, ...SPORT_VIEW, ...FIND_PAGE, 'page-control-widths'],
  },
  {
    // Every form shares this field-error rule: sign-up, sign-in, create organization, the
    // admin forms (locations, leagues, staff invites), and the create-season form.
    name: 'form helper',
    test: named('src/app/core/forms/', ['shown-errors']),
    specs: [SESSION, ...ADMIN, ...LEAGUE_MANAGEMENT],
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
    // The account link shows on every public page for a signed-in visitor, and the specs that sign a user in read it.
    name: 'account link',
    test: named('src/app/shell/', ['account-link']),
    specs: [SESSION],
  },
  {
    // The shell wraps every signed-in page, so the specs that sign a user in run with it.
    name: 'app shell',
    test: named('src/app/shell/', [
      'shell',
      'shell-sidebar',
      'account-row',
      'home-sidebar',
      'sidebar-classes',
      'url-path',
    ]),
    specs: ['app-shell', 'shell-sheet', SESSION],
  },
  {
    // Any file the sheet imports, directly or not, keeps the full suite.
    name: 'app shell sheet',
    test: named('src/app/shell/', ['shell-sheet']),
    specs: ['app-shell', 'shell-sheet', SESSION],
    directOnly: true,
  },
  {
    name: 'not-found view',
    test: inDir('src/app/not-found/'),
    // league-page.spec.ts and season-page.spec.ts assert the league and season pages' 404.
    specs: ['not-found', 'organization-page', 'sport-view', 'league-page', 'season-page', ...ADMIN],
  },
  {
    name: 'offline views',
    test: inDir('src/app/offline/'),
    specs: [
      'offline',
      'offline-note-height',
      'pwa',
      ...PUBLIC_PAGE,
      'league-page',
      'league-page-offline',
      'season-page',
    ],
  },
  {
    name: 'public layout',
    test: inDir('src/app/public-layout/'),
    specs: [
      'public-layout',
      'find-a-league',
      ...PUBLIC_PAGE,
      ...LEAGUE_PAGE,
      ...SEASON_PAGE,
      ...SPORT_VIEW,
      'accept-invite',
      'install',
      'not-found',
      'offline-note-height',
      'pwa',
      'pwa-kill-switch',
      'smoke',
      SESSION,
    ],
  },
  {
    // The route table decides which page opens at each path, and the guards decide who may open it. app.config.ts imports it and runs
    // the full suite, so it takes no importer specs.
    name: 'route table',
    test: (file) => file === 'src/app/app.routes.ts',
    specs: ROUTE_TABLE_SPECS,
    widen: false,
  },
  {
    // The render mode and headers of each path. cache-key samples the `?page=N` and `?q=` cache keys, and the raw HTTP specs read
    // what the server sends. app.config.server.ts imports it and runs the full suite, so it takes no importer specs.
    name: 'server route table',
    test: (file) => file === 'src/app/app.routes.server.ts',
    specs: [...ROUTE_TABLE_SPECS, 'cache-key'],
    derive: (graph) => ({ extraSpecs: specsImporting(graph, RAW_HTTP_SUPPORT) }),
    widen: false,
  },
  {
    // Only the route table imports the guards, and its redirects reach every signed-in and sign-in path.
    name: 'route guards',
    test: (file) => file === 'src/app/core/auth/guards.ts',
    specs: [],
    full: true,
  },
  {
    // The saved copies run these queries on the pages of each group, and offline serves the copies. saved-copies.ts imports the list
    // and runs the full suite, so the list takes no importer specs.
    name: 'offline saved queries',
    test: named('src/app/core/data/convex/', ['offline-saved-queries']),
    specs: [
      'offline',
      'offline-note-height',
      'league-page-offline',
      'pwa',
      'cache-key',
      ...Object.values(OFFLINE_QUERY_GROUP_SPECS).flat(),
    ],
    widen: false,
  },
  {
    // The league management page opens at `/app/organizations/<slug>/leagues/<league>`.
    name: 'league management page',
    test: inDir('src/app/organizations/league/'),
    specs: [],
    derive: (_graph, root) => ({ extraSpecs: findLeagueManagementPageSpecs(root) }),
  },
  {
    name: 'placeholder home',
    test: inDir('src/app/placeholder/'),
    specs: ['install', 'pwa', 'pwa-kill-switch', 'pwa-update', SESSION],
  },

  {
    // Specs read what these helpers return through the public pages and queries, so the specs
    // found in the repo run with the page groups.
    name: 'convex public read helpers',
    test: named('convex/lib/', ['publicPage', 'publicLeague', 'publicSeason', 'publicList']),
    specs: [...PUBLIC_PAGE, ...LEAGUE_PAGE, ...SEASON_PAGE, ...SPORT_VIEW, ...FIND_PAGE],
    derive: (_graph, root) => ({ extraSpecs: findPublicPageSpecs(root) }),
  },
  {
    // The create-league form lists the levels through api.customLevels, so every file that
    // references it brings its own specs.
    name: 'convex custom levels',
    test: named('convex/', ['customLevels']),
    specs: [
      'organization-leagues-custom-level',
      'organization-leagues-division',
      ...LEAGUE_MANAGEMENT,
    ],
    derive: (graph) => ({
      filesToSelect: [...graph.text]
        .filter(([file, text]) => file.startsWith('src/') && CUSTOM_LEVELS_API.test(text))
        .map(([file]) => file),
    }),
  },
  {
    name: 'convex organizations',
    test: named('convex/', ['organizations']),
    specs: [...PUBLIC_PAGE, ...ADMIN, ...LEAGUE_PAGE, ...SEASON_PAGE, ...SPORT_VIEW, SESSION],
  },
  {
    name: 'convex locations',
    test: named('convex/', ['locations']),
    specs: [...ADMIN, ...LOCATION_ADMIN, ...PUBLIC_PAGE, ...SPORT_VIEW],
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
    name: 'convex search',
    test: (file) =>
      named('convex/', ['search'])(file) || named('convex/lib/', ['searchQuery'])(file),
    specs: FIND_PAGE,
  },
  {
    name: 'convex seasons',
    test: named('convex/', ['seasons']),
    specs: [...LEAGUE_PAGE, ...SEASON_PAGE, ...LEAGUE_MANAGEMENT, ...TEAM_REGISTRATION],
  },
  { name: 'convex invites', test: named('convex/', ['invites']), specs: [...ADMIN, ...STAFF] },
  {
    name: 'convex memberships',
    test: named('convex/', ['memberships']),
    specs: ADMIN,
  },
  { name: 'convex users', test: named('convex/', ['users']), specs: [SESSION] },
  {
    name: 'convex teams and roster writes',
    test: (file) =>
      named('convex/', ['teams'])(file) ||
      named('convex/lib/', ['rosterWrites', 'rosterEntry', 'teamInput'])(file),
    specs: [...TEAM_REGISTRATION, 'season-page'],
  },
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

function filtersFor(rule, file, sessionSpecs) {
  return rule.specs.flatMap((name) => {
    if (name === 'self') return [file];
    if (name === SESSION) return sessionSpecs;
    return [spec(name)];
  });
}

class FullSuite extends Error {}

/**
 * @typedef {{
 *   root?: string,
 *   sessionSpecs?: string[] | (() => string[]),
 *   warn?: (reason: string) => void,
 * }} SelectContext
 */

/**
 * @param {string} file
 * @param {Set<string>} selected
 * @param {SelectContext & { graph: () => ImportGraph, widened: Set<string> }} context
 * @param {Set<string>} visiting
 */
function addFileSpecs(file, selected, context, visiting) {
  const rule = AREAS.find((area) => area.test(file));
  if (rule) {
    addRuleSpecs(rule, file, selected, context, visiting);
    return;
  }
  const graph = context.graph();
  if (graph.unresolved.length > 0) throw new FullSuite(graph.unresolved.join('; '));
  if (traceImporters(file, graph, selected, context, visiting, new Set()) === 0) {
    throw new FullSuite(`${file} has no rule, and its importers form a cycle that no rule reaches`);
  }
}

/**
 * @param {Rule} rule
 * @param {string} file
 * @param {Set<string>} selected
 * @param {SelectContext & { graph: () => ImportGraph, widened: Set<string> }} context
 * @param {Set<string>} visiting
 */
function addRuleSpecs(rule, file, selected, context, visiting) {
  if (rule.full) throw new FullSuite(`${file} is covered by the full-suite rule "${rule.name}"`);
  let session = [];
  if (rule.specs.includes(SESSION)) {
    const { sessionSpecs } = context;
    session = (typeof sessionSpecs === 'function' ? sessionSpecs() : sessionSpecs) ?? [];
    if (session.length === 0) throw new FullSuite('the session specs are not known');
  }
  for (const filter of filtersFor(rule, file, session)) selected.add(filter);
  if (rule.derive) {
    if (context.root === undefined)
      throw new FullSuite(`${file} needs the repo root to derive specs`);
    const derived = rule.derive(context.graph(), context.root);
    for (const filter of derived.extraSpecs ?? []) selected.add(filter);
    for (const derivedFile of derived.filesToSelect ?? []) {
      if (visiting.has(derivedFile)) continue;
      visiting.add(derivedFile);
      addFileSpecs(derivedFile, selected, context, visiting);
    }
  }
  if (widensToImporters(rule, file)) {
    widenToImporters(file, rule, selected, context, visiting);
  }
}

// An app file's specs are not enough when another area imports it: the other area's pages show what the file renders.
const widensToImporters = (rule, file) =>
  file.startsWith('src/app/') &&
  rule.widen !== false &&
  (rule.specs.length > 0 || rule.derive !== undefined);

/**
 * Adds the specs of each importer outside the rule's own match, and follows importers inside it to theirs.
 * @param {string} file
 * @param {Rule} rule
 * @param {Set<string>} selected
 * @param {SelectContext & { graph: () => ImportGraph, widened: Set<string> }} context
 * @param {Set<string>} visiting
 */
function widenToImporters(file, rule, selected, context, visiting) {
  if (context.widened.has(file)) return;
  context.widened.add(file);
  const graph = context.graph();
  if (graph.unresolved.length > 0) throw new FullSuite(graph.unresolved.join('; '));
  for (const importer of graph.importers.get(file) ?? []) {
    const importerRule = AREAS.find((area) => area.test(importer));
    if (importerRule?.directOnly) {
      throw new FullSuite(`${file} is reached through ${importer}, which a dynamic import() loads`);
    }
    if (importerRule === rule) {
      widenToImporters(importer, rule, selected, context, visiting);
    } else if (importerRule) {
      addRuleSpecs(importerRule, importer, selected, context, visiting);
    } else if (traceImporters(importer, graph, selected, context, visiting, new Set()) === 0) {
      throw new FullSuite(
        `${importer} has no rule, and its importers form a cycle that no rule reaches`,
      );
    }
  }
}

const CONVEX_MODULE = /^convex\/[^/]+\.ts$/;

/**
 * @param {string} file a file no rule names
 * @param {ImportGraph} graph
 * @param {Set<string>} selected
 * @param {SelectContext & { graph: () => ImportGraph, widened: Set<string> }} context
 * @param {Set<string>} visiting
 * @param {Set<string>} seen
 * @returns {number}
 */
function traceImporters(file, graph, selected, context, visiting, seen) {
  if (seen.has(file)) return 0;
  seen.add(file);
  if (!CODE_FILE.test(file)) throw new FullSuite(`${file} has no rule and is not a code file`);
  if (!graph.files.has(file)) throw new FullSuite(`${file} has no rule and is not on disk`);
  // Convex loads these by file name, so no importer shows what uses them.
  if (CONVEX_MODULE.test(file)) throw new FullSuite(`${file} is a Convex module with no rule`);
  if (graph.dynamicTargets.has(file)) {
    throw new FullSuite(`${file} has no rule and is loaded with a dynamic import()`);
  }
  const importers = graph.importers.get(file);
  if (importers === undefined || importers.size === 0) {
    throw new FullSuite(`${file} has no rule and no file imports it`);
  }
  let reached = 0;
  for (const importer of importers) {
    const rule = AREAS.find((area) => area.test(importer));
    if (rule?.directOnly) {
      throw new FullSuite(`${file} is reached through ${importer}, which a dynamic import() loads`);
    }
    if (rule) {
      addRuleSpecs(rule, importer, selected, context, visiting);
      reached += 1;
    } else {
      reached += traceImporters(importer, graph, selected, context, visiting, seen);
    }
  }
  return reached;
}

/**
 * @param {string[] | undefined} files
 * @param {{ event?: string, base?: string } & SelectContext} [context]
 * @returns {{ scope: 'full' } | { scope: 'affected', specs: string[] }}
 */
export function selectSpecs(files, { event, base, root, sessionSpecs, warn } = {}) {
  const full = { scope: /** @type {const} */ ('full') };
  if (event !== 'pull_request' || base === 'production') return full;
  if (!Array.isArray(files) || files.length === 0) return full;
  /** @type {ImportGraph | undefined} */
  let graph;
  const context = {
    root,
    sessionSpecs,
    widened: new Set(),
    graph: () => {
      if (root === undefined) throw new FullSuite('no repo root to read the import graph from');
      try {
        graph ??= buildImportGraph(root);
      } catch (error) {
        throw new FullSuite(
          `the import graph cannot be read: ${error instanceof Error ? error.message : error}`,
        );
      }
      return graph;
    },
  };
  const selected = new Set(ALWAYS);
  for (const file of files) {
    if (typeof file !== 'string' || !isPlainPath(file)) return full;
    try {
      addFileSpecs(file, selected, context, new Set([file]));
    } catch (error) {
      if (!(error instanceof FullSuite)) throw error;
      (warn ?? defaultWarn)(error.message);
      return full;
    }
  }
  return { scope: 'affected', specs: [...selected].sort() };
}

const defaultWarn = (reason) => process.stderr.write(`e2e-affected: full suite: ${reason}\n`);

const MOCKUPS_WORD = /\bmockups\b/;
const SPEC_FILE = /\.spec\.ts$/;
const specName = (relative) => relative.replace(SPEC_FILE, '');
const unmappedRead = (spec, mockup) => `${spec}: ${mockup}`;

/**
 * @param {string} root
 * @param {string} mockup
 * @returns {string[]} the Playwright filters a change to the mockup selects, apart from the harness directory every run includes
 */
function ruleFilters(root, mockup) {
  const selection = selectSpecs([`design/mockups/${mockup}`], {
    event: 'pull_request',
    base: 'main',
    root,
    warn: () => {},
  });
  if (selection.scope !== 'affected') return [];
  return selection.specs.filter((filter) => filter !== HARNESS);
}

/**
 * A spec opens a mockup by path, which the import graph cannot see, so a mockup edit selects that spec only through a rule.
 * @param {string} root
 * @returns {string[]}
 */
export function findUnmappedMockupReads(root) {
  const mockups = readdirSync(join(root, 'design', 'mockups'));
  const files = new Set();
  listFiles(root, 'e2e', files);
  const problems = [];
  for (const file of [...files].sort()) {
    const text = readFileSync(join(root, file), 'utf8');
    const relative = file.slice('e2e/'.length);
    const named = mockups.filter((mockup) => text.includes(mockup));
    if (!SPEC_FILE.test(file)) {
      if (named.length > 0 || MOCKUPS_WORD.test(text)) problems.push(relative);
      continue;
    }
    if (named.length === 0) {
      if (MOCKUPS_WORD.test(text)) problems.push(specName(relative));
      continue;
    }
    for (const mockup of named) {
      const covered = ruleFilters(root, mockup).some((filter) => new RegExp(filter).test(file));
      if (!covered) problems.push(unmappedRead(specName(relative), mockup));
    }
  }
  return problems.sort();
}

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
    const root = join(import.meta.dirname, '..');
    selection = selectSpecs(files, {
      ...context,
      root,
      sessionSpecs: () => deriveSessionSpecs(root),
    });
  } catch (error) {
    process.stderr.write(`e2e-affected: ${error instanceof Error ? error.message : error}\n`);
    selection = { scope: 'full' };
  }
  process.stdout.write(formatOutputs(selection));
}
