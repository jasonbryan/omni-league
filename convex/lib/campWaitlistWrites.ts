import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { insertCampRegistration } from './campRegistrationWrites';
import { participantKey, type Participant } from './individualRegistration';
import { WAITLIST_READ_LIMIT } from './waitlist';

/** The caller has checked access, the rules, and that the session counts as full; the counter moves with the row. */
export async function insertCampWaitlistEntry(
  ctx: MutationCtx,
  sessionId: Id<'campSessions'>,
  entry: { userId: Id<'users'>; participant: Participant; ageConfirmedAt?: number },
): Promise<Id<'campWaitlistEntries'>> {
  // Read again: a caller that inserts several entries holds a session whose counter is already out of date.
  const session = await ctx.db.get('campSessions', sessionId);
  if (!session) throw new Error(`Camp session ${sessionId} does not exist`);
  const { ageConfirmedAt, ...fixed } = entry;
  const id = await ctx.db.insert('campWaitlistEntries', {
    ...fixed,
    ...(ageConfirmedAt !== undefined && { ageConfirmedAt }),
    sessionId,
    campId: session.campId,
    organizationId: session.organizationId,
    participantKey: participantKey(entry.participant),
    status: 'waiting',
    requestedAt: Date.now(),
  });
  await ctx.db.patch('campSessions', sessionId, {
    waitlistCount: (session.waitlistCount ?? 0) + 1,
  });
  return id;
}

/** The caller has checked access, that the entry is the first waiting one, and that the session has a free place. */
export async function promoteCampWaitlistEntry(
  ctx: MutationCtx,
  entry: Doc<'campWaitlistEntries'>,
): Promise<Id<'campRegistrations'>> {
  const session = await ctx.db.get('campSessions', entry.sessionId);
  if (!session) throw new Error(`Camp session ${entry.sessionId} does not exist`);
  const registrationId = await insertCampRegistration(ctx, session, {
    userId: entry.userId,
    participant: entry.participant,
    ...(entry.ageConfirmedAt !== undefined && { ageConfirmedAt: entry.ageConfirmedAt }),
  });
  await ctx.db.patch('campWaitlistEntries', entry._id, {
    status: 'promoted',
    promotedAt: Date.now(),
    registrationId,
  });
  await ctx.db.patch('campSessions', session._id, {
    waitlistCount: Math.max(0, (session.waitlistCount ?? 0) - 1),
  });
  return registrationId;
}

export function waitingEntriesOf(
  ctx: Pick<QueryCtx, 'db'>,
  sessionId: Id<'campSessions'>,
): Promise<Doc<'campWaitlistEntries'>[]> {
  return ctx.db
    .query('campWaitlistEntries')
    .withIndex('by_sessionId_and_status_and_requestedAt', (q) =>
      q.eq('sessionId', sessionId).eq('status', 'waiting'),
    )
    .take(WAITLIST_READ_LIMIT);
}

export function positionIn(
  waiting: readonly Doc<'campWaitlistEntries'>[],
  id: Id<'campWaitlistEntries'>,
): number {
  const index = waiting.findIndex((entry) => entry._id === id);
  return index === -1 ? waiting.length + 1 : index + 1;
}

const USER_ENTRIES_BATCH = 100;

/** Never throws on a gone session: it runs inside the account-deletion trigger, where a throw rolls back the deletion. */
export async function deleteUserCampWaitlistEntries(
  ctx: Pick<MutationCtx, 'db'>,
  userId: Id<'users'>,
): Promise<void> {
  for (;;) {
    const batch = await ctx.db
      .query('campWaitlistEntries')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .take(USER_ENTRIES_BATCH);
    for (const entry of batch) {
      await ctx.db.delete('campWaitlistEntries', entry._id);
      if (entry.status !== 'waiting') continue;
      // Read per row: several rows of one session each lower its count.
      const session = await ctx.db.get('campSessions', entry.sessionId);
      if (!session) continue;
      await ctx.db.patch('campSessions', session._id, {
        waitlistCount: Math.max(0, (session.waitlistCount ?? 0) - 1),
      });
    }
    if (batch.length < USER_ENTRIES_BATCH) return;
  }
}
