// The anonymous local Convex backend for e2e (ADR 0005 as amended by ADR 0009, #59). Node built-ins
// only. Every Convex CLI call of the e2e run goes through this file:
//
//   node scripts/e2e-convex.mjs push             `convex dev --once`: push functions, run codegen
//   node scripts/e2e-convex.mjs serve            `convex dev`: the backend (Playwright webServer)
//   node scripts/e2e-convex.mjs setup            globalSetup: `env set` IS_TEST, SITE_URL, and a new
//                                                random BETTER_AUTH_SECRET; `run testing:reset`.
//                                                Each `env set` retries with backoff for up to 60 s
//                                                while the backend does not accept admin requests (#156)
//   node scripts/e2e-convex.mjs run <fn> [json]  `run` one test function; prints its JSON result
//   node scripts/e2e-convex.mjs seed-demo        `env set PREVIEW_ORIGIN_PATTERN`, `run seed:demo`:
//                                                the demo data of a production-build PWA run (#82).
//                                                With DEMO_ACCOUNT_PASSWORD set in the shell (a
//                                                throwaway, never the owner's), it is set on the local
//                                                backend first, so the demo accounts exist (#98)
//
// TARGETING (security). The CLI follows `.env.local`, which may name a contributor's cloud dev
// deployment, and `convex dev` rewrites `.env.local`. So the CLI never runs from the repository
// root. It runs from its own project directory, `.convex-e2e/` (gitignored), whose `convex.json`
// points at `../convex/`; the CLI's `.env.local`, `.gitignore`, and backend state stay there.
// - Every variable named CONVEX_* is removed from the CLI's environment (a deploy key, a deployment
//   name, a self-hosted URL), and CONVEX_AGENT_MODE=anonymous is set.
// - `convex dev` selects the anonymous deployment with `--env-file select.env`, pinned to the
//   backend version and ports in e2e/support/convex-backend.json (the one place they live).
// - `env set` and `run` go through `runConvex`, which first checks the target: the CLI config in
//   `.convex-e2e/` must name the anonymous deployment on http://127.0.0.1:3210, and the backend
//   answering there must report that name. Only then does it call the CLI, with the explicit URL and
//   admin key in `--env-file target.env`. A backend of the same name from another checkout has
//   another admin key, so it rejects the call.
// - `push` and `serve` first check that ports 3210 and 3211 are free, so they never push to (and
//   Playwright never resets) a backend another session started.
// - With E2E_BASE_URL set, every command refuses: that run uses no local backend.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { constants, homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const ROOT = join(import.meta.dirname, '..');
/** The CLI's own project directory: never the repository root, where `.env.local` lives. */
export const PROJECT_DIR = join(ROOT, '.convex-e2e');
/** The pinned backend release and local ports (patch-level bump, no gate; ADR 0005). */
export const BACKEND = Object.freeze(
  JSON.parse(readFileSync(join(ROOT, 'e2e', 'support', 'convex-backend.json'), 'utf8')),
);
export const LOCAL_CONVEX_URL = `http://127.0.0.1:${BACKEND.cloudPort}`;
/** The e2e app's origin (e2e/support/env.ts LOCAL_BASE_URL), Better Auth's SITE_URL (ADR 0008). */
export const E2E_SITE_URL = 'http://localhost:4000';

/** The name the CLI gives the anonymous deployment when CONVEX_AGENT_MODE=anonymous. */
export const DEPLOYMENT_NAME = 'anonymous-agent';

const CLI = join(ROOT, 'node_modules', 'convex', 'bin', 'main.js');
const SELECT_FILE = 'select.env';
/** How long `setup` waits for the backend to accept an `env set` (#156), and the backoff steps. */
export const READY_TIMEOUT_MS = 60_000;
const BACKOFF_FIRST_MS = 250;
const BACKOFF_MAX_MS = 5_000;
/** Under the home directory, where an older CLI kept every checkout's anonymous deployments. */
export const SHARED_STATE_DIRNAME = Object.freeze(['.convex', 'anonymous-convex-backend-state']);
const USAGE =
  'usage: node scripts/e2e-convex.mjs <push|serve|setup|seed-demo|run <function> [json-args]>';

