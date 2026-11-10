import type { FindResultRow, FindResults, FindSportResults } from '../find-path';

// On this date Summer 2027 is open for registration (see the public league page's test data).
export { at, OPEN_DAY } from '../../organizations/public-league/testing/league-data';

const GULF = { name: 'Gulf Coast Sport & Social', slug: 'gulf-coast-sport-social' };
const LAKESHORE = { name: 'Lakeshore Sand League', slug: 'lakeshore-sand-league' };

export const SUNDAY_4S_ROW: FindResultRow = {
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

export const THURSDAY_2S_ROW: FindResultRow = {
  organization: GULF,
  name: 'Thursday Night Coed 2s',
  slug: 'thursday-night-coed-2s',
  sportName: 'Beach volleyball',
  locationNames: ['North Beach Sand Courts'],
  divisionLabel: 'Coed · 2v2 · B',
  seasons: [],
};

export const SATURDAY_6S_ROW: FindResultRow = {
  organization: LAKESHORE,
  name: 'Saturday Coed 6s',
  slug: 'saturday-coed-6s',
  sportName: 'Beach volleyball',
  locationNames: ['Driftwood Beach Courts', 'Harbor Point Sand Courts'],
  divisionLabel: 'Coed · 6v6 · Rec',
  seasons: [],
};

export const COED_RESULTS: FindResults = {
  more: false,
  rows: [SUNDAY_4S_ROW, THURSDAY_2S_ROW, SATURDAY_6S_ROW],
};

export const NO_RESULTS: FindResults = { more: false, rows: [] };

export function manyResults(count: number, more: boolean): FindResults {
  return {
    more,
    rows: Array.from({ length: count }, (_, i) => ({
      ...THURSDAY_2S_ROW,
      name: `Coed League ${i + 1}`,
      slug: `coed-league-${i + 1}`,
    })),
  };
}

const FRONT_RANGE = { name: 'Front Range Rec Sports', slug: 'front-range-rec-sports' };

export const GIRLS_ROOKIES_ROW: FindResultRow = {
  organization: FRONT_RANGE,
  name: 'U10 Girls Fall Rec',
  slug: 'u10-girls-fall-rec',
  sportName: 'Soccer',
  locationNames: ['Cottonwood Creek Fields'],
  divisionLabel: 'Girls · 7v7 · Rec · U10',
  seasons: [],
};

export const GIRLS_SELECT_ROW: FindResultRow = {
  organization: FRONT_RANGE,
  name: 'U10 Girls Select',
  slug: 'u10-girls-select',
  sportName: 'Soccer',
  locationNames: ['Larkspur Turf Center'],
  divisionLabel: 'Girls · 7v7 · Competitive · U10',
  seasons: [],
};

export const SOCCER_FACETS: NonNullable<FindSportResults['facets']> = [
  { gender: 'womens', playersPerSide: 7, level: 'rec', ageGroup: 'u10' },
  { gender: 'womens', playersPerSide: 7, level: 'competitive', ageGroup: 'u10' },
  { gender: 'mens', playersPerSide: 7, level: 'rec', ageGroup: 'u10' },
  { gender: 'womens', playersPerSide: 11, level: 'intermediate', ageGroup: 'adult' },
  { gender: 'coed', playersPerSide: 6, level: 'rec', ageGroup: 'over40' },
];

export function sportResults(
  rows: FindResultRow[],
  paging: { page?: number; pageCount?: number; total?: number } = {},
  facets: FindSportResults['facets'] = SOCCER_FACETS,
): FindSportResults {
  return {
    rows,
    page: paging.page ?? 1,
    pageCount: paging.pageCount ?? 1,
    total: paging.total ?? rows.length,
    facets,
  };
}
