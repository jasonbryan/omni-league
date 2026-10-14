import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  checkNgswManifest,
  serviceWorkerDefine,
  serviceWorkerOptionSet,
  swConfigCheck,
} from './sw-config-check.mjs';

const ROOT = join(import.meta.dirname, '..');

function angularJson({ option = true, inConfiguration = false } = {}) {
  const options = { browser: 'src/main.ts', outputMode: 'server' };
  const production = { outputHashing: 'all' };
  if (option && !inConfiguration) options.serviceWorker = 'ngsw-config.json';
  if (option && inConfiguration) production.serviceWorker = 'ngsw-config.json';
  return {
    version: 1,
    projects: {
      'omni-league': {
        architect: { build: { options, configurations: { production } } },
      },
    },
  };
}

function ngswJson(overrides = {}) {
  return {
    configVersion: 1,
    timestamp: 1_760_000_000_000,
    index: '/index.csr.html',
    assetGroups: [
      {
        name: 'shell',
        installMode: 'prefetch',
        updateMode: 'prefetch',
        cacheQueryOptions: { ignoreVary: true },
        urls: [
          '/chunk-ABCDEF12.js',
          '/favicon.ico',
          '/index.csr.html',
          '/main-12345678.js',
          '/manifest.webmanifest',
          '/styles-ABCDEF12.css',
        ],
        patterns: [],
      },
      {
        name: 'assets',
        installMode: 'lazy',
        updateMode: 'prefetch',
        cacheQueryOptions: { ignoreVary: true },
        urls: ['/icons/icon-192.png', '/media/inter-latin-wght-normal-ABCDEF12.woff2'],
        patterns: [],
      },
    ],
    dataGroups: [],
    hashTable: { '/index.csr.html': '0000000000000000000000000000000000000000' },
    navigationUrls: [{ positive: true, regex: '^\\/.*$' }],
    navigationRequestStrategy: 'performance',
    ...overrides,
  };
}

const DATA_GROUP = {
  name: 'pages',
  patterns: ['^\\/organizations\\/.*$'],
  strategy: 'freshness',
  maxSize: 50,
  maxAge: 3_600_000,
  cacheOpaqueResponses: false,
  cacheQueryOptions: { ignoreVary: true },
  version: 1,
};

function withShellUrl(url) {
  const manifest = ngswJson();
  manifest.assetGroups[0].urls.push(url);
  return manifest;
}

