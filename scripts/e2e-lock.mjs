// The lock file is created with a hard link so it never exists without its PID.
import { linkSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Under the home directory rather than the temp directory, which sandboxed sessions each set apart. */
export const DEFAULT_LOCK_PATH = join(homedir(), '.cache', 'omni-league', 'e2e.lock');
export const POLL_MS = 1_000;

/** @param {number} pid */
export function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
  }
}

function readHolder(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return undefined;
    throw error;
  }
  const pid = Number.parseInt(text, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
}

function tryCreateLock(path, pid) {
  mkdirSync(dirname(path), { recursive: true });
  const scratch = `${path}.${pid}.tmp`;
  writeFileSync(scratch, `${pid}\n`);
  try {
    linkSync(scratch, path);
    return true;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST') return false;
    throw error;
  } finally {
    rmSync(scratch, { force: true });
  }
}

// Two waiters that both see a dead holder must not both remove the lock: the second removal could
// discard the lock that the first waiter's successor just took. Only the holder of the guard
// removes it, and only if it still names the dead holder.
export function takeOver(path, deadPid, isAlive, ownPid) {
  const guard = `${path}.takeover`;
  if (!tryCreateLock(guard, ownPid)) {
    const guardHolder = readHolder(guard);
    if (guardHolder === 0 || (guardHolder !== undefined && !isAlive(guardHolder))) {
      rmSync(guard, { force: true });
    }
    return;
  }
  try {
    if (readHolder(path) === deadPid) rmSync(path, { force: true });
  } finally {
    rmSync(guard, { force: true });
  }
}

/**
 * @param {{
 *   path?: string,
 *   pid?: number,
 *   isAlive?: (pid: number) => boolean,
 *   pollMs?: number,
 *   onWait?: (holder: number) => void,
 *   signal?: AbortSignal,
 * }} [options]
 * @returns {Promise<() => void>}
 */
export async function acquireLock({
  path = DEFAULT_LOCK_PATH,
  pid = process.pid,
  isAlive = processIsAlive,
  pollMs = POLL_MS,
  onWait = () => {},
  signal,
} = {}) {
  let announced;
  for (;;) {
    signal?.throwIfAborted();
    if (tryCreateLock(path, pid)) return () => release(path, pid);
    const holder = readHolder(path);
    if (holder === undefined) continue;
    if (holder === pid) return () => release(path, pid);
    if (holder === 0 || !isAlive(holder)) {
      takeOver(path, holder, isAlive, pid);
      continue;
    }
    if (announced !== holder) {
      announced = holder;
      onWait(holder);
    }
    await sleep(pollMs, signal);
  }
}

export function release(path, pid) {
  if (readHolder(path) !== pid) return;
  try {
    unlinkSync(path);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
  }
}

/** @param {number} ms @param {AbortSignal} [signal] */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve(undefined);
    }
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
  });
}

/**
 * @template T
 * @param {() => Promise<T>} task
 * @param {Parameters<typeof acquireLock>[0]} [options]
 * @returns {Promise<T>}
 */
export async function withLock(task, options) {
  const releaseLock = await acquireLock(options);
  // A process that exits without unwinding (an uncaught error elsewhere) still frees the lock.
  const onExit = () => releaseLock();
  process.on('exit', onExit);
  try {
    return await task();
  } finally {
    process.off('exit', onExit);
    releaseLock();
  }
}
