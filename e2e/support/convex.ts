import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

/** Playwright runs from the repository root. */
export const E2E_CONVEX_SCRIPT = join(process.cwd(), 'scripts', 'e2e-convex.mjs');

/**
 * The call goes through `scripts/e2e-convex.mjs run`, which refuses any target other than the
 * anonymous local backend. Local runs only: it refuses when E2E_BASE_URL is set.
 */
export async function convexRun(
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [E2E_CONVEX_SCRIPT, 'run', name, JSON.stringify(args)],
    { encoding: 'utf8' },
  );
  // The CLI prints nothing for a function that returns `null`.
  const text = stdout.trim();
  return text === '' ? null : (JSON.parse(text) as unknown);
}
