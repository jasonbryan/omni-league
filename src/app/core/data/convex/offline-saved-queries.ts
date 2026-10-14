import type { FunctionReference, FunctionReturnType } from 'convex/server';
import type { GenericValidator, Validator } from 'convex/values';
import { api } from '../../../../../convex/_generated/api';
import {
  getLeaguePublicPageReturns,
  getPublicPageReturns,
  getSeasonPublicPageReturns,
  publicLeaguesValidator,
  publicLocationsValidator,
  publicSeasonsValidator,
} from '../../../../../convex/lib/publicPage';

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
 * (schedules, standings); the league page's (#127) and the season page's (#128) are listed below.
 */
export const OFFLINE_SAVED_QUERIES: readonly OfflineSavedQuery[] = [
  savedQuery(api.organizations.getPublicPage, getPublicPageReturns, 1),
  // The organization page's lists (#100). Each (slug, page) is its own saved copy, so the page
  // opens offline with page 1 of each list; another page opens offline once it has been viewed.
  savedQuery(api.organizations.listPublicLeagues, publicLeaguesValidator, 1),
  savedQuery(api.organizations.listPublicLocations, publicLocationsValidator, 1),
  // The public league page (#127): the league's header and each page of its published seasons,
  // each (slugs, page) its own saved copy. The page also keeps `organizations.getPublicPage`
  // (above) for the breadcrumb, so it opens offline once all three have been viewed together.
  savedQuery(api.leagues.getPublicPage, getLeaguePublicPageReturns, 1),
  savedQuery(api.seasons.listPublic, publicSeasonsValidator, 1),
  // The public season page: the season with its league, organization name, and slug.
  savedQuery(api.seasons.getPublicPage, getSeasonPublicPageReturns, 1),
];
