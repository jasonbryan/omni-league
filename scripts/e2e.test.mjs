import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, afterEach, beforeEach, describe, it, mock } from 'node:test';
import { runE2e } from './e2e.mjs';
import { lastRunFile } from './e2e-last-run.mjs';

const EARLIER = JSON.stringify({ status: 'failed', failedTests: ['earlier-1', 'earlier-2'] });
const FAILED_SETUP = JSON.stringify({ status: 'failed', failedTests: [] });
const PASSED = JSON.stringify({ status: 'passed', failedTests: [] });
const FAILED_IDS = JSON.stringify({ status: 'failed', failedTests: ['new-1'] });

// What the stand-in playwright step does to the last-run file: Playwright clears `outputDir` in
// its first global-setup task, then `LastRunReporter.onEnd` writes the file.
const STEP = `
  const { rmSync, mkdirSync, writeFileSync } = require('node:fs');
  const { dirname } = require('node:path');
  const { CLEAR, FILE, WRITE, THEN } = process.env;
  if (CLEAR) rmSync(CLEAR, { recursive: true, force: true });
  if (WRITE !== undefined) {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, WRITE);
  }
  if (THEN === 'kill') process.kill(process.pid, 'SIGKILL');
  if (THEN === 'fail') process.exit(1);
`;

const dirs = [];
const originalCwd = process.cwd();
let root;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'e2e-last-run-test-')));
  dirs.push(root);
  process.chdir(root);
  mock.method(console, 'error', () => {});
});
afterEach(() => {
  process.chdir(originalCwd);
  mock.restoreAll();
});
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const read = (file) => readFileSync(file, 'utf8');
const put = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

async function run({ args = [], env = {}, writesTo, clearsDir, writes, ends = 'exit' }) {
  const plan = () => [
    {
      name: 'playwright',
      command: process.execPath,
      args: ['-e', STEP],
      env: {
        ...process.env,
        FILE: writesTo,
        CLEAR: clearsDir ?? '',
        THEN: ends,
        ...(writes === undefined ? {} : { WRITE: writes }),
      },
    },
  ];
  return runE2e(args, { env, plan, root, lock: { path: join(root, 'machine.lock') } });
}

const defaultFile = () => join(root, 'test-results', '.last-run.json');

describe('a run that records no failed tests', () => {
  it('puts the earlier file back after a failed setup', async () => {
    put(defaultFile(), EARLIER);
    const code = await run({
      writesTo: defaultFile(),
      clearsDir: join(root, 'test-results'),
      writes: FAILED_SETUP,
      ends: 'fail',
    });
    assert.equal(code, 1);
    assert.equal(read(defaultFile()), EARLIER);
  });

  it('leaves no file when there was none before', async () => {
    await run({
      writesTo: defaultFile(),
      clearsDir: join(root, 'test-results'),
      writes: FAILED_SETUP,
      ends: 'fail',
    });
    assert.equal(existsSync(defaultFile()), false);
  });

  it('puts the earlier file back when the step exits before Playwright writes one', async () => {
    put(defaultFile(), EARLIER);
    const code = await run({
      writesTo: defaultFile(),
      clearsDir: join(root, 'test-results'),
      ends: 'fail',
    });
    assert.equal(code, 1);
    assert.equal(read(defaultFile()), EARLIER);
  });

  it('puts the earlier file back when the step is killed before Playwright writes one', async () => {
    put(defaultFile(), EARLIER);
    const code = await run({
      writesTo: defaultFile(),
      clearsDir: join(root, 'test-results'),
      ends: 'kill',
    });
    assert.equal(code, 128 + 9);
    assert.equal(read(defaultFile()), EARLIER);
  });

  it('puts the earlier file back when the file the step wrote does not parse', async () => {
    put(defaultFile(), EARLIER);
    await run({
      writesTo: defaultFile(),
      clearsDir: join(root, 'test-results'),
      writes: '{"status":"fai',
      ends: 'kill',
    });
    assert.equal(read(defaultFile()), EARLIER);
  });

  it('removes a file that does not parse when there was no earlier file', async () => {
    await run({ writesTo: defaultFile(), writes: '{"status":"fai', ends: 'kill' });
    assert.equal(existsSync(defaultFile()), false);
  });

  it('puts the earlier file back after tests passed and the run still failed', async () => {
    put(defaultFile(), EARLIER);
    const code = await run({
      writesTo: defaultFile(),
      clearsDir: join(root, 'test-results'),
      writes: FAILED_SETUP,
      ends: 'fail',
    });
    assert.equal(code, 1);
    assert.equal(read(defaultFile()), EARLIER);
  });

  for (const status of ['interrupted', 'timedout']) {
    it(`puts the earlier file back when the run is ${status} with no failed tests`, async () => {
      put(defaultFile(), EARLIER);
      await run({
        writesTo: defaultFile(),
        clearsDir: join(root, 'test-results'),
        writes: JSON.stringify({ status, failedTests: [] }),
        ends: 'fail',
      });
      assert.equal(read(defaultFile()), EARLIER);
    });
  }

  it('names the restored file on stderr', async () => {
    put(defaultFile(), EARLIER);
    await run({
      writesTo: defaultFile(),
      clearsDir: join(root, 'test-results'),
      writes: FAILED_SETUP,
      ends: 'fail',
    });
    assert.match(
      console.error.mock.calls.map((call) => call.arguments.join(' ')).join('\n'),
      /keeps the earlier list/,
    );
  });

  it('applies when E2E_BASE_URL is set', async () => {
    put(defaultFile(), EARLIER);
    await run({
      env: { E2E_BASE_URL: 'https://example.netlify.app' },
      writesTo: defaultFile(),
      clearsDir: join(root, 'test-results'),
      writes: FAILED_SETUP,
      ends: 'fail',
    });
    assert.equal(read(defaultFile()), EARLIER);
  });
});

