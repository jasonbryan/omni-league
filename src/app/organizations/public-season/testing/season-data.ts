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
    divisionLabel: 'Coed · 4v4 · Rec',
    locations: [
      { name: 'North Beach Sand Courts', address: '3500 Sandcourt Ln, Corpus Christi, TX 78402' },
    ],
    upcomingSeasons: [
      {
        name: 'Summer 2027',
        slug: 'summer-2027',
        startDate: '2027-06-06',
        registrationDeadline: '2027-05-23',
      },
    ],
  },
  name: 'Summer 2027',
  slug: 'summer-2027',
  startDate: '2027-06-06',
  endDate: '2027-08-29',
  registrationDeadline: '2027-05-23',
  formatName: '4v4',
  minimumRosterSize: 4,
};

export function seasonQueryResults(
  options: { season?: PublicSeasonData | null } = {},
): Record<string, unknown> {
  return {
    'seasons:getPublicPage': options.season === undefined ? SUMMER_2027 : options.season,
  };
}

export const SUMMER_2027_VIEW: PublicSeasonView = {
  season: SUMMER_2027,
};

/** A saved copy made before the field existed lacks it. */
export function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) as Omit<T, K>;
}
