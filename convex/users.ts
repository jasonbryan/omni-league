import { v } from 'convex/values';
import { query } from './_generated/server';
import { getCurrentUser } from './lib/users';

// eslint-disable-next-line @convex-dev/require-access-control -- the caller's own row only, found from ctx.auth (getCurrentUser); no argument names a user, and an anonymous caller gets null.
export const me = query({
  args: {},
  returns: v.union(v.null(), v.object({ name: v.string(), email: v.optional(v.string()) })),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    // The email lives in the auth token, not the users table; the claim is optional on UserIdentity.
    const identity = await ctx.auth.getUserIdentity();
    return identity?.email === undefined
      ? { name: user.name }
      : { name: user.name, email: identity.email };
  },
});
