// Unit tests for scripts/e2e-convex.mjs and scripts/e2e.mjs (#59). Run with `npm run test:scripts`.
// No Convex CLI or backend runs: each case uses a temporary project directory and stubs.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  assertLocalTarget,
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
    assert.deepEqual(args, ['run', 'testing:ping', '--env-file', 'target.env']);
    assert.equal(options.cwd, dir);
    assert.deepEqual(options.env, { PATH: '/bin', CONVEX_AGENT_MODE: 'anonymous' });
    const targetFile = readFileSync(join(dir, 'target.env'), 'utf8');
    assert.equal(
      targetFile,
      `CONVEX_SELF_HOSTED_URL=${LOCAL_CONVEX_URL}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${ADMIN_KEY}\n`,
    );
    // .env.local (a cloud deployment) is untouched.
    assert.equal(readFileSync(join(dir, '.env.local'), 'utf8'), CLOUD_ENV_LOCAL);
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
