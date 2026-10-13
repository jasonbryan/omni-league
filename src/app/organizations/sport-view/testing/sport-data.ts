import type { PublicOrganizationHeader } from '../../organization-path';
import type { PublicSportLeagues, SportView } from '../sport-view-path';

/**
 * The sport view's data for specs: design/mockups/60-organization-page.html revision 4, state 9
 * (Confluence Sport & Social, 12 beach volleyball leagues at 3 locations), as
 * `organizations:getPublicPage` and `organizations:listPublicLeagues` (with `sport`) return it.
 * Test-only.
 */
export const CONFLUENCE: PublicOrganizationHeader = {
  name: 'Confluence Sport & Social',
  slug: 'confluence-sport-social',
  leagueCount: 26,
  locationCount: 14,
  sportCount: 3,
  sports: [
    {
      key: 'beachVolleyball',
      segment: 'beach-volleyball',
      name: 'Beach volleyball',
      leagueCount: 12,
      locationCount: 3,
    },
    { key: 'soccer', segment: 'soccer', name: 'Soccer', leagueCount: 8, locationCount: 6 },
    { key: 'softball', segment: 'softball', name: 'Softball', leagueCount: 6, locationCount: 5 },
  ],
};

/** The same organization with no softball league. */
export const CONFLUENCE_NO_SOFTBALL: PublicOrganizationHeader = {
  ...CONFLUENCE,
  leagueCount: 20,
  sportCount: 2,
  sports: CONFLUENCE.sports.filter((sport) => sport.key !== 'softball'),
};

/** The 12 beach volleyball leagues, sorted by name, as the query returns them. */
export const BEACH_LEAGUES = [
  ['Competitive Coed 6s', 'competitive-coed-6s', ['American River Sand Courts']],
  [
    "Competitive Men's 2s",
    'competitive-mens-2s',
    ['Lakeshore Cove Sand Courts', 'Pocket Bend Sand Courts'],
  ],
  ['Friday Night Coed 4s', 'friday-night-coed-4s', ['Pocket Bend Sand Courts']],
  ['Monday Coed 4s', 'monday-coed-4s', ['American River Sand Courts']],
  ['Reverse Coed 4s', 'reverse-coed-4s', ['Lakeshore Cove Sand Courts']],
  ['Saturday Open 2s', 'saturday-open-2s', ['Lakeshore Cove Sand Courts']],
  ['Sunday Reverse Coed 4s', 'sunday-reverse-coed-4s', ['Pocket Bend Sand Courts']],
  ['Thursday Coed 2s', 'thursday-coed-2s', ['American River Sand Courts']],
  ['Tuesday Women’s 4s', 'tuesday-womens-4s', ['Pocket Bend Sand Courts']],
  ['Wednesday Coed 6s', 'wednesday-coed-6s', ['Lakeshore Cove Sand Courts']],
  ['Weekend Beginner 2s', 'weekend-beginner-2s', ['American River Sand Courts']],
  ['Winter Indoor Sand 4s', 'winter-indoor-sand-4s', ['Pocket Bend Sand Courts']],
].map(([name, slug, locationNames]) => ({
  name: name as string,
  slug: slug as string,
  sportName: 'Beach volleyball',
  locationNames: locationNames as string[],
}));

/** Page `page` of `total` beach volleyball leagues (5 per page, 40 pages at most). */
export function leaguesPage(page: number, total = BEACH_LEAGUES.length): PublicSportLeagues {
  const pageCount = Math.min(Math.ceil(total / 5), 40);
  const rows = BEACH_LEAGUES.slice((page - 1) * 5, page * 5);
  return { rows, page, pageCount, total };
}

/** The result for a sport the organization has no league in. */
export const NO_LEAGUES: PublicSportLeagues = { rows: [], page: 1, pageCount: 0, total: 0 };

/** The results of the page's two queries, by function name. */
export function sportQueryResults(
  options: {
    page?: number;
    leagues?: PublicSportLeagues;
    organization?: PublicOrganizationHeader | null;
  } = {},
): Record<string, unknown> {
  return {
    'organizations:getPublicPage':
      options.organization === undefined ? CONFLUENCE : options.organization,
    'organizations:listPublicLeagues': options.leagues ?? leaguesPage(options.page ?? 1),
  };
}

export const BEACH_VOLLEYBALL_VIEW: SportView = {
  organization: CONFLUENCE,
  sport: CONFLUENCE.sports[0],
  leagues: leaguesPage(1),
};
