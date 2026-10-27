// The slot goes to stdout alone so `STAGING_SLOT="$(node scripts/staging-slot.mjs)"` captures only
// it; every reason goes to stderr.
import { STAGING_SLOT_FILE, STAGING_SLOTS } from './staging-slot-file.mjs';

const FETCH_TIMEOUT_MS = 10_000;
const FALLBACK_SLOT = STAGING_SLOTS[0];

/**
 * @param {{ primeUrl?: string, fetch?: typeof fetch, timeoutMs?: number }} options
 * @returns {Promise<{ slot: string, reason?: string }>}
 */
export async function chooseStagingSlot({
  primeUrl,
  fetch: fetchSlot = fetch,
  timeoutMs = FETCH_TIMEOUT_MS,
}) {
  const fallback = (/** @type {string} */ reason) => ({ slot: FALLBACK_SLOT, reason });
  if (!primeUrl) return fallback('DEPLOY_PRIME_URL is not set');
  let url;
  try {
    url = new URL(`/${STAGING_SLOT_FILE}`, primeUrl);
  } catch {
    return fallback('DEPLOY_PRIME_URL is not a valid URL');
  }

  // Not AbortSignal.timeout: fake timers cannot fake it, and the 10 s tests need them.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let body;
  try {
    const response = await fetchSlot(url, { signal: controller.signal, cache: 'no-store' });
    if (response.status !== 200) {
      return fallback(`${STAGING_SLOT_FILE} answered ${response.status}`);
    }
    body = await response.text();
  } catch {
    return fallback(
      controller.signal.aborted
        ? `${STAGING_SLOT_FILE} timed out after ${timeoutMs / 1000} s`
        : `${STAGING_SLOT_FILE} could not be fetched`,
    );
  } finally {
    clearTimeout(timer);
  }

  const served = STAGING_SLOTS.find((slot) => body === slot || body === `${slot}\n`);
  if (served === undefined) return fallback(`${STAGING_SLOT_FILE} is not a slot name`);
  return { slot: STAGING_SLOTS.find((slot) => slot !== served) ?? FALLBACK_SLOT };
}

/**
 * @param {{ env: NodeJS.ProcessEnv, fetch?: typeof fetch, stdout: (text: string) => void, stderr: (text: string) => void }} io
 * @returns {Promise<number>} the exit code
 */
export async function runStagingSlot({ env, fetch: fetchSlot, stdout, stderr }) {
  const { slot, reason } = await chooseStagingSlot({
    primeUrl: env.DEPLOY_PRIME_URL,
    fetch: fetchSlot,
  });
  if (reason) stderr(`staging-slot: ${reason}; using ${slot}\n`);
  stdout(`${slot}\n`);
  return 0;
}

if (import.meta.main) {
  process.exitCode = await runStagingSlot({
    env: process.env,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
}
