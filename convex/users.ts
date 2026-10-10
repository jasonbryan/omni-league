import { v } from 'convex/values';
import { query } from './_generated/server';
import { getCurrentUser } from './lib/users';

/**
 * The signed-in caller's own account, for "Signed in as <name>" (#62), or `null` with no identity.
 * It takes no argument: the row is found from `ctx.auth`, so no caller can name another user.
 */
// eslint-disable-next-line @convex-dev/require-access-control -- the caller's own row only, found from ctx.auth (getCurrentUser); no argument names a user, and an anonymous caller gets null.
export const me = query({
  args: {},
  returns: v.union(v.null(), v.object({ name: v.string() })),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return user ? { name: user.name } : null;
  },
});
