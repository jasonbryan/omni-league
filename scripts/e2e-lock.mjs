// A machine-wide lock for local e2e runs. Node built-ins only.
//
// Every local e2e run binds the same ports (3210, 3211, 4000) and resets the same backend, so two
// runs on one machine cannot overlap. A run takes the lock before it starts anything and releases
// it when it ends. The lock is a file holding the owner's PID: it is created with a hard link, so
// the file never exists without its content, and a lock whose PID is gone is taken over.
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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

/** The PID in the lock file, or undefined when the file is missing or holds no PID. */
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

/** Creates the lock file holding `pid`; false when it already exists. */
function tryCreate(path, pid) {
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

/**
 * Moves a dead holder's lock out of the way. The rename takes whichever file is at `path` now, so
 * when another waiter already replaced the dead lock with a live one, that file goes back.
 */
function takeOver(path, deadPid, isAlive, ownPid) {
  const moved = `${path}.stale.${ownPid}`;
  try {
    renameSync(path, moved);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return;
    throw error;
  }
  const holder = readHolder(moved);
  if (holder !== undefined && holder !== deadPid && isAlive(holder)) {
    try {
      linkSync(moved, path);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
    }
  }
  rmSync(moved, { force: true });
}

/**
 * Waits for the lock and takes it. Resolves to a `release` function that removes the lock only
 * while it still names `pid`. Rejects when `signal` aborts first.
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
    if (tryCreate(path, pid)) return () => release(path, pid);
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

/** Removes the lock when it names `pid`. */
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
 * Runs `task` while holding the lock; the lock is released when `task` returns or throws.
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
