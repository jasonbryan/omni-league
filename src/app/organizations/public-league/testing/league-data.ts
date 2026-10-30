import type { PublicOrganizationHeader } from '../../organization-path';
import { GULF_COAST } from '../../testing/pages';
import type {
  PublicLeagueHeader,
  PublicLeagueSeasons,
  PublicLeagueView,
} from '../public-league-path';

export const ORGANIZATION: PublicOrganizationHeader = {
  name: GULF_COAST.name,
  slug: GULF_COAST.slug,
  leagueCount: GULF_COAST.leagueCount,
  locationCount: GULF_COAST.locationCount,
  sportCount: GULF_COAST.sportCount,
  sports: GULF_COAST.sports,
};

// 18:00 UTC is 06:00 on that date at UTC-12.
export const at = (date: string): number => Date.parse(`${date}T18:00:00Z`);

/** On this date Summer 2027 is open for registration, Spring 2027 is in progress, and the rest have ended. */
export const OPEN_DAY = '2027-04-01';

export const SEASONS = [
  ['Summer 2027', 'summer-2027', '2027-06-06', '2027-08-29', '2027-05-23'],
  ['Spring 2027', 'spring-2027', '2027-03-07', '2027-05-16', '2027-02-21'],
  ['Fall 2026', 'fall-2026', '2026-09-13', '2026-11-15', '2026-08-30'],
  ['Summer 2026', 'summer-2026', '2026-06-07', '2026-08-30', '2026-05-24'],
  ['Spring 2026', 'spring-2026', '2026-03-08', '2026-05-17', '2026-02-22'],
  ['Fall 2025', 'fall-2025', '2025-09-14', '2025-11-16', '2025-08-31'],
  ['Summer 2025', 'summer-2025', '2025-06-08', '2025-08-31', '2025-05-25'],
].map(([name, slug, startDate, endDate, registrationDeadline]) => ({
  name,
  slug,
  startDate,
  endDate,
  registrationDeadline,
  formatName: '4v4',
}));

export const SUNDAY_4S: PublicLeagueHeader = {
  organization: { name: GULF_COAST.name, slug: GULF_COAST.slug },
  name: 'Sunday Reverse Coed 4s',
  slug: 'sunday-reverse-coed-4s',
  sportName: 'Beach volleyball',
  divisionLabel: 'Coed · 4v4 · BB',
  locationNames: ['North Beach Sand Courts'],
  locations: [
    { name: 'North Beach Sand Courts', address: '3500 Sandcourt Ln, Corpus Christi, TX 78402' },
  ],
  seasons: SEASONS.slice(0, 3).map((season) => ({
    name: season.name,
    slug: season.slug,
    startDate: season.startDate,
    endDate: season.endDate,
    registrationDeadline: season.registrationDeadline,
    minimumRosterSize: 4,
  })),
};

/** The shape of a saved copy made before the fields existed. */
export function without<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const kept = Object.entries(value).filter(([key]) => !keys.includes(key as K));
  return Object.fromEntries(kept) as Omit<T, K>;
}

export function seasonsPage(page: number, total = SEASONS.length): PublicLeagueSeasons {
  const pageCount = Math.min(Math.ceil(total / 5), 40);
  const rows = SEASONS.slice((page - 1) * 5, page * 5);
  return { rows, page, pageCount, total };
}

export const NO_SEASONS: PublicLeagueSeasons = { rows: [], page: 1, pageCount: 0, total: 0 };

export function leagueQueryResults(
  options: {
    page?: number;
    seasons?: PublicLeagueSeasons;
    league?: PublicLeagueHeader | null;
    organization?: PublicOrganizationHeader | null;
  } = {},
): Record<string, unknown> {
  return {
    'organizations:getPublicPage':
      options.organization === undefined ? ORGANIZATION : options.organization,
    'leagues:getPublicPage': options.league === undefined ? SUNDAY_4S : options.league,
    'seasons:listPublic': options.seasons ?? seasonsPage(options.page ?? 1),
  };
}

export const SUNDAY_4S_VIEW: PublicLeagueView = {
  organization: ORGANIZATION,
  league: SUNDAY_4S,
  seasons: seasonsPage(1),
};