describe('a run that records its result', () => {
  it('keeps a passed file as written', async () => {
    put(defaultFile(), EARLIER);
    const code = await run({
      writesTo: defaultFile(),
      clearsDir: join(root, 'test-results'),
      writes: PASSED,
      ends: 'exit',
    });
    assert.equal(code, 0);
    assert.equal(read(defaultFile()), PASSED);
  });

  it('keeps a file with failed test ids as written', async () => {
    put(defaultFile(), EARLIER);
    const code = await run({
      writesTo: defaultFile(),
      clearsDir: join(root, 'test-results'),
      writes: FAILED_IDS,
      ends: 'fail',
    });
    assert.equal(code, 1);
    assert.equal(read(defaultFile()), FAILED_IDS);
  });
});

describe('the last-run file the run reads', () => {
  // Each case clears the file's own directory and fails with no failed tests, so the earlier file
  // survives only when the script read the same path Playwright wrote.
  async function survives({ args = [], env = {}, writesTo }) {
    put(writesTo, EARLIER);
    await run({
      args,
      env,
      writesTo,
      clearsDir: dirname(writesTo),
      writes: FAILED_SETUP,
      ends: 'fail',
    });
    return read(writesTo) === EARLIER;
  }

  it('is --output <dir>, resolved against the cwd', async () => {
    assert.ok(
      await survives({
        args: ['--output', 'out/dir'],
        writesTo: join(root, 'out', 'dir', '.last-run.json'),
      }),
    );
  });

  it('is --output=<dir>', async () => {
    assert.ok(
      await survives({
        args: ['--output=out/dir'],
        writesTo: join(root, 'out', 'dir', '.last-run.json'),
      }),
    );
  });

  it('is --last-failed-file <file>, resolved against the cwd', async () => {
    assert.ok(
      await survives({
        args: ['--last-failed-file', 'lf/a.json'],
        writesTo: join(root, 'lf', 'a.json'),
      }),
    );
  });

  it('is --last-failed-file=<file>', async () => {
    assert.ok(
      await survives({
        args: ['--last-failed-file=lf/a.json'],
        writesTo: join(root, 'lf', 'a.json'),
      }),
    );
  });

  it('is PLAYWRIGHT_LAST_RUN_OUTPUT_FILE, resolved against the cwd', async () => {
    assert.ok(
      await survives({
        env: { PLAYWRIGHT_LAST_RUN_OUTPUT_FILE: 'env/b.json' },
        writesTo: join(root, 'env', 'b.json'),
      }),
    );
  });

  it('is test-results/.last-run.json under the root by default', async () => {
    assert.ok(await survives({ writesTo: defaultFile() }));
  });

  it('is test-results/<E2E_RUN_NAME>/.last-run.json under the root for a named run', async () => {
    assert.ok(
      await survives({
        env: { E2E_RUN_NAME: 'production-mobile' },
        writesTo: join(root, 'test-results', 'production-mobile', '.last-run.json'),
      }),
    );
  });

  it('prefers --last-failed-file, then the environment variable, then --output', async () => {
    const file = join(root, 'lf', 'a.json');
    put(join(root, 'out', '.last-run.json'), EARLIER);
    put(join(root, 'env.json'), EARLIER);
    put(file, EARLIER);
    await run({
      args: ['--output', 'out', '--last-failed-file', 'lf/a.json'],
      env: { PLAYWRIGHT_LAST_RUN_OUTPUT_FILE: 'env.json' },
      writesTo: file,
      clearsDir: dirname(file),
      writes: FAILED_SETUP,
      ends: 'fail',
    });
    assert.equal(read(file), EARLIER);
  });
});