/**
 * The CLI calls of `seed-demo`, in order. `seed:demo` writes only where `PREVIEW_ORIGIN_PATTERN`
 * is the preview constant (convex/seed.ts), so the local backend gets that value first. It admits
 * only this project's Netlify preview origins, so it opens nothing on a local backend.
 */
export function seedDemoCalls(previewOriginPattern, demoAccountPassword = '') {
  return [
    ['env', 'set', 'PREVIEW_ORIGIN_PATTERN', previewOriginPattern],
    ...(demoAccountPassword === ''
      ? []
      : [['env', 'set', 'DEMO_ACCOUNT_PASSWORD', demoAccountPassword]]),
    ['run', 'seed:demo'],
  ];
}

/**
 * `PREVIEW_ORIGIN_PATTERN` from convex/lib/previewOrigin.ts, the single source (Node strips the
 * types of that one constant file). The repo's package.json has no `type`, so Node warns
 * `MODULE_TYPELESS_PACKAGE_JSON` when it reparses the file as a module; only that warning is held
 * back, for this one import.
 */
export async function previewOriginPattern() {
  const emitWarning = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const [options, code] = rest;
    const warningCode = typeof options === 'object' && options !== null ? options.code : code;
    if (warningCode === 'MODULE_TYPELESS_PACKAGE_JSON') return;
    return emitWarning.call(this, warning, ...rest);
  };
  try {
    return (await import('../convex/lib/previewOrigin.ts')).PREVIEW_ORIGIN_PATTERN;
  } finally {
    process.emitWarning = emitWarning;
  }
}

/** E2E_BASE_URL when it is a non-empty string (the same rule as e2e/support/env.ts). */
export function remoteBaseUrl(env) {
  const value = env['E2E_BASE_URL'];
  return value !== undefined && value !== '' ? value : undefined;
}

/** The CLI's environment: the caller's, minus every CONVEX_* variable, in anonymous mode. */
export function convexCliEnv(env) {
  const out = {};
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('CONVEX_') && value !== undefined) out[name] = value;
  }
  out['CONVEX_AGENT_MODE'] = 'anonymous';
  return out;
}

/** `convex dev` arguments: the anonymous deployment, the pinned version, the fixed ports. */
export function devArgs({ once }) {
  return [
    'dev',
    ...(once ? ['--once'] : []),
    '--env-file',
    SELECT_FILE,
    '--local-backend-version',
    BACKEND.backendVersion,
    '--local-cloud-port',
    String(BACKEND.cloudPort),
    '--local-site-port',
    String(BACKEND.sitePort),
    '--tail-logs',
    'disable',
    // `npm run typecheck` checks convex/ (convex/tsconfig.json); this checkout's CLI cannot.
    '--typecheck',
    'disable',
  ];
}

/**
 * Throws when the CLI would pick the shared `~/.convex/anonymous-convex-backend-state/anonymous-agent/`
 * (CLI 1.46 selects it for `anonymous:anonymous-agent` when it exists): `push` would then push into
 * that legacy deployment and `setup` would find no local deployment in `.convex-e2e/`. Fine once
 * `.convex-e2e/` has its own local deployment config.
 */
export function assertNoSharedState({ homeDir = homedir(), projectDir = PROJECT_DIR } = {}) {
  const shared = join(homeDir, ...SHARED_STATE_DIRNAME, DEPLOYMENT_NAME);
  const own = join(projectDir, '.convex', 'local', 'default', 'config.json');
  if (existsSync(shared) && !existsSync(own)) {
    throw new Error(
      `e2e-convex: refused: ${shared} exists (left by an older Convex CLI and shared by every checkout ` +
        `on this machine), so the CLI would select it instead of creating a deployment in ${projectDir}. ` +
        'Move or delete that directory (stop any backend using it first), then run again.',
    );
  }
}

