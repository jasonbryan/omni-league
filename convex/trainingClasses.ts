import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireTrainingClassOrganizer, requireTrainingOrganizer } from './lib/access';
import { insertTrainingClasses } from './lib/tenantWrites';
import { TRAINING_CLASSES_LIMIT } from './lib/trainingLookup';
import {
  TRAINING_PATTERN_MESSAGES,
  checkTrainingPattern,
  firstTrainingPatternError,
  trainingClassStatusValidator,
  type TrainingPatternError,
} from './lib/trainingPattern';

function refuse(error: TrainingPatternError): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
}

export const schedule = mutation({
  args: {
    trainingId: v.id('trainings'),
    weekday: v.number(),
    startTime: v.string(),
    endTime: v.string(),
    firstDate: v.string(),
    weeks: v.number(),
    placesPerClass: v.number(),
    registrationDeadline: v.string(),
    allowSingleRegistration: v.boolean(),
  },
  returns: v.object({ classCount: v.number() }),
  handler: async (ctx, { trainingId, allowSingleRegistration, ...values }) => {
    const { training } = await requireTrainingOrganizer(ctx, trainingId);
    const refusal = firstTrainingPatternError(checkTrainingPattern(values));
    if (refusal) refuse(refusal);
    const existing = await ctx.db
      .query('trainingClasses')
      .withIndex('by_trainingId_and_date', (q) => q.eq('trainingId', trainingId))
      .first();
    if (existing || training.pattern !== undefined) {
      refuse({
        field: 'weekday',
        code: 'alreadyScheduled',
        message: TRAINING_PATTERN_MESSAGES.alreadyScheduled,
      });
    }
    const classCount = await insertTrainingClasses(ctx, training, {
      ...values,
      allowSingleRegistration,
    });
    return { classCount };
  },
});

export const listForTraining = query({
  args: { trainingId: v.id('trainings') },
  returns: v.array(
    v.object({
      trainingClassId: v.id('trainingClasses'),
      date: v.string(),
      startTime: v.string(),
      endTime: v.string(),
      places: v.number(),
      registeredCount: v.number(),
      status: trainingClassStatusValidator,
    }),
  ),
  handler: async (ctx, { trainingId }) => {
    await requireTrainingOrganizer(ctx, trainingId);
    const classes = await ctx.db
      .query('trainingClasses')
      .withIndex('by_trainingId_and_date', (q) => q.eq('trainingId', trainingId))
      .take(TRAINING_CLASSES_LIMIT);
    return classes.map((row) => ({
      trainingClassId: row._id,
      date: row.date,
      startTime: row.startTime,
      endTime: row.endTime,
      places: row.places,
      registeredCount: row.registeredCount,
      status: row.status,
    }));
  },
});

export const cancel = mutation({
  args: { trainingClassId: v.id('trainingClasses') },
  returns: v.null(),
  handler: async (ctx, { trainingClassId }) => {
    const { trainingClass } = await requireTrainingClassOrganizer(ctx, trainingClassId);
    if (trainingClass.status === 'cancelled') return null;
    if (trainingClass.registeredCount > 0) {
      throw new ConvexError({
        code: 'hasRegistrations',
        message: TRAINING_PATTERN_MESSAGES.hasRegistrations(trainingClass.registeredCount),
      });
    }
    await ctx.db.patch('trainingClasses', trainingClassId, { status: 'cancelled' });
    return null;
  },
});

export const restore = mutation({
  args: { trainingClassId: v.id('trainingClasses') },
  returns: v.null(),
  handler: async (ctx, { trainingClassId }) => {
    const { trainingClass } = await requireTrainingClassOrganizer(ctx, trainingClassId);
    if (trainingClass.status === 'scheduled') return null;
    await ctx.db.patch('trainingClasses', trainingClassId, { status: 'scheduled' });
    return null;
  },
});
