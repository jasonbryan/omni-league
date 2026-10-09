// `noindex` on non-production Netlify builds (#15, ADR 0010 item 6). Node built-ins only.
// Netlify's own X-Robots-Tag on previews is undocumented, and netlify.toml [[headers]] cannot be
// limited to a context, so `scripts/ng-convex.mjs build` decides from Netlify's CONTEXT:
// - static files: it writes `_headers` into the publish directory (Netlify applies it to them);
// - server responses: it sets the `__NOINDEX__` define, read by `src/server-robots.ts`.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * True for every Netlify build context except production (`deploy-preview`, `branch-deploy`, and
 * any other); false for `production` and when CONTEXT is unset or empty (a local build).
 *
 * @param {string | undefined} context
 */
export function noindexForContext(context) {
  return typeof context === 'string' && context !== '' && context !== 'production';
}

export const NOINDEX_HEADERS_FILE =
  '# Written by scripts/ng-convex.mjs for non-production Netlify builds only (#15).\n' +
  '/*\n' +
  '  X-Robots-Tag: noindex\n';

/** Writes the `_headers` file into `publishDir`. */
export async function writeNoindexHeaders(publishDir) {
  await writeFile(join(publishDir, '_headers'), NOINDEX_HEADERS_FILE);
}
