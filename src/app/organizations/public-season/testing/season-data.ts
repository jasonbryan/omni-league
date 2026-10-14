import type { PublicOrganizationHeader } from '../../organization-path';
import { ORGANIZATION } from '../../public-league/testing/league-data';
import type { PublicSeasonData, PublicSeasonView } from '../public-season-view';

export { ORGANIZATION };

export const SUMMER_2027: PublicSeasonData = {
  organization: { name: ORGANIZATION.name, slug: ORGANIZATION.slug },
  league: {
    name: 'Sunday Reverse Coed 4s',
    slug: 'sunday-reverse-coed-4s',
    sportName: 'Beach volleyball',
    locationNames: ['North Beach Sand Courts'],
  },
  name: 'Summer 2027',
  slug: 'summer-2027',
  startDate: '2027-06-06',
  endDate: '2027-08-29',
  formatName: '4 v 4',
  minimumRosterSize: 4,
};

export function seasonQueryResults(
  options: {
    season?: PublicSeasonData | null;
    organization?: PublicOrganizationHeader | null;
  } = {},
): Record<string, unknown> {
  return {
    'organizations:getPublicPage':
      options.organization === undefined ? ORGANIZATION : options.organization,
    'seasons:getPublicPage': options.season === undefined ? SUMMER_2027 : options.season,
  };
}

export const SUMMER_2027_VIEW: PublicSeasonView = {
  organization: ORGANIZATION,
  season: SUMMER_2027,
};