/**
 * An error a retry cannot fix (a refused target, a missing deployment config). `retryUntilReady`
 * rethrows it at once; any other error may be a backend that is still starting.
 */
function permanent(message) {
  return Object.assign(new Error(message), { permanent: true });
}

/**
 * Runs `attempt` until it succeeds, retrying any non-permanent failure with exponential backoff
 * until `timeoutMs` has passed. On timeout it throws one error naming `label` and the wait, then
 * the last failure's text with every occurrence of `redact` (a secret the call was setting) removed.
 */
export async function retryUntilReady(
  attempt,
  { label, redact = '', timeoutMs = READY_TIMEOUT_MS, sleep = defaultSleep, now = Date.now },
) {
  const start = now();
  let delay = BACKOFF_FIRST_MS;
  for (;;) {
    let failure;
    try {
      return await attempt();
    } catch (caught) {
      failure = caught;
    }
    if (failure?.permanent) throw failure;
    const remaining = timeoutMs - (now() - start);
    if (remaining <= 0) {
      // No `cause`: only the redacted text may reach the output.
      const text = failure instanceof Error ? failure.message : String(failure);
      const last = redact ? text.split(redact).join('<secret>') : text;
      throw new Error(
        `e2e-convex: ${label} failed after ${Math.round(timeoutMs / 1000)} s: the local backend ` +
          `is not accepting admin requests\nlast error: ${last}`,
      );
    }
    await sleep(Math.min(delay, remaining));
    delay = Math.min(delay * 2, BACKOFF_MAX_MS);
  }
}

function defaultSleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/** Writes the CLI's project files into `dir` (idempotent). */
export function prepareProjectDir(dir = PROJECT_DIR) {
  mkdirSync(dir, { recursive: true });
  const files = {
    'package.json': { private: true, dependencies: { convex: '*' } },
    'convex.json': { functions: '../convex/', aiFiles: { enabled: false } },
  };
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), `${JSON.stringify(content, null, 2)}\n`);
  }
  writeFileSync(join(dir, SELECT_FILE), `CONVEX_DEPLOYMENT=anonymous:${DEPLOYMENT_NAME}\n`);
}

/**
 * The target check: throws unless the target is the anonymous local backend on
 * http://127.0.0.1:3210, read from the e2e project directory.
 */
export function assertLocalTarget({ url, deploymentName, projectDir }, expectedDir = PROJECT_DIR) {
  const problems = [];
  if (url !== LOCAL_CONVEX_URL) problems.push(`URL ${url} is not ${LOCAL_CONVEX_URL}`);
  if (deploymentName !== DEPLOYMENT_NAME) {
    problems.push(`deployment ${deploymentName} is not ${DEPLOYMENT_NAME}`);
  }
  if (resolve(projectDir) !== resolve(expectedDir)) {
    problems.push(`project directory ${projectDir} is not ${expectedDir}`);
  }
  if (problems.length > 0) {
    throw permanent(
      `e2e-convex: refused: ${problems.join('; ')}. The e2e run targets only the anonymous local backend.`,
    );
  }
}

/** The local deployment the CLI recorded in `projectDir`. Never reads `.env.local`. */
export function readLocalDeployment(projectDir) {
  const file = join(projectDir, '.convex', 'local', 'default', 'config.json');
  if (!existsSync(file)) {
    throw permanent(
      `e2e-convex: no local deployment in ${file}; run \`node scripts/e2e-convex.mjs push\` first`,
    );
  }
  const config = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof config.adminKey !== 'string' || !Number.isInteger(config.ports?.cloud)) {
    throw permanent(`e2e-convex: ${file} has no admin key or cloud port`);
  }
  return {
    url: `http://127.0.0.1:${config.ports.cloud}`,
    deploymentName: config.deploymentName,
    adminKey: config.adminKey,
  };
}