describe('a run whose last-run file the script cannot know', () => {
  // The step leaves the empty file Playwright would write; a restore would replace it.
  async function leavesFile({ args = [], env = {} }) {
    put(defaultFile(), EARLIER);
    const code = await run({
      args,
      env,
      writesTo: defaultFile(),
      writes: FAILED_SETUP,
      ends: 'fail',
    });
    assert.equal(code, 1);
    return read(defaultFile()) === FAILED_SETUP;
  }

  for (const args of [
    ['-c', 'other.config.ts'],
    ['--config', 'other.config.ts'],
    ['--config=other.config.ts'],
    ['-cother.config.ts'],
  ]) {
    it(`skips the copy and the restore for ${args.join(' ')}`, async () => {
      assert.ok(await leavesFile({ args }));
    });
  }

  it('still restores with --config when --last-failed-file names the file', async () => {
    const file = join(root, 'lf', 'a.json');
    put(file, EARLIER);
    await run({
      args: ['-c', 'other.config.ts', '--last-failed-file', file],
      writesTo: file,
      writes: FAILED_SETUP,
      ends: 'fail',
    });
    assert.equal(read(file), EARLIER);
  });

  it('still restores with --config when --output names the directory', async () => {
    const file = join(root, 'out', '.last-run.json');
    put(file, EARLIER);
    await run({
      args: ['-c', 'other.config.ts', '--output', 'out'],
      writesTo: file,
      clearsDir: dirname(file),
      writes: FAILED_SETUP,
      ends: 'fail',
    });
    assert.equal(read(file), EARLIER);
  });

  it('skips the copy and the restore for an invalid E2E_RUN_NAME, and does not throw', async () => {
    for (const name of ['../escape', 'a/b', 'Upper', '-lead']) {
      assert.ok(await leavesFile({ env: { E2E_RUN_NAME: name } }), name);
    }
  });
});

describe('lastRunFile', () => {
  const bases = () => ({ root: '/repo', cwd: '/work' });

  it('treats an empty E2E_RUN_NAME as unset', () => {
    assert.equal(
      lastRunFile([], { E2E_RUN_NAME: '' }, bases()),
      '/repo/test-results/.last-run.json',
    );
  });

  it('resolves --last-failed-file against the cwd, not the root', () => {
    assert.equal(lastRunFile(['--last-failed-file', 'lf/a.json'], {}, bases()), '/work/lf/a.json');
    assert.equal(lastRunFile(['--last-failed-file=lf/a.json'], {}, bases()), '/work/lf/a.json');
  });

  it('resolves PLAYWRIGHT_LAST_RUN_OUTPUT_FILE against the cwd, not the root', () => {
    const env = { PLAYWRIGHT_LAST_RUN_OUTPUT_FILE: 'env/b.json' };
    assert.equal(lastRunFile([], env, bases()), '/work/env/b.json');
  });

  it('uses --output with --config, which overrides every outputDir', () => {
    assert.equal(
      lastRunFile(['-c', 'x', '--output', 'out'], {}, bases()),
      '/work/out/.last-run.json',
    );
  });

  it('takes the last of a repeated option', () => {
    assert.equal(
      lastRunFile(['--output', 'a', '--output=b'], {}, bases()),
      '/work/b/.last-run.json',
    );
  });

  it('ignores options after a bare --', () => {
    assert.equal(
      lastRunFile(['--', '--output', 'a'], {}, bases()),
      '/repo/test-results/.last-run.json',
    );
    assert.equal(lastRunFile(['--', '-c', 'x'], {}, bases()), '/repo/test-results/.last-run.json');
  });

  it('is undefined with --config and nothing that names the file', () => {
    assert.equal(lastRunFile(['--config=x'], {}, bases()), undefined);
  });
});
