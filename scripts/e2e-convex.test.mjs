// Unit tests for scripts/e2e-convex.mjs and scripts/e2e.mjs (#59). Run with `npm run test:scripts`.
// No Convex CLI or backend runs: each case uses a temporary project directory and stubs.
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  assertLocalTarget,
  assertNoSharedState,
  assertPortsFree,
  BACKEND,
  convexCliEnv,
  DEPLOYMENT_NAME,
  devArgs,
  E2E_SITE_URL,
  isListening,
  LOCAL_CONVEX_URL,
  main,
  previewOriginPattern,
  PROJECT_DIR,
  readLocalDeployment,
  resolveTarget,
  ROOT,
  runConvex,
  seedDemoCalls,
  SHARED_STATE_DIRNAME,
} from './e2e-convex.mjs';
import { e2ePlan } from './e2e.mjs';

const ADMIN_KEY = 'anonymous-agent|sentinel-admin-key-0c5d';
const CLOUD_ENV_LOCAL =
  'CONVEX_DEPLOYMENT=dev:fake-cloud-123 # team: x, project: y\n' +
  'CONVEX_URL=https://fake-cloud-123.convex.cloud\n';

const temps = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A temporary e2e project dir; `config` is written as the CLI's local deployment config. */
function projectDir({ config, envLocal } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-convex-test-'));
  temps.push(dir);
  if (config !== undefined) {
    mkdirSync(join(dir, '.convex', 'local', 'default'), { recursive: true });
    writeFileSync(join(dir, '.convex', 'local', 'default', 'config.json'), JSON.stringify(config));
  }
  if (envLocal !== undefined) writeFileSync(join(dir, '.env.local'), envLocal);
  return dir;
}

const LOCAL_CONFIG = {
  ports: { cloud: 3210, site: 3211 },
  backendVersion: BACKEND.backendVersion,
  adminKey: ADMIN_KEY,
  instanceSecret: 'sentinel-instance-secret',
  deploymentName: 'anonymous-agent',
};

describe('pinned backend (one place: e2e/support/convex-backend.json)', () => {
  it('pins a backend release and the local ports', () => {
    const json = JSON.parse(readFileSync(join(ROOT, 'e2e', 'support', 'convex-backend.json')));
    assert.deepEqual(BACKEND, json);
    assert.match(BACKEND.backendVersion, /^precompiled-\d{4}-\d{2}-\d{2}-[0-9a-f]{7}$/);
    assert.equal(BACKEND.cloudPort, 3210);
    assert.equal(BACKEND.sitePort, 3211);
    assert.equal(LOCAL_CONVEX_URL, 'http://127.0.0.1:3210');
  });

  it('runs the CLI from its own project dir, never the repository root', () => {
    assert.equal(PROJECT_DIR, join(ROOT, '.convex-e2e'));
  });

  it('passes the pinned version, ports, and the anonymous selection to convex dev', () => {
    const args = devArgs({ once: true });
    assert.equal(args[0], 'dev');
    assert.ok(args.includes('--once'));
    const flag = (name) => args[args.indexOf(name) + 1];
    assert.equal(flag('--local-backend-version'), BACKEND.backendVersion);
    assert.equal(flag('--local-cloud-port'), '3210');
    assert.equal(flag('--local-site-port'), '3211');
    assert.equal(flag('--env-file'), 'select.env');
    assert.equal(devArgs({ once: false }).includes('--once'), false);
  });
});

describe('convexCliEnv', () => {
  it('drops every CONVEX_ variable from the caller and selects anonymous mode', () => {
    const env = convexCliEnv({
      PATH: '/bin',
      CONVEX_DEPLOYMENT: 'dev:fake-cloud-123',
      CONVEX_DEPLOY_KEY: 'prod:sentinel',
      CONVEX_SELF_HOSTED_URL: 'https://fake.example',
      CONVEX_SELF_HOSTED_ADMIN_KEY: 'sentinel',
      CONVEX_OVERRIDE_ACCESS_TOKEN: 'sentinel',
      CONVEX_URL: 'https://fake-cloud-123.convex.cloud',
      CONVEX_AGENT_MODE: 'something-else',
    });
    assert.deepEqual(env, { PATH: '/bin', CONVEX_AGENT_MODE: 'anonymous' });
  });
});

