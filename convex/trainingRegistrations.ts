import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireUser } from './lib/access';
import { SELF_KEY, participantValidator } from './lib/individualRegistration';
import { dateAtUtcMinus12 } from './lib/registration';
import { findOrganizationBySlug } from './lib/seasonLookup';
import { findTrainingBySlugs } from './lib/trainingLookup';
import { publicPattern } from './lib/trainingPublicList';
import {
  TRAINING_NOT_FOUND_CODE,
  TRAINING_REGISTRATION_MESSAGES,
  trainingHasAgeRange,
} from './lib/trainingRegistration';
import {
  classesToAttend,
  minorRegistrationsOf,
  publishedTrainingOf,
} from './lib/trainingRegistrationReads';
import {
  checkedTrainingRegistrant,
  refuseTrainingRegistration,
} from './lib/trainingRegistrationRules';
import { insertTrainingSeriesRegistration } from './lib/trainingRegistrationWrites';
import { getCurrentUser } from './lib/users';

export const register = mutation({
  args: {
    trainingId: v.id('trainings'),
    participant: participantValidator,
    ageConfirmed: v.boolean(),
  },
  returns: v.object({ registrationId: v.id('trainingRegistrations') }),
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
    const participant = await checkedTrainingRegistrant(ctx, {
      userId: user._id,
      training,
      pattern,
      classCount: classes.length,
      asked,
      ageConfirmed,
    });
    const full = classes.find((row) => row.registeredCount >= row.places);
    if (full) {
      refuseTrainingRegistration({
        code: 'classFull',
        message: TRAINING_REGISTRATION_MESSAGES.classFull(full.date),
      });
    }
    const registrationId = await insertTrainingSeriesRegistration(ctx, training, classes, {
      userId: user._id,
      participant,
      ...(trainingHasAgeRange(training) && { ageConfirmedAt: Date.now() }),
    });
    return { registrationId };
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: a draft or unknown training program answers null, the caller is read only to say whether they hold a place, and no registrant field is returned.
export const getForRegistration = query({
  args: { orgSlug: v.string(), trainingSlug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      trainingId: v.id('trainings'),
      organizationName: v.string(),
      name: v.string(),
      minimumAge: v.optional(v.number()),
      maximumAge: v.optional(v.number()),
      pattern: v.object({
        weekday: v.number(),
        startTime: v.string(),
        endTime: v.string(),
        firstDate: v.string(),
        weeks: v.number(),
        registrationDeadline: v.string(),
      }),
      classCount: v.number(),
      placesLeft: v.number(),
      fullClassDate: v.optional(v.string()),
      registered: v.boolean(),
    }),
  ),
  handler: async (ctx, { orgSlug, trainingSlug }) => {
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    if (!organization) return null;
    const found = await findTrainingBySlugs(ctx, organization, trainingSlug);
    // A draft answers like an unknown training program, so nothing says whether its slug exists.
    const published = found && (await publishedTrainingOf(ctx, found.training._id));
    if (!published) return null;
    const { training, pattern } = published;
    const classes = await classesToAttend(ctx, training._id, dateAtUtcMinus12(Date.now()));
    const left = classes.map((row) => Math.max(0, row.places - row.registeredCount));
    const fullClass = classes.find((row) => row.registeredCount >= row.places);
    const user = await getCurrentUser(ctx);
    const held = user
      ? await ctx.db
          .query('trainingRegistrations')
          .withIndex('by_trainingId_and_userId_and_participantKey', (q) =>
            q.eq('trainingId', training._id).eq('userId', user._id).eq('participantKey', SELF_KEY),
          )
          .first()
      : null;
    return {
      trainingId: training._id,
      organizationName: organization.name,
      name: found.program.name,
      ...(training.minimumAge !== undefined && { minimumAge: training.minimumAge }),
      ...(training.maximumAge !== undefined && { maximumAge: training.maximumAge }),
      pattern: publicPattern(pattern),
      classCount: classes.length,
      placesLeft: left.length === 0 ? 0 : Math.min(...left),
      ...(fullClass && { fullClassDate: fullClass.date }),
      registered: held !== null,
    };
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- reads only the caller's own rows, and a signed-out caller gets nothing.
export const listMineForTraining = query({
  args: { orgSlug: v.string(), trainingSlug: v.string() },
  returns: v.object({ self: v.boolean(), minorNames: v.array(v.string()) }),
  handler: async (ctx, { orgSlug, trainingSlug }) => {
    const none = { self: false, minorNames: [] };
    const user = await getCurrentUser(ctx);
    if (!user) return none;
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    if (!organization) return none;
    const found = await findTrainingBySlugs(ctx, organization, trainingSlug);
    if (found?.program.status !== 'published') return none;
    const self = await ctx.db
      .query('trainingRegistrations')
      .withIndex('by_trainingId_and_userId_and_participantKey', (q) =>
        q
          .eq('trainingId', found.training._id)
          .eq('userId', user._id)
          .eq('participantKey', SELF_KEY),
      )
      .first();
    const minors = await minorRegistrationsOf(ctx, found.training._id, user._id);
    // The index orders by name; the guardian reads them in the order they were registered.
    minors.sort((a, b) => a._creationTime - b._creationTime);
    return {
      self: self !== null,
      minorNames: minors.flatMap(({ participant }) =>
        participant.kind === 'minor' ? [participant.minorName] : [],
      ),
    };
  },
});
