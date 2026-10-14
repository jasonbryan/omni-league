import type { PublicOrganizationPage } from '../organization-path';

export const GULF_COAST: PublicOrganizationPage = {
  name: 'Gulf Coast Sport & Social',
  slug: 'gulf-coast-sport-social',
  leagueCount: 5,
  locationCount: 3,
  sportCount: 3,
  sports: [
    {
      key: 'beachVolleyball',
      segment: 'beach-volleyball',
      name: 'Beach volleyball',
      leagueCount: 2,
      locationCount: 1,
    },
    { key: 'soccer', segment: 'soccer', name: 'Soccer', leagueCount: 2, locationCount: 1 },
    { key: 'softball', segment: 'softball', name: 'Softball', leagueCount: 1, locationCount: 2 },
  ],
  locations: [
    { name: 'Bayside Athletic Complex', address: '4410 Ocean Dr, Corpus Christi, TX 78412' },
    { name: 'Flour Bluff Softball Park', address: '2001 Waldron Rd, Corpus Christi, TX 78418' },
    { name: 'North Beach Sand Courts', address: '3500 Surfside Blvd, Corpus Christi, TX 78402' },
  ],
  leagues: [
    {
      name: 'Coed 7v7 Rec',
      slug: 'coed-7v7-rec',
      sportName: 'Soccer',
      locationNames: ['Bayside Athletic Complex'],
    },
    {
      name: "Men's Over-30 11v11",
      slug: 'mens-over-30-11v11',
      sportName: 'Soccer',
      locationNames: ['Bayside Athletic Complex'],
    },
    {
      name: 'Sunday Reverse Coed 4s',
      slug: 'sunday-reverse-coed-4s',
      sportName: 'Beach volleyball',
      locationNames: ['North Beach Sand Courts'],
    },
    {
      name: 'Thursday Night Coed 2s',
      slug: 'thursday-night-coed-2s',
      sportName: 'Beach volleyball',
      locationNames: ['North Beach Sand Courts'],
    },
    {
      name: 'Wednesday Coed Slow-Pitch',
      slug: 'wednesday-coed-slow-pitch',
      sportName: 'Softball',
      locationNames: ['Flour Bluff Softball Park', 'Bayside Athletic Complex'],
    },
  ],
};

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

export const PORT_ARANSAS: PublicOrganizationPage = {
  name: 'Port Aransas Beach Volleyball Club',
  slug: 'port-aransas-beach-volleyball-club',
  leagueCount: 0,
  locationCount: 0,
  sportCount: 0,
  sports: [],
  locations: [],
  leagues: [],
};
