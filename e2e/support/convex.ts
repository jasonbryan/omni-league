import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from '@playwright/test';

/** Playwright runs from the repository root. */
export const E2E_CONVEX_SCRIPT = join(process.cwd(), 'scripts', 'e2e-convex.mjs');

type RunFunction = (name: string, args: Record<string, unknown>) => Promise<unknown>;

// The script is an ES module with a top-level `await`: a static import fails under Playwright's
// loader, and `require` throws ERR_REQUIRE_ASYNC_MODULE.
let runFunction: Promise<RunFunction> | undefined;

function loadRunFunction(): Promise<RunFunction> {
  runFunction ??= import(pathToFileURL(E2E_CONVEX_SCRIPT).href).then(
    (script: { runFunction: RunFunction }) => script.runFunction,
  );
  return runFunction;
}

/**
 * One request to the local backend's `/api/function`, after the script's check that the target is
 * the anonymous local backend. Local runs only: it refuses when E2E_BASE_URL is set. The name is
 * sent as given, so it is `module:function`.
 */
export async function convexRun(
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  // A step puts each call's duration in the JSON report and the trace; a worker fixture has no test
  // to hold one.
  return inATest()
    ? test.step(`convexRun ${name}`, () => runOnce(name, args))
    : runOnce(name, args);
}

function inATest(): boolean {
  try {
    test.info();
    return true;
  } catch {
    return false;
  }
}

async function runOnce(name: string, args: Record<string, unknown>): Promise<unknown> {
  return (await loadRunFunction())(name, args);
}
