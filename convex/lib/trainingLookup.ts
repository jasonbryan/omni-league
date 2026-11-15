import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { leagueLocations } from './publicLeague';
import { sportName } from './sports';

export const TRAINING_CLASSES_LIMIT = 52;

export async function findTrainingBySlugs(
  ctx: Pick<QueryCtx, 'db'>,
  organization: Doc<'organizations'>,
  trainingSlug: string,
) {
  const program = await ctx.db
    .query('programs')
    .withIndex('by_organizationId_and_slug', (q) =>
      q.eq('organizationId', organization._id).eq('slug', trainingSlug),
    )
    .unique();
  if (program?.type !== 'training') return null;
  const training = await ctx.db
    .query('trainings')
    .withIndex('by_programId', (q) => q.eq('programId', program._id))
    .unique();
  return training?.organizationId === organization._id ? { program, training } : null;
}

export async function trainingDetails(
  ctx: Pick<QueryCtx, 'db'>,
  organization: Doc<'organizations'>,
  { program, training }: { program: Doc<'programs'>; training: Doc<'trainings'> },
) {
  return {
    organization: { name: organization.name, slug: organization.slug },
    name: program.name,
    slug: program.slug,
    status: program.status,
    sportName: sportName(program.sport),
    coachName: training.coachName,
    ...(training.minimumAge !== undefined && { minimumAge: training.minimumAge }),
    ...(training.maximumAge !== undefined && { maximumAge: training.maximumAge }),
    ...(training.pattern !== undefined && { pattern: training.pattern }),
    locations: await leagueLocations(ctx, organization, program),
  };
}
