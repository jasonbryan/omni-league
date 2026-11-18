import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireTrainingOrganizer, requireUser } from './lib/access';
import { namedParticipants } from './lib/campRegistrants';
import { participantValidator } from './lib/individualRegistration';
import { dateAtUtcMinus12 } from './lib/registration';
import { findOrganizationBySlug } from './lib/seasonLookup';
import { findTrainingBySlugs } from './lib/trainingLookup';
import {
  TRAINING_NOT_FOUND_CODE,
  TRAINING_REGISTRATION_MESSAGES,
  trainingHasAgeRange,
} from './lib/trainingRegistration';
import {
  classesToAttend,
  everyClassHasPlace,
  publishedTrainingOf,
  replacedBySeries,
} from './lib/trainingRegistrationReads';
import {
  checkedTrainingRegistrant,
  refuseTrainingRegistration,
} from './lib/trainingRegistrationRules';
import { TRAINING_WAITLIST_MESSAGES } from './lib/trainingWaitlist';
import { positionIn, seriesEntryWaits, waitingSeriesEntriesOf } from './lib/trainingWaitlistReads';
import {
  insertTrainingWaitlistEntry,
  promoteTrainingWaitlistEntry,
} from './lib/trainingWaitlistWrites';
import { getCurrentUser } from './lib/users';

export const join = mutation({
  args: {
    trainingId: v.id('trainings'),
    participant: participantValidator,
    ageConfirmed: v.boolean(),
  },
  returns: v.object({
    trainingWaitlistEntryId: v.id('trainingWaitlistEntries'),
    position: v.number(),
  }),
  handler: async (ctx, { trainingId, participant: asked, ageConfirmed }) => {
    const user = await requireUser(ctx);
    const found = await publishedTrainingOf(ctx, trainingId);
    if (!found) {
      refuseTrainingRegistration({
        code: TRAINING_NOT_FOUND_CODE,
        message: TRAINING_REGISTRATION_MESSAGES.trainingNotFound,
      });
    }
    const { training, pattern } = found;
    const classes = await classesToAttend(ctx, training._id, dateAtUtcMinus12(Date.now()));
    const { participant, replaced } = await checkedTrainingRegistrant(ctx, {
      userId: user._id,
      training,
      pattern,
      scope: { kind: 'series', classes },
      asked,
      ageConfirmed,
    });
    // The series takes the place of the participant's single-class rows, so a class they fill alone is not full to them.
    const full =
      (await seriesEntryWaits(ctx, training._id)) || !everyClassHasPlace(classes, replaced);
    if (!full) {
      refuseTrainingRegistration({
        code: 'seriesHasPlace',
        message: TRAINING_WAITLIST_MESSAGES.seriesHasPlace,
      });
    }
    const trainingWaitlistEntryId = await insertTrainingWaitlistEntry(ctx, training, {
      userId: user._id,
      participant,
      ...(trainingHasAgeRange(training) && { ageConfirmedAt: Date.now() }),
    });
    const waiting = await waitingSeriesEntriesOf(ctx, training._id);
    return { trainingWaitlistEntryId, position: positionIn(waiting, trainingWaitlistEntryId) };
  },
});

export const promote = mutation({
  args: { trainingWaitlistEntryId: v.id('trainingWaitlistEntries') },
  returns: v.object({ registrationId: v.id('trainingRegistrations') }),
  handler: async (ctx, { trainingWaitlistEntryId }) => {
    // Signed in first, so an unknown entry and another organization's look alike.
    await requireUser(ctx);
    const entry = await ctx.db.get('trainingWaitlistEntries', trainingWaitlistEntryId);
    if (!entry) throw new Error('Not allowed');
    const { training } = await requireTrainingOrganizer(ctx, entry.trainingId);
    if (entry.status !== 'waiting') {
      refuseTrainingRegistration({
        code: 'notWaiting',
        message: TRAINING_WAITLIST_MESSAGES.notWaiting,
      });
    }
    if (!(await ctx.db.get('users', entry.userId))) {
      refuseTrainingRegistration({
        code: 'accountGone',
        message: TRAINING_WAITLIST_MESSAGES.accountGone,
      });
    }
    const classes = await classesToAttend(ctx, training._id, dateAtUtcMinus12(Date.now()));
    if (classes.length === 0) {
      refuseTrainingRegistration({
        code: 'noUpcomingClass',
        message: TRAINING_WAITLIST_MESSAGES.noUpcomingClass,
      });
    }
    const replaced = await replacedBySeries(ctx, training._id, entry.userId, entry.participant);
    if (!everyClassHasPlace(classes, replaced)) {
      refuseTrainingRegistration({
        code: 'noFreePlace',
        message: TRAINING_WAITLIST_MESSAGES.noFreePlace,
      });
    }
    const [first] = await waitingSeriesEntriesOf(ctx, training._id);
    if (first?._id !== entry._id) {
      refuseTrainingRegistration({ code: 'notNext', message: TRAINING_WAITLIST_MESSAGES.notNext });
    }
    return {
      registrationId: await promoteTrainingWaitlistEntry(ctx, entry, training, classes, replaced),
    };
  },
});

/** A guardian's email goes only to the training program's organizers, who contact them. */
export const listForTraining = query({
  args: { trainingId: v.id('trainings') },
  returns: v.array(
    v.object({
      trainingWaitlistEntryId: v.id('trainingWaitlistEntries'),
      name: v.string(),
      guardian: v.optional(v.object({ name: v.string(), email: v.string() })),
      requestedAt: v.number(),
      canPromote: v.boolean(),
    }),
  ),
  handler: async (ctx, { trainingId }) => {
    await requireTrainingOrganizer(ctx, trainingId);
    const waiting = await waitingSeriesEntriesOf(ctx, trainingId);
    const named = await namedParticipants(ctx, waiting);
    const [first] = waiting;
    const classes = await classesToAttend(ctx, trainingId, dateAtUtcMinus12(Date.now()));
    const replaced = first
      ? await replacedBySeries(ctx, trainingId, first.userId, first.participant)
      : [];
    const firstCanBePromoted = classes.length > 0 && everyClassHasPlace(classes, replaced);
    return waiting.map((entry, index) => ({
      trainingWaitlistEntryId: entry._id,
      requestedAt: entry.requestedAt,
      canPromote: index === 0 && firstCanBePromoted,
      ...named[index],
    }));
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- reads only the caller's own rows, and a signed-out caller gets an empty list.
export const listMineForTraining = query({
  args: { orgSlug: v.string(), trainingSlug: v.string() },
  returns: v.array(v.object({ participant: participantValidator, position: v.number() })),
  handler: async (ctx, { orgSlug, trainingSlug }) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    if (!organization) return [];
    const found = await findTrainingBySlugs(ctx, organization, trainingSlug);
    if (found?.program.status !== 'published') return [];
    const waiting = await waitingSeriesEntriesOf(ctx, found.training._id);
    return waiting.flatMap((entry) =>
      entry.userId === user._id
        ? [{ participant: entry.participant, position: positionIn(waiting, entry._id) }]
        : [],
    );
  },
});
