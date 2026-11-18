import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { participantKey, type Participant } from './individualRegistration';
import { MAX_TRAINING_WEEKS } from './trainingPattern';

/** The caller has checked access, the rules, and that every class has a place; each class's counter moves with the row. */
export async function insertTrainingSeriesRegistration(
  ctx: MutationCtx,
  training: Doc<'trainings'>,
  classes: readonly Doc<'trainingClasses'>[],
  registration: {
    userId: Id<'users'>;
    participant: Participant;
    ageConfirmedAt?: number;
  },
): Promise<Id<'trainingRegistrations'>> {
  const { ageConfirmedAt, ...fixed } = registration;
  const id = await ctx.db.insert('trainingRegistrations', {
    ...fixed,
    ...(ageConfirmedAt !== undefined && { ageConfirmedAt }),
    trainingId: training._id,
    organizationId: training.organizationId,
    participantKey: participantKey(registration.participant),
    createdAt: Date.now(),
  });
  for (const row of classes) {
    await ctx.db.patch('trainingClasses', row._id, { registeredCount: row.registeredCount + 1 });
  }
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
