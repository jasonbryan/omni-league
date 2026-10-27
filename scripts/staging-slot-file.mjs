// A static file in the publish directory, so Netlify serves it without the edge function and the
// next staging build can read it.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const STAGING_SLOTS = ['staging-a', 'staging-b'];
export const STAGING_SLOT_FILE = 'staging-slot.txt';

/**
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
