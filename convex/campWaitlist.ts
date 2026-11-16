import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireCampSessionOrganizer, requireUser } from './lib/access';
import { CAMP_SESSIONS_LIMIT, findCampBySlugs, publishedCampOfSession } from './lib/campLookup';
import { CAMP_NOT_FOUND_CODE, CAMP_REGISTRATION_MESSAGES } from './lib/campRegistration';
import { checkedRegistrant, refuseRegistration } from './lib/campRegistrationRules';
import { namedParticipants } from './lib/campRegistrants';
import {
  CAMP_WAITLIST_MESSAGES,
  campSessionHasFreePlace,
  campSessionPlacesLeft,
} from './lib/campWaitlist';
import {
  insertCampWaitlistEntry,
  positionIn,
  promoteCampWaitlistEntry,
  waitingEntriesOf,
} from './lib/campWaitlistWrites';
import { participantValidator } from './lib/individualRegistration';
import { findOrganizationBySlug } from './lib/seasonLookup';
import { getCurrentUser } from './lib/users';

export const join = mutation({
  args: {
    sessionId: v.id('campSessions'),
    participant: participantValidator,
    ageConfirmed: v.boolean(),
  },
  returns: v.object({ campWaitlistEntryId: v.id('campWaitlistEntries'), position: v.number() }),
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
    if (campSessionPlacesLeft(session) > 0) {
      refuseRegistration({
        code: 'sessionHasPlace',
        message: CAMP_WAITLIST_MESSAGES.sessionHasPlace,
      });
    }
    const campWaitlistEntryId = await insertCampWaitlistEntry(ctx, sessionId, {
      userId: user._id,
      participant,
      ageConfirmedAt: Date.now(),
    });
    const waiting = await waitingEntriesOf(ctx, sessionId);
    return { campWaitlistEntryId, position: positionIn(waiting, campWaitlistEntryId) };
  },
});

export const promote = mutation({
  args: { campWaitlistEntryId: v.id('campWaitlistEntries') },
  returns: v.object({ registrationId: v.id('campRegistrations') }),
  handler: async (ctx, { campWaitlistEntryId }) => {
    // Signed in first, so an unknown entry and another organization's look alike.
    await requireUser(ctx);
    const entry = await ctx.db.get('campWaitlistEntries', campWaitlistEntryId);
    if (!entry) throw new Error('Not allowed');
    const { campSession: session } = await requireCampSessionOrganizer(ctx, entry.sessionId);
    if (entry.status !== 'waiting') {
      refuseRegistration({ code: 'notWaiting', message: CAMP_WAITLIST_MESSAGES.notWaiting });
    }
    if (!campSessionHasFreePlace(session)) {
      refuseRegistration({ code: 'noFreePlace', message: CAMP_WAITLIST_MESSAGES.noFreePlace });
    }
    const [first] = await waitingEntriesOf(ctx, session._id);
    if (first?._id !== entry._id) {
      refuseRegistration({ code: 'notNext', message: CAMP_WAITLIST_MESSAGES.notNext });
    }
    return { registrationId: await promoteCampWaitlistEntry(ctx, entry) };
  },
});

/** A guardian's email goes only to the camp's organizers, who contact them. */
export const listForSession = query({
  args: { sessionId: v.id('campSessions') },
  returns: v.array(
    v.object({
      campWaitlistEntryId: v.id('campWaitlistEntries'),
      name: v.string(),
      guardian: v.optional(v.object({ name: v.string(), email: v.string() })),
      requestedAt: v.number(),
    }),
  ),
  handler: async (ctx, { sessionId }) => {
    await requireCampSessionOrganizer(ctx, sessionId);
    const waiting = await waitingEntriesOf(ctx, sessionId);
    const named = await namedParticipants(ctx, waiting);
    return waiting.map((entry, index) => ({
      campWaitlistEntryId: entry._id,
      requestedAt: entry.requestedAt,
      ...named[index],
    }));
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- reads only the caller's own rows, and a signed-out caller gets an empty list.
export const listMineForCamp = query({
  args: { orgSlug: v.string(), campSlug: v.string() },
  returns: v.array(
    v.object({
      sessionId: v.id('campSessions'),
      participant: participantValidator,
      position: v.number(),
    }),
  ),
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
      if ((session.waitlistCount ?? 0) === 0) continue;
      const waiting = await waitingEntriesOf(ctx, session._id);
      for (const entry of waiting) {
        if (entry.userId !== user._id) continue;
        held.push({
          sessionId: session._id,
          participant: entry.participant,
          position: positionIn(waiting, entry._id),
        });
      }
    }
    return held;
  },
});