describe('assertLocalTarget (the target check)', () => {
  const good = { url: LOCAL_CONVEX_URL, deploymentName: DEPLOYMENT_NAME, projectDir: PROJECT_DIR };

  it('accepts the anonymous local backend in the e2e project dir', () => {
    assert.doesNotThrow(() => assertLocalTarget(good));
  });

  for (const [why, change] of [
    ['a cloud URL', { url: 'https://fake-cloud-123.convex.cloud' }],
    ['another local port', { url: 'http://127.0.0.1:3220' }],
    ['localhost instead of 127.0.0.1', { url: 'http://localhost:3210' }],
    ['a cloud deployment name', { deploymentName: 'fake-cloud-123' }],
    ['a dev: deployment', { deploymentName: 'dev:fake-cloud-123' }],
    ['another anonymous deployment', { deploymentName: 'anonymous-omni-league' }],
    ['the repository root (where .env.local lives)', { projectDir: ROOT }],
  ]) {
    it(`refuses ${why}`, () => {
      assert.throws(() => assertLocalTarget({ ...good, ...change }), /refused/);
    });
  }
});

describe('readLocalDeployment', () => {
  it('reads the CLI config of the e2e project dir and never .env.local', () => {
    const dir = projectDir({ config: LOCAL_CONFIG, envLocal: CLOUD_ENV_LOCAL });
    assert.deepEqual(readLocalDeployment(dir), {
      url: LOCAL_CONVEX_URL,
      deploymentName: 'anonymous-agent',
      adminKey: ADMIN_KEY,
    });
  });

  it('fails when only a .env.local (naming a cloud deployment) exists', () => {
    const dir = projectDir({ envLocal: CLOUD_ENV_LOCAL });
    assert.throws(() => readLocalDeployment(dir), /no local deployment/);
  });
});

describe('resolveTarget', () => {
  const answering = (name) => async () => name;

  it('resolves the local backend when the running backend has the expected name', async () => {
    const dir = projectDir({ config: LOCAL_CONFIG });
    const target = await resolveTarget({
      projectDir: dir,
      expectedProjectDir: dir,
      instanceName: answering('anonymous-agent'),
    });
    assert.equal(target.url, LOCAL_CONVEX_URL);
  });

  it('refuses when the CLI config names another port', async () => {
    const dir = projectDir({ config: { ...LOCAL_CONFIG, ports: { cloud: 3220, site: 3221 } } });
    await assert.rejects(
      resolveTarget({
        projectDir: dir,
        expectedProjectDir: dir,
        instanceName: answering('anonymous-agent'),
      }),
      /refused/,
    );
  });

  it('refuses when the backend on the port is another deployment', async () => {
    const dir = projectDir({ config: LOCAL_CONFIG });
    await assert.rejects(
      resolveTarget({
        projectDir: dir,
        expectedProjectDir: dir,
        instanceName: answering('anonymous-omni-league'),
      }),
      /refused.*anonymous-omni-league/,
    );
  });
});

