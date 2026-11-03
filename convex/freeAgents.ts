import { ConvexError, v } from 'convex/values';
import { mutation } from './_generated/server';
import { requireUser } from './lib/access';
import { freeAgentStatusValidator } from './lib/freeAgent';
import { registrationIsOpen } from './lib/registration';
import { insertFreeAgent } from './lib/rosterWrites';
import { findSeasonBySlugs, seasonSlugsValidator } from './lib/seasonLookup';
import { TEAM_MESSAGES, type RegistrationClosedError } from './lib/teamInput';
import { SEASON_NOT_FOUND_CODE } from './teams';

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
