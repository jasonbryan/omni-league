import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireUser } from './lib/access';
import {
  CAMP_NOT_FOUND_CODE,
  CAMP_REGISTRATION_MESSAGES,
  SELF_PARTICIPANT,
  adultMayRegister,
  participantKey,
  selfParticipantValidator,
  type CampRegistrationRefusal,
} from './lib/campRegistration';
import { insertCampRegistration } from './lib/campRegistrationWrites';
import { CAMP_SESSIONS_LIMIT, findCampBySlugs, publishedCampOfSession } from './lib/campLookup';
import { registrationIsOpen } from './lib/registration';
import { findOrganizationBySlug } from './lib/seasonLookup';
import { getCurrentUser } from './lib/users';

function refuse(refusal: CampRegistrationRefusal): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...refusal });
}

const SELF_KEY = participantKey(SELF_PARTICIPANT);

export const register = mutation({
  args: {
    sessionId: v.id('campSessions'),
    participant: selfParticipantValidator,
    ageConfirmed: v.boolean(),
  },
  returns: v.object({ registrationId: v.id('campRegistrations') }),
  handler: async (ctx, { sessionId, participant, ageConfirmed }) => {
    const user = await requireUser(ctx);
    const found = await publishedCampOfSession(ctx, sessionId);
    if (!found) {
      refuse({ code: CAMP_NOT_FOUND_CODE, message: CAMP_REGISTRATION_MESSAGES.campNotFound });
    }
    const { session, camp } = found;
    if (!registrationIsOpen(session, Date.now())) {
      refuse({
        code: 'registrationClosed',
        message: CAMP_REGISTRATION_MESSAGES.registrationClosed,
      });
    }
    const existing = await ctx.db
      .query('campRegistrations')
      .withIndex('by_sessionId_and_userId_and_participantKey', (q) =>
        q.eq('sessionId', sessionId).eq('userId', user._id).eq('participantKey', SELF_KEY),
      )
      .first();
    if (existing) {
      refuse({
        code: 'alreadyRegistered',
        message: CAMP_REGISTRATION_MESSAGES.alreadyRegistered,
      });
    }
    if (!adultMayRegister(camp.maximumAge)) {
      refuse({
        code: 'adultNotAllowed',
        message: CAMP_REGISTRATION_MESSAGES.adultNotAllowed(camp.maximumAge),
      });
    }
    if (!ageConfirmed) {
      refuse({
        code: 'ageNotConfirmed',
        field: 'ageConfirmed',
        message: CAMP_REGISTRATION_MESSAGES.ageNotConfirmed,
      });
    }
    if (session.registeredCount >= session.places) {
      refuse({ code: 'sessionFull', message: CAMP_REGISTRATION_MESSAGES.sessionFull });
    }
    const registrationId = await insertCampRegistration(ctx, session, {
      userId: user._id,
      participant,
      ageConfirmedAt: Date.now(),
    });
    return { registrationId };
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: a draft or unknown camp answers null, the caller is read only to say whether they hold a place, and no registrant field is returned.
export const getForRegistration = query({
  args: {
    orgSlug: v.string(),
    campSlug: v.string(),
    sessionId: v.optional(v.string()),
  },
  returns: v.union(
    v.null(),
    v.object({
      organizationName: v.string(),
      name: v.string(),
      minimumAge: v.number(),
      maximumAge: v.number(),
      session: v.union(
        v.null(),
        v.object({
          sessionId: v.id('campSessions'),
          name: v.string(),
          startDate: v.string(),
          endDate: v.string(),
          dailyStartTime: v.optional(v.string()),
          dailyEndTime: v.optional(v.string()),
          registrationDeadline: v.string(),
          placesLeft: v.number(),
        }),
      ),
      registered: v.boolean(),
    }),
  ),
  handler: async (ctx, { orgSlug, campSlug, sessionId }) => {
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    if (!organization) return null;
    const found = await findCampBySlugs(ctx, organization, campSlug);
    // A draft answers like an unknown camp, so nothing says whether its slug exists.
    if (found?.program.status !== 'published') return null;
    const { program, camp } = found;
    const base = {
      organizationName: organization.name,
      name: program.name,
      minimumAge: camp.minimumAge,
      maximumAge: camp.maximumAge,
    };
    const id = sessionId === undefined ? null : ctx.db.normalizeId('campSessions', sessionId);
    const session = id === null ? null : await ctx.db.get('campSessions', id);
    if (session?.campId !== camp._id) return { ...base, session: null, registered: false };
    const user = await getCurrentUser(ctx);
    const held = user
      ? await ctx.db
          .query('campRegistrations')
          .withIndex('by_sessionId_and_userId_and_participantKey', (q) =>
            q.eq('sessionId', session._id).eq('userId', user._id),
          )
          .first()
      : null;
    return {
      ...base,
      session: {
        sessionId: session._id,
        name: session.name,
        startDate: session.startDate,
        endDate: session.endDate,
        ...(session.dailyStartTime !== undefined && { dailyStartTime: session.dailyStartTime }),
        ...(session.dailyEndTime !== undefined && { dailyEndTime: session.dailyEndTime }),
        registrationDeadline: session.registrationDeadline,
        placesLeft: Math.max(0, session.places - session.registeredCount),
      },
      registered: held !== null,
    };
  },
});

/** The camp's sessions the caller holds a place in, for the "You're registered" line on the camp page. */
// eslint-disable-next-line @convex-dev/require-access-control -- reads only the caller's own rows, and a signed-out caller gets an empty list.
export const listMineForCamp = query({
  args: { orgSlug: v.string(), campSlug: v.string() },
  returns: v.array(v.id('campSessions')),
  handler: async (ctx, { orgSlug, campSlug }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    if (!organization) return [];
    const found = await findCampBySlugs(ctx, organization, campSlug);
    if (found?.program.status !== 'published') return [];
    const sessions = await ctx.db
      .query('campSessions')
      .withIndex('by_campId_and_startDate', (q) => q.eq('campId', found.camp._id))
      .take(CAMP_SESSIONS_LIMIT);
    const held = [];
    for (const session of sessions) {
      const registration = await ctx.db
        .query('campRegistrations')
        .withIndex('by_sessionId_and_userId_and_participantKey', (q) =>
          q.eq('sessionId', session._id).eq('userId', user._id),
        )
        .first();
      if (registration) held.push(session._id);
    }
    return held;
  },
});
