import { v } from 'convex/values';
import { query } from './_generated/server';
import { getCurrentUser } from './lib/users';

// eslint-disable-next-line @convex-dev/require-access-control -- the caller's own row only, found from ctx.auth (getCurrentUser); no argument names a user, and an anonymous caller gets null.
export const me = query({
  args: {},
  returns: v.union(v.null(), v.object({ name: v.string() })),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return user ? { name: user.name } : null;
  },
});
