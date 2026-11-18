import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import {
  MAX_MINORS_PER_SESSION,
  MINOR_KEY_END,
  MINOR_KEY_PREFIX,
  participantKey,
  type Participant,
} from './individualRegistration';
import { MAX_TRAINING_CLASS_PLACES, MAX_TRAINING_WEEKS } from './trainingPattern';
import { publishedTrainingProgramOf } from './trainingPublicList';
import { CLASS_KEY_END, CLASS_KEY_PREFIX, classParticipantKey } from './trainingRegistration';

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

// Each registration of one kind holds a place in the class, and a class takes at most as many as it has places.
export const REGISTRATIONS_OF_ONE_KIND_LIMIT = MAX_TRAINING_CLASS_PLACES * 2;

async function seriesRegistrationCount(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
): Promise<number> {
  const registrations = await ctx.db
    .query('trainingRegistrations')
    .withIndex('by_trainingId_and_classId', (q) =>
      q.eq('trainingId', trainingId).eq('classId', undefined),
    )
    .take(REGISTRATIONS_OF_ONE_KIND_LIMIT);
  return registrations.length;
}

export async function heldPlacesIn(
  ctx: Pick<QueryCtx, 'db'>,
  trainingClass: Doc<'trainingClasses'>,
): Promise<number> {
  const own = await ctx.db
    .query('trainingRegistrations')
    .withIndex('by_trainingId_and_classId', (q) =>
      q.eq('trainingId', trainingClass.trainingId).eq('classId', trainingClass._id),
    )
    .take(REGISTRATIONS_OF_ONE_KIND_LIMIT);
  return (await seriesRegistrationCount(ctx, trainingClass.trainingId)) + own.length;
}

export async function seriesRegistrationOf(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
  userId: Id<'users'>,
  participant: Participant,
): Promise<Doc<'trainingRegistrations'> | null> {
  return keyedRegistration(ctx, trainingId, userId, participantKey(participant));
}

export async function classRegistrationOf(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
  userId: Id<'users'>,
  classId: Id<'trainingClasses'>,
  participant: Participant,
): Promise<Doc<'trainingRegistrations'> | null> {
  return keyedRegistration(ctx, trainingId, userId, classParticipantKey(classId, participant));
}

function keyedRegistration(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
  userId: Id<'users'>,
  key: string,
): Promise<Doc<'trainingRegistrations'> | null> {
  return ctx.db
    .query('trainingRegistrations')
    .withIndex('by_trainingId_and_userId_and_participantKey', (q) =>
      q.eq('trainingId', trainingId).eq('userId', userId).eq('participantKey', key),
    )
    .first();
}

export async function minorSeriesRegistrationsOf(
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

// Each of the account holder and 20 children holds at most one registration of each class.
const SINGLE_CLASS_REGISTRATIONS_LIMIT = (MAX_MINORS_PER_SESSION + 1) * MAX_TRAINING_WEEKS;

export function singleClassRegistrationsOf(
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
        .gte('participantKey', CLASS_KEY_PREFIX)
        .lt('participantKey', CLASS_KEY_END),
    )
    .take(SINGLE_CLASS_REGISTRATIONS_LIMIT);
}

export async function replacedBySeries(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
  userId: Id<'users'>,
  participant: Participant,
): Promise<Doc<'trainingRegistrations'>[]> {
  const key = participantKey(participant);
  return (await singleClassRegistrationsOf(ctx, trainingId, userId)).filter(
    (row) => participantKey(row.participant) === key,
  );
}

export function everyClassHasPlace(
  classes: readonly Doc<'trainingClasses'>[],
  replaced: readonly Doc<'trainingRegistrations'>[],
): boolean {
  return classes.every((row) => placesHeldExcluding(row, replaced) < row.places);
}

export function placesHeldExcluding(
  trainingClass: Doc<'trainingClasses'>,
  replaced: readonly Doc<'trainingRegistrations'>[],
): number {
  const own = replaced.filter((row) => row.classId === trainingClass._id).length;
  return Math.max(0, trainingClass.registeredCount - own);
}