/** The instance name the backend at `url` reports. */
async function fetchInstanceName(url) {
  let response;
  try {
    response = await fetch(`${url}/instance_name`, { signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new Error(`e2e-convex: no backend answers at ${url}`);
  }
  if (!response.ok) throw new Error(`e2e-convex: ${url}/instance_name returned ${response.status}`);
  return (await response.text()).trim();
}

/** The checked target: the recorded deployment, which must also be the backend answering there. */
export async function resolveTarget({
  projectDir = PROJECT_DIR,
  expectedProjectDir = PROJECT_DIR,
  instanceName = fetchInstanceName,
} = {}) {
  const deployment = readLocalDeployment(projectDir);
  assertLocalTarget({ ...deployment, projectDir }, expectedProjectDir);
  const running = await instanceName(deployment.url);
  if (running !== deployment.deploymentName) {
    throw permanent(
      `e2e-convex: refused: the backend at ${deployment.url} is ${running}, not ${deployment.deploymentName}`,
    );
  }
  return deployment;
}

/** Runs the CLI with output captured (for `env set` and `run`). */
function captureCli(args, { cwd, env }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

/** Runs the CLI with inherited output until it exits, forwarding SIGINT and SIGTERM. */
function startCli(args, { cwd, env }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    let received = null;
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => {
        received ??= signal;
        child.kill(signal);
      });
    }
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      const terminatedBy = received ?? signal;
      resolvePromise(terminatedBy ? 128 + constants.signals[terminatedBy] : (code ?? 0));
    });
  });
}

/**
 * `convex env set` or `convex run` against the checked local target only: the target check runs
 * first, and the CLI gets the explicit URL and admin key. Returns the CLI's stdout.
 */
