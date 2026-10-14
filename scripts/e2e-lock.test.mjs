import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { needsLock } from './e2e.mjs';
import { acquireLock, processIsAlive, release, takeOver, withLock } from './e2e-lock.mjs';

const temps = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function lockPath() {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-lock-test-'));
  temps.push(dir);
  return join(dir, 'nested', 'e2e.lock');
}

const always = () => true;

describe('acquireLock', () => {
  it('creates the lock holding the PID, and the release removes it', async () => {
    const path = lockPath();
    const unlock = await acquireLock({ path, pid: 4001, isAlive: always });
    assert.equal(readFileSync(path, 'utf8').trim(), '4001');
    unlock();
    assert.equal(existsSync(path), false);
  });

  it('waits while a live process holds the lock, names the holder once, then proceeds', async () => {
    const path = lockPath();
    const first = await acquireLock({ path, pid: 4001, isAlive: always });
    const waits = [];
    let acquired = false;
    const second = acquireLock({
      path,
      pid: 4002,
      isAlive: always,
      pollMs: 5,
      onWait: (holder) => waits.push(holder),
    }).then((unlock) => {
      acquired = true;
      return unlock;
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(acquired, false);
    assert.deepEqual(waits, [4001]);
    first();
    const unlock = await second;
    assert.equal(readFileSync(path, 'utf8').trim(), '4002');
    assert.deepEqual(waits, [4001]);
    unlock();
  });

  it('takes over a lock whose holder process is gone', async () => {
    const path = lockPath();
    await acquireLock({ path, pid: 4001, isAlive: always });
    const waits = [];
    const unlock = await acquireLock({
      path,
      pid: 4002,
      isAlive: (pid) => pid !== 4001,
      pollMs: 5,
      onWait: (holder) => waits.push(holder),
    });
    assert.equal(readFileSync(path, 'utf8').trim(), '4002');
    assert.deepEqual(waits, []);
    unlock();
    assert.equal(existsSync(path), false);
  });

  it('takes over a lock file that holds no PID', async () => {
    const path = lockPath();
    await acquireLock({ path, pid: 4001, isAlive: always });
    writeFileSync(path, 'garbage');
    const unlock = await acquireLock({ path, pid: 4002, isAlive: always, pollMs: 5 });
    assert.equal(readFileSync(path, 'utf8').trim(), '4002');
    unlock();
  });

  it('stops waiting when the signal aborts, and leaves the other holder’s lock alone', async () => {
    const path = lockPath();
    await acquireLock({ path, pid: 4001, isAlive: always });
    const abort = new AbortController();
    const waiting = acquireLock({
      path,
      pid: 4002,
      isAlive: always,
      pollMs: 5,
      signal: abort.signal,
    });
    setTimeout(() => abort.abort(new Error('stopped')), 30);
    await assert.rejects(waiting, /stopped/);
    assert.equal(readFileSync(path, 'utf8').trim(), '4001');
  });

  it('releases only a lock that still names the caller', async () => {
    const path = lockPath();
    const unlock = await acquireLock({ path, pid: 4001, isAlive: always });
    writeFileSync(path, '4002\n');
    unlock();
    assert.equal(readFileSync(path, 'utf8').trim(), '4002');
    release(path, 4002);
    assert.equal(existsSync(path), false);
    release(path, 4002);
  });

  it('lets exactly one of several simultaneous callers hold the lock at a time', async () => {
    const path = lockPath();
    let holding = 0;
    let peak = 0;
    const run = async (pid) => {
      const unlock = await acquireLock({ path, pid, isAlive: always, pollMs: 2 });
      holding += 1;
      peak = Math.max(peak, holding);
      await new Promise((resolve) => setTimeout(resolve, 10));
      holding -= 1;
      unlock();
    };
    await Promise.all([5001, 5002, 5003, 5004, 5005].map(run));
    assert.equal(peak, 1);
    assert.equal(existsSync(path), false);
  });
});

describe('takeover by several processes', () => {
  const lockModule = new URL('./e2e-lock.mjs', import.meta.url).href;
  const RACERS = 8;
  const ROUNDS = 5;

  async function exitedProcessPid() {
    const child = spawn(process.execPath, ['-e', '']);
    await new Promise((resolve) => child.on('exit', resolve));
    return /** @type {number} */ (child.pid);
  }

  it('leaves a live lock alone when the file it saw as dead has since been replaced', () => {
    const path = lockPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '4002\n');
    takeOver(path, 4001, (pid) => pid === 4002, 4003);
    assert.equal(readFileSync(path, 'utf8').trim(), '4002');
    assert.deepEqual(readdirSync(dirname(path)), ['e2e.lock']);
  });

  it('does not remove a lock while another waiter holds the takeover guard', () => {
    const path = lockPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '4001\n');
    writeFileSync(`${path}.takeover`, '4005\n');
    takeOver(path, 4001, (pid) => pid === 4005, 4003);
    assert.equal(readFileSync(path, 'utf8').trim(), '4001');
  });

  it('clears a takeover guard whose holder is gone', () => {
    const path = lockPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.takeover`, '4005\n');
    takeOver(path, 4001, () => false, 4003);
    assert.equal(existsSync(`${path}.takeover`), false);
  });

  it('lets one process at a time hold a lock that a dead process left', async () => {
    const path = lockPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${await exitedProcessPid()}\n`);
    const inside = `${path}.inside`;
    const source = `
      import { acquireLock } from ${JSON.stringify(lockModule)};
      import { rmSync, writeFileSync } from 'node:fs';
      for (let round = 0; round < ${ROUNDS}; round += 1) {
        const unlock = await acquireLock({ path: ${JSON.stringify(path)}, pollMs: 2 });
        writeFileSync(${JSON.stringify(inside)}, 'x', { flag: 'wx' });
        await new Promise((resolve) => setTimeout(resolve, 5));
        rmSync(${JSON.stringify(inside)});
        unlock();
      }
    `;
    const racers = Array.from({ length: RACERS }, () => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => (stderr += chunk));
      return new Promise((resolve) => child.on('exit', (code) => resolve({ code, stderr })));
    });
    for (const { code, stderr } of await Promise.all(racers)) assert.equal(code, 0, stderr);
    assert.deepEqual(readdirSync(dirname(path)), []);
  });
});

