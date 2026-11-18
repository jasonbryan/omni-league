import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { participantKey, type Participant } from './individualRegistration';
import { MAX_TRAINING_WEEKS } from './trainingPattern';
import { classParticipantKey } from './trainingRegistration';

interface NewRegistration {
  userId: Id<'users'>;
  participant: Participant;
  ageConfirmedAt?: number;
}

async function insertRegistration(
  ctx: MutationCtx,
  training: Doc<'trainings'>,
  classId: Id<'trainingClasses'> | undefined,
  { ageConfirmedAt, ...fixed }: NewRegistration,
): Promise<Id<'trainingRegistrations'>> {
  return ctx.db.insert('trainingRegistrations', {
    ...fixed,
    ...(ageConfirmedAt !== undefined && { ageConfirmedAt }),
    ...(classId !== undefined && { classId }),
    trainingId: training._id,
    organizationId: training.organizationId,
    participantKey:
      classId === undefined
        ? participantKey(fixed.participant)
        : classParticipantKey(classId, fixed.participant),
    createdAt: Date.now(),
  });
}

/**
 * The caller has checked access, the rules, and that every class has a place less those in `replaced`, the participant's own
 * single-class rows, which the series takes the place of: each class's counter moves with the rows.
 */
export async function insertTrainingSeriesRegistration(
  ctx: MutationCtx,
  training: Doc<'trainings'>,
  classes: readonly Doc<'trainingClasses'>[],
  registration: NewRegistration,
  replaced: readonly Doc<'trainingRegistrations'>[] = [],
): Promise<Id<'trainingRegistrations'>> {
  const id = await insertRegistration(ctx, training, undefined, registration);
  const freedByClass = new Map<Id<'trainingClasses'>, number>();
  for (const row of replaced) {
    await ctx.db.delete('trainingRegistrations', row._id);
    if (row.classId !== undefined) {
      freedByClass.set(row.classId, (freedByClass.get(row.classId) ?? 0) + 1);
    }
  }
  for (const row of classes) {
    const freed = freedByClass.get(row._id) ?? 0;
    freedByClass.delete(row._id);
    await ctx.db.patch('trainingClasses', row._id, {
      registeredCount: row.registeredCount + 1 - freed,
    });
  }
  for (const [classId, freed] of freedByClass) {
    const row = await ctx.db.get('trainingClasses', classId);
    if (row) await lowerRegisteredCount(ctx, row, freed);
  }
  return id;
}

/** The caller has checked access, the rules, and that the class has a place. */
export async function insertTrainingClassRegistration(
  ctx: MutationCtx,
  training: Doc<'trainings'>,
  trainingClass: Doc<'trainingClasses'>,
  registration: NewRegistration,
): Promise<Id<'trainingRegistrations'>> {
  const id = await insertRegistration(ctx, training, trainingClass._id, registration);
  await ctx.db.patch('trainingClasses', trainingClass._id, {
    registeredCount: trainingClass.registeredCount + 1,
  });
  return id;
}

const USER_REGISTRATIONS_BATCH = 100;

/** Never throws on a gone class: it runs inside the account-deletion trigger, where a throw rolls back the deletion. */
export async function deleteUserTrainingRegistrations(
  ctx: Pick<MutationCtx, 'db'>,
  userId: Id<'users'>,
): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query('trainingRegistrations')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(USER_REGISTRATIONS_BATCH);
    // One write per class, so a guardian with many children in a long series stays inside a mutation's write limit.
    const freedByTraining = new Map<Id<'trainings'>, number>();
    const freedByClass = new Map<Id<'trainingClasses'>, number>();
    for (const registration of batch) {
      await ctx.db.delete('trainingRegistrations', registration._id);
      if (registration.classId === undefined) {
        const { trainingId } = registration;
        freedByTraining.set(trainingId, (freedByTraining.get(trainingId) ?? 0) + 1);
      } else {
        const { classId } = registration;
        freedByClass.set(classId, (freedByClass.get(classId) ?? 0) + 1);
      }
    }
    for (const [trainingId, freed] of freedByTraining) {
      const classes = await ctx.db
        .query('trainingClasses')
        .withIndex('by_trainingId_and_date', (q) => q.eq('trainingId', trainingId))
        .take(MAX_TRAINING_WEEKS);
      for (const row of classes) await lowerRegisteredCount(ctx, row, freed);
    }
    for (const [classId, freed] of freedByClass) {
      const row = await ctx.db.get('trainingClasses', classId);
      if (row) await lowerRegisteredCount(ctx, row, freed);
    }
    if (batch.length < USER_REGISTRATIONS_BATCH) return;
  }
}

async function lowerRegisteredCount(
  ctx: Pick<MutationCtx, 'db'>,
  row: Doc<'trainingClasses'>,
  freed: number,
): Promise<void> {
  await ctx.db.patch('trainingClasses', row._id, {
    registeredCount: Math.max(0, row.registeredCount - freed),
  });
}
