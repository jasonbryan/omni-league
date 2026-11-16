import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { MAX_MINORS_PER_SESSION, MINOR_KEY_END, MINOR_KEY_PREFIX } from './individualRegistration';

export async function minorRegistrationsOf(
  ctx: Pick<QueryCtx, 'db'>,
  sessionId: Id<'campSessions'>,
  userId: Id<'users'>,
): Promise<Doc<'campRegistrations'>[]> {
  return ctx.db
    .query('campRegistrations')
    .withIndex('by_sessionId_and_userId_and_participantKey', (q) =>
      q
        .eq('sessionId', sessionId)
        .eq('userId', userId)
        .gte('participantKey', MINOR_KEY_PREFIX)
        .lt('participantKey', MINOR_KEY_END),
    )
    .take(MAX_MINORS_PER_SESSION);
}

/** Leaves out a promoted entry: it is already a registration, which `minorRegistrationsOf` counts. */
export async function minorWaitlistEntriesOf(
  ctx: Pick<QueryCtx, 'db'>,
  sessionId: Id<'campSessions'>,
  userId: Id<'users'>,
): Promise<Doc<'campWaitlistEntries'>[]> {
  const entries = await ctx.db
    .query('campWaitlistEntries')
    .withIndex('by_sessionId_and_userId_and_participantKey', (q) =>
      q
        .eq('sessionId', sessionId)
        .eq('userId', userId)
        .gte('participantKey', MINOR_KEY_PREFIX)
        .lt('participantKey', MINOR_KEY_END),
    )
    .take(MAX_MINORS_PER_SESSION);
  return entries.filter((entry) => entry.status === 'waiting');
}
