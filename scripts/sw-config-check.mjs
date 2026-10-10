// Service worker config check (#81, ADR 0013 section 1). Node built-ins only.
// The enforced form of "the worker never caches Convex, auth, or signed-in data": the built
// `ngsw.json` may hold only same-origin build files, no data groups, the client shell as its index,
// and the `performance` navigation strategy. Every content-hashed chunk, lazy ones too, must be in
// a prefetch group, so lazily loaded features work offline. `scripts/ng-convex.mjs build` runs it after the
// edge-safety check, so a failing build is never published. Run alone with
// `node scripts/sw-config-check.mjs` after a build.
//
// With no `serviceWorker` option in angular.json and no ngsw.json (the kill switch, ADR 0013
// section 4), it prints `sw-config-check: SKIP` and passes.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PREFIX = 'sw-config-check:';
const INDEX = '/index.csr.html';
const STRATEGY = 'performance';
/** Substrings no cached URL may contain (compared in lower case). */
const FORBIDDEN = ['/api/', 'convex.cloud', 'convex.site'];

/**
 * True when angular.json sets the `serviceWorker` build option, in the build options or in any
 * build configuration, for any project.
 *
 * @param {any} angularJson
 * @returns {boolean}
 */
export function serviceWorkerOptionSet(angularJson) {
  return Object.values(angularJson?.projects ?? {}).some((project) => {
    const build = project?.architect?.build;
    const sets = (options) => !!options?.serviceWorker;
    return sets(build?.options) || Object.values(build?.configurations ?? {}).some(sets);
  });
}

/**
 * Content-hashed build files at the root of browser/ that the worker must prefetch: lazily loaded
 * chunks too, so a feature that imports one (the phone sheet) works offline before its first use
 * online (PR #107 testing). A development build's unhashed `main.js` does not match.
 */
const PREFETCHED_BUILD_FILE = /^(?:(?:main|chunk|polyfills)-[^/]+\.js|styles-[^/]+\.css)$/;

/**
 * The problems for content-hashed build files in `browserFiles` (names at the root of browser/)
 * that no `prefetch` asset group of `manifest` lists, one string per file.
 *
 * @param {any} manifest
 * @param {string[]} browserFiles
 * @returns {string[]}
 */
export function unprefetchedBuildFiles(manifest, browserFiles) {
  const prefetched = new Set(
    (manifest?.assetGroups ?? [])
      .filter((group) => group?.installMode === 'prefetch')
      .flatMap((group) => group?.urls ?? []),
  );
  return browserFiles
    .filter((name) => PREFETCHED_BUILD_FILE.test(name) && !prefetched.has(`/${name}`))
    .sort()
    .map(
      (name) =>
        `build file ${JSON.stringify(`/${name}`)} is in no prefetch asset group, ` +
        'so it is not available offline',
    );
}

/** The reasons a cached URL is not allowed; empty when it is a same-origin path to a build file. */
function urlProblems(url) {
  const problems = [];
  // One leading slash and then no slash or backslash: `//host` and `/\host` name another host.
  if (typeof url !== 'string' || !/^\/(?![/\\])/.test(url))
    problems.push('is not a same-origin path');
  const lower = String(url).toLowerCase();
  for (const text of FORBIDDEN) if (lower.includes(text)) problems.push(`contains ${text}`);
  return problems;
}

/**
 * The problems in a parsed ngsw.json, one string per problem; empty when it passes.
 *
 * @param {any} manifest
 * @returns {string[]}
 */
export function checkNgswManifest(manifest) {
  const problems = [];
  if (manifest?.index !== INDEX) {
    problems.push(`index is ${JSON.stringify(manifest?.index)}, not "${INDEX}"`);
  }
  if (manifest?.navigationRequestStrategy !== STRATEGY) {
    problems.push(
      `navigationRequestStrategy is ${JSON.stringify(manifest?.navigationRequestStrategy)}, ` +
        `not "${STRATEGY}"`,
    );
  }
  for (const group of manifest?.dataGroups ?? []) {
    problems.push(`data group ${JSON.stringify(group?.name)}: ngsw.json must have no dataGroups`);
  }
  if (!Array.isArray(manifest?.assetGroups)) {
    problems.push('ngsw.json has no assetGroups list');
    return problems;
  }
  for (const group of manifest.assetGroups) {
    const name = JSON.stringify(group?.name);
    for (const url of group?.urls ?? []) {
      const reasons = urlProblems(url);
      if (reasons.length > 0) {
        problems.push(`asset group ${name}: URL ${JSON.stringify(url)} ${reasons.join('; ')}`);
      }
    }
    // Patterns come only from `resources.urls`, which can match any origin.
    for (const pattern of group?.patterns ?? []) {
      problems.push(
        `asset group ${name}: URL pattern ${JSON.stringify(pattern)} ` +
          '(only build files may be listed, not resources.urls)',
      );
    }
  }
  return problems;
}

/**
 * Checks one build. Returns the status and the lines to print: one PASS or SKIP line, or one
 * FAIL line per problem.
 *
 * @param {{ angularJsonPath: string, browserDir: string }} paths
 * @returns {Promise<{ status: 'PASS' | 'SKIP' | 'FAIL', lines: string[] }>}
 */
export async function swConfigCheck({ angularJsonPath, browserDir }) {
  const optionSet = serviceWorkerOptionSet(JSON.parse(await readFile(angularJsonPath, 'utf8')));
  let text;
  try {
    text = await readFile(join(browserDir, 'ngsw.json'), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const fail = (problems) => ({
    status: 'FAIL',
    lines: problems.map((problem) => `${PREFIX} FAIL ${problem}`),
  });
  if (text === undefined) {
    if (optionSet) {
      return fail(['angular.json sets the serviceWorker option, but the build wrote no ngsw.json']);
    }
    return {
      status: 'SKIP',
      lines: [`${PREFIX} SKIP (no serviceWorker option and no ngsw.json: the worker is off)`],
    };
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    return fail(['ngsw.json is not valid JSON']);
  }
  const problems = checkNgswManifest(manifest);
  if (Array.isArray(manifest?.assetGroups)) {
    problems.push(...unprefetchedBuildFiles(manifest, await readdir(browserDir)));
  }
  if (problems.length > 0) return fail(problems);
  return {
    status: 'PASS',
    lines: [
      `${PREFIX} PASS (ngsw.json caches only same-origin build files and prefetches every ` +
        'content-hashed chunk; no data groups)',
    ],
  };
}

if (import.meta.main) {
  const root = join(import.meta.dirname, '..');
  const { status, lines } = await swConfigCheck({
    angularJsonPath: join(root, 'angular.json'),
    browserDir: join(root, 'dist', 'omni-league', 'browser'),
  });
  for (const line of lines) (status === 'FAIL' ? console.error : console.log)(line);
  if (status === 'FAIL') process.exitCode = 1;
}
