import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { MAX_MINORS_PER_SESSION, MINOR_KEY_END, MINOR_KEY_PREFIX } from './individualRegistration';
import { MAX_TRAINING_WEEKS } from './trainingPattern';
import { publishedTrainingProgramOf } from './trainingPublicList';

/** A draft program, or one with no classes scheduled, answers like an unknown one, so nothing says whether it exists. */
export async function publishedTrainingOf(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
): Promise<{
  training: Doc<'trainings'>;
  pattern: NonNullable<Doc<'trainings'>['pattern']>;
} | null> {
  const training = await ctx.db.get('trainings', trainingId);
  if (!training?.pattern) return null;
  const program = await publishedTrainingProgramOf(ctx, training);
  return program ? { training, pattern: training.pattern } : null;
}

export async function classesToAttend(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
  today: string,
): Promise<Doc<'trainingClasses'>[]> {
  const classes = await ctx.db
    .query('trainingClasses')
    .withIndex('by_trainingId_and_date', (q) => q.eq('trainingId', trainingId).gte('date', today))
    .take(MAX_TRAINING_WEEKS);
  return classes.filter((row) => row.status === 'scheduled');
}

export async function minorRegistrationsOf(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
  userId: Id<'users'>,
): Promise<Doc<'trainingRegistrations'>[]> {
  return ctx.db
    .query('trainingRegistrations')
    .withIndex('by_trainingId_and_userId_and_participantKey', (q) =>
      q
        .eq('trainingId', trainingId)
        .eq('userId', userId)
        .gte('participantKey', MINOR_KEY_PREFIX)
        .lt('participantKey', MINOR_KEY_END),
    )
    .take(MAX_MINORS_PER_SESSION);
}
