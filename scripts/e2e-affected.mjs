// Node built-ins only: the `e2e specs` step runs before setup-node, on the Node the runner image ships.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Spec names are Playwright file filters: regular expressions matched against the test file path.
const spec = (name) => `e2e/${name}.spec.ts`;

export const ALWAYS = [spec('smoke'), 'e2e/harness/'];

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
    'organization-leagues-mockup',
    'shell-sheet',
    'navigation-focus',
  ]),
];
const PUBLIC_PAGE = [
  'organization-page',
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
  'navigation-focus',
];

// cache-key samples the league page's `?page=N` parameter.
const LEAGUE_PAGE = ['league-page', 'league-page-offline', 'cache-key'];
// cache-key samples the season route.
const SEASON_PAGE = ['season-page', 'cache-key'];
const LEAGUE_MANAGEMENT = [
  'league-management',
  'league-management-publish',
  'league-management-mockup',
];

export const SESSION = '@session';

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

/** @typedef {{ name: string, test: (file: string) => boolean, specs: string[] }} Rule */

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
        '.github/workflows/staging-rebuild.yml',
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
    specs: [...LEAGUE_ADMIN, 'organization-leagues-mockup', 'validate-on-blur'],
  },
  {
    name: 'sticky form footer',
    test: named('src/app/organizations/admin/', ['sticky-footer']),
    specs: [...LEAGUE_ADMIN, 'organization-leagues-mockup', ...LEAGUE_MANAGEMENT],
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
      'sport-list',
      'initials',
    ]),
    specs: [...PUBLIC_PAGE, ...ADMIN, ...LEAGUE_PAGE, ...SEASON_PAGE],
  },
  {
    // The season page builds its links from the league page's paths, and the league page's rows link
    // to it.
    name: 'public league page',
    test: inDir('src/app/organizations/public-league/'),
    specs: [...LEAGUE_PAGE, ...SEASON_PAGE],
  },
  {
    name: 'public season page',
    test: inDir('src/app/organizations/public-season/'),
    specs: SEASON_PAGE,
  },
  {
    name: 'numbered page control',
    test: named('src/app/organizations/', ['page-control']),
    specs: LEAGUE_PAGE,
  },
  {
    name: 'list page helper',
    test: named('src/app/core/', ['list-page']),
    specs: LEAGUE_PAGE,
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
    // The account link shows on every page of a signed-in visitor, and the specs that sign a user in read it.
    name: 'account link',
    test: named('src/app/shell/', ['account-link']),
    specs: [SESSION],
  },
  {
    name: 'not-found view',
    test: inDir('src/app/not-found/'),
    // league-page.spec.ts and season-page.spec.ts assert the league and season pages' 404.
    specs: ['not-found', 'organization-page', 'league-page', 'season-page', ...ADMIN],
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
      ...PUBLIC_PAGE,
      ...LEAGUE_PAGE,
      ...SEASON_PAGE,
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
    name: 'placeholder home',
    test: inDir('src/app/placeholder/'),
    specs: ['install', 'pwa', 'pwa-kill-switch', SESSION],
  },

  {
    name: 'convex organizations',
    test: named('convex/', ['organizations']),
    specs: [...PUBLIC_PAGE, ...ADMIN, ...LEAGUE_PAGE, ...SEASON_PAGE, SESSION],
  },
  {
    name: 'convex locations',
    test: named('convex/', ['locations']),
    specs: [...ADMIN, ...LOCATION_ADMIN, ...PUBLIC_PAGE],
  },
  {
    name: 'convex leagues',
    test: named('convex/', ['leagues']),
    specs: [...ADMIN, ...LEAGUE_ADMIN, ...PUBLIC_PAGE, ...LEAGUE_PAGE, ...LEAGUE_MANAGEMENT],
  },
  {
    name: 'convex seasons',
    test: named('convex/', ['seasons']),
    specs: [...LEAGUE_PAGE, ...SEASON_PAGE, ...LEAGUE_MANAGEMENT],
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

function filtersFor(rule, file, sessionSpecs) {
  return rule.specs.flatMap((name) => {
    if (name === 'self') return [file];
    if (name === SESSION) return sessionSpecs;
    return [spec(name)];
  });
}

/**
 * @param {string[] | undefined} files
 * @param {{ event?: string, base?: string, sessionSpecs?: string[] | (() => string[]) }} [context]
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
    let session = [];
    if (rule.specs.includes(SESSION)) {
      session = (typeof sessionSpecs === 'function' ? sessionSpecs() : sessionSpecs) ?? [];
      if (session.length === 0) return full;
    }
    for (const filter of filtersFor(rule, file, session)) selected.add(filter);
  }
  return { scope: 'affected', specs: [...selected].sort() };
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
    selection = selectSpecs(files, {
      ...context,
      sessionSpecs: () => deriveSessionSpecs(join(import.meta.dirname, '..')),
    });
  } catch (error) {
    process.stderr.write(`e2e-affected: ${error instanceof Error ? error.message : error}\n`);
    selection = { scope: 'full' };
  }
  process.stdout.write(formatOutputs(selection));
}
