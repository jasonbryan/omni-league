import { v } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { leagueDivisionLabel } from './leagueDivision';
import { leagueLocations } from './publicLeague';
import { sportName } from './sports';

export const tournamentSlugsValidator = v.object({
  orgSlug: v.string(),
  tournamentSlug: v.string(),
});

export async function findTournamentBySlugs(
  ctx: Pick<QueryCtx, 'db'>,
  organization: Doc<'organizations'>,
  tournamentSlug: string,
) {
  const program = await ctx.db
    .query('programs')
    .withIndex('by_organizationId_and_slug', (q) =>
      q.eq('organizationId', organization._id).eq('slug', tournamentSlug),
    )
    .unique();
  if (program?.type !== 'tournament') return null;
  const tournament = await ctx.db
    .query('tournaments')
    .withIndex('by_programId', (q) => q.eq('programId', program._id))
    .unique();
  return tournament?.organizationId === organization._id ? { program, tournament } : null;
}

export async function tournamentDetails(
  ctx: Pick<QueryCtx, 'db'>,
  organization: Doc<'organizations'>,
  { program, tournament }: { program: Doc<'programs'>; tournament: Doc<'tournaments'> },
) {
  return {
    organization: { name: organization.name, slug: organization.slug },
    name: program.name,
    slug: program.slug,
    sportName: sportName(program.sport),
    divisionLabel: await leagueDivisionLabel(ctx, program),
    locations: await leagueLocations(ctx, organization, program),
    startDate: tournament.startDate,
    endDate: tournament.endDate,
    registrationDeadline: tournament.registrationDeadline,
    minimumRosterSize: tournament.minimumRosterSize,
    maximumTeams: tournament.maximumTeams,
  };
}
