import { ConvexError, v } from 'convex/values';
import { mutation } from './_generated/server';
import { requireTeamManager, requireUser } from './lib/access';
import { removeRosterEntry } from './lib/rosterWrites';
import {
  TEAM_MESSAGES,
  type CaptainRequiredRefusal,
  type NotRosteredRefusal,
} from './lib/teamInput';

export const remove = mutation({
  args: { rosterEntryId: v.id('rosterEntries') },
  returns: v.null(),
  handler: async (ctx, { rosterEntryId }) => {
    // Signed-in first, so an unknown id and another team's entry look alike.
    await requireUser(ctx);
    const entry = await ctx.db.get('rosterEntries', rosterEntryId);
    const team = entry ? await ctx.db.get('teams', entry.teamId) : null;
    if (!entry || !team) throw new Error('Not allowed');
    const user = await requireTeamManager(ctx, team);
    if (entry.status !== 'rostered') {
      throw new ConvexError({
        code: 'notRostered',
        message: TEAM_MESSAGES.notRostered,
      } satisfies NotRosteredRefusal);
    }
    if (entry.userId === team.captainUserId) {
      throw new ConvexError({
        code: 'captainRequired',
        message: TEAM_MESSAGES.captainRequired,
      } satisfies CaptainRequiredRefusal);
    }
    await removeRosterEntry(ctx, entry, user._id);
    return null;
  },
});
