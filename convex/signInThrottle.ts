import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { HARD_LIMIT, waitAfterFailures } from './lib/signInThrottle';

const beginResult = v.union(
  v.object({ status: v.literal('allowed') }),
  v.object({ status: v.literal('throttled'), retryAfterSeconds: v.number() }),
  v.object({ status: v.literal('locked') }),
);

// Counted as a failure before the password is checked, so parallel guesses cannot all pass a check
// made before any is recorded: Convex runs the mutations one after another.
export const begin = internalMutation({
  args: { key: v.string() },
  returns: beginResult,
  handler: async (ctx, { key }) => {
    const now = Date.now();
    const row = await ctx.db
      .query('signInFailures')
      .withIndex('by_email', (q) => q.eq('email', key))
      .unique();
    if (row && row.failures >= HARD_LIMIT) return { status: 'locked' as const };
    if (row && row.blockedUntil > now) {
      return {
        status: 'throttled' as const,
        retryAfterSeconds: Math.ceil((row.blockedUntil - now) / 1000),
      };
    }
    const failures = (row?.failures ?? 0) + 1;
    const blockedUntil = now + waitAfterFailures(failures);
    if (row) await ctx.db.patch('signInFailures', row._id, { failures, blockedUntil });
    else await ctx.db.insert('signInFailures', { email: key, failures, blockedUntil });
    return { status: 'allowed' as const };
  },
});

export const clear = internalMutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    const row = await ctx.db
      .query('signInFailures')
      .withIndex('by_email', (q) => q.eq('email', key))
      .unique();
    if (row) await ctx.db.delete('signInFailures', row._id);
    return null;
  },
});
