import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LOCAL_CONVEX_URL } from './env';
import timeouts from './convex-timeouts.json';

/** Playwright runs from the repository root. */
export const E2E_CONVEX_SCRIPT = join(process.cwd(), 'scripts', 'e2e-convex.mjs');

/** The script's own timeout (`testCallTimeoutMs`) fires first and cleans up; this one is the backstop. */
export const CONVEX_RUN_TIMEOUT_MS = timeouts.testCallTimeoutMs + timeouts.backstopGraceMs;

/**
 * The call goes through `scripts/e2e-convex.mjs run`, which refuses any target other than the
 * anonymous local backend. Local runs only: it refuses when E2E_BASE_URL is set.
 */
export async function convexRun(
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)(
      process.execPath,
      [E2E_CONVEX_SCRIPT, 'run', name, JSON.stringify(args)],
      { encoding: 'utf8', timeout: CONVEX_RUN_TIMEOUT_MS },
    ));
  } catch (failure) {
    if ((failure as { killed?: boolean }).killed) {
      throw new Error(
        `convexRun ${name} got no answer within ${CONVEX_RUN_TIMEOUT_MS / 1000} s: the local ` +
          `backend at ${LOCAL_CONVEX_URL} (convex-local-backend) may be stalled`,
        { cause: failure },
      );
    }
    throw failure;
  }
  // The CLI prints nothing for a function that returns `null`.
  const text = stdout.trim();
  return text === '' ? null : (JSON.parse(text) as unknown);
}
