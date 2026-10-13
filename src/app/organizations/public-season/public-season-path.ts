import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../../convex/_generated/api';
import type { PublicOrganizationHeader } from '../organization-path';

/** A found season's page data, as `seasons:getPublicPage` returns it. */
export type PublicSeasonData = NonNullable<FunctionReturnType<typeof api.seasons.getPublicPage>>;

/**
 * What the public season page shows (#128): the organization's header (for the sidebar's sports
 * and totals) and the season with its league.
 */
export interface PublicSeasonView {
  organization: PublicOrganizationHeader;
  season: PublicSeasonData;
}