describe('runConvex', () => {
  /** A spawn stub that records calls and exits 0 with `stdout`. */
  function stubSpawn(stdout = '"ok"\n') {
    const calls = [];
    const spawnCli = async (args, options) => {
      calls.push({ args, options });
      return { code: 0, stdout, stderr: '' };
    };
    return { calls, spawnCli };
  }

  it('runs env set and run with the explicit local target file, from the e2e project dir', async () => {
    const dir = projectDir({ config: LOCAL_CONFIG, envLocal: CLOUD_ENV_LOCAL });
    const { calls, spawnCli } = stubSpawn();
    const out = await runConvex(['run', 'testing:ping'], {
      projectDir: dir,
      expectedProjectDir: dir,
      instanceName: async () => 'anonymous-agent',
      spawnCli,
      env: { PATH: '/bin', CONVEX_DEPLOYMENT: 'dev:fake-cloud-123' },
    });
    assert.equal(out, '"ok"\n');
    assert.equal(calls.length, 1);
    const [{ args, options }] = calls;
    assert.deepEqual(args.slice(0, 3), ['run', 'testing:ping', '--env-file']);
    assert.equal(args.length, 4);
    assert.match(args[3], /^target-[0-9a-f-]+\.env$/);
    assert.equal(options.cwd, dir);
    assert.deepEqual(options.env, { PATH: '/bin', CONVEX_AGENT_MODE: 'anonymous' });
    // The call's own target file existed while the CLI ran (see the parallel test), and is gone.
    assert.equal(existsSync(join(dir, args[3])), false);
    // .env.local (a cloud deployment) is untouched.
    assert.equal(readFileSync(join(dir, '.env.local'), 'utf8'), CLOUD_ENV_LOCAL);
  });

  it('gives each call its own private target file, so parallel calls never race', async () => {
    const dir = projectDir({ config: LOCAL_CONFIG });
    const expected = `CONVEX_SELF_HOSTED_URL=${LOCAL_CONVEX_URL}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${ADMIN_KEY}\n`;
    const seen = [];
    let running = 0;
    let peak = 0;
    const spawnCli = async (args) => {
      const file = join(dir, args[args.indexOf('--env-file') + 1]);
      running += 1;
      peak = Math.max(peak, running);
      const before = readFileSync(file, 'utf8');
      // Yield so every other call starts (and, with a shared file, rewrites or removes it).
      await new Promise((resolve) => setTimeout(resolve, 20));
      const after = readFileSync(file, 'utf8');
      seen.push({ file, before, after, mode: statSync(file).mode & 0o777 });
      running -= 1;
      return { code: 0, stdout: '"ok"\n', stderr: '' };
    };
    const calls = Array.from({ length: 8 }, (_, index) =>
      runConvex(['run', 'testing:ping', JSON.stringify({ index })], {
        projectDir: dir,
        expectedProjectDir: dir,
        instanceName: async () => 'anonymous-agent',
        spawnCli,
        env: {},
      }),
    );
    assert.deepEqual(await Promise.all(calls), Array(8).fill('"ok"\n'));
    assert.equal(peak, 8, 'the calls overlapped');
    assert.equal(new Set(seen.map((entry) => entry.file)).size, 8, 'one target file per call');
    for (const entry of seen) {
      assert.equal(entry.before, expected);
      assert.equal(entry.after, expected);
      assert.equal(entry.mode, 0o600);
    }
    assert.deepEqual(
      readdirSync(dir).filter((name) => name.endsWith('.env')),
      [],
      'no target file is left behind',
    );
  });

  it('removes the target file when the CLI fails, and does not leak the admin key', async () => {
    const dir = projectDir({ config: LOCAL_CONFIG });
    const spawnCli = async () => ({ code: 1, stdout: '', stderr: `bad key ${ADMIN_KEY}\n` });
    await assert.rejects(
      runConvex(['run', 'testing:ping'], {
        projectDir: dir,
        expectedProjectDir: dir,
        instanceName: async () => 'anonymous-agent',
        spawnCli,
        env: {},
      }),
      (failure) => !failure.message.includes(ADMIN_KEY) && /<admin key>/.test(failure.message),
    );
    assert.deepEqual(
      readdirSync(dir).filter((name) => name.endsWith('.env')),
      [],
    );
  });

  it('never spawns the CLI when the target check refuses', async () => {
    const dir = projectDir({ config: { ...LOCAL_CONFIG, deploymentName: 'fake-cloud-123' } });
    const { calls, spawnCli } = stubSpawn();
    await assert.rejects(
      runConvex(['env', 'set', 'IS_TEST', 'true'], {
        projectDir: dir,
        expectedProjectDir: dir,
        instanceName: async () => 'fake-cloud-123',
        spawnCli,
        env: {},
      }),
      /refused/,
    );
    assert.equal(calls.length, 0);
  });

  it('accepts only env set and run', async () => {
    const dir = projectDir({ config: LOCAL_CONFIG });
    const { calls, spawnCli } = stubSpawn();
    await assert.rejects(
      runConvex(['deploy'], {
        projectDir: dir,
        expectedProjectDir: dir,
        instanceName: async () => 'anonymous-agent',
        spawnCli,
        env: {},
      }),
      /only `env set` and `run`/,
    );
    assert.equal(calls.length, 0);
  });
});

describe('assertNoSharedState (the CLI would select the shared anonymous-agent state)', () => {
  /** A temporary home with (or without) the shared state directory the CLI may select. */
  function home({ shared }) {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-convex-home-'));
    temps.push(dir);
    if (shared) mkdirSync(join(dir, ...SHARED_STATE_DIRNAME, DEPLOYMENT_NAME), { recursive: true });
    return dir;
  }

  it('names the legacy state under ~/.convex/anonymous-convex-backend-state', () => {
    assert.deepEqual(SHARED_STATE_DIRNAME, ['.convex', 'anonymous-convex-backend-state']);
  });

  it('refuses when the shared directory exists and the e2e dir has no local deployment', () => {
    const homeDir = home({ shared: true });
    const dir = projectDir();
    assert.throws(
      () => assertNoSharedState({ homeDir, projectDir: dir }),
      (failure) =>
        /refused/.test(failure.message) &&
        failure.message.includes(
          join(homeDir, '.convex', 'anonymous-convex-backend-state', 'anonymous-agent'),
        ),
    );
  });

  it('accepts when the shared directory is absent', () => {
    assert.doesNotThrow(() =>
      assertNoSharedState({ homeDir: home({ shared: false }), projectDir: projectDir() }),
    );
  });

  it('accepts when the e2e dir already has its own local deployment', () => {
    const dir = projectDir({ config: LOCAL_CONFIG });
    assert.doesNotThrow(() =>
      assertNoSharedState({ homeDir: home({ shared: true }), projectDir: dir }),
    );
  });
});

