import { getFunctionName, type FunctionReference } from 'convex/server';
import { convexToJson, type Value } from 'convex/values';
import { OFFLINE_SAVED_QUERIES } from '../offline-saved-queries';
import { savedCopyKey } from '../saved-copies';

/**
 * Writes a saved copy of `value` for a listed `query` and `args` straight to `localStorage`, as
 * `ConvexSavedCopies.write` would at `savedAt` (with the entry's current version), or with the
 * fields in `stored` replacing those. Test-only.
 */
export function plantSavedCopy(
  query: FunctionReference<'query'>,
  args: object,
  value: unknown,
  savedAt: number,
  stored: Record<string, unknown> = {},
): void {
  const entry = OFFLINE_SAVED_QUERIES.find(
    (listed) => getFunctionName(listed.query) === getFunctionName(query),
  );
  localStorage.setItem(
    savedCopyKey(query, args),
    JSON.stringify({
      v: convexToJson(value as Value),
      savedAt,
      usedAt: savedAt,
      version: entry?.version,
      ...stored,
    }),
  );
}
