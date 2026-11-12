import { convexRun } from './convex';
import type { DivisionSeed, Sport, Tenant } from './tenant';

export interface TournamentSeed {
  name: string;
  slug: string;
  sport?: Sport;
  locations: string[];
  division?: Omit<DivisionSeed, 'minimumRosterSize'>;
  startDate: string;
  endDate: string;
  /** Defaults to a date long past, so registration is closed. */
  registrationDeadline?: string;
  maximumTeams?: number;
  status?: 'draft' | 'published';
}

/** Skips the rules of `tournaments.create`. Local runs only. */
export async function seedTournament(tenant: Tenant, tournament: TournamentSeed): Promise<string> {
  const { slug } = (await convexRun('testing:seedTournament', {
    organizationSlug: tenant.slug,
    name: tournament.name,
    slug: tournament.slug,
    sport: tournament.sport ?? 'beachVolleyball',
    locationNames: tournament.locations,
    ...(tournament.division && { division: tournament.division }),
    startDate: tournament.startDate,
    endDate: tournament.endDate,
    registrationDeadline: tournament.registrationDeadline ?? '2025-12-01',
    maximumTeams: tournament.maximumTeams ?? 16,
    status: tournament.status ?? 'published',
  })) as { slug: string };
  return `${tenant.path}/tournaments/${slug}`;
}
