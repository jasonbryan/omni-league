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
import { minorRegistrationsOf, participantRegistrationsOf } from './trainingRegistrationReads';

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
  { kind: 'series'; classCount: number } | { kind: 'class'; trainingClass: Doc<'trainingClasses'> };

/** The stored name is the one a guardian knows the child by, whatever case or spacing they typed now. */
function refuseIfHeld(
  scope: RegistrationScope,
  participant: Participant,
  held: readonly Doc<'trainingRegistrations'>[],
): void {
  const field = participant.kind === 'minor' ? { field: 'minorName' as const } : {};
  const series = held.find((row) => row.classId === undefined);
  if (series) {
    refuseTrainingRegistration({
      code: 'alreadyRegistered',
      ...field,
      message: TRAINING_REGISTRATION_MESSAGES.alreadyRegistered(series.participant),
    });
  }
  const single =
    scope.kind === 'class' && held.find((row) => row.classId === scope.trainingClass._id);
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
  } else if (scope.classCount === 0 || dateAtUtcMinus12(nowMs) > pattern.registrationDeadline) {
    refuseTrainingRegistration({
      code: 'registrationClosed',
      message: TRAINING_REGISTRATION_MESSAGES.registrationClosed,
    });
  }
}

/** Whether each class has a place is the caller's to check. */
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
): Promise<{ participant: Participant; held: Doc<'trainingRegistrations'>[] }> {
  refuseIfClosed(scope, pattern);
  const participant = checkedParticipant(asked);
  const held = await participantRegistrationsOf(
    ctx,
    training._id,
    userId,
    participantKey(participant),
  );
  refuseIfHeld(scope, participant, held);
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
  if (participant.kind === 'minor' && held.length === 0) {
    const minors = await minorRegistrationsOf(ctx, training._id, userId);
    if (new Set(minors.map((row) => row.participantKey)).size >= MAX_MINORS_PER_SESSION) {
      refuseTrainingRegistration({
        code: 'minorLimit',
        field: 'minorName',
        message: TRAINING_REGISTRATION_MESSAGES.minorLimit,
      });
    }
  }
  return { participant, held };
}
