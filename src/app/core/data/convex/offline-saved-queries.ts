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

export interface OfflineSavedQuery {
  readonly query: FunctionReference<'query'>;
  readonly returns: GenericValidator;
  /**
   * Bump it when the result keeps its shape but changes meaning (a field now holds something else), so copies saved by the earlier
   * build are dropped. A shape change needs no bump: `returns` catches it.
   */
  readonly version: number;
}

function savedQuery<Q extends FunctionReference<'query'>>(
  query: Q,
  returns: Validator<FunctionReturnType<Q>, 'required', string>,
  version: number,
): OfflineSavedQuery {
  return { query, returns, version };
}

/**
 * A query is listed only if it is deliberately public (no `ctx.auth` check) and its result does not depend on the caller, so a saved
 * copy never holds signed-in or per-user data. A query that reads the caller's identity, or ever may, is never listed.
 */
export const OFFLINE_SAVED_QUERIES: readonly OfflineSavedQuery[] = [
  savedQuery(api.organizations.getPublicPage, getPublicPageReturns, 1),
  // Each (slug, page) is its own saved copy, so the page opens offline with page 1 of each list; another page opens offline once it has been viewed.
  savedQuery(api.organizations.listPublicLeagues, publicLeaguesValidator, 1),
  savedQuery(api.organizations.listPublicLocations, publicLocationsValidator, 1),
  // The page also keeps `organizations.getPublicPage` for its sidebar, so it opens offline once all three have been viewed together.
  savedQuery(api.leagues.getPublicPage, getLeaguePublicPageReturns, 1),
  savedQuery(api.seasons.listPublic, publicSeasonsValidator, 1),
  // The page also keeps `organizations.getPublicPage` for its sidebar, so it opens offline once both have been viewed together.
  savedQuery(api.seasons.getPublicPage, getSeasonPublicPageReturns, 1),
];
