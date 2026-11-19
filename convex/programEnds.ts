import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';
import { dateAtUtcMinus12 } from './lib/registration';

export const MARK_ENDED_BATCH = 100;

export const markEnded = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const ended = await ctx.db
      .query('programs')
      .withIndex('by_current_and_endDate', (q) =>
        // The empty lower bound leaves out leagues, which have no end date.
        q.eq('current', true).gte('endDate', '').lt('endDate', dateAtUtcMinus12(Date.now())),
      )
      .take(MARK_ENDED_BATCH);
    for (const program of ended) await ctx.db.patch('programs', program._id, { current: false });
    // A patched row leaves the range, so the next batch reads the rest.
    if (ended.length === MARK_ENDED_BATCH) {
      await ctx.scheduler.runAfter(0, internal.programEnds.markEnded, {});
    }
    return null;
  },
});