describe('ports', () => {
  /** Listens on 127.0.0.1 on a free port; returns the port and a close function. */
  async function listener() {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    return { port, close: () => new Promise((resolve) => server.close(resolve)) };
  }

  it('isListening is true while a process listens and false after it stops', async () => {
    const { port, close } = await listener();
    assert.equal(await isListening(port), true);
    await close();
    assert.equal(await isListening(port), false);
  });

  it('assertPortsFree names a port another process holds', async () => {
    const { port, close } = await listener();
    try {
      await assert.rejects(assertPortsFree([port]), new RegExp(`port ${port} is in use`));
    } finally {
      await close();
    }
  });
});

describe('seedDemoCalls (seed-demo)', () => {
  it('sets PREVIEW_ORIGIN_PATTERN to the given pattern, then runs seed:demo, both through runConvex', () => {
    const pattern = String.raw`^https://(main)--site\.netlify\.app$`;
    const calls = seedDemoCalls(pattern);
    assert.deepEqual(calls, [
      ['env', 'set', 'PREVIEW_ORIGIN_PATTERN', pattern],
      ['run', 'seed:demo'],
    ]);
    // Each call is one runConvex accepts (env set or run), so each goes through the target check.
    for (const args of calls) {
      assert.ok((args[0] === 'env' && args[1] === 'set') || args[0] === 'run', args.join(' '));
    }
  });
});

describe('previewOriginPattern (seed-demo)', () => {
  it('reads the constant from convex/lib/previewOrigin.ts with no module-type warning', () => {
    // A fresh process: Node warns once per file, and this test process may have loaded it.
    const script =
      `const { previewOriginPattern } = await import(${JSON.stringify(
        new URL('./e2e-convex.mjs', import.meta.url).href,
      )});\n` + 'process.stdout.write(await previewOriginPattern());';
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^\^https:\/\/.*netlify\\\.app\$$/);
    assert.equal(run.stderr, '');
  });

  it('restores process.emitWarning afterwards', async () => {
    const before = process.emitWarning;
    assert.equal(typeof (await previewOriginPattern()), 'string');
    assert.equal(process.emitWarning, before);
  });
});

describe('main', () => {
  for (const command of ['push', 'serve', 'setup', 'seed-demo', 'run']) {
    it(`${command} refuses with E2E_BASE_URL set and spawns nothing`, async () => {
      const spawned = [];
      const errors = [];
      const code = await main([command, 'testing:ping'], {
        env: { E2E_BASE_URL: 'https://example.netlify.app' },
        spawnCli: async (...args) => {
          spawned.push(args);
          return { code: 0, stdout: '', stderr: '' };
        },
        startCli: (...args) => {
          spawned.push(args);
          throw new Error('must not start');
        },
        log: () => {},
        error: (line) => errors.push(line),
      });
      assert.equal(code, 1);
      assert.equal(spawned.length, 0);
      assert.match(errors.join('\n'), /E2E_BASE_URL/);
    });
  }
});

