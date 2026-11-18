import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requireTrainingClassOrganizer, requireTrainingOrganizer } from './lib/access';
import { dateAtUtcMinus12 } from './lib/registration';
import { heldPlacesIn } from './lib/trainingRegistrationReads';
import { insertTrainingClasses, setTrainingClassStatus } from './lib/tenantWrites';
import {
  TRAINING_PATTERN_MESSAGES,
  MAX_TRAINING_WEEKS,
  checkTrainingClassPlaces,
  checkTrainingPattern,
  firstTrainingPatternError,
  trainingClassStatusValidator,
  type TrainingPatternError,
  type TrainingPlacesError,
} from './lib/trainingPattern';

const classPlacesValidator = v.object({
  trainingClassId: v.id('trainingClasses'),
  places: v.number(),
});

function refuse(error: TrainingPatternError | TrainingPlacesError): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
}

/** The series change names the class it would break; a single class's own message needs no date. */
function refuseBelowRegistered(row: Doc<'trainingClasses'>, places: number): void {
  const refusal = checkTrainingClassPlaces(places, row.registeredCount);
  if (!refusal) return;
  refuse(
    refusal.code === 'placesBelowRegistered'
      ? {
          ...refusal,
          message: TRAINING_PATTERN_MESSAGES.classBelowRegistered(row.date, row.registeredCount),
        }
      : refusal,
  );
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
    const refusal = firstTrainingPatternError(
      checkTrainingPattern(values, dateAtUtcMinus12(Date.now())),
    );
    if (refusal) refuse(refusal);
    const existing = await ctx.db
      .query('trainingClasses')
      .withIndex('by_trainingId_and_date', (q) => q.eq('trainingId', trainingId))
      .first();
    if (existing || training.pattern !== undefined) {
      throw new ConvexError({
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
      .take(MAX_TRAINING_WEEKS);
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
    await setTrainingClassStatus(ctx, trainingClass, 'cancelled');
    return null;
  },
});

export const restore = mutation({
  args: { trainingClassId: v.id('trainingClasses') },
  returns: v.null(),
  handler: async (ctx, { trainingClassId }) => {
    const { trainingClass } = await requireTrainingClassOrganizer(ctx, trainingClassId);
    if (trainingClass.status === 'scheduled') return null;
    await setTrainingClassStatus(ctx, trainingClass, 'scheduled');
    // A class cancelled before the series registrations took no place for them, so the restore counts them.
    await ctx.db.patch('trainingClasses', trainingClassId, {
      registeredCount: await heldPlacesIn(ctx, trainingClass),
    });
    return null;
  },
});

export const updatePlaces = mutation({
  args: { trainingClassId: v.id('trainingClasses'), places: v.number() },
  returns: v.object({ previousPlaces: v.number() }),
  handler: async (ctx, { trainingClassId, places }) => {
    const { trainingClass } = await requireTrainingClassOrganizer(ctx, trainingClassId);
    const refusal = checkTrainingClassPlaces(places, trainingClass.registeredCount);
    if (refusal) refuse(refusal);
    await ctx.db.patch('trainingClasses', trainingClassId, { places });
    return { previousPlaces: trainingClass.places };
  },
});

/** Cancelled classes change too, so a restored class matches the series. */
export const updateAllPlaces = mutation({
  args: { trainingId: v.id('trainings'), places: v.number() },
  returns: v.object({ classCount: v.number(), previous: v.array(classPlacesValidator) }),
  handler: async (ctx, { trainingId, places }) => {
    await requireTrainingOrganizer(ctx, trainingId);
    const today = dateAtUtcMinus12(Date.now());
    const upcoming = await ctx.db
      .query('trainingClasses')
      .withIndex('by_trainingId_and_date', (q) => q.eq('trainingId', trainingId).gte('date', today))
      .take(MAX_TRAINING_WEEKS);
    const scheduled = upcoming.filter((row) => row.status === 'scheduled');
    if (scheduled.length === 0) {
      refuse({
        field: 'places',
        code: 'noUpcomingClass',
        message: TRAINING_PATTERN_MESSAGES.noUpcomingClass,
      });
    }
    for (const row of upcoming) refuseBelowRegistered(row, places);
    for (const row of upcoming) await ctx.db.patch('trainingClasses', row._id, { places });
    return {
      classCount: scheduled.length,
      previous: upcoming.map((row) => ({ trainingClassId: row._id, places: row.places })),
    };
  },
});

export const restorePlaces = mutation({
  args: { trainingId: v.id('trainings'), classes: v.array(classPlacesValidator) },
  returns: v.object({ classCount: v.number() }),
  handler: async (ctx, { trainingId, classes }) => {
    await requireTrainingOrganizer(ctx, trainingId);
    if (classes.length > MAX_TRAINING_WEEKS) throw new Error('Not allowed');
    const rows: { row: Doc<'trainingClasses'>; places: number }[] = [];
    for (const { trainingClassId, places } of classes) {
      const row = await ctx.db.get('trainingClasses', trainingClassId);
      if (row?.trainingId !== trainingId) throw new Error('Not allowed');
      rows.push({ row, places });
    }
    for (const { row, places } of rows) refuseBelowRegistered(row, places);
    for (const { row, places } of rows) await ctx.db.patch('trainingClasses', row._id, { places });
    return { classCount: rows.length };
  },
});