export async function runConvex(
  args,
  {
    projectDir = PROJECT_DIR,
    expectedProjectDir = PROJECT_DIR,
    instanceName = fetchInstanceName,
    spawnCli = captureCli,
    env = process.env,
  } = {},
) {
  if (!((args[0] === 'env' && args[1] === 'set') || args[0] === 'run')) {
    throw permanent('e2e-convex: only `env set` and `run` go through runConvex');
  }
  const target = await resolveTarget({ projectDir, expectedProjectDir, instanceName });
  // One file per call: concurrent calls (parallel Playwright workers) never share or truncate one.
  const targetFile = `target-${randomUUID()}.env`;
  writeFileSync(
    join(projectDir, targetFile),
    `CONVEX_SELF_HOSTED_URL=${target.url}\nCONVEX_SELF_HOSTED_ADMIN_KEY=${target.adminKey}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  let result;
  try {
    result = await spawnCli([...args, '--env-file', targetFile], {
      cwd: projectDir,
      env: convexCliEnv(env),
    });
  } finally {
    rmSync(join(projectDir, targetFile), { force: true });
  }
  if (result.code !== 0) {
    const detail = result.stderr.split(target.adminKey).join('<admin key>').trim();
    throw new Error(`e2e-convex: convex ${args.slice(0, 2).join(' ')} failed:\n${detail}`);
  }
  return result.stdout;
}

/** True when something accepts TCP connections on 127.0.0.1:`port`. */
export function isListening(port) {
  return new Promise((resolvePromise) => {
    const socket = connect({ port, host: '127.0.0.1' });
    const done = (listening) => {
      socket.destroy();
      resolvePromise(listening);
    };
    socket.setTimeout(2_000, () => done(true)); // no refusal: treat as taken
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Rejects, naming each port another process holds. */
export async function assertPortsFree(ports) {
  const busy = [];
  for (const port of ports) if (await isListening(port)) busy.push(port);
  if (busy.length > 0) {
    throw new Error(
      busy
        .map(
          (port) =>
            `e2e-convex: port ${port} is in use by another process (lsof -nP -iTCP:${port} -sTCP:LISTEN). ` +
            'The e2e run starts its own backend and never pushes to or resets one it did not start.',
        )
        .join('\n'),
    );
  }
}

/** Runs one command; returns the exit code. */
export async function main(
  argv,
  {
    env = process.env,
    spawnCli = captureCli,
    startCli: start = startCli,
    log = (line) => console.log(line),
    error = (line) => console.error(line),
    homeDir = homedir(),
    projectDir = PROJECT_DIR,
    instanceName,
    portsFree = assertPortsFree,
    wait = {},
    randomBytes: random = randomBytes,
  } = {},
) {
  const target = { env, spawnCli, projectDir, expectedProjectDir: projectDir, instanceName };
  const [command, ...rest] = argv;
  if (remoteBaseUrl(env) !== undefined) {
    error(
      'e2e-convex: refused: E2E_BASE_URL is set, so this run starts no Convex backend and makes no Convex CLI call',
    );
    return 1;
  }
  try {
    switch (command) {
      case 'push':
      case 'serve': {
        prepareProjectDir(projectDir);
        assertNoSharedState({ homeDir, projectDir });
        await portsFree([BACKEND.cloudPort, BACKEND.sitePort]);
        log(
          `e2e-convex: convex dev${command === 'push' ? ' --once' : ''} on the anonymous local ` +
            `backend ${BACKEND.backendVersion} at ${LOCAL_CONVEX_URL}`,
        );
        return await start(devArgs({ once: command === 'push' }), {
          cwd: projectDir,
          env: convexCliEnv(env),
        });
      }
      case 'setup': {
        // The webServer is up once `/version` answers, but the backend can still refuse admin
        // requests for a moment (#156), so each `env set` retries until it accepts one.
        const setEnv = (name, value, { redact = '' } = {}) =>
          retryUntilReady(() => runConvex(['env', 'set', name, value], target), {
            ...wait,
            label: `convex env set ${name}`,
            redact,
          });
        await setEnv('IS_TEST', 'true');
        await setEnv('SITE_URL', E2E_SITE_URL);
        // A new secret every run (ADR 0005, ADR 0008), so none is stored anywhere. It is never
        // printed: on failure only its name is. It is hex (256 bits), never base64url: a base64url
        // value starts with `-` in 1 run of 64, and `convex env set` reads that as an option (#191).
        // `testing:reset` then clears the component's `jwks`, whose signing key the previous run's
        // secret encrypted.
        const secret = random(32).toString('hex');
        await setEnv('BETTER_AUTH_SECRET', secret, { redact: secret });
        const reset = await runConvex(['run', 'testing:reset'], target);
        log(
          `e2e-convex: IS_TEST=true, SITE_URL=${E2E_SITE_URL}, and a new BETTER_AUTH_SECRET on ` +
            `${LOCAL_CONVEX_URL}; testing:reset deleted ${JSON.stringify(JSON.parse(reset))}`,
        );
        return 0;
      }
      case 'seed-demo': {
        let inserted = '';
        const password = env['DEMO_ACCOUNT_PASSWORD'] ?? '';
        try {
          for (const args of seedDemoCalls(await previewOriginPattern(), password)) {
            inserted = await runConvex(args, target);
          }
        } catch (failure) {
          // Only the redacted text may reach the output; no `cause`.
          const text = failure instanceof Error ? failure.message : String(failure);
          // eslint-disable-next-line preserve-caught-error -- a cause would carry the unredacted text.
          throw new Error(password === '' ? text : text.split(password).join('<secret>'));
        }
        log(
          `e2e-convex: seed:demo on ${LOCAL_CONVEX_URL} inserted ` +
            JSON.stringify(JSON.parse(inserted)),
        );
        return 0;
      }
      case 'run': {
        const [name, json] = rest;
        if (name === undefined || rest.length > 2) {
          error(USAGE);
          return 2;
        }
        log((await runConvex(['run', name, ...(json ? [json] : [])], target)).trim());
        return 0;
      }
      default:
        error(USAGE);
        return 2;
    }
  } catch (failure) {
    error(failure instanceof Error ? failure.message : String(failure));
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
