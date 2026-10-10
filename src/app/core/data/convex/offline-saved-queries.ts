import type { FunctionReference, FunctionReturnType } from 'convex/server';
import type { GenericValidator, Validator } from 'convex/values';
import { api } from '../../../../../convex/_generated/api';
import { getPublicPageReturns } from '../../../../../convex/lib/publicPage';

/** A query on the saved-copy allow-list, with what a saved copy of it must match. */
export interface OfflineSavedQuery {
  readonly query: FunctionReference<'query'>;
  /**
   * The query's own `returns` validator, imported from where the Convex function takes it, never
   * restated. A saved copy that does not match it is not shown, and is removed.
   */
  readonly returns: GenericValidator;
  /**
   * Stored with each saved copy; a copy with another version is not shown, and is removed. Bump it
   * when the result keeps its shape but changes meaning (a field now holds something else), so
   * copies saved by the earlier build are dropped. A shape change needs no bump: `returns` catches
   * it.
   */
  readonly version: number;
}

/**
 * An allow-list entry. `returns` must be a validator of the query's own result type, so the build
 * fails when the query's result changes and the entry still names an older validator.
 */
function savedQuery<Q extends FunctionReference<'query'>>(
  query: Q,
  returns: Validator<FunctionReturnType<Q>, 'required', string>,
  version: number,
): OfflineSavedQuery {
  return { query, returns, version };
}

/**
 * The queries whose live results the browser keeps as saved copies (ADR 0013 section 3, #82).
 *
 * A query is listed only if it is deliberately public (no `ctx.auth` check, Convex conventions,
 * Functions) and its result does not depend on the caller, so a saved copy never holds signed-in
 * or per-user data, whoever was signed in when it was written. A query that reads the caller's
 * identity, or ever may, is never listed. Each public page adds its own query in its own issue
 * (schedules, standings).
 */
export const OFFLINE_SAVED_QUERIES: readonly OfflineSavedQuery[] = [
  // #100 (PR #140) drops `locations` and `leagues` from this result. Whichever PR merges second
  // changes the result in convex/lib/publicPage.ts only; this entry then follows it, copies in the
  // earlier shape stop matching and are removed, and `version` stays 1. The paged queries #100 adds
  // show offline only if they join this list, each with its own `returns` from convex/lib/.
  savedQuery(api.organizations.getPublicPage, getPublicPageReturns, 1),
];
