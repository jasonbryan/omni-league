import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';
import { requireTrainingClassOrganizer, requireUser } from './lib/access';
import { SELF_PARTICIPANT, participantValidator } from './lib/individualRegistration';
import { dateAtUtcMinus12 } from './lib/registration';
import { findOrganizationBySlug } from './lib/seasonLookup';
import { findTrainingBySlugs } from './lib/trainingLookup';
import { publicPattern } from './lib/trainingPublicList';
import { trainingClassRegistrantsOf } from './lib/trainingRegistrants';
import {
  TRAINING_NOT_FOUND_CODE,
  TRAINING_REGISTRATION_MESSAGES,
  trainingHasAgeRange,
} from './lib/trainingRegistration';
import {
  classesToAttend,
  minorSeriesRegistrationsOf,
  placesHeldExcluding,
  publishedTrainingOf,
  seriesRegistrationOf,
  singleClassRegistrationsOf,
} from './lib/trainingRegistrationReads';
import {
  checkedTrainingRegistrant,
  refuseTrainingRegistration,
  requestedClassOf,
} from './lib/trainingRegistrationRules';
import {
  insertTrainingClassRegistration,
  insertTrainingSeriesRegistration,
} from './lib/trainingRegistrationWrites';
import { getCurrentUser } from './lib/users';

export const register = mutation({
  args: {
    trainingId: v.id('trainings'),
    classId: v.optional(v.id('trainingClasses')),
    participant: participantValidator,
    ageConfirmed: v.boolean(),
  },
  returns: v.object({ registrationId: v.id('trainingRegistrations') }),
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
    const ageConfirmedAt = trainingHasAgeRange(training) ? Date.now() : undefined;
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
      if (trainingClass.registeredCount >= trainingClass.places) {
        refuseTrainingRegistration({
          code: 'classFull',
          message: TRAINING_REGISTRATION_MESSAGES.classFull(trainingClass.date),
        });
      }
      const registrationId = await insertTrainingClassRegistration(ctx, training, trainingClass, {
        userId: user._id,
        participant,
        ...(ageConfirmedAt !== undefined && { ageConfirmedAt }),
      });
      return { registrationId };
    }
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
    const full = classes.find((row) => placesHeldExcluding(row, replaced) >= row.places);
    if (full) {
      refuseTrainingRegistration({
        code: 'classFull',
        message: TRAINING_REGISTRATION_MESSAGES.classFull(full.date),
      });
    }
    const registrationId = await insertTrainingSeriesRegistration(
      ctx,
      training,
      classes,
      { userId: user._id, participant, ...(ageConfirmedAt !== undefined && { ageConfirmedAt }) },
      replaced,
    );
    return { registrationId };
  },
});

const heldValidator = v.union(v.literal('series'), v.literal('class'));

/** `undefined` for an id that is no scheduled class of the program, so nothing says whether it belongs to another one. */
async function singleClassAnswer(
  ctx: QueryCtx,
  training: Doc<'trainings'>,
  pattern: NonNullable<Doc<'trainings'>['pattern']>,
  rawClassId: string,
  mine: { series: boolean; singles: readonly Doc<'trainingRegistrations'>[] },
) {
  const classId = ctx.db.normalizeId('trainingClasses', rawClassId);
  const trainingClass = classId && (await ctx.db.get('trainingClasses', classId));
  if (trainingClass?.trainingId !== training._id || trainingClass.status !== 'scheduled') {
    return undefined;
  }
  const held = mine.series
    ? ('series' as const)
    : mine.singles.some((row) => row.classId === trainingClass._id)
      ? ('class' as const)
      : undefined;
  return {
    classId: trainingClass._id,
    date: trainingClass.date,
    startTime: trainingClass.startTime,
    endTime: trainingClass.endTime,
    placesLeft: Math.max(0, trainingClass.places - trainingClass.registeredCount),
    allowed: pattern.allowSingleRegistration,
    ...(held && { held }),
  };
}

