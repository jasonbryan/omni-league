import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import {
  requireLeagueOrganizer,
  requireSeasonOrganizerOrForbidden,
  requireUser,
} from './lib/access';
import { authEmailsOf } from './lib/authUsers';
import { promoteWaitlistEntry } from './lib/rosterWrites';
import { findSeasonBySlugs, seasonSlugsValidator } from './lib/seasonLookup';
import { WAITLIST_READ_LIMIT } from './lib/waitlist';

/** Captains' emails go only to the season's organizers, who contact them. */
export const listForOrganizer = query({
  args: seasonSlugsValidator.fields,
  returns: v.union(
    v.null(),
    v.object({
      rows: v.array(
        v.object({
          waitlistEntryId: v.id('waitlistEntries'),
          teamName: v.string(),
          captainName: v.string(),
          captainEmail: v.string(),
          requestedAt: v.number(),
        }),
      ),
      waitlistCount: v.number(),
    }),
  ),
  handler: async (ctx, slugs) => {
    const found = await findSeasonBySlugs(ctx, slugs);
    if (!found) return null;
    const { league, season } = found;
    if (!(await requireSeasonOrganizerOrForbidden(ctx, league, season))) return null;
    const waiting = await ctx.db
      .query('waitlistEntries')
      .withIndex('by_seasonId_and_status_and_requestedAt', (q) =>
        q.eq('seasonId', season._id).eq('status', 'waiting'),
      )
      .take(WAITLIST_READ_LIMIT);
    const captains = await Promise.all(waiting.map((entry) => ctx.db.get('users', entry.userId)));
    const emails = await authEmailsOf(
      ctx,
      captains.flatMap((captain) => (captain ? [captain.authUserId] : [])),
    );
    const rows = waiting.map((entry, index) => {
      const captain = captains[index];
      return {
        waitlistEntryId: entry._id,
        teamName: entry.teamName,
        captainName: captain?.name ?? '',
        captainEmail: (captain && emails.get(captain.authUserId)) ?? '',
        requestedAt: entry.requestedAt,
      };
    });
    return { rows, waitlistCount: season.waitlistCount ?? rows.length };
  },
});

/** Organizers may promote in any order; the list shows the oldest first. */
export const promote = mutation({
  args: { waitlistEntryId: v.id('waitlistEntries') },
  returns: v.object({
    teamId: v.id('teams'),
    teamCount: v.number(),
    maxTeams: v.optional(v.number()),
  }),
  handler: async (ctx, { waitlistEntryId }) => {
    // Signed in first, so an unknown entry and another organization's look alike.
    await requireUser(ctx);
    const entry = await ctx.db.get('waitlistEntries', waitlistEntryId);
    const season = entry && (await ctx.db.get('seasons', entry.seasonId));
    if (!entry || !season) throw new Error('Not allowed');
    const { user } = await requireLeagueOrganizer(ctx, season.leagueId);
    const { teamId, teamCount, maxTeams } = await promoteWaitlistEntry(ctx, entry._id, user._id);
    return { teamId, teamCount, ...(maxTeams !== undefined && { maxTeams }) };
  },
});