describe('main setup (globalSetup, ADR 0005 "#7 (auth)", #62)', () => {
  /** A fake clock: `sleep` advances `now`, so a retry loop runs instantly and deterministically. */
  function fakeClock() {
    let time = 0;
    const sleeps = [];
    return {
      sleeps,
      now: () => time,
      sleep: async (ms) => {
        sleeps.push(ms);
        time += ms;
      },
    };
  }

  /**
   * Runs `setup` against a stub CLI; returns the CLI calls and everything printed. `failures`
   * maps an `env set` name to how many of its first attempts fail; `fail` is shorthand for
   * `{ [fail]: Infinity }`.
   */
  async function setup({ fail, failures = {}, stderr, clock = fakeClock(), randomBytes } = {}) {
    const dir = projectDir({ config: LOCAL_CONFIG });
    const calls = [];
    const lines = [];
    const remaining = new Map(Object.entries(fail ? { ...failures, [fail]: Infinity } : failures));
    const code = await main(['setup'], {
      env: {},
      projectDir: dir,
      instanceName: async () => 'anonymous-agent',
      ...(randomBytes && { randomBytes }),
      spawnCli: async (args) => {
        calls.push(args.slice(0, -2)); // without `--env-file <target>`
        // Like the real CLI (#191): a value that starts with `-` is parsed as an option.
        if (args[0] === 'env' && args[3]?.startsWith('-')) {
          return { code: 1, stdout: '', stderr: "error: unknown option '<redacted>'" };
        }
        const left = remaining.get(args[2]) ?? 0;
        if (left > 0) {
          remaining.set(args[2], left - 1);
          return {
            code: 1,
            stdout: '',
            // The default prints the `NAME=value` pair twice, to prove every occurrence is redacted.
            stderr:
              stderr ??
              `cannot set ${args.slice(2, 4).join('=')}\nretry: ${args.slice(2, 4).join('=')}`,
          };
        }
        const reset = { documents: 0, authDocuments: 3, scheduledFunctions: 0, files: 0 };
        return { code: 0, stdout: args[0] === 'run' ? JSON.stringify(reset) : '', stderr: '' };
      },
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
      wait: { ...clock },
    });
    return { code, calls, output: lines.join('\n'), clock };
  }

  it('sets IS_TEST, SITE_URL, and a new random BETTER_AUTH_SECRET, then resets', async () => {
    const first = await setup();
    assert.equal(first.code, 0);
    assert.deepEqual(
      first.calls.map((args) => args.slice(0, 3)),
      [
        ['env', 'set', 'IS_TEST'],
        ['env', 'set', 'SITE_URL'],
        ['env', 'set', 'BETTER_AUTH_SECRET'],
        ['run', 'testing:reset'],
      ],
    );
    assert.deepEqual(first.calls[0], ['env', 'set', 'IS_TEST', 'true']);
    assert.deepEqual(first.calls[1], ['env', 'set', 'SITE_URL', E2E_SITE_URL]);
    assert.equal(E2E_SITE_URL, 'http://localhost:4000');

    // Random per run, at least 256 bits, and never printed.
    const secret = first.calls[2][3];
    assert.match(secret, /^[0-9a-f]{64}$/);
    assert.ok(!first.output.includes(secret), 'the secret is printed');
    const second = await setup();
    assert.notEqual(second.calls[2][3], secret);
    assert.deepEqual(first.clock.sleeps, [], 'a backend that is ready costs no wait');
  });

  it('sets the secret when the random bytes would give a leading "-" in base64url (#191)', async () => {
    // 0xfb encodes to "-" as the first base64url character; the CLI reads such a value as an option.
    const bytes = Buffer.alloc(32, 0xfb);
    assert.ok(bytes.toString('base64url').startsWith('-'), 'the fixture forces a leading -');
    const { code, calls, output } = await setup({ randomBytes: () => bytes });
    assert.equal(code, 0, output);
    assert.deepEqual(
      calls.map((args) => args.slice(0, 3).join(' ')),
      ['env set IS_TEST', 'env set SITE_URL', 'env set BETTER_AUTH_SECRET', 'run testing:reset'],
    );
    const secret = calls[2][3];
    assert.ok(!secret.startsWith('-'), 'the secret can be read as an option');
    assert.ok(!output.includes(secret), 'the secret is printed');
  });

  it('never generates a secret that starts with "-", whatever the random bytes (#191)', async () => {
    for (const byte of [0x00, 0x7f, 0xfb, 0xff]) {
      const { code, calls } = await setup({ randomBytes: () => Buffer.alloc(32, byte) });
      assert.equal(code, 0);
      assert.match(calls[2][3], /^[0-9a-f]{64}$/);
    }
  });

  it('fails without printing the secret when setting it fails', async () => {
    const { code, calls, output } = await setup({ fail: 'BETTER_AUTH_SECRET' });
    assert.equal(code, 1);
    const secret = calls.find((args) => args[2] === 'BETTER_AUTH_SECRET')[3];
    assert.ok(!output.includes(secret), 'the secret is printed');
    assert.match(output, /BETTER_AUTH_SECRET/);
    // The reset never runs with the old secret's signing key left in place.
    assert.ok(calls.every((args) => args[0] !== 'run'));
  });

  it('retries `env set` while the backend is not ready: fails twice, then succeeds (#156)', async () => {
    const { code, calls, output, clock } = await setup({
      failures: { IS_TEST: 2, BETTER_AUTH_SECRET: 2 },
    });
    assert.equal(code, 0, output);
    assert.deepEqual(
      calls.map((args) => args.slice(0, 3).join(' ')),
      [
        ...Array(3).fill('env set IS_TEST'),
        'env set SITE_URL',
        ...Array(3).fill('env set BETTER_AUTH_SECRET'),
        'run testing:reset',
      ],
    );
    // One value for every attempt of a call: the secret is generated once, never printed.
    const secrets = calls.filter((args) => args[2] === 'BETTER_AUTH_SECRET').map((args) => args[3]);
    assert.equal(new Set(secrets).size, 1);
    assert.ok(!output.includes(secrets[0]), 'the secret is printed');
    // Backoff: each wait is longer than the last, and none is zero.
    assert.equal(clock.sleeps.length, 4);
    assert.ok(clock.sleeps.every((ms) => ms > 0));
    assert.ok(clock.sleeps[1] > clock.sleeps[0]);
  });

  it('times out with a clear message, naming the call and the wait, never the secret (#156)', async () => {
    const clock = fakeClock();
    const { code, calls, output } = await setup({ fail: 'BETTER_AUTH_SECRET', clock });
    assert.equal(code, 1);
    assert.match(output, /convex env set BETTER_AUTH_SECRET failed/);
    assert.match(output, /after 60 s/);
    assert.match(output, /not accepting admin requests/);
    const attempts = calls.filter((args) => args[2] === 'BETTER_AUTH_SECRET');
    assert.ok(attempts.length > 2, 'it retried');
    // The whole 60 s window is used (a shorter deadline would bring #156 back), in waits of at most 5 s.
    assert.equal(
      clock.sleeps.reduce((sum, ms) => sum + ms, 0),
      60_000,
      'it waits the full 60 s',
    );
    assert.ok(Math.max(...clock.sleeps) <= 5_000, 'no single wait is longer than 5 s');
    assert.ok(!output.includes(attempts[0][3]), 'the secret is printed');
    assert.ok(calls.every((args) => args[0] !== 'run'));
  });

  it('shows the last CLI error of the secret call on timeout, with the secret redacted', async () => {
    const clock = fakeClock();
    const { calls, output } = await setup({ fail: 'BETTER_AUTH_SECRET', clock });
    const secret = calls.find((args) => args[2] === 'BETTER_AUTH_SECRET')[3];
    // The stub's stderr prints `BETTER_AUTH_SECRET=<value>` twice; each one must end at the label.
    assert.match(output, /last error:[\s\S]*cannot set BETTER_AUTH_SECRET=<secret>$/m);
    assert.equal(output.match(/BETTER_AUTH_SECRET=<secret>$/gm)?.length, 2, 'both are redacted');
    assert.ok(!output.includes(secret), 'the secret is printed');
    for (let i = 0; i + 8 <= secret.length; i++) {
      assert.ok(!output.includes(secret.slice(i, i + 8)), `part of the secret is printed at ${i}`);
    }
  });

  it('shows the last CLI error of a non-secret call on timeout', async () => {
    const { code, output } = await setup({ fail: 'IS_TEST', stderr: 'backend is starting' });
    assert.equal(code, 1);
    assert.match(output, /convex env set IS_TEST failed/);
    assert.match(output, /backend is starting/);
  });

  it('does not retry a refused target (another deployment): it fails at once', async () => {
    const dir = projectDir({ config: LOCAL_CONFIG });
    const clock = fakeClock();
    const lines = [];
    const code = await main(['setup'], {
      env: {},
      projectDir: dir,
      instanceName: async () => 'some-other-deployment',
      spawnCli: async () => assert.fail('the CLI must not run against another backend'),
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
      wait: { timeoutMs: 60_000, ...clock },
    });
    assert.equal(code, 1);
    assert.match(lines.join('\n'), /refused/);
    assert.deepEqual(clock.sleeps, []);
  });

  it('retries while no backend answers yet', async () => {
    const dir = projectDir({ config: LOCAL_CONFIG });
    const clock = fakeClock();
    let probes = 0;
    const lines = [];
    const code = await main(['setup'], {
      env: {},
      projectDir: dir,
      instanceName: async () => {
        if (++probes <= 3)
          throw new Error('e2e-convex: no backend answers at http://127.0.0.1:3210');
        return 'anonymous-agent';
      },
      spawnCli: async (args) => ({
        code: 0,
        stdout: args[0] === 'run' ? '{"documents":0}' : '',
        stderr: '',
      }),
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
      wait: { timeoutMs: 60_000, ...clock },
    });
    assert.equal(code, 0, lines.join('\n'));
    assert.equal(clock.sleeps.length, 3);
  });
});

