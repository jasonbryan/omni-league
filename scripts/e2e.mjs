// A local run holds the machine-wide lock from before the push until the last step ends, because
// every local run uses the same ports and resets the same backend.
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { join } from 'node:path';
import { LOCAL_CONVEX_URL, remoteBaseUrl, ROOT } from './e2e-convex.mjs';
import { withLock } from './e2e-lock.mjs';

export function e2ePlan({ env }, playwrightArgs) {
  const remote = remoteBaseUrl(env) !== undefined;
  const node = process.execPath;
  const steps = [];
  if (!remote) {
    steps.push({
      name: 'convex push',
      command: node,
      args: [join(ROOT, 'scripts', 'e2e-convex.mjs'), 'push'],
      env,
    });
  }
  steps.push({
    name: 'build',
    command: node,
    args: [join(ROOT, 'scripts', 'ng-convex.mjs'), 'build', '--configuration', 'development'],
    // Locally the bundle must name the local backend, never a CONVEX_URL from the shell or
    // `.env.local` (scripts/ng-convex.mjs reads the environment first).
    env: remote ? env : { ...env, CONVEX_URL: LOCAL_CONVEX_URL },
  });
  steps.push({
    name: 'playwright',
    command: node,
    args: [join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', ...playwrightArgs],
    env,
  });
  return steps;
}

function runStep(step) {
  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, { env: step.env, stdio: 'inherit' });
    const forward = (signal) => child.kill(signal);
    process.on('SIGINT', forward);
    process.on('SIGTERM', forward);
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      process.off('SIGINT', forward);
      process.off('SIGTERM', forward);
      resolve(signal ? 128 + constants.signals[signal] : (code ?? 1));
    });
  });
}

export function needsLock({ env }) {
  const ci = !['', '0', 'false'].includes((env.CI ?? '').toLowerCase());
  return remoteBaseUrl(env) === undefined && !ci;
}

/**
 * @param {string[]} playwrightArgs
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   lock?: Parameters<typeof withLock>[1],
 *   plan?: typeof e2ePlan,
 * }} [options]
 */
export async function runE2e(
  playwrightArgs,
  { env = process.env, lock = {}, plan = e2ePlan } = {},
) {
  const abort = new AbortController();
  let received;
  const stop = (signal) => {
    received ??= signal;
    abort.abort();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const steps = async () => {
    for (const step of plan({ env }, playwrightArgs)) {
      if (received) break;
      const code = await runStep(step);
      if (code !== 0) {
        console.error(`e2e: ${step.name} failed (exit ${code})`);
        return code;
      }
    }
    return received ? 128 + constants.signals[received] : 0;
  };
  try {
    if (!needsLock({ env })) return await steps();
    return await withLock(steps, {
      signal: abort.signal,
      onWait: (holder) =>
        console.error(`e2e: waiting for the e2e run of process ${holder} to finish`),
      ...lock,
    });
  } catch (error) {
    if (abort.signal.aborted && received) return 128 + constants.signals[received];
    throw error;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

if (import.meta.main) {
  process.exitCode = await runE2e(process.argv.slice(2));
}
