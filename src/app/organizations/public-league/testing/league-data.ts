import type { PublicOrganizationHeader } from '../../organization-path';
import { GULF_COAST } from '../../testing/pages';
import type {
  PublicLeagueHeader,
  PublicLeagueSeasons,
  PublicLeagueView,
} from '../public-league-path';

/**
 * The public league page's data for specs: design/mockups/127-128-public-seasons.html's populated
 * league, as `organizations:getPublicPage`, `leagues:getPublicPage`, and `seasons:listPublic`
 * return it. Test-only.
 */
export const ORGANIZATION: PublicOrganizationHeader = {
  name: GULF_COAST.name,
  slug: GULF_COAST.slug,
  leagueCount: GULF_COAST.leagueCount,
  locationCount: GULF_COAST.locationCount,
  sportCount: GULF_COAST.sportCount,
  sports: GULF_COAST.sports,
};

export const SUNDAY_4S: PublicLeagueHeader = {
  organization: { name: GULF_COAST.name, slug: GULF_COAST.slug },
  name: 'Sunday Reverse Coed 4s',
  slug: 'sunday-reverse-coed-4s',
  sportName: 'Beach volleyball',
  locationNames: ['North Beach Sand Courts'],
};

/** The league's seven published seasons, newest start date first. */
export const SEASONS = [
  ['Summer 2027', 'summer-2027', '2027-06-06', '2027-08-29'],
  ['Spring 2027', 'spring-2027', '2027-03-07', '2027-05-16'],
  ['Fall 2026', 'fall-2026', '2026-09-13', '2026-11-15'],
  ['Summer 2026', 'summer-2026', '2026-06-07', '2026-08-30'],
  ['Spring 2026', 'spring-2026', '2026-03-08', '2026-05-17'],
  ['Fall 2025', 'fall-2025', '2025-09-14', '2025-11-16'],
  ['Summer 2025', 'summer-2025', '2025-06-08', '2025-08-31'],
].map(([name, slug, startDate, endDate]) => ({
  name,
  slug,
  startDate,
  endDate,
  formatName: '4v4',
}));

/** Page `page` of `total` seasons as `seasons:listPublic` returns it (5 per page, 40 pages at most). */
export function seasonsPage(page: number, total = SEASONS.length): PublicLeagueSeasons {
  const pageCount = Math.min(Math.ceil(total / 5), 40);
  const rows = SEASONS.slice((page - 1) * 5, page * 5);
  return { rows, page, pageCount, total };
}

export const NO_SEASONS: PublicLeagueSeasons = { rows: [], page: 1, pageCount: 0, total: 0 };

/** The results of the page's three queries, by function name. */
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
