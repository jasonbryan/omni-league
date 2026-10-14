// Enforces that the service worker never caches Convex, auth, or signed-in data.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PREFIX = 'sw-config-check:';
const INDEX = '/index.csr.html';
const STRATEGY = 'performance';
const FORBIDDEN = ['/api/', 'convex.cloud', 'convex.site'];

/**
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
 * The option is the kill switch's single setting: without it the build writes no worker and the app
 * registers none, so no client requests the missing `ngsw-worker.js`.
 * @param {any} angularJson
 * @returns {string}
 */
export function serviceWorkerDefine(angularJson) {
  return `--define=__SERVICE_WORKER__=${String(serviceWorkerOptionSet(angularJson))}`;
}

// Lazily loaded chunks too, so a feature that imports one works offline before its first use online.
const PREFETCHED_BUILD_FILE = /^(?:(?:main|chunk|polyfills)-[^/]+\.js|styles-[^/]+\.css)$/;

/**
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
      lines: [
        `${PREFIX} SKIP (no serviceWorker option and no ngsw.json: the worker is off, and the ` +
          'app registers none)',
      ],
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
