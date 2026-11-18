import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { today } from './campPublicList';
import { leagueLocations } from './publicLeague';
import { sportName, type Sport } from './sports';
import { MAX_TRAINING_WEEKS } from './trainingPattern';
import { seriesEntryWaits } from './trainingWaitlistReads';

export function upcomingTrainings(
  ctx: Pick<QueryCtx, 'db'>,
  organizationId: Id<'organizations'>,
  sport: Sport | undefined,
) {
  const from = today();
  return sport === undefined
    ? ctx.db
        .query('trainings')
        .withIndex('by_organizationId_and_status_and_lastClassDate', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('status', 'published')
            .gte('lastClassDate', from),
        )
    : ctx.db
        .query('trainings')
        .withIndex('by_organizationId_and_sport_and_status_and_lastClassDate', (q) =>
          q
            .eq('organizationId', organizationId)
            .eq('sport', sport)
            .eq('status', 'published')
            .gte('lastClassDate', from),
        );
}

export async function publishedTrainingProgramOf(
  ctx: Pick<QueryCtx, 'db'>,
  training: Doc<'trainings'>,
): Promise<Doc<'programs'> | null> {
  const program = await ctx.db.get('programs', training.programId);
  return program?.organizationId === training.organizationId && program.status === 'published'
    ? program
    : null;
}

export async function upcomingClassesOf(ctx: Pick<QueryCtx, 'db'>, trainingId: Id<'trainings'>) {
  const from = today();
  const classes = await ctx.db
    .query('trainingClasses')
    .withIndex('by_trainingId_and_date', (q) => q.eq('trainingId', trainingId).gte('date', from))
    .take(MAX_TRAINING_WEEKS);
  // A waiting series entry holds the next place in every class, so each reads as full.
  const seriesWaits = await seriesEntryWaits(ctx, trainingId);
  return classes
    .filter((row) => row.status === 'scheduled')
    .map((row) => ({
      classId: row._id,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      placesLeft: seriesWaits ? 0 : Math.max(0, row.places - row.registeredCount),
    }));
}

/** Read from the classes, not `lastClassDate`, which a training row written before it existed lacks. */
export async function hasScheduledClass(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
): Promise<boolean> {
  const classes = await ctx.db
    .query('trainingClasses')
    .withIndex('by_trainingId_and_date', (q) => q.eq('trainingId', trainingId))
    .take(MAX_TRAINING_WEEKS);
  return classes.some((row) => row.status === 'scheduled');
}

export function publicPattern(pattern: NonNullable<Doc<'trainings'>['pattern']>) {
  return {
    weekday: pattern.weekday,
    startTime: pattern.startTime,
    endTime: pattern.endTime,
    firstDate: pattern.firstDate,
    registrationDeadline: pattern.registrationDeadline,
    weeks: pattern.weeks,
  };
}

export async function publicTrainingRow(
  ctx: Pick<QueryCtx, 'db'>,
  organization: Doc<'organizations'>,
  training: Doc<'trainings'>,
  program: Doc<'programs'>,
) {
  const { pattern, lastClassDate } = training;
  if (pattern === undefined || lastClassDate === undefined) return null;
  return {
    name: program.name,
    slug: program.slug,
    sportName: sportName(program.sport),
    coachName: training.coachName,
    ...(training.minimumAge !== undefined && { minimumAge: training.minimumAge }),
    ...(training.maximumAge !== undefined && { maximumAge: training.maximumAge }),
    locationNames: (await leagueLocations(ctx, organization, program)).map(({ name }) => name),
    ...publicPattern(pattern),
    lastClassDate,
  };
}
