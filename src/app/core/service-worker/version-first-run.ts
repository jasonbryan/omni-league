/** `localStorage` key of the record: `{ [ngsw version hash]: first-run time in epoch ms }`. */
export const FIRST_RUN_STORAGE_KEY = 'omni-league:sw-version-first-run';
/** The record keeps this many versions, the most recently first run; older ones are dropped. */
export const FIRST_RUN_MAX_ENTRIES = 10;

type FirstRuns = Record<string, number>;

function read(): FirstRuns {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FIRST_RUN_STORAGE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number' && isFinite(entry[1]),
      ),
    );
  } catch {
    // No storage (blocked, private mode) or a value that is not JSON.
    return {};
  }
}

/**
 * When the version `hash` was first run on this device, recording `now` when it has no record yet.
 * With no usable storage every version counts as first run `now`, so the app never forces a reload.
 * The value holds only version hashes and times, nothing about the user.
 */
export function firstRunOf(hash: string, now: number): number {
  const runs = read();
  const known = runs[hash];
  if (known !== undefined) return known;
  runs[hash] = now;
  const kept = Object.entries(runs)
    .sort(([, a], [, b]) => b - a)
    .slice(0, FIRST_RUN_MAX_ENTRIES);
  try {
    localStorage.setItem(FIRST_RUN_STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Full or blocked storage: the record is skipped, as above.
  }
  return now;
}
