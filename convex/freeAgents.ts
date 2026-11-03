import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireSeasonOrganizerOrForbidden, requireUser } from './lib/access';
import { authEmailOf } from './lib/authUsers';
import { freeAgentStatusValidator } from './lib/freeAgent';
import { registrationIsOpen } from './lib/registration';
import { insertFreeAgent } from './lib/rosterWrites';
import { findSeasonBySlugs, seasonSlugsValidator } from './lib/seasonLookup';
import {
  SEASON_NOT_FOUND_CODE,
  TEAM_MESSAGES,
  type RegistrationClosedError,
} from './lib/teamInput';

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
    const rows = [];
    for (const freeAgent of waiting.slice(0, ORGANIZER_FREE_AGENTS_LIMIT)) {
      const user = await ctx.db.get('users', freeAgent.userId);
      rows.push({
        freeAgentId: freeAgent._id,
        name: user?.name ?? '',
        email: user ? ((await authEmailOf(ctx, user.authUserId)) ?? '') : '',
        registeredAt: freeAgent.registeredAt,
      });
    }
    return { rows, hasMore: waiting.length > ORGANIZER_FREE_AGENTS_LIMIT };
  },
});