describe('seed-demo with a demo account password', () => {
  const THROWAWAY = 'throwaway local passphrase 2026';

  it('seedDemoCalls sets DEMO_ACCOUNT_PASSWORD between the pattern and the seed, only when given', () => {
    const pattern = '^x$';
    assert.deepEqual(seedDemoCalls(pattern, ''), seedDemoCalls(pattern));
    assert.deepEqual(seedDemoCalls(pattern, THROWAWAY), [
      ['env', 'set', 'PREVIEW_ORIGIN_PATTERN', pattern],
      ['env', 'set', 'DEMO_ACCOUNT_PASSWORD', THROWAWAY],
      ['run', 'seed:demo'],
    ]);
  });

  it('main passes the shell variable to the local backend only, and prints no value', async () => {
    const dir = projectDir({ config: LOCAL_CONFIG });
    const calls = [];
    const lines = [];
    const code = await main(['seed-demo'], {
      env: { DEMO_ACCOUNT_PASSWORD: THROWAWAY },
      projectDir: dir,
      instanceName: async () => 'anonymous-agent',
      spawnCli: async (args) => {
        calls.push(args.slice(0, 3));
        return { code: 0, stdout: args[0] === 'run' ? '{"accounts":{}}' : '', stderr: '' };
      },
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
    });
    assert.equal(code, 0, lines.join('\n'));
    assert.deepEqual(
      calls.map((args) => args.slice(0, 3)),
      [
        ['env', 'set', 'PREVIEW_ORIGIN_PATTERN'],
        ['env', 'set', 'DEMO_ACCOUNT_PASSWORD'],
        ['run', 'seed:demo', '--env-file'],
      ],
    );
    assert.ok(!lines.join('\n').includes(THROWAWAY));
  });

  it('main redacts the value from a failure the CLI echoes', async () => {
    const dir = projectDir({ config: LOCAL_CONFIG });
    const lines = [];
    const code = await main(['seed-demo'], {
      env: { DEMO_ACCOUNT_PASSWORD: THROWAWAY },
      projectDir: dir,
      instanceName: async () => 'anonymous-agent',
      spawnCli: async (args) =>
        args[2] === 'DEMO_ACCOUNT_PASSWORD'
          ? { code: 1, stdout: '', stderr: `bad value ${THROWAWAY}` }
          : { code: 0, stdout: '{}', stderr: '' },
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
    });
    assert.equal(code, 1);
    assert.ok(!lines.join('\n').includes(THROWAWAY));
  });
});

