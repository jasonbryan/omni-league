// Kept in `sessionStorage`, so a mark lasts for the tab and not for the page. With no usable storage the guard cannot tell a first reload from a repeat, so it allows none.
const RELOADED_FOR_KEY = 'omni-league:sw-reloaded-for';
const UNRECOVERABLE_KEY = 'omni-league:sw-unrecoverable-reloaded';
const MAX_HASHES = 10;

/** `null` when the storage cannot be read. A stored value that is not a list of hashes is an empty record. */
function readHashes(): string[] | null {
  let stored: string | null;
  try {
    stored = sessionStorage.getItem(RELOADED_FOR_KEY);
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(stored ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((hash): hash is string => typeof hash === 'string')
      : [];
  } catch {
    return [];
  }
}

export function mayReloadForVersion(hash: string): boolean {
  const hashes = readHashes();
  return hashes !== null && !hashes.includes(hash);
}

/** Returns false when the mark could not be kept; the caller must then not reload. */
export function recordReloadForVersion(hash: string): boolean {
  const hashes = readHashes();
  if (hashes === null) return false;
  try {
    sessionStorage.setItem(RELOADED_FOR_KEY, JSON.stringify([...hashes, hash].slice(-MAX_HASHES)));
    return true;
  } catch {
    return false;
  }
}

export function mayReloadForUnrecoverable(): boolean {
  try {
    return sessionStorage.getItem(UNRECOVERABLE_KEY) === null;
  } catch {
    return false;
  }
}

/** Returns false when the mark could not be kept; the caller must then not reload. */
export function recordReloadForUnrecoverable(): boolean {
  try {
    sessionStorage.setItem(UNRECOVERABLE_KEY, '1');
    return true;
  } catch {
    return false;
  }
}
