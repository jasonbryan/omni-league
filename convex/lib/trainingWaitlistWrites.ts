import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { participantKey, type Participant } from './individualRegistration';
import { insertTrainingSeriesRegistration } from './trainingRegistrationWrites';

/** The caller has checked access, the rules, and that the series counts as full. */
export async function insertTrainingWaitlistEntry(
  ctx: MutationCtx,
  training: Doc<'trainings'>,
  entry: { userId: Id<'users'>; participant: Participant; ageConfirmedAt?: number },
): Promise<Id<'trainingWaitlistEntries'>> {
  const { ageConfirmedAt, ...fixed } = entry;
  return ctx.db.insert('trainingWaitlistEntries', {
    ...fixed,
    ...(ageConfirmedAt !== undefined && { ageConfirmedAt }),
    trainingId: training._id,
    organizationId: training.organizationId,
    participantKey: participantKey(entry.participant),
    status: 'waiting',
    requestedAt: Date.now(),
  });
}

/**
 * The caller has checked access, that the entry is the first waiting one, and that every class has a place less those in
 * `replaced`, the participant's own single-class rows, which the series takes the place of.
 */
export async function promoteTrainingWaitlistEntry(
  ctx: MutationCtx,
  entry: Doc<'trainingWaitlistEntries'>,
  training: Doc<'trainings'>,
  classes: readonly Doc<'trainingClasses'>[],
  replaced: readonly Doc<'trainingRegistrations'>[],
): Promise<Id<'trainingRegistrations'>> {
  const registrationId = await insertTrainingSeriesRegistration(
    ctx,
    training,
    classes,
    {
      userId: entry.userId,
      participant: entry.participant,
      ...(entry.ageConfirmedAt !== undefined && { ageConfirmedAt: entry.ageConfirmedAt }),
    },
    replaced,
  );
  await ctx.db.patch('trainingWaitlistEntries', entry._id, {
    status: 'promoted',
    promotedAt: Date.now(),
    registrationId,
  });
  return registrationId;
}

const USER_ENTRIES_BATCH = 100;

export async function deleteUserTrainingWaitlistEntries(
  ctx: Pick<MutationCtx, 'db'>,
  userId: Id<'users'>,
): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query('trainingWaitlistEntries')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(USER_ENTRIES_BATCH);
    for (const entry of batch) await ctx.db.delete('trainingWaitlistEntries', entry._id);
    if (batch.length < USER_ENTRIES_BATCH) return;
  }
}