describe('main seed-demo (#82)', () => {
  it('checks the target like setup and run: the given project dir and instance name', async () => {
    const dir = projectDir({ config: LOCAL_CONFIG });
    const calls = [];
    const checked = [];
    const lines = [];
    const code = await main(['seed-demo'], {
      env: {},
      projectDir: dir,
      instanceName: async (url) => {
        checked.push(url);
        return 'anonymous-agent';
      },
      spawnCli: async (args, options) => {
        calls.push({ args: args.slice(0, -2), cwd: options.cwd });
        return { code: 0, stdout: args[0] === 'run' ? '{"organizations":4}' : '', stderr: '' };
      },
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
    });
    assert.equal(code, 0, lines.join('\n'));
    assert.deepEqual(
      calls.map(({ args }) => args.slice(0, 2)),
      [
        ['env', 'set'],
        ['run', 'seed:demo'],
      ],
    );
    // Both calls run from the e2e project dir given to main, after the target check.
    assert.deepEqual(
      calls.map(({ cwd }) => cwd),
      [dir, dir],
    );
    assert.deepEqual(checked, [LOCAL_CONVEX_URL, LOCAL_CONVEX_URL]);
  });

  it('refuses without spawning the CLI when the backend is another deployment', async () => {
    const dir = projectDir({ config: LOCAL_CONFIG });
    const spawned = [];
    const lines = [];
    const code = await main(['seed-demo'], {
      env: {},
      projectDir: dir,
      instanceName: async () => 'someone-elses-deployment',
      spawnCli: async (args) => {
        spawned.push(args);
        return { code: 0, stdout: '', stderr: '' };
      },
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
    });
    assert.equal(code, 1);
    assert.equal(spawned.length, 0);
    assert.match(lines.join('\n'), /refused/);
  });
});

