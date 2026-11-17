import type {
  FindBrowseResults,
  FindLeagueRow,
  FindResults,
  FindTournamentRow,
} from '../find-types';

// On this date Summer 2027 is open for registration (see the public league page's test data).
export { at, OPEN_DAY } from '../../organizations/public-league/testing/league-data';

const GULF = { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' };
const LAKESHORE = { name: 'Lakeshore Sand League', slug: 'lakeshore-sand-league' };

export const SUNDAY_4S_ROW: FindLeagueRow = {
  type: 'league',
  organization: GULF,
  name: 'Sunday Reverse Coed 4s',
  slug: 'sunday-reverse-coed-4s',
  sportName: 'Beach volleyball',
  locationNames: ['North Beach Sand Courts'],
  divisionLabel: 'Coed · 4v4 · BB',
  seasons: [
    {
      name: 'Summer 2027',
      slug: 'summer-2027',
      startDate: '2027-06-06',
      endDate: '2027-08-29',
      registrationDeadline: '2027-05-23',
    },
  ],
};

export const THURSDAY_2S_ROW: FindLeagueRow = {
  type: 'league',
  organization: GULF,
  name: 'Thursday Night Coed 2s',
  slug: 'thursday-night-coed-2s',
  sportName: 'Beach volleyball',
  locationNames: ['North Beach Sand Courts'],
  divisionLabel: 'Coed · 2v2 · B',
  seasons: [],
};

export const SATURDAY_6S_ROW: FindLeagueRow = {
  type: 'league',
  organization: LAKESHORE,
  name: 'Saturday Coed 6s',
  slug: 'saturday-coed-6s',
  sportName: 'Beach volleyball',
  locationNames: ['Driftwood Beach Courts', 'Harbor Point Sand Courts'],
  divisionLabel: 'Coed · 6v6 · Rec',
  seasons: [],
};

export const GULF_OPEN_ROW: FindTournamentRow = {
  type: 'tournament',
  organization: GULF,
  name: 'Gulf Coast Beach Open',
  slug: 'gulf-coast-beach-open',
  sportName: 'Beach volleyball',
  locationNames: ['North Beach Sand Courts'],
  divisionLabel: 'Coed · 4v4 · BB',
  startDate: '2027-07-10',
  endDate: '2027-07-11',
  registrationDeadline: '2027-07-01',
  isFull: false,
};

export const COED_RESULTS: FindResults = {
  more: false,
  rows: [SUNDAY_4S_ROW, THURSDAY_2S_ROW, SATURDAY_6S_ROW],
  typeCounts: [{ type: 'league', count: 3 }],
};

export const NO_RESULTS: FindResults = { more: false, rows: [], typeCounts: [] };

export function manyResults(count: number, more: boolean): FindResults {
  return {
    more,
    typeCounts: [{ type: 'league', count }],
    rows: Array.from({ length: count }, (_, i) => ({
      ...THURSDAY_2S_ROW,
      name: `Coed League ${i + 1}`,
      slug: `coed-league-${i + 1}`,
    })),
  };
}

const FRONT_RANGE = { name: 'Front Range Rec Sports', slug: 'front-range-rec-sports' };

export const GIRLS_ROOKIES_ROW: FindLeagueRow = {
  type: 'league',
  organization: FRONT_RANGE,
  name: 'U10 Girls Fall Rec',
  slug: 'u10-girls-fall-rec',
  sportName: 'Soccer',
  locationNames: ['Cottonwood Creek Fields'],
  divisionLabel: 'Girls · 7v7 · Rec · U10',
  seasons: [],
};

export const GIRLS_SELECT_ROW: FindLeagueRow = {
  type: 'league',
  organization: FRONT_RANGE,
  name: 'U10 Girls Select',
  slug: 'u10-girls-select',
  sportName: 'Soccer',
  locationNames: ['Larkspur Turf Center'],
  divisionLabel: 'Girls · 7v7 · Competitive · U10',
  seasons: [],
};

export const SOCCER_FACETS: NonNullable<FindBrowseResults['facets']> = [
  { gender: 'womens', playersPerSide: 7, level: 'rec', ageGroup: 'u10' },
  { gender: 'womens', playersPerSide: 7, level: 'competitive', ageGroup: 'u10' },
  { gender: 'mens', playersPerSide: 7, level: 'rec', ageGroup: 'u10' },
  { gender: 'womens', playersPerSide: 11, level: 'intermediate', ageGroup: 'adult' },
  { gender: 'coed', playersPerSide: 6, level: 'rec', ageGroup: 'over40' },
];

export function browseResults(
  rows: (FindLeagueRow | FindTournamentRow)[],
  paging: { page?: number; pageCount?: number; total?: number } = {},
  facets: FindBrowseResults['facets'] = SOCCER_FACETS,
): FindBrowseResults {
  return {
    rows,
    typeCounts: [{ type: 'league', count: rows.length }],
    page: paging.page ?? 1,
    pageCount: paging.pageCount ?? 1,
    total: paging.total ?? rows.length,
    facets,
  };
}
