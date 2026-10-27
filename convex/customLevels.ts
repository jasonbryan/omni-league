import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireOrgAdmin } from './lib/access';
import {
  CUSTOM_LEVEL_MESSAGES,
  MAX_CUSTOM_LEVELS_PER_SPORT,
  checkCustomLevelName,
  checkCustomLevelStandard,
  type CustomLevelInputError,
} from './lib/customLevelInput';
import { standardLevelValidator } from './lib/divisions';
import { sportValidator } from './lib/sports';
import { deleteCustomLevel, findCustomLevel, insertCustomLevel } from './lib/tenantWrites';

function refuse(error: CustomLevelInputError): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
}

export const listForSport = query({
  args: { organizationId: v.id('organizations'), sport: sportValidator },
  returns: v.array(
    v.object({
      customLevelId: v.id('customLevels'),
      name: v.string(),
      standardLevel: standardLevelValidator,
    }),
  ),
  handler: async (ctx, { organizationId, sport }) => {
    await requireOrgAdmin(ctx, organizationId);
    const levels = await ctx.db
      .query('customLevels')
      .withIndex('by_organizationId_and_sport_and_nameKey', (q) =>
        q.eq('organizationId', organizationId).eq('sport', sport),
      )
      .take(MAX_CUSTOM_LEVELS_PER_SPORT);
    return levels.map(({ _id, name, standardLevel }) => ({
      customLevelId: _id,
      name,
      standardLevel,
    }));
  },
});

export const create = mutation({
  args: {
    organizationId: v.id('organizations'),
    sport: sportValidator,
    name: v.string(),
    // A string, not the level validator, so an empty or unknown value is refused with the field's error.
    standardLevel: v.string(),
  },
  returns: v.id('customLevels'),
  handler: async (ctx, args) => {
    await requireOrgAdmin(ctx, args.organizationId);
    const name = checkCustomLevelName(args.sport, args.name);
    if (!name.ok) refuse(name.error);
    const standard = checkCustomLevelStandard(args.sport, name.name, args.standardLevel);
    if (!standard.ok) refuse(standard.error);
    if (await findCustomLevel(ctx, args.organizationId, args.sport, name.name)) {
      refuse({
        field: 'name',
        code: 'duplicate',
        message: CUSTOM_LEVEL_MESSAGES.duplicate(name.name, args.sport),
      });
    }
    const existing = await ctx.db
      .query('customLevels')
      .withIndex('by_organizationId_and_sport_and_nameKey', (q) =>
        q.eq('organizationId', args.organizationId).eq('sport', args.sport),
      )
      .take(MAX_CUSTOM_LEVELS_PER_SPORT);
    if (existing.length >= MAX_CUSTOM_LEVELS_PER_SPORT) {
      refuse({
        field: 'name',
        code: 'limit',
        message: CUSTOM_LEVEL_MESSAGES.limit(args.sport),
      });
    }
    return insertCustomLevel(ctx, args.organizationId, {
      sport: args.sport,
      name: name.name,
      standardLevel: standard.standardLevel,
    });
  },
});

export const remove = mutation({
  args: { customLevelId: v.id('customLevels') },
  returns: v.null(),
  handler: async (ctx, { customLevelId }) => {
    const level = await ctx.db.get('customLevels', customLevelId);
    if (!level) throw new Error('Not allowed');
    await requireOrgAdmin(ctx, level.organizationId);
    const leagueUsing = await ctx.db
      .query('leagues')
      .withIndex('by_customLevelId', (q) => q.eq('customLevelId', customLevelId))
      .first();
    if (leagueUsing) {
      refuse({
        field: 'name',
        code: 'inUse',
        message: CUSTOM_LEVEL_MESSAGES.inUse(level.name),
      });
    }
    await deleteCustomLevel(ctx, customLevelId);
    return null;
  },
});
