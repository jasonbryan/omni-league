import type { FindResultRow, FindResults } from '../find-path';

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
