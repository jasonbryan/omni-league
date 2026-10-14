import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it, mock } from 'node:test';
import { chooseStagingSlot, runStagingSlot } from './staging-slot.mjs';

const PRIME_URL = 'https://main--charming-longma-28c00d.netlify.app';

function respond(body, status = 200) {
  return async () => new Response(body, { status });
}

function capture() {
  const out = [];
  const err = [];
  return { out, err, stdout: (text) => out.push(text), stderr: (text) => err.push(text) };
}

describe('chooseStagingSlot', () => {
  for (const [body, expected] of [
    ['staging-a', 'staging-b'],
    ['staging-a\n', 'staging-b'],
    ['staging-b', 'staging-a'],
    ['staging-b\n', 'staging-a'],
  ]) {
    it(`serves ${JSON.stringify(body)}, so the build uses ${expected}`, async () => {
      const result = await chooseStagingSlot({
        primeUrl: PRIME_URL,
        fetch: respond(body),
      });
      assert.deepEqual(result, { slot: expected });
    });
  }

  it('fetches /staging-slot.txt of the prime URL, whatever trailing slash it has', async () => {
    const urls = [];
    const fetch = async (url) => {
      urls.push(String(url));
      return new Response('staging-a');
    };
    await chooseStagingSlot({ primeUrl: PRIME_URL, fetch });
    await chooseStagingSlot({ primeUrl: `${PRIME_URL}/`, fetch });
    assert.deepEqual(urls, [`${PRIME_URL}/staging-slot.txt`, `${PRIME_URL}/staging-slot.txt`]);
  });

  for (const primeUrl of [undefined, '', 'not a url']) {
    it(`falls back to staging-a when DEPLOY_PRIME_URL is ${JSON.stringify(primeUrl)}`, async () => {
      const result = await chooseStagingSlot({
        primeUrl,
        fetch: async () => assert.fail('must not fetch'),
      });
      assert.equal(result.slot, 'staging-a');
      assert.match(result.reason, /^[^\n]+$/);
    });
  }

  it('falls back on a 404, a 500, and a network error', async () => {
    for (const fetch of [
      respond('staging-b', 404),
      respond('staging-b', 500),
      async () => {
        throw new TypeError('fetch failed');
      },
    ]) {
      const result = await chooseStagingSlot({ primeUrl: PRIME_URL, fetch });
      assert.equal(result.slot, 'staging-a');
      assert.match(result.reason, /^[^\n]+$/);
    }
  });

  for (const body of [
    'main',
    '',
    ' staging-a',
    'staging-a\n\n',
    'staging-a\nstaging-b',
    'staging-a ',
  ]) {
    it(`falls back on the invalid body ${JSON.stringify(body)}`, async () => {
      const result = await chooseStagingSlot({ primeUrl: PRIME_URL, fetch: respond(body) });
      assert.equal(result.slot, 'staging-a');
      assert.match(result.reason, /^[^\n]+$/);
      assert.ok(!result.reason.includes(body.trim() || '\0'), 'the body is not echoed');
    });
  }

  it('falls back when the fetch takes more than 10 seconds', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let signal;
      const fetch = (_url, init) => {
        signal = init.signal;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason));
        });
      };
      const pending = chooseStagingSlot({ primeUrl: PRIME_URL, fetch });
      mock.timers.tick(9_999);
      assert.equal(signal.aborted, false);
      mock.timers.tick(1);
      const result = await pending;
      assert.equal(signal.aborted, true);
      assert.equal(result.slot, 'staging-a');
      assert.match(result.reason, /10 s|timed out/);
    } finally {
      mock.timers.reset();
    }
  });

  it('falls back when the body stalls after the headers arrive', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const fetch = async (_url, init) => {
        const body = new ReadableStream({
          start(controller) {
            init.signal.addEventListener('abort', () => controller.error(init.signal.reason));
          },
        });
        return new Response(body, { status: 200 });
      };
      const pending = chooseStagingSlot({ primeUrl: PRIME_URL, fetch });
      await new Promise((resolve) => setImmediate(resolve));
      mock.timers.tick(10_000);
      const result = await pending;
      assert.equal(result.slot, 'staging-a');
    } finally {
      mock.timers.reset();
    }
  });
});

describe('runStagingSlot', () => {
  it('writes only the slot and a newline to stdout, and nothing to stderr', async () => {
    const io = capture();
    const code = await runStagingSlot({
      env: { DEPLOY_PRIME_URL: PRIME_URL },
      fetch: respond('staging-a\n'),
      ...io,
    });
    assert.equal(code, 0);
    assert.equal(io.out.join(''), 'staging-b\n');
    assert.deepEqual(io.err, []);
  });

  it('writes the reason to stderr only, and exits 0, when it falls back', async () => {
    const io = capture();
    const code = await runStagingSlot({
      env: { DEPLOY_PRIME_URL: PRIME_URL },
      fetch: respond('main'),
      ...io,
    });
    assert.equal(code, 0);
    assert.equal(io.out.join(''), 'staging-a\n');
    assert.equal(io.err.length, 1);
    assert.match(io.err[0], /^[^\n]+\n$/);
  });
});

describe('scripts/staging-slot.mjs as a process', () => {
  it('prints staging-a alone on stdout, a reason on stderr, and exits 0 without DEPLOY_PRIME_URL', () => {
    const env = { ...process.env, DEPLOY_PRIME_URL: '' };
    const run = spawnSync(process.execPath, [join(import.meta.dirname, 'staging-slot.mjs')], {
      env,
      encoding: 'utf8',
    });
    assert.equal(run.status, 0);
    assert.equal(run.stdout, 'staging-a\n');
    assert.match(run.stderr, /^staging-slot: [^\n]+\n$/);
  });
});
