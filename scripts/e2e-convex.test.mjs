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
  isListening,
  LOCAL_CONVEX_URL,
  main,
  PROJECT_DIR,
  readLocalDeployment,
  resolveTarget,
  ROOT,
  runConvex,
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

describe('main', () => {
  for (const command of ['push', 'serve', 'setup', 'run']) {
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
