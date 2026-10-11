// The per-address sign-in throttle (#63, ADR 0008 "Rate limits and lockout"). Only these internal
// functions read or write `signInFailures`, and only the `/sign-in/email` hooks in convex/auth.ts
// call them, so no client can reach the table.
import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { HARD_LIMIT, waitAfterFailures } from './lib/signInThrottle';

/** The answer to `begin`: the attempt may go on, or why it is refused. */
const beginResult = v.union(
  v.object({ status: v.literal('allowed') }),
  v.object({ status: v.literal('throttled'), retryAfterSeconds: v.number() }),
  v.object({ status: v.literal('locked') }),
);

/**
 * Starts a sign-in attempt for `key` (`throttleKey` of the email). Refused while the address is
 * locked (HARD_LIMIT consecutive failures) or inside its wait; a refused attempt changes nothing,
 * so asking again cannot extend the wait. Otherwise the attempt is counted as a failure at once and
 * the wait that follows it is set. Counting before the password is checked, not after, means
 * parallel guesses cannot all pass a check made before any of them is recorded: Convex runs the
 * mutations one after another, so only the first few reach the password. A success then deletes the
 * row (`clear`), which makes the count the number of consecutive failures.
 */
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

/** A successful sign-in: forgets the address's failures. */
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
