import type { PublicOrganizationPage } from '../organization-path';

/**
 * The organization page's data for specs: the mockup's populated organization (#73), as
 * `getPublicPage` and page 1 of the two list queries return it. Test-only.
 */
export const GULF_COAST: PublicOrganizationPage = {
  name: 'Gulf Coast Sport & Social',
  slug: 'gulf-coast-sport-social',
  leagueCount: 5,
  locationCount: 3,
  sportCount: 3,
  locations: [
    { name: 'Bayside Athletic Complex', address: '4410 Ocean Dr, Corpus Christi, TX 78412' },
    { name: 'Flour Bluff Softball Park', address: '2001 Waldron Rd, Corpus Christi, TX 78418' },
    { name: 'North Beach Sand Courts', address: '3500 Surfside Blvd, Corpus Christi, TX 78402' },
  ],
  leagues: [
    { name: 'Coed 7v7 Rec', sportName: 'Soccer', locationNames: ['Bayside Athletic Complex'] },
    {
      name: "Men's Over-30 11v11",
      sportName: 'Soccer',
      locationNames: ['Bayside Athletic Complex'],
    },
    {
      name: 'Sunday Reverse Coed 4s',
      sportName: 'Beach volleyball',
      locationNames: ['North Beach Sand Courts'],
    },
    {
      name: 'Thursday Night Coed 2s',
      sportName: 'Beach volleyball',
      locationNames: ['North Beach Sand Courts'],
    },
    {
      name: 'Wednesday Coed Slow-Pitch',
      sportName: 'Softball',
      locationNames: ['Flour Bluff Softball Park', 'Bayside Athletic Complex'],
    },
  ],
};

/**
 * The results of the page's three queries for `page`, by function name: the header with its
 * totals, and page 1 of each list (5 rows per page, at most 40 pages, as the queries serve them).
 * Test-only.
 */
export function queryResults(page: PublicOrganizationPage): Record<string, unknown> {
  const { leagues, locations, ...header } = page;
  const list = (rows: unknown[], total: number) => ({
    rows,
    page: 1,
    pageCount: Math.min(Math.ceil(total / 5), 40),
    total,
  });
  return {
    'organizations:getPublicPage': header,
    'organizations:listPublicLeagues': list(leagues, header.leagueCount),
    'organizations:listPublicLocations': list(locations, header.locationCount),
  };
}

/** The mockup's empty organization: no leagues and no locations. Test-only. */
export const PORT_ARANSAS: PublicOrganizationPage = {
  name: 'Port Aransas Beach Volleyball Club',
  slug: 'port-aransas-beach-volleyball-club',
  leagueCount: 0,
  locationCount: 0,
  sportCount: 0,
  locations: [],
  leagues: [],
};
