import { ConvexError, v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import { requireTeamMemberOrOrganizer, requireUser } from './lib/access';
import { registrationIsOpen } from './lib/registration';
import { insertTeamWithCaptain } from './lib/rosterWrites';
import { findSeasonBySlugs, seasonSlugsValidator } from './lib/seasonLookup';
import { checkTeamName, TEAM_MESSAGES, type RegistrationClosedError } from './lib/teamInput';

/** More than a roster holds, so the page always lists the whole roster. */
export const ROSTER_READ_LIMIT = 200;

export const SEASON_NOT_FOUND_CODE = 'seasonNotFound';

export const register = mutation({
  args: { ...seasonSlugsValidator.fields, name: v.string() },
  returns: v.object({ status: v.literal('registered'), teamId: v.id('teams') }),
  handler: async (ctx, { name, ...slugs }) => {
    const user = await requireUser(ctx);
    const found = await findSeasonBySlugs(ctx, slugs);
    // A draft answers like an unknown season, as the register page's query does.
    if (found?.league.status !== 'published' || found.season.status !== 'published') {
      throw new ConvexError({ code: SEASON_NOT_FOUND_CODE });
    }
    const { season } = found;
    if (!registrationIsOpen(season, Date.now())) {
      throw new ConvexError({
        code: 'registrationClosed',
        message: TEAM_MESSAGES.registrationClosed,
      } satisfies RegistrationClosedError);
    }
    const checked = checkTeamName(name);
    if (!checked.ok) throw new ConvexError({ ...checked.error });
    const teamId = await insertTeamWithCaptain(ctx, season, {
      name: checked.name,
      captainUserId: user._id,
    });
    return { status: 'registered' as const, teamId };
  },
});

const rosterRowValidator = v.object({
  rosterEntryId: v.id('rosterEntries'),
  name: v.string(),
  isCaptain: v.boolean(),
  isViewer: v.boolean(),
});

const teamForMemberValidator = v.object({
  name: v.string(),
  organization: v.object({ name: v.string(), slug: v.string() }),
  league: v.object({ name: v.string(), slug: v.string() }),
  season: v.object({ name: v.string(), slug: v.string() }),
  minimumRosterSize: v.number(),
  rosterCount: v.number(),
  roster: v.array(rosterRowValidator),
  viewerIsCaptain: v.boolean(),
});

/** `teamId` is a string so a malformed id answers `null`, as an unknown one does, never a validator error. */
export const getForMember = query({
  args: { teamId: v.string() },
  returns: v.union(v.null(), teamForMemberValidator),
  handler: async (ctx, args) => {
    const teamId = ctx.db.normalizeId('teams', args.teamId);
    const team = teamId ? await ctx.db.get('teams', teamId) : null;
    const league = team ? await ctx.db.get('leagues', team.leagueId) : null;
    if (!team || !league) return null;
    const user = await requireTeamMemberOrOrganizer(ctx, team, league);
    const season = await ctx.db.get('seasons', team.seasonId);
    const organization = await ctx.db.get('organizations', team.organizationId);
    if (!season || !organization) return null;
    return {
      name: team.name,
      organization: { name: organization.name, slug: organization.slug },
      league: { name: league.name, slug: league.slug },
      season: { name: season.name, slug: season.slug },
      minimumRosterSize: season.minimumRosterSize,
      rosterCount: team.rosterCount,
      roster: await rosterOf(ctx, team, user),
      viewerIsCaptain: team.captainUserId === user._id,
    };
  },
});

async function rosterOf(ctx: Pick<QueryCtx, 'db'>, team: Doc<'teams'>, viewer: Doc<'users'>) {
  const entries = await ctx.db
    .query('rosterEntries')
    .withIndex('by_teamId_and_status', (q) => q.eq('teamId', team._id).eq('status', 'rostered'))
    .take(ROSTER_READ_LIMIT);
  const rows = [];
  for (const entry of entries) {
    const player = await ctx.db.get('users', entry.userId);
    rows.push({
      rosterEntryId: entry._id,
      name: player?.name ?? '',
      isCaptain: entry.userId === team.captainUserId,
      isViewer: entry.userId === viewer._id,
    });
  }
  return rows.sort(captainFirst);
}

function captainFirst(a: { isCaptain: boolean }, b: { isCaptain: boolean }): number {
  return Number(b.isCaptain) - Number(a.isCaptain);
}
