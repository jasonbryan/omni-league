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

  it('refuses a run name that is not one path segment of lowercase letters, digits, and hyphens', () => {
    for (const [index, name] of ['../escape', 'a/b', 'Upper', '-lead'].entries()) {
      const { result } = listIn(`bad-${index}`, { E2E_RUN_NAME: name });
      assert.notEqual(result.status, 0, name);
      assert.match(result.stderr + result.stdout, /E2E_RUN_NAME/, name);
    }
  });
});
