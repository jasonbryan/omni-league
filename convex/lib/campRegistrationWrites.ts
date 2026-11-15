import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { participantKey, type Participant } from './individualRegistration';

/** The caller has checked access, the rules, and that the session has a place; the counter moves with the row. */
export async function insertCampRegistration(
  ctx: MutationCtx,
  session: Doc<'campSessions'>,
  registration: {
    userId: Id<'users'>;
    participant: Participant;
    ageConfirmedAt?: number;
  },
): Promise<Id<'campRegistrations'>> {
  const { ageConfirmedAt, ...fixed } = registration;
  const id = await ctx.db.insert('campRegistrations', {
    ...fixed,
    ...(ageConfirmedAt !== undefined && { ageConfirmedAt }),
    sessionId: session._id,
    campId: session.campId,
    organizationId: session.organizationId,
    participantKey: participantKey(registration.participant),
    createdAt: Date.now(),
  });
  await ctx.db.patch('campSessions', session._id, { registeredCount: session.registeredCount + 1 });
  return id;
}

const USER_REGISTRATIONS_BATCH = 100;

/** Never throws on a gone session: it runs inside the account-deletion trigger, where a throw rolls back the deletion. */
export async function deleteUserCampRegistrations(
  ctx: Pick<MutationCtx, 'db'>,
  userId: Id<'users'>,
): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query('campRegistrations')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(USER_REGISTRATIONS_BATCH);
    for (const registration of batch) {
      await ctx.db.delete('campRegistrations', registration._id);
      // Read per row: several rows of one session each lower its count.
      const session = await ctx.db.get('campSessions', registration.sessionId);
      if (!session) continue;
      await ctx.db.patch('campSessions', session._id, {
        registeredCount: Math.max(0, session.registeredCount - 1),
      });
    }
    if (batch.length < USER_REGISTRATIONS_BATCH) return;
  }
}
