import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { lastRunFile } from './e2e-last-run.mjs';

const root = join(import.meta.dirname, '..');
// Playwright reports real paths; macOS's tmpdir is behind a symlink.
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'playwright-config-')));
after(() => rmSync(scratch, { recursive: true, force: true }));

// Listing still runs the configured reporters, so the run happens in a copy of the config and its
// imports, never writing to this checkout's test-results/ or playwright-report/.
function listIn(name, env) {
  const dir = join(scratch, name);
  cpSync(join(root, 'playwright.config.ts'), join(dir, 'playwright.config.ts'));
  cpSync(join(root, 'e2e', 'support'), join(dir, 'e2e', 'support'), { recursive: true });
  cpSync(join(root, 'e2e', 'global-setup.ts'), join(dir, 'e2e', 'global-setup.ts'));
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
  writeFileSync(
    join(dir, 'e2e', 'listed.spec.ts'),
    "import { test } from '@playwright/test';\n\ntest('listed', () => {});\n",
  );
  const childEnv = { ...process.env, E2E_BASE_URL: 'http://localhost:4000', ...env };
  if (env.E2E_RUN_NAME === undefined) delete childEnv.E2E_RUN_NAME;
  const result = spawnSync(
    process.execPath,
    [join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '--list'],
    { cwd: dir, env: childEnv, encoding: 'utf8' },
  );
  return { dir, result };
}

/** @param {string} path */
const outputDirs = (path) =>
  new Set(
    JSON.parse(readFileSync(path, 'utf8')).config.projects.map((project) => project.outputDir),
  );