// eslint-disable-next-line @convex-dev/require-access-control -- deliberately public: a draft or unknown training program answers null, the caller is read only to say whether they hold a place, and no registrant field is returned.
export const getForRegistration = query({
  args: {
    orgSlug: v.string(),
    trainingSlug: v.string(),
    /** The class asked for, as the page's address gives it: text, which may be no id. */
    classId: v.optional(v.string()),
  },
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
      singleClass: v.optional(
        v.object({
          classId: v.id('trainingClasses'),
          date: v.string(),
          startTime: v.string(),
          endTime: v.string(),
          placesLeft: v.number(),
          allowed: v.boolean(),
          held: v.optional(heldValidator),
        }),
      ),
    }),
  ),
  handler: async (ctx, { orgSlug, trainingSlug, classId }) => {
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    if (!organization) return null;
    const found = await findTrainingBySlugs(ctx, organization, trainingSlug);
    // A draft answers like an unknown training program, so nothing says whether its slug exists.
    const published = found && (await publishedTrainingOf(ctx, found.training._id));
    if (!published) return null;
    const { training, pattern } = published;
    const classes = await classesToAttend(ctx, training._id, dateAtUtcMinus12(Date.now()));
    const user = await getCurrentUser(ctx);
    const series = user
      ? await seriesRegistrationOf(ctx, training._id, user._id, SELF_PARTICIPANT)
      : null;
    // A series replaces the single-class places of the account, so a class they fill alone is not full to them.
    // The server's `classFull` answers for a participant who does not hold the place.
    const singles = user ? await singleClassRegistrationsOf(ctx, training._id, user._id) : [];
    const left = classes.map((row) => Math.max(0, row.places - placesHeldExcluding(row, singles)));
    const fullClass = classes.find((row) => placesHeldExcluding(row, singles) >= row.places);
    const singleClass =
      classId === undefined
        ? undefined
        : await singleClassAnswer(ctx, training, pattern, classId, {
            series: series !== null,
            singles: singles.filter((row) => row.participant.kind === 'self'),
          });
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
      registered: series !== null,
      ...(singleClass && { singleClass }),
    };
  },
});

// eslint-disable-next-line @convex-dev/require-access-control -- reads only the caller's own rows, and a signed-out caller gets nothing.
export const listMineForTraining = query({
  args: { orgSlug: v.string(), trainingSlug: v.string() },
  returns: v.object({
    self: v.boolean(),
    minorNames: v.array(v.string()),
    /** The classes the caller registered for one by one; the series is in `self` and `minorNames`. */
    classes: v.array(
      v.object({
        classId: v.id('trainingClasses'),
        self: v.boolean(),
        minorNames: v.array(v.string()),
      }),
    ),
  }),
  handler: async (ctx, { orgSlug, trainingSlug }) => {
    const none = { self: false, minorNames: [], classes: [] };
    const user = await getCurrentUser(ctx);
    if (!user) return none;
    const organization = await findOrganizationBySlug(ctx, orgSlug);
    if (!organization) return none;
    const found = await findTrainingBySlugs(ctx, organization, trainingSlug);
    if (found?.program.status !== 'published') return none;
    const trainingId = found.training._id;
    const selfSeries = await seriesRegistrationOf(ctx, trainingId, user._id, SELF_PARTICIPANT);
    const seriesMinors = await minorSeriesRegistrationsOf(ctx, trainingId, user._id);
    const singles = await singleClassRegistrationsOf(ctx, trainingId, user._id);
    // The index orders by key; the guardian reads them in the order they were registered.
    const byRegistered = (a: Doc<'trainingRegistrations'>, b: Doc<'trainingRegistrations'>) =>
      a._creationTime - b._creationTime;
    const classes = new Map<
      Id<'trainingClasses'>,
      { classId: Id<'trainingClasses'>; self: boolean; minorNames: string[] }
    >();
    for (const row of singles.sort(byRegistered)) {
      if (row.classId === undefined) continue;
      const entry = classes.get(row.classId) ?? {
        classId: row.classId,
        self: false,
        minorNames: [],
      };
      if (row.participant.kind === 'minor') entry.minorNames.push(row.participant.minorName);
      else entry.self = true;
      classes.set(row.classId, entry);
    }
    return {
      self: selfSeries !== null,
      minorNames: seriesMinors
        .sort(byRegistered)
        .flatMap(({ participant }) =>
          participant.kind === 'minor' ? [participant.minorName] : [],
        ),
      classes: [...classes.values()],
    };
  },
});

export const listForClass = query({
  args: { trainingClassId: v.id('trainingClasses') },
  returns: v.array(
    v.object({
      registrationId: v.id('trainingRegistrations'),
      name: v.string(),
      kind: heldValidator,
      guardian: v.optional(v.object({ name: v.string(), email: v.string() })),
      registeredAt: v.number(),
    }),
  ),
  handler: async (ctx, { trainingClassId }) => {
    const { trainingClass } = await requireTrainingClassOrganizer(ctx, trainingClassId);
    return trainingClassRegistrantsOf(ctx, trainingClass);
  },
});
