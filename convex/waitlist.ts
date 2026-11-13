import { v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import {
  requireLeagueOrganizer,
  requireProgramOrganizer,
  requireProgramOrganizerOrForbidden,
  requireSeasonOrganizerOrForbidden,
  requireStaffOrForbidden,
  requireUser,
} from './lib/access';
import { authEmailsOf } from './lib/authUsers';
import { promoteTournamentWaitlistEntry, promoteWaitlistEntry } from './lib/rosterWrites';
import {
  findOrganizationBySlug,
  findSeasonBySlugs,
  seasonSlugsValidator,
} from './lib/seasonLookup';
import { findTournamentBySlugs, tournamentSlugsValidator } from './lib/tournamentLookup';
import { WAITLIST_READ_LIMIT } from './lib/waitlist';

const waitlistRowsValidator = v.array(
  v.object({
    waitlistEntryId: v.id('waitlistEntries'),
    teamName: v.string(),
    captainName: v.string(),
    captainEmail: v.string(),
    requestedAt: v.number(),
  }),
);

async function waitlistRows(ctx: QueryCtx, waiting: Doc<'waitlistEntries'>[]) {
  const captains = await Promise.all(waiting.map((entry) => ctx.db.get('users', entry.userId)));
  const emails = await authEmailsOf(
    ctx,
    captains.flatMap((captain) => (captain ? [captain.authUserId] : [])),
  );
  return waiting.map((entry, index) => {
    const captain = captains[index];
    return {
      waitlistEntryId: entry._id,
      teamName: entry.teamName,
      captainName: captain?.name ?? '',
      captainEmail: (captain && emails.get(captain.authUserId)) ?? '',
      requestedAt: entry.requestedAt,
    };
  });
}

/** Captains' emails go only to the season's organizers, who contact them. */
export const listForOrganizer = query({
  args: seasonSlugsValidator.fields,
  returns: v.union(v.null(), v.object({ rows: waitlistRowsValidator, waitlistCount: v.number() })),
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
    const rows = await waitlistRows(ctx, waiting);
    return { rows, waitlistCount: season.waitlistCount ?? rows.length };
  },
});

/** Captains' emails go only to the tournament's organizers, who contact them. */
export const listForTournament = query({
  args: tournamentSlugsValidator.fields,
  returns: v.union(v.null(), v.object({ rows: waitlistRowsValidator, waitlistCount: v.number() })),
  handler: async (ctx, { orgSlug, tournamentSlug }) => {
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    // Null for any caller: the public page already shows whether the organization exists.
    if (!organization) return null;
    const found = await findTournamentBySlugs(ctx, organization, tournamentSlug);
    if (!found) {
      // Only staff learn that a web address is unused.
      await requireStaffOrForbidden(ctx, organization._id);
      return null;
    }
    await requireProgramOrganizerOrForbidden(ctx, found.program);
    const { tournament } = found;
    const waiting = await ctx.db
      .query('waitlistEntries')
      .withIndex('by_tournamentId_and_status_and_requestedAt', (q) =>
        q.eq('tournamentId', tournament._id).eq('status', 'waiting'),
      )
      .take(WAITLIST_READ_LIMIT);
    const rows = await waitlistRows(ctx, waiting);
    return { rows, waitlistCount: tournament.waitlistCount ?? rows.length };
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
    const season = entry?.seasonId && (await ctx.db.get('seasons', entry.seasonId));
    if (!entry || !season) throw new Error('Not allowed');
    const { user } = await requireLeagueOrganizer(ctx, season.leagueId);
    const { teamId, teamCount, maxTeams } = await promoteWaitlistEntry(ctx, entry._id, user._id);
    return { teamId, teamCount, ...(maxTeams !== undefined && { maxTeams }) };
  },
});

/** Organizers may promote in any order; the list shows the oldest first. `maxTeams` is the tournament's maximum, named as the season's so one panel reads both. */
export const promoteForTournament = mutation({
  args: { waitlistEntryId: v.id('waitlistEntries') },
  returns: v.object({ teamId: v.id('teams'), teamCount: v.number(), maxTeams: v.number() }),
  handler: async (ctx, { waitlistEntryId }) => {
    // Signed in first, so an unknown entry and another organization's look alike.
    await requireUser(ctx);
    const entry = await ctx.db.get('waitlistEntries', waitlistEntryId);
    const tournament = entry?.tournamentId && (await ctx.db.get('tournaments', entry.tournamentId));
    if (!entry || !tournament) throw new Error('Not allowed');
    const { user } = await requireProgramOrganizer(ctx, tournament.programId);
    const { teamId, teamCount, maximumTeams } = await promoteTournamentWaitlistEntry(
      ctx,
      entry._id,
      user._id,
    );
    return { teamId, teamCount, maxTeams: maximumTeams };
  },
});
