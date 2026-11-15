import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { authEmailsOf } from './authUsers';

export const REMOVED_ACCOUNT_NAME = 'Removed account';

export interface CampRegistrant {
  registrationId: Id<'campRegistrations'>;
  name: string;
  guardian?: { name: string; email: string };
  registeredAt: number;
}

function byName(a: CampRegistrant, b: CampRegistrant): number {
  return (
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.registeredAt - b.registeredAt
  );
}

export async function campRegistrantsOf(
  ctx: Pick<QueryCtx, 'db' | 'runQuery'>,
  session: Doc<'campSessions'>,
): Promise<CampRegistrant[]> {
  const registrations = await ctx.db
    .query('campRegistrations')
    .withIndex('by_sessionId_and_userId_and_participantKey', (q) => q.eq('sessionId', session._id))
    .take(session.places);
  const userIds = [...new Set(registrations.map(({ userId }) => userId))];
  const users = new Map<Id<'users'>, Doc<'users'>>();
  for (const user of await Promise.all(userIds.map((id) => ctx.db.get('users', id)))) {
    if (user) users.set(user._id, user);
  }
  const guardianIds = new Set(
    registrations.flatMap(({ userId, participant }) =>
      participant.kind === 'minor' && users.has(userId) ? [users.get(userId)!.authUserId] : [],
    ),
  );
  const emails = await authEmailsOf(ctx, [...guardianIds]);
  return registrations
    .map((registration): CampRegistrant => {
      const user = users.get(registration.userId);
      const { participant } = registration;
      const base = { registrationId: registration._id, registeredAt: registration.createdAt };
      if (participant.kind === 'self') {
        return { ...base, name: user?.name ?? REMOVED_ACCOUNT_NAME };
      }
      return {
        ...base,
        name: participant.minorName,
        ...(user && {
          guardian: { name: user.name, email: emails.get(user.authUserId) ?? '' },
        }),
      };
    })
    .sort(byName);
}