describe('the Playwright output paths', () => {
  it('keeps test-results/ and playwright-report/ when E2E_RUN_NAME is unset', () => {
    const { dir, result } = listIn('unset', { E2E_RUN_NAME: undefined });
    assert.equal(result.status, 0, result.stderr);
    const json = join(dir, 'test-results', 'results.json');
    assert.ok(existsSync(json), 'JSON report at test-results/results.json');
    assert.ok(existsSync(join(dir, 'playwright-report', 'index.html')), 'HTML report');
    assert.deepEqual(outputDirs(json), new Set([join(dir, 'test-results')]));
  });

  it('treats an empty E2E_RUN_NAME as unset', () => {
    const { dir, result } = listIn('empty', { E2E_RUN_NAME: '' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(existsSync(join(dir, 'test-results', 'results.json')));
    assert.ok(existsSync(join(dir, 'playwright-report', 'index.html')));
  });

  it('gives a named run its own output folder, JSON report, and HTML report', () => {
    const { dir, result } = listIn('named', { E2E_RUN_NAME: 'production-mobile' });
    assert.equal(result.status, 0, result.stderr);
    const json = join(dir, 'test-results', 'production-mobile', 'results.json');
    assert.ok(existsSync(json), 'JSON report at test-results/production-mobile/results.json');
    assert.ok(existsSync(join(dir, 'playwright-report', 'production-mobile', 'index.html')));
    assert.ok(!existsSync(join(dir, 'test-results', 'results.json')), 'no shared JSON report');
    assert.ok(!existsSync(join(dir, 'playwright-report', 'index.html')), 'no shared HTML report');
    assert.deepEqual(outputDirs(json), new Set([join(dir, 'test-results', 'production-mobile')]));
  });

  it('puts the last-run file where scripts/e2e-last-run.mjs reads it, with and without E2E_RUN_NAME', () => {
    for (const [name, runName] of [
      ['last-run-unset', undefined],
      ['last-run-named', 'production-mobile'],
    ]) {
      const { dir, result } = listIn(name, { E2E_RUN_NAME: runName });
      assert.equal(result.status, 0, result.stderr);
      const json = join(dir, 'test-results', ...(runName ? [runName] : []), 'results.json');
      const [outputDir] = outputDirs(json);
      assert.equal(
        lastRunFile([], runName === undefined ? {} : { E2E_RUN_NAME: runName }, {
          root: dir,
          cwd: dir,
        }),
        join(outputDir, '.last-run.json'),
        runName ?? 'unset',
      );
    }
  });

  it('refuses a run name that is not one path segment of lowercase letters, digits, and hyphens', () => {
    for (const [index, name] of ['../escape', 'a/b', 'Upper', '-lead'].entries()) {
      const { result } = listIn(`bad-${index}`, { E2E_RUN_NAME: name });
      assert.notEqual(result.status, 0, name);
      assert.match(result.stderr + result.stdout, /E2E_RUN_NAME/, name);
    }
  });
});

describe('the convex webServer', () => {
  const READY_LINE = '✔ 14:47:03 Convex functions ready! (922.52ms)';

  // The spec imports the config and writes what it holds; a webServer array does not reach a
  // reporter, and `--list` starts no server.
  let loaded;
  function loadedWebServers() {
    loaded ??= loadWebServers();
    return loaded;
  }

  function loadWebServers() {
    const dir = join(scratch, 'web-servers');
    cpSync(join(root, 'playwright.config.ts'), join(dir, 'playwright.config.ts'));
    cpSync(join(root, 'e2e', 'support'), join(dir, 'e2e', 'support'), { recursive: true });
    cpSync(join(root, 'e2e', 'global-setup.ts'), join(dir, 'e2e', 'global-setup.ts'));
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    const dump = join(dir, 'web-servers.json');
    writeFileSync(
      join(dir, 'e2e', 'dump.spec.ts'),
      [
        "import { test } from '@playwright/test';",
        "import { writeFileSync } from 'node:fs';",
        "import config from '../playwright.config';",
        'const servers = [config.webServer ?? []].flat().map((server) => ({',
        '  name: server.name,',
        '  keys: Object.keys(server),',
        '  readyLineMatches: server.wait?.stderr?.test(process.env.READY_LINE ?? "") ?? false,',
        '  stdoutMatches: server.wait?.stdout?.test(process.env.READY_LINE ?? "") ?? false,',
        '}));',
        'writeFileSync(process.env.DUMP_FILE!, JSON.stringify(servers));',
        "test('listed', () => {});",
      ].join('\n'),
    );
    const env = { ...process.env, DUMP_FILE: dump, READY_LINE };
    delete env.E2E_BASE_URL;
    delete env.E2E_RUN_NAME;
    const result = spawnSync(
      process.execPath,
      [join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '--list'],
      { cwd: dir, env, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(dump, 'utf8'));
  }

  it('is ready at the first `Convex functions ready!` on stderr, with no url and no reuse option', () => {
    const convex = loadedWebServers().find((server) => server.name === 'convex');
    assert.ok(convex, 'a convex webServer');
    assert.ok(convex.keys.includes('wait'), 'it waits for a line');
    assert.equal(convex.readyLineMatches, true, 'the CLI line on stderr marks it ready');
    assert.ok(!convex.keys.includes('url'), 'a url would also mark it ready, at /version');
    assert.ok(
      !convex.keys.includes('reuseExistingServer'),
      'the option does nothing without a url',
    );
  });

  it('is not ready at the CLI line on stdout', () => {
    const convex = loadedWebServers().find((server) => server.name === 'convex');
    assert.equal(convex.stdoutMatches, false);
  });

  it('is installed with a CLI that still prints the ready line, which the ci workflow also greps', () => {
    const bundle = readFileSync(
      join(root, 'node_modules', 'convex', 'dist', 'cli.bundle.cjs'),
      'utf8',
    );
    assert.ok(
      bundle.includes('Convex functions ready!'),
      'a Convex CLI that renames the line leaves the convex webServer waiting until its timeout',
    );
    const workflow = readFileSync(join(root, '.github', 'workflows', 'e2e.yml'), 'utf8');
    assert.ok(workflow.includes("grep -q 'Convex functions ready!'"));
  });
});

describe('the test split', () => {
  // Only Playwright's loader reads the TypeScript config, so a spec in a copy writes its values out.
  let split;
  function loadSplit() {
    split ??= readSplit();
    return split;
  }

  function readSplit() {
    const dir = join(scratch, 'split');
    cpSync(join(root, 'playwright.config.ts'), join(dir, 'playwright.config.ts'));
    cpSync(join(root, 'e2e', 'support'), join(dir, 'e2e', 'support'), { recursive: true });
    cpSync(join(root, 'e2e', 'global-setup.ts'), join(dir, 'e2e', 'global-setup.ts'));
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    const dump = join(dir, 'split.json');
    writeFileSync(
      join(dir, 'e2e', 'dump.spec.ts'),
      [
        "import { test } from '@playwright/test';",
        "import { writeFileSync } from 'node:fs';",
        "import config from '../playwright.config';",
        'const { fullyParallel, workers, retries } = config;',
        'writeFileSync(process.env.DUMP_FILE!, JSON.stringify({ fullyParallel, workers, retries }));',
        "test('listed', () => {});",
      ].join('\n'),
    );
    const result = spawnSync(
      process.execPath,
      [join(root, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', '--list'],
      {
        cwd: dir,
        env: { ...process.env, CI: '1', DUMP_FILE: dump, E2E_BASE_URL: 'http://localhost:4000' },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(dump, 'utf8'));
  }

  it('splits every test into its own group, so a shard is cut by test and not by spec file', () => {
    assert.equal(loadSplit().fullyParallel, true);
  });

  it('keeps 2 workers and one retry on CI', () => {
    const { workers, retries } = loadSplit();
    assert.equal(workers, 2);
    assert.equal(retries, 1);
  });
});
