import { ConvexError } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
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
  trainingHasAgeRange,
  type TrainingRegistrationRefusal,
} from './trainingRegistration';
import { minorRegistrationsOf } from './trainingRegistrationReads';

export function refuseTrainingRegistration(refusal: TrainingRegistrationRefusal): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...refusal });
}

/** Whether each class has a place is the caller's to check. */
export async function checkedTrainingRegistrant(
  ctx: Pick<QueryCtx, 'db'>,
  {
    userId,
    training,
    pattern,
    classCount,
    asked,
    ageConfirmed,
  }: {
    userId: Doc<'users'>['_id'];
    training: Doc<'trainings'>;
    pattern: NonNullable<Doc<'trainings'>['pattern']>;
    classCount: number;
    asked: Participant;
    ageConfirmed: boolean;
  },
): Promise<Participant> {
  if (classCount === 0 || dateAtUtcMinus12(Date.now()) > pattern.registrationDeadline) {
    refuseTrainingRegistration({
      code: 'registrationClosed',
      message: TRAINING_REGISTRATION_MESSAGES.registrationClosed,
    });
  }
  const participant = checkedParticipant(asked);
  const key = participantKey(participant);
  const existing = await ctx.db
    .query('trainingRegistrations')
    .withIndex('by_trainingId_and_userId_and_participantKey', (q) =>
      q.eq('trainingId', training._id).eq('userId', userId).eq('participantKey', key),
    )
    .first();
  if (existing) {
    refuseTrainingRegistration({
      code: 'alreadyRegistered',
      ...(participant.kind === 'minor' && { field: 'minorName' as const }),
      message: TRAINING_REGISTRATION_MESSAGES.alreadyRegistered(existing.participant),
    });
  }
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
  if (
    participant.kind === 'minor' &&
    (await minorRegistrationsOf(ctx, training._id, userId)).length >= MAX_MINORS_PER_SESSION
  ) {
    refuseTrainingRegistration({
      code: 'minorLimit',
      field: 'minorName',
      message: TRAINING_REGISTRATION_MESSAGES.minorLimit,
    });
  }
  return participant;
}
