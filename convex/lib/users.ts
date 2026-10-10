// The app's `users` rows (#62, ADR 0008 "Identity key"). Shared by the auth triggers and every
// function that needs the caller's record. Users are keyed on `identity.subject`, the Better Auth
// user id, which is stable across sessions.
import type { Doc } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

/**
 * Writes the `users` row for a new auth user. Called only by the component's `user.onCreate`
 * trigger, after the sign-up hook has refused any sign-up without the 18+ confirmation, so the
 * creation time is when that confirmation was given.
 */
export async function insertUserRecord(
  ctx: Pick<MutationCtx, 'db'>,
  { authUserId, name }: { authUserId: string; name: string },
): Promise<void> {
  await ctx.db.insert('users', { authUserId, name, adultConfirmedAt: Date.now() });
}

/** Deletes the `users` row of a deleted auth user, if there is one. */
export async function deleteUserRecord(
  ctx: Pick<MutationCtx, 'db'>,
  authUserId: string,
): Promise<void> {
  const user = await ctx.db
    .query('users')
    .withIndex('by_authUserId', (q) => q.eq('authUserId', authUserId))
    .unique();
  if (user) await ctx.db.delete('users', user._id);
}

/** The caller's own `users` row, or `null` with no identity or no row. */
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
