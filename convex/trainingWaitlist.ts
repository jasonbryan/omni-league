import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
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
  requestedClassOf,
} from './lib/trainingRegistrationRules';
import { TRAINING_WAITLIST_MESSAGES } from './lib/trainingWaitlist';
import {
  participantHoldsPlace,
  positionIn,
  queueRowsOf,
  waitingQueueOf,
} from './lib/trainingWaitlistQueue';
import {
  classesWithWaitingEntries,
  seriesEntryWaits,
  waitlistHoldsClass,
} from './lib/trainingWaitlistReads';
import {
  deleteWaitingClassEntriesOf,
  insertTrainingWaitlistEntry,
  promoteTrainingClassEntry,
  promoteTrainingWaitlistEntry,
} from './lib/trainingWaitlistWrites';
import { getCurrentUser } from './lib/users';

export const join = mutation({
  args: {
    trainingId: v.id('trainings'),
    /** Set to wait for one full class; absent for the series. */
    classId: v.optional(v.id('trainingClasses')),
    participant: participantValidator,
    ageConfirmed: v.boolean(),
  },
  returns: v.object({
    trainingWaitlistEntryId: v.id('trainingWaitlistEntries'),
    position: v.number(),
  }),
  handler: async (ctx, { trainingId, classId, participant: asked, ageConfirmed }) => {
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
    const ageConfirmedAt = trainingHasAgeRange(training) ? Date.now() : undefined;
    let entryId: Id<'trainingWaitlistEntries'>;
    if (classId !== undefined) {
      const trainingClass = await requestedClassOf(ctx, training, pattern, classId);
      const { participant } = await checkedTrainingRegistrant(ctx, {
        userId: user._id,
        training,
        pattern,
        scope: { kind: 'class', trainingClass },
        asked,
        ageConfirmed,
      });
      const full =
        trainingClass.registeredCount >= trainingClass.places ||
        (await waitlistHoldsClass(ctx, trainingClass));
      if (!full) {
        refuseTrainingRegistration({
          code: 'classHasPlace',
          message: TRAINING_WAITLIST_MESSAGES.classHasPlace,
        });
      }
      entryId = await insertTrainingWaitlistEntry(ctx, training, {
        userId: user._id,
        participant,
        classId,
        ...(ageConfirmedAt !== undefined && { ageConfirmedAt }),
      });
    } else {
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
        !everyClassHasPlace(classes, replaced) ||
        (await seriesEntryWaits(ctx, training._id)) ||
        (await classesWithWaitingEntries(ctx, classes, { userId: user._id, participant })).size > 0;
      if (!full) {
        refuseTrainingRegistration({
          code: 'seriesHasPlace',
          message: TRAINING_WAITLIST_MESSAGES.seriesHasPlace,
        });
      }
      await deleteWaitingClassEntriesOf(ctx, training._id, user._id, participant);
      entryId = await insertTrainingWaitlistEntry(ctx, training, {
        userId: user._id,
        participant,
        ...(ageConfirmedAt !== undefined && { ageConfirmedAt }),
      });
    }
    const entry = (await ctx.db.get('trainingWaitlistEntries', entryId))!;
    const queue = await waitingQueueOf(ctx, training._id, classes);
    return { trainingWaitlistEntryId: entryId, position: positionIn(queue, entry) };
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
    const trainingClass = classes.find((row) => row._id === entry.classId);
    if (entry.classId !== undefined && !trainingClass) {
      refuseTrainingRegistration({
        code: 'classGone',
        message: TRAINING_WAITLIST_MESSAGES.classGone,
      });
    }
    if (classes.length === 0) {
      refuseTrainingRegistration({
        code: 'noUpcomingClass',
        message: TRAINING_WAITLIST_MESSAGES.noUpcomingClass,
      });
    }
    if (await participantHoldsPlace(ctx, entry)) {
      refuseTrainingRegistration({
        code: 'alreadyRegistered',
        message: TRAINING_REGISTRATION_MESSAGES.alreadyRegistered(entry.participant),
      });
    }
    const rows = await queueRowsOf(ctx, classes, await waitingQueueOf(ctx, training._id, classes));
    const row = rows.find((other) => other.entry._id === entry._id);
    if (!row?.hasPlace) {
      refuseTrainingRegistration({
        code: 'noFreePlace',
        message:
          entry.classId === undefined
            ? TRAINING_WAITLIST_MESSAGES.noFreePlace
            : TRAINING_WAITLIST_MESSAGES.noFreePlaceInClass,
      });
    }
    if (!row.next) {
      refuseTrainingRegistration({ code: 'notNext', message: TRAINING_WAITLIST_MESSAGES.notNext });
    }
    if (trainingClass) {
      return {
        registrationId: await promoteTrainingClassEntry(ctx, entry, training, trainingClass),
      };
    }
    const replaced = await replacedBySeries(ctx, training._id, entry.userId, entry.participant);
    await deleteWaitingClassEntriesOf(ctx, training._id, entry.userId, entry.participant);
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
      /** Whether the places the entry needs are free, whatever its turn. */
      hasPlace: v.boolean(),
      /** Set for an entry that waits for one class; absent for the series. */
      classId: v.optional(v.id('trainingClasses')),
      classDate: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { trainingId }) => {
    await requireTrainingOrganizer(ctx, trainingId);
    const classes = await classesToAttend(ctx, trainingId, dateAtUtcMinus12(Date.now()));
    const waiting = await waitingQueueOf(ctx, trainingId, classes);
    const named = await namedParticipants(ctx, waiting);
    const rows = await queueRowsOf(ctx, classes, waiting);
    return waiting.map((entry, index) => {
      const trainingClass = classes.find((row) => row._id === entry.classId);
      return {
        trainingWaitlistEntryId: entry._id,
        requestedAt: entry.requestedAt,
        canPromote: rows[index].next,
        hasPlace: rows[index].hasPlace,
        ...(trainingClass && { classId: trainingClass._id, classDate: trainingClass.date }),
        ...named[index],
      };
    });
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- reads only the caller's own rows, and a signed-out caller gets an empty list.
export const listMineForTraining = query({
  args: { orgSlug: v.string(), trainingSlug: v.string() },
  returns: v.array(v.object({ participant: participantValidator, position: v.number() })),
  handler: async (ctx, { orgSlug, trainingSlug }) => {
    const mine = await mineOf(ctx, orgSlug, trainingSlug);
    return mine.flatMap(({ entry, position }) =>
      entry.classId === undefined ? [{ participant: entry.participant, position }] : [],
    );
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- reads only the caller's own rows, and a signed-out caller gets an empty list.
export const listMineForClasses = query({
  args: { orgSlug: v.string(), trainingSlug: v.string() },
  returns: v.array(
    v.object({
      classId: v.id('trainingClasses'),
      participant: participantValidator,
      position: v.number(),
    }),
  ),
  handler: async (ctx, { orgSlug, trainingSlug }) => {
    const mine = await mineOf(ctx, orgSlug, trainingSlug);
    return mine.flatMap(({ entry, position }) =>
      entry.classId === undefined
        ? []
        : [{ classId: entry.classId, participant: entry.participant, position }],
    );
  },
});

async function mineOf(ctx: QueryCtx, orgSlug: string, trainingSlug: string) {
  const user = await getCurrentUser(ctx);
  if (!user) return [];
  const organization = await findOrganizationBySlug(ctx, orgSlug);
  if (!organization) return [];
  const found = await findTrainingBySlugs(ctx, organization, trainingSlug);
  if (found?.program.status !== 'published') return [];
  const classes = await classesToAttend(ctx, found.training._id, dateAtUtcMinus12(Date.now()));
  const waiting = await waitingQueueOf(ctx, found.training._id, classes);
  return waiting.flatMap((entry) =>
    entry.userId === user._id ? [{ entry, position: positionIn(waiting, entry) }] : [],
  );
}
