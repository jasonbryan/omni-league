import type { FunctionReference, FunctionReturnType } from 'convex/server';
import type { GenericValidator, Validator } from 'convex/values';
import {
  getLeaguePublicPageReturns,
  getPublicPageReturns,
  getSeasonPublicPageReturns,
  publicLeagueFacetsValidator,
  publicLeaguesValidator,
  publicLocationsValidator,
  publicOpenSeasonsValidator,
  publicSeasonsValidator,
  searchLeaguesValidator,
  searchOrganizationsValidator,
} from '../../../../../convex/lib/publicPage';
import { api } from './api';

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

const ORGANIZATION_PAGE_QUERIES: readonly OfflineSavedQuery[] = [
  savedQuery(api.organizations.getPublicPage, getPublicPageReturns, 1),
  savedQuery(api.organizations.listPublicLeagues, publicLeaguesValidator, 1),
  savedQuery(api.organizations.listPublicLocations, publicLocationsValidator, 1),
  savedQuery(api.seasons.listOpenForOrganization, publicOpenSeasonsValidator, 1),
  savedQuery(api.organizations.listPublicLeagueFacets, publicLeagueFacetsValidator, 1),
];

const LEAGUE_PAGE_QUERIES: readonly OfflineSavedQuery[] = [
  savedQuery(api.leagues.getPublicPage, getLeaguePublicPageReturns, 1),
  savedQuery(api.seasons.listPublic, publicSeasonsValidator, 1),
];

const SEASON_PAGE_QUERIES: readonly OfflineSavedQuery[] = [
  savedQuery(api.seasons.getPublicPage, getSeasonPublicPageReturns, 1),
];

const FIND_PAGE_QUERIES: readonly OfflineSavedQuery[] = [
  savedQuery(api.search.leagues, searchLeaguesValidator, 1),
  savedQuery(api.search.organizations, searchOrganizationsValidator, 1),
];

/**
 * A query is listed only if it is deliberately public (no `ctx.auth` check) and its result does not depend on the caller, so a saved
 * copy never holds signed-in or per-user data. A query that reads the caller's identity, or ever may, is never listed.
 */
export const OFFLINE_SAVED_QUERIES: readonly OfflineSavedQuery[] = [
  ...ORGANIZATION_PAGE_QUERIES,
  ...LEAGUE_PAGE_QUERIES,
  ...SEASON_PAGE_QUERIES,
  ...FIND_PAGE_QUERIES,
];
