// Reads of the Better Auth component's `user` table, which holds the email of each account (#67).
// The app's own `users` row keeps the name and the `authUserId` that points here. The component's
// generated return types are `any`, so the one field read is typed here.
import { components } from '../_generated/api';
import type { QueryCtx } from '../_generated/server';

type Ctx = Pick<QueryCtx, 'runQuery'>;

interface AuthUser {
  _id: string;
  email: string;
}

/** The email of the auth user `authUserId` (a `users.authUserId`), lower case, or `null`. */
export async function authEmailOf(ctx: Ctx, authUserId: string): Promise<string | null> {
  const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [{ field: '_id', value: authUserId }],
  })) as AuthUser | null;
  return user ? user.email.toLowerCase() : null;
}

/**
 * The id of the auth user with this email, or `null`. Better Auth stores addresses in lower case,
 * so `email` must be normalised first (`normaliseInviteEmail`).
 */
export async function authUserIdByEmail(ctx: Ctx, email: string): Promise<string | null> {
  const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [{ field: 'email', value: email }],
  })) as AuthUser | null;
  return user ? user._id : null;
}
