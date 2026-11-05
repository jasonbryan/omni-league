// The component's generated return types are `any`, so the one field read is typed here.
import { components } from '../_generated/api';
import type { QueryCtx } from '../_generated/server';

type Ctx = Pick<QueryCtx, 'runQuery'>;

interface AuthUser {
  _id: string;
  email: string;
}

export async function authEmailOf(ctx: Ctx, authUserId: string): Promise<string | null> {
  const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [{ field: '_id', value: authUserId }],
  })) as AuthUser | null;
  return user ? user.email.toLowerCase() : null;
}

// One component call for the whole list: a call per row takes about 2 s for 200 rows.
// Ids with no user are left out, so callers read the map by id, never by position.
export async function authEmailsOf(
  ctx: Ctx,
  authUserIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(authUserIds)];
  const emails = new Map<string, string>();
  if (ids.length === 0) return emails;
  const { page } = (await ctx.runQuery(components.betterAuth.adapter.findMany, {
    model: 'user',
    where: [{ field: '_id', operator: 'in', value: ids }],
    select: ['_id', 'email'],
    paginationOpts: { numItems: ids.length, cursor: null },
  })) as { page: AuthUser[] };
  for (const user of page) emails.set(user._id, user.email.toLowerCase());
  return emails;
}

// Better Auth stores addresses in lower case, so `email` must be normalised first.
export async function authUserIdByEmail(ctx: Ctx, email: string): Promise<string | null> {
  const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'user',
    where: [{ field: 'email', value: email }],
  })) as AuthUser | null;
  return user ? user._id : null;
}
