import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireCampSessionOrganizer, requireUser } from './lib/access';
import { CAMP_SESSIONS_LIMIT, findCampBySlugs, publishedCampOfSession } from './lib/campLookup';
import { CAMP_NOT_FOUND_CODE, CAMP_REGISTRATION_MESSAGES } from './lib/campRegistration';
import { minorRegistrationsOf } from './lib/campRegistrationReads';
import { campMineRowValidator, campRowsOf } from './lib/campRegistrationsMine';
import { checkedRegistrant, refuseRegistration } from './lib/campRegistrationRules';
import { campRegistrantsOf } from './lib/campRegistrants';
import { insertCampRegistration } from './lib/campRegistrationWrites';
import { campSessionPlacesLeft } from './lib/campWaitlist';
import { SELF_KEY, participantValidator } from './lib/individualRegistration';
import { findOrganizationBySlug } from './lib/seasonLookup';
import { getCurrentUser } from './lib/users';

export const register = mutation({
  args: {
    sessionId: v.id('campSessions'),
    participant: participantValidator,
    ageConfirmed: v.boolean(),
  },
  returns: v.object({ registrationId: v.id('campRegistrations') }),
  handler: async (ctx, { sessionId, participant: asked, ageConfirmed }) => {
    const user = await requireUser(ctx);
    const found = await publishedCampOfSession(ctx, sessionId);
    if (!found) {
      refuseRegistration({
        code: CAMP_NOT_FOUND_CODE,
        message: CAMP_REGISTRATION_MESSAGES.campNotFound,
      });
    }
    const { session, camp } = found;
    const participant = await checkedRegistrant(ctx, {
      userId: user._id,
      session,
      camp,
      asked,
      ageConfirmed,
    });
    // Anyone waiting holds the next place, so a place raised or freed goes to the waitlist, not to a new registration.
    if (campSessionPlacesLeft(session) === 0) {
      refuseRegistration({ code: 'sessionFull', message: CAMP_REGISTRATION_MESSAGES.sessionFull });
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
      waitlisted: v.boolean(),
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
    if (session?.campId !== camp._id) {
      return { ...base, session: null, registered: false, waitlisted: false };
    }
    const user = await getCurrentUser(ctx);
    const held = user
      ? await ctx.db
          .query('campRegistrations')
          .withIndex('by_sessionId_and_userId_and_participantKey', (q) =>
            q.eq('sessionId', session._id).eq('userId', user._id).eq('participantKey', SELF_KEY),
          )
          .first()
      : null;
    const waiting = user
      ? await ctx.db
          .query('campWaitlistEntries')
          .withIndex('by_sessionId_and_userId_and_participantKey', (q) =>
            q.eq('sessionId', session._id).eq('userId', user._id).eq('participantKey', SELF_KEY),
          )
          .order('desc')
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
        placesLeft: campSessionPlacesLeft(session),
      },
      registered: held !== null,
      waitlisted: waiting?.status === 'waiting',
    };
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- reads only the caller's own rows, found from ctx.auth (getCurrentUser); no argument names a user, and a signed-out caller gets an empty list.
export const listMine = query({
  args: {},
  returns: v.array(campMineRowValidator),
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return user ? campRowsOf(ctx, user._id) : [];
  },
});

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
          q.eq('sessionId', session._id).eq('userId', user._id).eq('participantKey', SELF_KEY),
        )
        .first();
      if (registration) held.push(session._id);
    }
    return held;
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- reads only the caller's own rows, and a signed-out caller gets an empty list.
export const listMyMinorsForCamp = query({
  args: { orgSlug: v.string(), campSlug: v.string() },
  returns: v.array(v.object({ sessionId: v.id('campSessions'), minorName: v.string() })),
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
      const registrations = await minorRegistrationsOf(ctx, session._id, user._id);
      // The index orders by name; the guardian reads them in the order they were registered.
      registrations.sort((a, b) => a._creationTime - b._creationTime);
      for (const registration of registrations) {
        if (registration.participant.kind === 'minor') {
          held.push({ sessionId: session._id, minorName: registration.participant.minorName });
        }
      }
    }
    return held;
  },
});

export const listForSession = query({
  args: { sessionId: v.id('campSessions') },
  returns: v.array(
    v.object({
      registrationId: v.id('campRegistrations'),
      name: v.string(),
      guardian: v.optional(v.object({ name: v.string(), email: v.string() })),
      registeredAt: v.number(),
    }),
  ),
  handler: async (ctx, { sessionId }) => {
    const { campSession } = await requireCampSessionOrganizer(ctx, sessionId);
    return campRegistrantsOf(ctx, campSession);
  },
});
