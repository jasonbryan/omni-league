import type { PublicBracket } from '../../../../../convex/lib/publicPage';
import type { PublicTournamentData } from '../public-tournament-view';

export const ORG_SLUG = 'gulf-coast-sport-social';
export const TOURNAMENT_SLUG = 'gulf-coast-beach-open';
export const TOURNAMENT_PATH = `/organizations/${ORG_SLUG}/tournaments/${TOURNAMENT_SLUG}`;

export const BEACH_OPEN: PublicTournamentData = {
  organization: { name: 'Gulf Coast Sport & Social', slug: ORG_SLUG },
  name: 'Gulf Coast Beach Open',
  slug: TOURNAMENT_SLUG,
  sportName: 'Beach volleyball',
  divisionLabel: 'Coed · 2v2 · Open',
  locations: [
    { name: 'North Beach Sand Courts', address: '3500 Sandcourt Ln, Corpus Christi, TX 78402' },
  ],
  startDate: '2027-06-12',
  endDate: '2027-06-13',
  registrationDeadline: '2027-06-05',
  minimumRosterSize: 2,
  maximumTeams: 16,
};

export const BEACH_OPEN_BRACKET: PublicBracket = {
  rounds: [
    {
      name: 'Semifinals',
      games: [
        {
          teams: [
            { name: 'Sand Crabs', seed: 1 },
            { name: 'Dig Dogs', seed: 4 },
          ],
          bye: false,
          winner: 0,
        },
        {
          teams: [
            { name: 'Net Results', seed: 2 },
            { name: 'Dune Dashers', seed: 3 },
          ],
          bye: false,
        },
      ],
    },
    { name: 'Final', games: [{ teams: [{ name: 'Sand Crabs', seed: 1 }, null], bye: false }] },
  ],
};

export const TOURNAMENT_ARGS = { orgSlug: ORG_SLUG, tournamentSlug: TOURNAMENT_SLUG };

export function tournamentQueryResults(
  tournament: PublicTournamentData | null = BEACH_OPEN,
): Record<string, unknown> {
  return { 'tournaments:getPublicPage': tournament };
}

// 18:00 UTC is 06:00 on that date at UTC-12.
export const at = (date: string): number => Date.parse(`${date}T18:00:00Z`);
