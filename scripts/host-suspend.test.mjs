import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { runE2e } from './e2e.mjs';
import { at, fakeHost } from './host-suspend-fake.mjs';
import { clockTime, reportSuspensions, SUSPEND_GAP_MS, TICK_MS } from './host-suspend.mjs';

describe('reportSuspensions', () => {
  async function run(during) {
    const host = fakeHost();
    const lines = [];
    await reportSuspensions(async () => during(host), {
      ...host.clocks,
      error: (line) => lines.push(line),
    });
    return lines;
  }

  it('prints a line at once for a 901 s interval, then a summary after the step', async () => {
    const lines = [];
    const host = fakeHost();
    await reportSuspensions(
      async () => {
        host.elapse(TICK_MS);
        host.elapse(TICK_MS + 901_000);
        assert.equal(lines.length, 1, 'the line is out before the step ends');
        host.elapse(TICK_MS);
      },
      { ...host.clocks, error: (line) => lines.push(line) },
    );
    assert.deepEqual(lines, [
      'e2e: the host was suspended for 901 s (01:40:45 to 01:55:47, from Date.now()) during the ' +
        'playwright step; tests running then time out',
      'e2e: the host was suspended 1 time (901 s in all) during the playwright step; rerun the ' +
        'failures with the host awake',
    ]);
  });

  it('counts every suspension in the summary', async () => {
    const lines = await run((host) => {
      host.elapse(TICK_MS + 901_000);
      host.elapse(TICK_MS);
      host.elapse(TICK_MS + 1_046_000);
    });
    assert.equal(lines.length, 3);
    assert.match(lines[2], /^e2e: the host was suspended 2 times \(1947 s in all\) during the/);
  });

  it('prints nothing for an 11 s interval, which is the tick plus the gap limit', async () => {
    assert.equal(TICK_MS + SUSPEND_GAP_MS, 11_000);
    assert.deepEqual(await run((host) => host.elapse(11_000)), []);
  });

  it('prints a line for a 12 s interval', async () => {
    const lines = await run((host) => host.elapse(12_000));
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^e2e: the host was suspended for 11 s \(/);
  });

  it('prints nothing for ordinary ticks', async () => {
    assert.deepEqual(
      await run((host) => {
        for (let i = 0; i < 30; i++) host.elapse(TICK_MS);
      }),
      [],
    );
  });

  it('prints nothing when only the wall clock jumps', async () => {
    const lines = await run((host) => {
      host.elapse(TICK_MS);
      host.stepWallClock(3_600_000);
      host.elapse(TICK_MS);
      host.stepWallClock(-7_200_000);
      host.elapse(TICK_MS);
    });
    assert.deepEqual(lines, []);
  });

  it('counts a suspension that ended the step before any tick saw it', async () => {
    const lines = await run((host) => {
      // The clock moves with no tick, as when the step ends right at the wake.
      host.jump(31_000);
    });
    assert.equal(lines.length, 2);
  });

  it('stops the tick when the step throws, and still prints the summary', async () => {
    const host = fakeHost();
    const lines = [];
    await assert.rejects(
      reportSuspensions(
        async () => {
          host.elapse(TICK_MS + 60_000);
          throw new Error('step failed');
        },
        { ...host.clocks, error: (line) => lines.push(line) },
      ),
      /step failed/,
    );
    assert.equal(host.ticking, false);
    assert.equal(lines.length, 2);
  });
});

describe('clockTime', () => {
  it('is the local time of day as hh:mm:ss', () => {
    assert.equal(clockTime(at(1, 5, 9)), '01:05:09');
    assert.equal(clockTime(at(14, 54, 10)), '14:54:10');
  });
});

describe('runE2e and the playwright step', () => {
  const dirs = [];
  after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  /** Each stub step appends its name to `order`, and the fake interval appends when it starts and stops. */
  function stubRun(exitCodes = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'host-suspend-'));
    dirs.push(dir);
    const order = join(dir, 'order');
    const host = fakeHost();
    const note = (entry) => appendFileSync(order, `${entry}\n`);
    const step = (name) => ({
      name,
      command: process.execPath,
      args: ['-e', `require('fs').appendFileSync(${JSON.stringify(order)}, '${name}\\n');`],
      env: process.env,
    });
    const failing = (name) => ({
      ...step(name),
      args: [
        '-e',
        `require('fs').appendFileSync(${JSON.stringify(order)}, '${name}\\n'); process.exit(${exitCodes[name]});`,
      ],
    });
    const lines = [];
    const clocks = {
      ...host.clocks,
      setInterval: (callback, ms) => {
        note('tick start');
        return host.clocks.setInterval(callback, ms);
      },
      clearInterval: (timer) => {
        note('tick stop');
        host.clocks.clearInterval(timer);
      },
      error: (line) => lines.push(line),
    };
    const names = ['convex push', 'build', 'playwright'];
    const options = {
      env: { E2E_BASE_URL: 'http://localhost:4000' },
      plan: () => names.map((name) => (exitCodes[name] ? failing(name) : step(name))),
      hostClocks: clocks,
    };
    const entries = () => readFileSync(order, 'utf8').trim().split('\n');
    return { options, entries, lines, host };
  }

  it('ticks only while the playwright step runs', async () => {
    const { options, entries } = stubRun();
    assert.equal(await runE2e([], options), 0);
    assert.deepEqual(entries(), ['convex push', 'build', 'tick start', 'playwright', 'tick stop']);
  });

  it('never ticks when a step before playwright fails', async () => {
    const { options, entries } = stubRun({ build: 4 });
    assert.equal(await runE2e([], options), 4);
    assert.deepEqual(entries(), ['convex push', 'build']);
  });

  it("keeps Playwright's exit code and prints the summary before the failure line", async () => {
    const { options, lines, host } = stubRun({ playwright: 1 });
    const failed = [];
    const originalError = console.error;
    console.error = (line) => failed.push(line);
    try {
      options.hostClocks.setInterval = (callback) => {
        host.clocks.setInterval(callback);
        host.elapse(TICK_MS + 60_000);
        return undefined;
      };
      assert.equal(await runE2e([], options), 1);
    } finally {
      console.error = originalError;
    }
    assert.equal(lines.length, 2, lines.join('\n'));
    assert.deepEqual(failed, ['e2e: playwright failed (exit 1)']);
  });
});
