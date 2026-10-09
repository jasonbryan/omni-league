// `npm run e2e [-- <playwright test args>]` (ADR 0005, #13, #59). Node built-ins only.
//
// Local run: `convex dev --once` pushes the functions to the anonymous local backend
// (scripts/e2e-convex.mjs push), the development build compiles in that backend's URL, and
// `playwright test` starts the backend and the SSR server (playwright.config.ts).
// With E2E_BASE_URL set: no Convex step and no Convex URL override; the build runs as before and
// Playwright targets the given URL with no local server.
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { join } from 'node:path';
import { LOCAL_CONVEX_URL, remoteBaseUrl, ROOT } from './e2e-convex.mjs';

/** The steps of one e2e run, in order. */
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

/** Runs `step` with inherited output; resolves to its exit code (128 + n for a signal). */
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

if (import.meta.main) {
  for (const step of e2ePlan({ env: process.env }, process.argv.slice(2))) {
    const code = await runStep(step);
    if (code !== 0) {
      console.error(`e2e: ${step.name} failed (exit ${code})`);
      process.exit(code);
    }
  }
}
