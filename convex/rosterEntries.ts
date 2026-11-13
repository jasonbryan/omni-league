import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, type MutationCtx } from './_generated/server';
import { canManageTeamOf, organizesTeam, requireUser } from './lib/access';
import { checkMinorName } from './lib/minorName';
import {
  addMinorEntry,
  isMinorEntry,
  removeRosterEntry,
  renameMinorEntry,
  rosteredEntriesInTeamParent,
} from './lib/rosterWrites';
import {
  TEAM_MESSAGES,
  type CaptainRequiredRefusal,
  type NotRosteredRefusal,
} from './lib/teamInput';

function refuseNotRostered(): never {
  throw new ConvexError({
    code: 'notRostered',
    message: TEAM_MESSAGES.notRostered,
  } satisfies NotRosteredRefusal);
}

function checkedMinorName(minorName: string): string {
  const checked = checkMinorName(minorName);
  if (!checked.ok) throw new ConvexError({ ...checked.error });
  return checked.name;
}

async function entryWithTeam(ctx: MutationCtx, rosterEntryId: Doc<'rosterEntries'>['_id']) {
  const entry = await ctx.db.get('rosterEntries', rosterEntryId);
  const team = entry ? await ctx.db.get('teams', entry.teamId) : null;
  if (!entry || !team) throw new Error('Not allowed');
  return { entry, team };
}

export const remove = mutation({
  args: { rosterEntryId: v.id('rosterEntries') },
  returns: v.null(),
  handler: async (ctx, { rosterEntryId }) => {
    // Signed-in first, so an unknown id and another team's entry look alike.
    const user = await requireUser(ctx);
    const { entry, team } = await entryWithTeam(ctx, rosterEntryId);
    const isGuardian = isMinorEntry(entry) && entry.userId === user._id;
    if (!isGuardian && !(await canManageTeamOf(ctx, user._id, team))) {
      throw new Error('Not allowed');
    }
    if (entry.status !== 'rostered') refuseNotRostered();
    if (!isMinorEntry(entry) && entry.userId === team.captainUserId) {
      throw new ConvexError({
        code: 'captainRequired',
        message: TEAM_MESSAGES.captainRequired,
      } satisfies CaptainRequiredRefusal);
    }
    await removeRosterEntry(ctx, entry, user._id);
    return null;
  },
});

/** Open to anyone rostered on the team, by their own entry or a minor's: the captain admitted them, and can remove any minor. */
export const addMinor = mutation({
  args: { teamId: v.id('teams'), minorName: v.string() },
  returns: v.object({ rosterEntryId: v.id('rosterEntries'), minorName: v.string() }),
  handler: async (ctx, { teamId, minorName }) => {
    const user = await requireUser(ctx);
    const team = await ctx.db.get('teams', teamId);
    if (!team) throw new Error('Not allowed');
    const entries = await rosteredEntriesInTeamParent(ctx, team, user._id);
    if (!entries.some((entry) => entry.teamId === team._id)) throw new Error('Not allowed');
    const name = checkedMinorName(minorName);
    const rosterEntryId = await addMinorEntry(ctx, team, {
      guardianUserId: user._id,
      minorName: name,
      source: 'guardian',
      addedByUserId: user._id,
    });
    return { rosterEntryId, minorName: name };
  },
});

/** The guardian and whoever runs the league or tournament rename a minor; the captain may remove one but not rename it. */
export const renameMinor = mutation({
  args: { rosterEntryId: v.id('rosterEntries'), minorName: v.string() },
  returns: v.object({ minorName: v.string() }),
  handler: async (ctx, { rosterEntryId, minorName }) => {
    const user = await requireUser(ctx);
    const { entry, team } = await entryWithTeam(ctx, rosterEntryId);
    if (!isMinorEntry(entry)) throw new Error('Not allowed');
    if (entry.userId !== user._id && !(await organizesTeam(ctx, user._id, team))) {
      throw new Error('Not allowed');
    }
    if (entry.status !== 'rostered') refuseNotRostered();
    const name = checkedMinorName(minorName);
    await renameMinorEntry(ctx, entry, name);
    return { minorName: name };
  },
});