async function withBuild({ angular, ngsw, files = [] }, run) {
  const dir = await mkdtemp(join(tmpdir(), 'sw-config-check-'));
  try {
    const browserDir = join(dir, 'dist', 'omni-league', 'browser');
    await mkdir(browserDir, { recursive: true });
    const angularJsonPath = join(dir, 'angular.json');
    await writeFile(angularJsonPath, JSON.stringify(angular));
    for (const file of files) await writeFile(join(browserDir, file), '');
    if (ngsw !== undefined) {
      await writeFile(
        join(browserDir, 'ngsw.json'),
        typeof ngsw === 'string' ? ngsw : JSON.stringify(ngsw),
      );
    }
    await run({ angularJsonPath, browserDir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function check(angular, ngsw, files = []) {
  let result;
  await withBuild({ angular, ngsw, files }, async (paths) => {
    result = await swConfigCheck(paths);
  });
  return result;
}

describe('swConfigCheck', () => {
  it('passes a build with the option and an ngsw.json that caches only same-origin build files', async () => {
    const { status, lines } = await check(angularJson(), ngswJson());
    assert.equal(status, 'PASS');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^sw-config-check: PASS\b/);
  });

  it('prints SKIP and passes with no serviceWorker option and no ngsw.json (the kill switch)', async () => {
    const { status, lines } = await check(angularJson({ option: false }), undefined);
    assert.equal(status, 'SKIP');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^sw-config-check: SKIP\b/);
  });

  it('fails when the option is set and the build wrote no ngsw.json', async () => {
    const { status, lines } = await check(angularJson(), undefined);
    assert.equal(status, 'FAIL');
    assert.deepEqual(lines, [
      'sw-config-check: FAIL angular.json sets the serviceWorker option, but the build wrote no ngsw.json',
    ]);
  });

  it('counts the option in a build configuration too', async () => {
    const { status } = await check(angularJson({ inConfiguration: true }), undefined);
    assert.equal(status, 'FAIL');
  });

  it('fails on a data group, naming it', async () => {
    const { status, lines } = await check(angularJson(), ngswJson({ dataGroups: [DATA_GROUP] }));
    assert.equal(status, 'FAIL');
    assert.deepEqual(lines, [
      'sw-config-check: FAIL data group "pages": ngsw.json must have no dataGroups',
    ]);
  });

  it('fails on a Convex URL in an asset group', async () => {
    const { status, lines } = await check(
      angularJson(),
      withShellUrl('https://happy-otter-123.convex.cloud/api/1.46.0/sync'),
    );
    assert.equal(status, 'FAIL');
    assert.deepEqual(lines, [
      'sw-config-check: FAIL asset group "shell": URL "https://happy-otter-123.convex.cloud/api/1.46.0/sync" ' +
        'is not a same-origin path; contains /api/; contains convex.cloud',
    ]);
  });

  it('fails on a convex.site URL, in any letter case', async () => {
    const { lines } = await check(
      angularJson(),
      withShellUrl('https://Happy-Otter-123.CONVEX.SITE/x.js'),
    );
    assert.deepEqual(lines, [
      'sw-config-check: FAIL asset group "shell": URL "https://Happy-Otter-123.CONVEX.SITE/x.js" ' +
        'is not a same-origin path; contains convex.site',
    ]);
  });

  it('fails on a same-origin /api/ URL', async () => {
    const { status, lines } = await check(angularJson(), withShellUrl('/api/auth/convex/token'));
    assert.equal(status, 'FAIL');
    assert.deepEqual(lines, [
      'sw-config-check: FAIL asset group "shell": URL "/api/auth/convex/token" contains /api/',
    ]);
  });

  it('fails on a protocol-relative or backslash URL, which a browser reads as another host', async () => {
    for (const url of ['//cdn.example/x.js', '/\\cdn.example/x.js', 'x.js']) {
      const { lines } = await check(angularJson(), withShellUrl(url));
      assert.deepEqual(lines, [
        `sw-config-check: FAIL asset group "shell": URL ${JSON.stringify(url)} is not a same-origin path`,
      ]);
    }
  });

  it('fails on any URL pattern, which a resources.urls entry produces', async () => {
    const pattern = String.raw`https:\/\/fonts\.example\/.*`;
    const manifest = ngswJson();
    manifest.assetGroups[1].patterns.push(pattern);
    const { status, lines } = await check(angularJson(), manifest);
    assert.equal(status, 'FAIL');
    assert.deepEqual(lines, [
      `sw-config-check: FAIL asset group "assets": URL pattern ${JSON.stringify(pattern)} ` +
        '(only build files may be listed, not resources.urls)',
    ]);
  });

  it('fails on the freshness navigation strategy', async () => {
    const { status, lines } = await check(
      angularJson(),
      ngswJson({ navigationRequestStrategy: 'freshness' }),
    );
    assert.equal(status, 'FAIL');
    assert.deepEqual(lines, [
      'sw-config-check: FAIL navigationRequestStrategy is "freshness", not "performance"',
    ]);
  });

  it('fails on an index other than /index.csr.html', async () => {
    const { lines } = await check(angularJson(), ngswJson({ index: '/index.html' }));
    assert.deepEqual(lines, [
      'sw-config-check: FAIL index is "/index.html", not "/index.csr.html"',
    ]);
  });

  it('prints one FAIL line per problem when there are several', async () => {
    const manifest = withShellUrl('/api/x.js');
    manifest.dataGroups = [DATA_GROUP, { ...DATA_GROUP, name: 'auth' }];
    manifest.navigationRequestStrategy = 'freshness';
    const { status, lines } = await check(angularJson(), manifest);
    assert.equal(status, 'FAIL');
    assert.equal(lines.length, 4);
    for (const line of lines) assert.match(line, /^sw-config-check: FAIL /);
  });

  // A lazily loaded chunk must be prefetched, or the feature that imports it fails offline until it
  // has been used online once.
  describe('content-hashed build files in browser/', () => {
    const BUILT = [
      'chunk-ABCDEF12.js',
      'main-12345678.js',
      'styles-ABCDEF12.css',
      'ngsw-worker.js',
      'safety-worker.js',
      'worker-basic.min.js',
      'index.csr.html',
    ];

    it('passes when every chunk, main, polyfills, and styles file is in a prefetch group', async () => {
      const { status } = await check(angularJson(), ngswJson(), BUILT);
      assert.equal(status, 'PASS');
    });

    it('fails on a chunk that no asset group lists, one line per file', async () => {
      const { status, lines } = await check(angularJson(), ngswJson(), [
        ...BUILT,
        'chunk-LAZY0001.js',
        'polyfills-ABCDEF12.js',
      ]);
      assert.equal(status, 'FAIL');
      assert.deepEqual(lines, [
        'sw-config-check: FAIL build file "/chunk-LAZY0001.js" is in no prefetch asset group, so it is not available offline',
        'sw-config-check: FAIL build file "/polyfills-ABCDEF12.js" is in no prefetch asset group, so it is not available offline',
      ]);
    });

    it('fails on a chunk listed only in a lazy group', async () => {
      const manifest = ngswJson();
      manifest.assetGroups[1].urls.push('/chunk-LAZY0002.js');
      const { lines } = await check(angularJson(), manifest, [...BUILT, 'chunk-LAZY0002.js']);
      assert.deepEqual(lines, [
        'sw-config-check: FAIL build file "/chunk-LAZY0002.js" is in no prefetch asset group, so it is not available offline',
      ]);
    });

    it('ignores the unhashed files of a development build', async () => {
      const { status } = await check(angularJson(), ngswJson(), [
        ...BUILT,
        'main.js',
        'polyfills.js',
        'styles.css',
      ]);
      assert.equal(status, 'PASS');
    });
  });

  it('checks an ngsw.json that is present even without the option', async () => {
    const { status } = await check(
      angularJson({ option: false }),
      ngswJson({ dataGroups: [DATA_GROUP] }),
    );
    assert.equal(status, 'FAIL');
  });

  it('fails on an ngsw.json that is not JSON or has no asset groups', async () => {
    assert.deepEqual((await check(angularJson(), '{')).lines, [
      'sw-config-check: FAIL ngsw.json is not valid JSON',
    ]);
    assert.deepEqual((await check(angularJson(), ngswJson({ assetGroups: undefined }))).lines, [
      'sw-config-check: FAIL ngsw.json has no assetGroups list',
    ]);
  });
});

describe('checkNgswManifest', () => {
  it('returns no problems for the expected manifest shape', () => {
    assert.deepEqual(checkNgswManifest(ngswJson()), []);
  });
});

describe('serviceWorkerOptionSet', () => {
  it('is true for the option in options or a configuration, false otherwise', () => {
    assert.equal(serviceWorkerOptionSet(angularJson()), true);
    assert.equal(serviceWorkerOptionSet(angularJson({ inConfiguration: true })), true);
    assert.equal(serviceWorkerOptionSet(angularJson({ option: false })), false);
  });
});

describe('serviceWorkerDefine', () => {
  it('turns registration on exactly when angular.json sets the serviceWorker option', () => {
    assert.equal(serviceWorkerDefine(angularJson()), '--define=__SERVICE_WORKER__=true');
    assert.equal(
      serviceWorkerDefine(angularJson({ inConfiguration: true })),
      '--define=__SERVICE_WORKER__=true',
    );
    assert.equal(
      serviceWorkerDefine(angularJson({ option: false })),
      '--define=__SERVICE_WORKER__=false',
    );
  });
});

describe('the repository configuration', () => {
  it('angular.json sets serviceWorker to ngsw-config.json in the build options of every configuration', async () => {
    const angular = JSON.parse(await readFile(join(ROOT, 'angular.json'), 'utf8'));
    const build = angular.projects['omni-league'].architect.build;
    assert.equal(build.options.serviceWorker, 'ngsw-config.json');
    for (const [name, configuration] of Object.entries(build.configurations)) {
      assert.equal(configuration.serviceWorker, undefined, `${name} does not override it`);
    }
  });

  it('ngsw-config.json has performance navigations, no data groups, and two asset groups', async () => {
    const config = JSON.parse(await readFile(join(ROOT, 'ngsw-config.json'), 'utf8'));
    assert.equal(config.index, '/index.csr.html');
    assert.equal(config.navigationRequestStrategy, 'performance');
    assert.equal(config.dataGroups, undefined);
    assert.equal(config.navigationUrls, undefined, 'the default navigationUrls stay');
    assert.deepEqual(
      config.assetGroups.map(({ name, installMode, updateMode, resources }) => ({
        name,
        installMode,
        updateMode,
        resources,
      })),
      [
        {
          name: 'shell',
          installMode: 'prefetch',
          updateMode: 'prefetch',
          resources: {
            files: [
              '/index.csr.html',
              '/manifest.webmanifest',
              '/favicon.ico',
              '/main-*.js',
              '/chunk-*.js',
              '/polyfills-*.js',
              '/styles-*.css',
            ],
          },
        },
        {
          name: 'assets',
          installMode: 'lazy',
          updateMode: 'prefetch',
          resources: { files: ['/media/**', '/icons/**'] },
        },
      ],
    );
  });

  it('angular.json defaults __SERVICE_WORKER__ to false, so a build outside npm run build registers no worker', async () => {
    const angular = JSON.parse(await readFile(join(ROOT, 'angular.json'), 'utf8'));
    assert.equal(
      angular.projects['omni-league'].architect.build.options.define.__SERVICE_WORKER__,
      'false',
    );
  });

  it('npm run build and npm start pass __SERVICE_WORKER__ from the serviceWorker option', async () => {
    const source = await readFile(join(ROOT, 'scripts', 'ng-convex.mjs'), 'utf8');
    assert.match(
      source,
      /^const swDefine = serviceWorkerDefine\(JSON\.parse\(readFileSync\(join\(root, 'angular\.json'\)/m,
    );
    assert.match(source, /^defines\.push\(swDefine\);$/m);
  });

  it('the app registers the worker only when __SERVICE_WORKER__ is true, in a production build', async () => {
    const config = await readFile(join(ROOT, 'src', 'app', 'app.config.ts'), 'utf8');
    assert.match(
      config,
      /provideServiceWorker\(\s*'ngsw-worker\.js',\s*serviceWorkerRegistration\(SERVICE_WORKER_BUILD, isDevMode\(\)\),?\s*\)/,
    );
  });

  it('npm run build runs the check after the edge-safety check', async () => {
    const source = await readFile(join(ROOT, 'scripts', 'ng-convex.mjs'), 'utf8');
    const edge = source.indexOf('checkServerBundle(');
    const sw = source.indexOf('swConfigCheck(');
    assert.ok(edge >= 0, 'ng-convex.mjs runs the edge-safety check');
    assert.ok(sw > edge, 'ng-convex.mjs runs swConfigCheck after it');
  });
});
