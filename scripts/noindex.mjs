// Netlify's own X-Robots-Tag on previews is undocumented, and netlify.toml [[headers]] cannot be
// limited to a context, so `ng-convex.mjs build` decides from Netlify's CONTEXT: static files get a
// `_headers` file, and server responses get the `__NOINDEX__` define, read by `src/server-robots.ts`.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** @param {string | undefined} context */
export function noindexForContext(context) {
  return typeof context === 'string' && context !== '' && context !== 'production';
}

export const NOINDEX_HEADERS_FILE =
  '# Written by scripts/ng-convex.mjs for non-production Netlify builds only.\n' +
  '/*\n' +
  '  X-Robots-Tag: noindex\n';

export async function writeNoindexHeaders(publishDir) {
  await writeFile(join(publishDir, '_headers'), NOINDEX_HEADERS_FILE);
}