describe('processIsAlive', () => {
  it('is true for this process and false for an exited one', async () => {
    assert.equal(processIsAlive(process.pid), true);
    const child = spawn(process.execPath, ['-e', '']);
    const pid = /** @type {number} */ (child.pid);
    await new Promise((resolve) => child.on('exit', resolve));
    assert.equal(processIsAlive(pid), false);
  });
});

describe('withLock', () => {
  it('holds the lock while the task runs and returns its result', async () => {
    const path = lockPath();
    const result = await withLock(
      async () => {
        assert.equal(readFileSync(path, 'utf8').trim(), String(process.pid));
        return 'done';
      },
      { path },
    );
    assert.equal(result, 'done');
    assert.equal(existsSync(path), false);
  });

  it('releases the lock when the task throws', async () => {
    const path = lockPath();
    await assert.rejects(
      withLock(
        async () => {
          throw new Error('step failed');
        },
        { path },
      ),
      /step failed/,
    );
    assert.equal(existsSync(path), false);
  });
});

describe('needsLock', () => {
  it('is true for a local run', () => {
    assert.equal(needsLock({ env: {} }), true);
  });

  it('is false in CI', () => {
    assert.equal(needsLock({ env: { CI: 'true' } }), false);
  });

  it('is true when CI is empty, 0, or false', () => {
    for (const CI of ['', '0', 'false', 'FALSE'])
      assert.equal(needsLock({ env: { CI } }), true, CI);
  });

  it('is false for a run against a URL, which starts no backend or server', () => {
    assert.equal(needsLock({ env: { E2E_BASE_URL: 'https://example.netlify.app' } }), false);
  });
});

describe('runE2e', () => {
  const e2eModule = new URL('./e2e.mjs', import.meta.url).href;

  function startRunE2eWithFakeStep(path, stepScript) {
    const source = `
      import { runE2e } from ${JSON.stringify(e2eModule)};
      const plan = () => [{ name: 'fake', command: process.execPath, args: ['-e', ${JSON.stringify(stepScript)}], env: process.env }];
      process.exitCode = await runE2e([], { env: {}, plan, lock: { path: ${JSON.stringify(path)}, pollMs: 5 } });
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = { stderr: '' };
    child.stderr.on('data', (chunk) => (output.stderr += chunk));
    const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
    return { child, exited, output };
  }

  async function until(condition) {
    for (let i = 0; i < 400 && !condition(); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(condition(), 'timed out');
  }

  it('holds the lock during the steps and releases it when they succeed', async () => {
    const path = lockPath();
    const run = startRunE2eWithFakeStep(path, `setTimeout(() => {}, 300)`);
    await until(() => existsSync(path));
    assert.equal(await run.exited, 0);
    assert.equal(existsSync(path), false);
  });

  it('releases the lock when a step fails and reports its exit code', async () => {
    const path = lockPath();
    const run = startRunE2eWithFakeStep(path, 'process.exit(3)');
    assert.equal(await run.exited, 3);
    assert.match(run.output.stderr, /e2e: fake failed \(exit 3\)/);
    assert.equal(existsSync(path), false);
  });

  it('releases the lock on SIGINT and stops the step', async () => {
    const path = lockPath();
    const run = startRunE2eWithFakeStep(path, 'setTimeout(() => {}, 60000)');
    await until(() => existsSync(path));
    await new Promise((resolve) => setTimeout(resolve, 200));
    run.child.kill('SIGINT');
    assert.equal(await run.exited, 130);
    assert.equal(existsSync(path), false);
  });

  it('a second run waits for the first, naming its PID, and runs after', async () => {
    const path = lockPath();
    const first = startRunE2eWithFakeStep(path, `setTimeout(() => {}, 600)`);
    await until(() => existsSync(path));
    const holder = readFileSync(path, 'utf8').trim();
    const second = startRunE2eWithFakeStep(path, '');
    await until(() => second.output.stderr.includes('waiting'));
    assert.match(second.output.stderr, new RegExp(`process ${holder} `));
    assert.equal(await first.exited, 0);
    assert.equal(await second.exited, 0);
    assert.equal(existsSync(path), false);
  });
});
