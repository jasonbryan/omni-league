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
