import { pageOf, PUBLIC_LIST_PAGE_SIZE } from '../../../../convex/lib/publicList';
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
    {
      name: 'Bayside Athletic Complex',
      address: '4410 Gullwing Commons Dr, Corpus Christi, TX 78412',
      sportNames: ['Soccer', 'Softball'],
    },
    {
      name: 'Flour Bluff Softball Park',
      address: '2001 Bluff Diamond Rd, Corpus Christi, TX 78418',
      sportNames: ['Softball'],
    },
    {
      name: 'North Beach Sand Courts',
      address: '3500 Sandcourt Ln, Corpus Christi, TX 78402',
      sportNames: ['Beach volleyball'],
    },
  ],
  leagues: [
    {
      name: 'Coed 7v7 Rec',
      slug: 'coed-7v7-rec',
      divisionLabel: 'Coed · 7v7 · Rec',
      sportName: 'Soccer',
      locationNames: ['Bayside Athletic Complex'],
      seasons: [],
    },
    {
      name: "Men's Over-30 11v11",
      slug: 'mens-over-30-11v11',
      divisionLabel: "Men's · 11v11 · Rec · 30+",
      sportName: 'Soccer',
      locationNames: ['Bayside Athletic Complex'],
      seasons: [],
    },
    {
      name: 'Sunday Reverse Coed 4s',
      slug: 'sunday-reverse-coed-4s',
      divisionLabel: 'Coed · 4v4 · BB',
      sportName: 'Beach volleyball',
      locationNames: ['North Beach Sand Courts'],
      seasons: [],
    },
    {
      name: 'Thursday Night Coed 2s',
      slug: 'thursday-night-coed-2s',
      divisionLabel: 'Coed · 2v2 · B',
      sportName: 'Beach volleyball',
      locationNames: ['North Beach Sand Courts'],
      seasons: [],
    },
    {
      name: 'Wednesday Coed Slow-Pitch',
      slug: 'wednesday-coed-slow-pitch',
      divisionLabel: 'Coed · 10v10 · Rec',
      sportName: 'Softball',
      locationNames: ['Flour Bluff Softball Park', 'Bayside Athletic Complex'],
      seasons: [],
    },
  ],
};

export function queryResults(page: PublicOrganizationPage): Record<string, unknown> {
  const { leagues, locations, openSeasons = [], ...header } = page;
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
    'seasons:listOpenForOrganization': openSeasons,
  };
}

export function sportQueryResults(
  page: PublicOrganizationPage,
  segment: string,
): Record<string, unknown> {
  const { leagues, locations, openSeasons = [], ...header } = page;
  const sport = header.sports.find((entry) => entry.segment === segment);
  if (!sport) throw new Error(`No sport ${segment}`);
  const list = (rows: unknown[], total: number) => ({
    rows,
    page: 1,
    pageCount: Math.min(Math.ceil(total / 5), 40),
    total,
  });
  return {
    'organizations:getPublicPage': header,
    'organizations:listPublicLeagues': list(
      leagues.filter((league) => league.sportName === sport.name).slice(0, 5),
      sport.leagueCount,
    ),
    'organizations:listPublicLocations': list(
      locations.filter((location) => location.sportNames?.includes(sport.name)),
      sport.locationCount,
    ),
    'seasons:listOpenForOrganization': openSeasons.filter(
      (season) => season.league.sportName === sport.name,
    ),
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

/** One page of a list as `listPublicLeagues` and `listPublicLocations` return it. */
export function listPage<T>(rows: readonly T[], requested: number, total = rows.length) {
  const { page, pageCount } = pageOf(total, requested);
  return {
    rows: rows.slice((page - 1) * PUBLIC_LIST_PAGE_SIZE, page * PUBLIC_LIST_PAGE_SIZE),
    page,
    pageCount,
    total,
  };
}

const SOCCER_LEAGUE_COUNT = 12;
const SOCCER_LOCATION_COUNT = 8;
const twoDigits = (n: number) => String(n).padStart(2, '0');

/** 26 leagues and 14 locations, as Confluence Sport & Social: soccer has 12 leagues and 8 locations, softball the rest. */
export const PAGED: PublicOrganizationPage = {
  name: 'Confluence Sport & Social',
  slug: 'confluence-sport-social',
  leagueCount: 26,
  locationCount: 14,
  sportCount: 2,
  sports: [
    {
      key: 'soccer',
      segment: 'soccer',
      name: 'Soccer',
      leagueCount: SOCCER_LEAGUE_COUNT,
      locationCount: SOCCER_LOCATION_COUNT,
    },
    { key: 'softball', segment: 'softball', name: 'Softball', leagueCount: 14, locationCount: 6 },
  ],
  leagues: Array.from({ length: 26 }, (_, i) => ({
    name: `League ${twoDigits(i + 1)}`,
    slug: `league-${twoDigits(i + 1)}`,
    sportName: i < SOCCER_LEAGUE_COUNT ? 'Soccer' : 'Softball',
    locationNames: [],
    seasons: [],
  })),
  locations: Array.from({ length: 14 }, (_, i) => ({
    name: `Location ${twoDigits(i + 1)}`,
    address: `${i + 1} Test Road, Sacramento, CA 95814`,
    sportNames: [i < SOCCER_LOCATION_COUNT ? 'Soccer' : 'Softball'],
  })),
};

/** The four results for one URL: the organization page, or the sport view of `segment`. */
export function pagedResults(
  page: PublicOrganizationPage,
  pages: { leagues?: number; locations?: number } = {},
  segment?: string,
): Record<string, unknown> {
  const { leagues, locations, openSeasons = [], ...header } = page;
  const sport =
    segment === undefined ? undefined : header.sports.find((entry) => entry.segment === segment);
  if (segment !== undefined && !sport) throw new Error(`No sport ${segment}`);
  const shownLeagues = sport
    ? leagues.filter((league) => league.sportName === sport.name)
    : leagues;
  const shownLocations = sport
    ? locations.filter((location) => location.sportNames?.includes(sport.name))
    : locations;
  return {
    'organizations:getPublicPage': header,
    'organizations:listPublicLeagues': listPage(
      shownLeagues,
      pages.leagues ?? 1,
      sport?.leagueCount ?? header.leagueCount,
    ),
    'organizations:listPublicLocations': listPage(
      shownLocations,
      pages.locations ?? 1,
      sport?.locationCount ?? header.locationCount,
    ),
    'seasons:listOpenForOrganization': sport
      ? openSeasons.filter((season) => season.league.sportName === sport.name)
      : openSeasons,
  };
}
