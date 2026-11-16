import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { authEmailsOf } from './authUsers';
import type { Participant } from './individualRegistration';

export const REMOVED_ACCOUNT_NAME = 'Removed account';

export interface CampRegistrant {
  registrationId: Id<'campRegistrations'>;
  name: string;
  guardian?: { name: string; email: string };
  registeredAt: number;
}

export interface NamedParticipant {
  name: string;
  guardian?: { name: string; email: string };
}

function byName(a: CampRegistrant, b: CampRegistrant): number {
  return (
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.registeredAt - b.registeredAt
  );
}

export async function namedParticipants(
  ctx: Pick<QueryCtx, 'db' | 'runQuery'>,
  rows: readonly { userId: Id<'users'>; participant: Participant }[],
): Promise<NamedParticipant[]> {
  const userIds = [...new Set(rows.map(({ userId }) => userId))];
  const users = new Map<Id<'users'>, Doc<'users'>>();
  for (const user of await Promise.all(userIds.map((id) => ctx.db.get('users', id)))) {
    if (user) users.set(user._id, user);
  }
  const guardianIds = new Set(
    rows.flatMap(({ userId, participant }) =>
      participant.kind === 'minor' && users.has(userId) ? [users.get(userId)!.authUserId] : [],
    ),
  );
  const emails = await authEmailsOf(ctx, [...guardianIds]);
  return rows.map(({ userId, participant }): NamedParticipant => {
    const user = users.get(userId);
    if (participant.kind === 'self') return { name: user?.name ?? REMOVED_ACCOUNT_NAME };
    return {
      name: participant.minorName,
      ...(user && {
        guardian: { name: user.name, email: emails.get(user.authUserId) ?? '' },
      }),
    };
  });
}

export async function campRegistrantsOf(
  ctx: Pick<QueryCtx, 'db' | 'runQuery'>,
  session: Doc<'campSessions'>,
): Promise<CampRegistrant[]> {
  const registrations = await ctx.db
    .query('campRegistrations')
    .withIndex('by_sessionId_and_userId_and_participantKey', (q) => q.eq('sessionId', session._id))
    .take(session.places);
  const named = await namedParticipants(ctx, registrations);
  return registrations
    .map((registration, index): CampRegistrant => ({
      registrationId: registration._id,
      registeredAt: registration.createdAt,
      ...named[index],
    }))
    .sort(byName);
}