describe('main with the backend port held by another process', () => {
  /** Holds 127.0.0.1:`port`; if something already holds it, the port is busy either way. */
  async function hold(port) {
    const server = createServer();
    const held = await new Promise((resolve, reject) => {
      server.once('error', (failure) =>
        failure.code === 'EADDRINUSE' ? resolve(false) : reject(failure),
      );
      server.listen(port, '127.0.0.1', () => resolve(true));
    });
    // `close` waits for open connections, so any client that connects while the port is held would
    // hang the release; destroy them.
    server.on('connection', (socket) => socket.destroy());
    return () => (held ? new Promise((resolve) => server.close(resolve)) : Promise.resolve());
  }

  for (const command of ['push', 'serve']) {
    it(`${command} fails before starting the CLI, so nothing is pushed`, async () => {
      const release = await hold(BACKEND.cloudPort);
      try {
        const started = [];
        const errors = [];
        const code = await main([command], {
          env: {},
          homeDir: mkdtempSync(join(tmpdir(), 'e2e-convex-home-')),
          projectDir: projectDir(),
          startCli: async (...args) => {
            started.push(args);
            return 0;
          },
          log: () => {},
          error: (line) => errors.push(line),
        });
        assert.equal(code, 1);
        assert.equal(started.length, 0);
        assert.match(errors.join('\n'), new RegExp(`port ${BACKEND.cloudPort} is in use`));
      } finally {
        await release();
      }
    });
  }
});

describe('main with shared anonymous-agent state in the home directory', () => {
  for (const command of ['push', 'serve']) {
    it(`${command} refuses, names the directory, and never starts the CLI`, async () => {
      const homeDir = mkdtempSync(join(tmpdir(), 'e2e-convex-home-'));
      temps.push(homeDir);
      const shared = join(homeDir, '.convex', 'anonymous-convex-backend-state', 'anonymous-agent');
      mkdirSync(shared, { recursive: true });
      const started = [];
      const errors = [];
      const code = await main([command], {
        env: {},
        homeDir,
        projectDir: projectDir(),
        startCli: async (...args) => {
          started.push(args);
          return 0;
        },
        log: () => {},
        error: (line) => errors.push(line),
      });
      assert.equal(code, 1);
      assert.equal(started.length, 0);
      assert.ok(errors.join('\n').includes(shared), errors.join('\n'));
    });
  }

  it('push proceeds when the e2e dir already has its own local deployment', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'e2e-convex-home-'));
    temps.push(homeDir);
    mkdirSync(join(homeDir, '.convex', 'anonymous-convex-backend-state', 'anonymous-agent'), {
      recursive: true,
    });
    const dir = projectDir({ config: LOCAL_CONFIG });
    const started = [];
    const code = await main(['push'], {
      env: {},
      homeDir,
      projectDir: dir,
      startCli: async (args, options) => {
        started.push({ args, options });
        return 0;
      },
      log: () => {},
      error: () => {},
      portsFree: async () => {},
    });
    assert.equal(code, 0);
    assert.equal(started.length, 1);
    assert.equal(started[0].options.cwd, dir);
  });
});

describe('e2ePlan (npm run e2e)', () => {
  const step = (plan, name) => plan.find((s) => s.name === name);

  it('locally: pushes to the local backend, builds with its URL, then runs Playwright', () => {
    const plan = e2ePlan({ env: { PATH: '/bin', CONVEX_URL: 'https://fake.convex.cloud' } }, [
      'e2e/smoke.spec.ts',
    ]);
    assert.deepEqual(
      plan.map((s) => s.name),
      ['convex push', 'build', 'playwright'],
    );
    assert.deepEqual(step(plan, 'convex push').args.slice(-1), ['push']);
    assert.equal(step(plan, 'build').env.CONVEX_URL, LOCAL_CONVEX_URL);
    assert.deepEqual(step(plan, 'build').args.slice(-3), [
      'build',
      '--configuration',
      'development',
    ]);
    assert.deepEqual(step(plan, 'playwright').args.slice(-2), ['test', 'e2e/smoke.spec.ts']);
  });

  it('with E2E_BASE_URL: no Convex step, and the build environment is the caller’s', () => {
    const env = { PATH: '/bin', E2E_BASE_URL: 'https://example.netlify.app' };
    const plan = e2ePlan({ env }, []);
    assert.deepEqual(
      plan.map((s) => s.name),
      ['build', 'playwright'],
    );
    for (const s of plan) assert.ok(!s.args.some((arg) => arg.includes('e2e-convex')));
    assert.deepEqual(step(plan, 'build').env, env);
  });
});
