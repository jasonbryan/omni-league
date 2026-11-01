import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { MAX_SUBSCRIPTIONS_PER_USER } from './pushSubscription';

export async function insertUserRecord(
  ctx: Pick<MutationCtx, 'db'>,
  { authUserId, name }: { authUserId: string; name: string },
): Promise<void> {
  // The sign-up hook has refused any sign-up without the 18+ confirmation, so now is when it was given.
  await ctx.db.insert('users', { authUserId, name, adultConfirmedAt: Date.now() });
}

export async function deleteUserRecord(
  ctx: Pick<MutationCtx, 'db'>,
  authUserId: string,
): Promise<void> {
  const user = await ctx.db
    .query('users')
    .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
    .unique();
  if (!user) return;
  const subscriptions = await ctx.db
    .query('pushSubscriptions')
    .withIndex('by_userId', (q) => q.eq('userId', user._id))
    .take(MAX_SUBSCRIPTIONS_PER_USER * 2);
  for (const row of subscriptions) await ctx.db.delete('pushSubscriptions', row._id);
  await ctx.db.delete('users', user._id);
}

export async function getCurrentUser(
  ctx: Pick<QueryCtx, 'auth' | 'db'>,
): Promise<Doc<'users'> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query('users')
    .withIndex('by_authUserId', (q) => q.eq('authUserId', identity.subject))
    .unique();
}
