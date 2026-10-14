// Staging alternates between two Convex deployments so a merge never deletes the backend the
// published frontend uses. Each branch deploy publishes the slot it was built for as a static
// file, and the next build reads it to pick the other slot (`scripts/staging-slot.mjs`).
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const STAGING_SLOTS = ['staging-a', 'staging-b'];
export const STAGING_SLOT_FILE = 'staging-slot.txt';

/**
 * Written only for the staging build, into the publish directory, so Netlify serves it as a static
 * file beside the app.
 * @param {string} publishDir
 * @param {{ CONTEXT?: string, STAGING_SLOT?: string }} env
 * @returns {Promise<boolean>} whether the file was written
 */
export async function writeStagingSlotFile(publishDir, env) {
  const slot = env.STAGING_SLOT;
  if (env.CONTEXT !== 'branch-deploy' || !STAGING_SLOTS.includes(slot ?? '')) return false;
  await writeFile(join(publishDir, STAGING_SLOT_FILE), `${slot}\n`);
  return true;
}
