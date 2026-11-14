import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { leagueLocations } from './publicLeague';
import { sportName } from './sports';

export const CAMP_SESSIONS_LIMIT = 200;

export async function recountCampSessions(
  ctx: Pick<QueryCtx, 'db'>,
  campId: Id<'camps'>,
): Promise<number> {
  const sessions = await ctx.db
    .query('campSessions')
    .withIndex('by_campId_and_startDate', (q) => q.eq('campId', campId))
    .take(CAMP_SESSIONS_LIMIT);
  return sessions.length;
}

export async function findCampBySlugs(
  ctx: Pick<QueryCtx, 'db'>,
  organization: Doc<'organizations'>,
  campSlug: string,
) {
  const program = await ctx.db
    .query('programs')
    .withIndex('by_organizationId_and_slug', (q) =>
      q.eq('organizationId', organization._id).eq('slug', campSlug),
    )
    .unique();
  if (program?.type !== 'camp') return null;
  const camp = await ctx.db
    .query('camps')
    .withIndex('by_programId', (q) => q.eq('programId', program._id))
    .unique();
  return camp?.organizationId === organization._id ? { program, camp } : null;
}

export async function campDetails(
  ctx: Pick<QueryCtx, 'db'>,
  organization: Doc<'organizations'>,
  { program, camp }: { program: Doc<'programs'>; camp: Doc<'camps'> },
) {
  return {
    organization: { name: organization.name, slug: organization.slug },
    name: program.name,
    slug: program.slug,
    status: program.status,
    sportName: sportName(program.sport),
    minimumAge: camp.minimumAge,
    maximumAge: camp.maximumAge,
    locations: await leagueLocations(ctx, organization, program),
  };
}
