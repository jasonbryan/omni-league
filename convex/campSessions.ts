import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireCampOrganizer, requireCampSessionOrganizer } from './lib/access';
import {
  CAMP_SESSION_MESSAGES,
  checkCampSessionFields,
  firstCampSessionError,
  type CampSessionInputError,
} from './lib/campSessionInput';
import { CAMP_SESSIONS_LIMIT } from './lib/campLookup';
import { insertCampSession } from './lib/tenantWrites';

function refuse(error: CampSessionInputError): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...error });
}

export const add = mutation({
  args: {
    campId: v.id('camps'),
    name: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    dailyStartTime: v.optional(v.string()),
    dailyEndTime: v.optional(v.string()),
    places: v.number(),
    registrationDeadline: v.string(),
  },
  returns: v.object({ campSessionId: v.id('campSessions') }),
  handler: async (ctx, { campId, ...values }) => {
    const { camp } = await requireCampOrganizer(ctx, campId);
    const refusal = firstCampSessionError(checkCampSessionFields(values));
    if (refusal) refuse(refusal);
    const campSessionId = await insertCampSession(ctx, camp, {
      ...values,
      name: values.name.trim(),
    });
    return { campSessionId };
  },
});

export const listForCamp = query({
  args: { campId: v.id('camps') },
  returns: v.array(
    v.object({
      campSessionId: v.id('campSessions'),
      name: v.string(),
      startDate: v.string(),
      endDate: v.string(),
      dailyStartTime: v.optional(v.string()),
      dailyEndTime: v.optional(v.string()),
      places: v.number(),
      registrationDeadline: v.string(),
      registeredCount: v.number(),
    }),
  ),
  handler: async (ctx, { campId }) => {
    await requireCampOrganizer(ctx, campId);
    const sessions = await ctx.db
      .query('campSessions')
      .withIndex('by_campId_and_startDate', (q) => q.eq('campId', campId))
      .take(CAMP_SESSIONS_LIMIT);
    return sessions.map((session) => ({
      campSessionId: session._id,
      name: session.name,
      startDate: session.startDate,
      endDate: session.endDate,
      ...(session.dailyStartTime !== undefined && { dailyStartTime: session.dailyStartTime }),
      ...(session.dailyEndTime !== undefined && { dailyEndTime: session.dailyEndTime }),
      places: session.places,
      registrationDeadline: session.registrationDeadline,
      registeredCount: session.registeredCount,
    }));
  },
});

export const remove = mutation({
  args: { campSessionId: v.id('campSessions') },
  returns: v.null(),
  handler: async (ctx, { campSessionId }) => {
    const { campSession: session } = await requireCampSessionOrganizer(ctx, campSessionId);
    if (session.registeredCount > 0) {
      throw new ConvexError({
        code: 'hasRegistrations',
        message: CAMP_SESSION_MESSAGES.hasRegistrations(session.registeredCount),
      });
    }
    await ctx.db.delete('campSessions', campSessionId);
    return null;
  },
});
