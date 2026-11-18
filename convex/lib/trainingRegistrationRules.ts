import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { checkedParticipant } from './campRegistrationRules';
import {
  MAX_MINORS_PER_SESSION,
  adultMayRegister,
  minorMayRegister,
  participantKey,
  type Participant,
} from './individualRegistration';
import { dateAtUtcMinus12 } from './registration';
import {
  TRAINING_REGISTRATION_MESSAGES,
  singleClassIsOpen,
  trainingHasAgeRange,
  type TrainingRegistrationRefusal,
} from './trainingRegistration';
import {
  classRegistrationOf,
  minorSeriesRegistrationsOf,
  seriesRegistrationOf,
  singleClassRegistrationsOf,
} from './trainingRegistrationReads';

export function refuseTrainingRegistration(refusal: TrainingRegistrationRefusal): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...refusal });
}

/** A class of another program is refused as not open, so nothing says it exists. */
export async function requestedClassOf(
  ctx: Pick<QueryCtx, 'db'>,
  training: Doc<'trainings'>,
  pattern: NonNullable<Doc<'trainings'>['pattern']>,
  classId: Id<'trainingClasses'>,
): Promise<Doc<'trainingClasses'>> {
  if (!pattern.allowSingleRegistration) {
    refuseTrainingRegistration({
      code: 'singleClassNotAllowed',
      message: TRAINING_REGISTRATION_MESSAGES.singleClassNotAllowed,
    });
  }
  const trainingClass = await ctx.db.get('trainingClasses', classId);
  if (trainingClass?.trainingId !== training._id || trainingClass.status !== 'scheduled') {
    refuseTrainingRegistration({
      code: 'classNotFound',
      message: TRAINING_REGISTRATION_MESSAGES.classNotFound,
    });
  }
  return trainingClass;
}

export type RegistrationScope =
  | { kind: 'series'; classes: readonly Doc<'trainingClasses'>[] }
  | { kind: 'class'; trainingClass: Doc<'trainingClasses'> };

/** The stored name is the one a guardian knows the child by, whatever case or spacing they typed now. */
async function refuseIfHeld(
  ctx: Pick<QueryCtx, 'db'>,
  {
    training,
    userId,
    scope,
  }: { training: Doc<'trainings'>; userId: Id<'users'>; scope: RegistrationScope },
  participant: Participant,
): Promise<void> {
  const field = participant.kind === 'minor' ? { field: 'minorName' as const } : {};
  const series = await seriesRegistrationOf(ctx, training._id, userId, participant);
  if (series) {
    refuseTrainingRegistration({
      code: 'alreadyRegistered',
      ...field,
      message: TRAINING_REGISTRATION_MESSAGES.alreadyRegistered(series.participant),
    });
  }
  if (scope.kind !== 'class') return;
  const single = await classRegistrationOf(
    ctx,
    training._id,
    userId,
    scope.trainingClass._id,
    participant,
  );
  if (single) {
    refuseTrainingRegistration({
      code: 'alreadyRegistered',
      ...field,
      message: TRAINING_REGISTRATION_MESSAGES.alreadyRegisteredForClass(
        single.participant,
        scope.trainingClass.date,
      ),
    });
  }
}

function refuseIfClosed(
  scope: RegistrationScope,
  pattern: NonNullable<Doc<'trainings'>['pattern']>,
): void {
  const nowMs = Date.now();
  if (scope.kind === 'class') {
    if (!singleClassIsOpen(scope.trainingClass.date, nowMs)) {
      refuseTrainingRegistration({
        code: 'registrationClosed',
        message: TRAINING_REGISTRATION_MESSAGES.classRegistrationClosed(scope.trainingClass.date),
      });
    }
  } else if (scope.classes.length === 0 || dateAtUtcMinus12(nowMs) > pattern.registrationDeadline) {
    refuseTrainingRegistration({
      code: 'registrationClosed',
      message: TRAINING_REGISTRATION_MESSAGES.registrationClosed,
    });
  }
}

async function distinctMinorKeysOf(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
  userId: Id<'users'>,
): Promise<Set<string>> {
  const series = await minorSeriesRegistrationsOf(ctx, trainingId, userId);
  const singles = await singleClassRegistrationsOf(ctx, trainingId, userId);
  return new Set(
    [...series, ...singles].flatMap(({ participant }) =>
      participant.kind === 'minor' ? [participantKey(participant)] : [],
    ),
  );
}

/** Whether each class has a place is the caller's to check. The single-class rows of a series registrant come back, for the series to replace. */
export async function checkedTrainingRegistrant(
  ctx: Pick<QueryCtx, 'db'>,
  {
    userId,
    training,
    pattern,
    scope,
    asked,
    ageConfirmed,
  }: {
    userId: Doc<'users'>['_id'];
    training: Doc<'trainings'>;
    pattern: NonNullable<Doc<'trainings'>['pattern']>;
    scope: RegistrationScope;
    asked: Participant;
    ageConfirmed: boolean;
  },
): Promise<{ participant: Participant; replaced: Doc<'trainingRegistrations'>[] }> {
  refuseIfClosed(scope, pattern);
  const participant = checkedParticipant(asked);
  await refuseIfHeld(ctx, { training, userId, scope }, participant);
  const { minimumAge, maximumAge } = training;
  if (participant.kind === 'self' && maximumAge !== undefined && !adultMayRegister(maximumAge)) {
    refuseTrainingRegistration({
      code: 'adultNotAllowed',
      message: TRAINING_REGISTRATION_MESSAGES.adultNotAllowed(maximumAge),
    });
  }
  if (participant.kind === 'minor' && minimumAge !== undefined && !minorMayRegister(minimumAge)) {
    refuseTrainingRegistration({
      code: 'minorNotAllowed',
      message: TRAINING_REGISTRATION_MESSAGES.minorNotAllowed(minimumAge),
    });
  }
  if (trainingHasAgeRange(training) && !ageConfirmed) {
    refuseTrainingRegistration({
      code: 'ageNotConfirmed',
      field: 'ageConfirmed',
      message: TRAINING_REGISTRATION_MESSAGES.ageNotConfirmed(participant),
    });
  }
  if (participant.kind === 'minor') {
    const keys = await distinctMinorKeysOf(ctx, training._id, userId);
    if (!keys.has(participantKey(participant)) && keys.size >= MAX_MINORS_PER_SESSION) {
      refuseTrainingRegistration({
        code: 'minorLimit',
        field: 'minorName',
        message: TRAINING_REGISTRATION_MESSAGES.minorLimit,
      });
    }
  }
  const replaced =
    scope.kind === 'series'
      ? (await singleClassRegistrationsOf(ctx, training._id, userId)).filter(
          (row) => participantKey(row.participant) === participantKey(participant),
        )
      : [];
  return { participant, replaced };
}
