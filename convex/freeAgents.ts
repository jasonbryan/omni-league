import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import {
  requireLeagueOrganizer,
  requireSeasonOrganizerOrForbidden,
  requireUser,
} from './lib/access';
import { authEmailsOf } from './lib/authUsers';
import { freeAgentStatusValidator } from './lib/freeAgent';
import { registrationIsOpen } from './lib/registration';
import { insertFreeAgent, placeFreeAgent } from './lib/rosterWrites';
import { findSeasonBySlugs, seasonSlugsValidator } from './lib/seasonLookup';
import {
  SEASON_NOT_FOUND_CODE,
  TEAM_MESSAGES,
  type RegistrationClosedError,
} from './lib/teamInput';
import { getCurrentUser } from './lib/users';

export const register = mutation({
  args: seasonSlugsValidator.fields,
  returns: v.object({ status: freeAgentStatusValidator, registeredAt: v.number() }),
  handler: async (ctx, slugs) => {
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
    const { status, registeredAt } = await insertFreeAgent(ctx, season, user._id);
    return { status, registeredAt };
  },
});

export const place = mutation({
  args: { freeAgentId: v.id('freeAgents'), teamId: v.id('teams') },
  returns: v.null(),
  handler: async (ctx, { freeAgentId, teamId }) => {
    // Signed in first, so an unknown free agent and another organization's look alike.
    await requireUser(ctx);
    const freeAgent = await ctx.db.get('freeAgents', freeAgentId);
    const season = freeAgent && (await ctx.db.get('seasons', freeAgent.seasonId));
    if (!freeAgent || !season) throw new Error('Not allowed');
    const { user } = await requireLeagueOrganizer(ctx, season.leagueId);
    const team = await ctx.db.get('teams', teamId);
    if (team?.seasonId !== season._id) throw new Error('The team is not in this season');
    await placeFreeAgent(ctx, freeAgent, team, user._id);
    return null;
  },
});

export const FREE_AGENTS_LIST_MINE_LIMIT = 20;

// eslint-disable-next-line @convex-dev/require-access-control -- the caller's own waiting rows only, found from ctx.auth (getCurrentUser); no argument names a user, and an anonymous caller gets [].
export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      freeAgentId: v.id('freeAgents'),
      leagueName: v.string(),
      seasonName: v.string(),
      organizationName: v.string(),
      registrationDeadline: v.string(),
      seasonStartDate: v.string(),
      seasonEndDate: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const waiting = await ctx.db
      .query('freeAgents')
      .withIndex('by_userId_and_status', (q) => q.eq('userId', user._id).eq('status', 'waiting'))
      .order('desc')
      .take(FREE_AGENTS_LIST_MINE_LIMIT);
    const rows = [];
    for (const freeAgent of waiting) {
      const season = await ctx.db.get('seasons', freeAgent.seasonId);
      if (!season) continue;
      const [league, organization] = await Promise.all([
        ctx.db.get('leagues', season.leagueId),
        ctx.db.get('organizations', freeAgent.organizationId),
      ]);
      if (!league || !organization) continue;
      rows.push({
        freeAgentId: freeAgent._id,
        leagueName: league.name,
        seasonName: season.name,
        organizationName: organization.name,
        registrationDeadline: season.registrationDeadline,
        seasonStartDate: season.startDate,
        seasonEndDate: season.endDate,
      });
    }
    return rows;
  },
});

export const ORGANIZER_FREE_AGENTS_LIMIT = 200;

/** Emails go only to the season's organizers, who contact the players. */
export const listForOrganizer = query({
  args: seasonSlugsValidator.fields,
  returns: v.union(
    v.null(),
    v.object({
      rows: v.array(
        v.object({
          freeAgentId: v.id('freeAgents'),
          name: v.string(),
          email: v.string(),
          registeredAt: v.number(),
        }),
      ),
      hasMore: v.boolean(),
    }),
  ),
  handler: async (ctx, slugs) => {
    const found = await findSeasonBySlugs(ctx, slugs);
    if (!found) return null;
    const { league, season } = found;
    if (!(await requireSeasonOrganizerOrForbidden(ctx, league, season))) return null;
    const waiting = await ctx.db
      .query('freeAgents')
      .withIndex('by_seasonId_and_status_and_registeredAt', (q) =>
        q.eq('seasonId', season._id).eq('status', 'waiting'),
      )
      .take(ORGANIZER_FREE_AGENTS_LIMIT + 1);
    const read = waiting.slice(0, ORGANIZER_FREE_AGENTS_LIMIT);
    const users = await Promise.all(read.map((freeAgent) => ctx.db.get('users', freeAgent.userId)));
    const emails = await authEmailsOf(
      ctx,
      users.flatMap((user) => (user ? [user.authUserId] : [])),
    );
    const rows = read.map((freeAgent, index) => {
      const user = users[index];
      return {
        freeAgentId: freeAgent._id,
        name: user?.name ?? '',
        email: (user && emails.get(user.authUserId)) ?? '',
        registeredAt: freeAgent.registeredAt,
      };
    });
    return { rows, hasMore: waiting.length > ORGANIZER_FREE_AGENTS_LIMIT };
  },
});
