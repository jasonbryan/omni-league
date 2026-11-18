import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../../convex/_generated/api';
import { participantsOffered } from '../../../../convex/lib/individualRegistration';
import { dateAtUtcMinus12 } from '../../../../convex/lib/registration';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';

export type TrainingRegistrationAnswer = FunctionReturnType<
  typeof api.trainingRegistrations.getForRegistration
>;

type Answer = NonNullable<TrainingRegistrationAnswer>;

export type RegisterTrainingState =
  'loading' | 'not-found' | 'signed-out' | 'registered' | 'closed' | 'full' | 'form';

/** Who the form offers: the account holder cannot register twice for themself, so a held place leaves only the child. */
export function registrationOptions(answer: Answer): ('self' | 'minor')[] {
  return participantsOffered(answer).filter((kind) => kind !== 'self' || !answer.registered);
}

type Schedule = Pick<Answer, 'classCount' | 'pattern'>;

function isOpen(answer: Schedule, nowMs: number): boolean {
  return answer.classCount > 0 && dateAtUtcMinus12(nowMs) <= answer.pattern.registrationDeadline;
}

/** "Registered" comes first once nothing else can be asked for, so a person holding a place still sees it after the deadline or when a class is full. */
export function registerTrainingState({
  answer,
  signedIn,
  nowMs,
}: {
  answer: TrainingRegistrationAnswer | undefined;
  signedIn: boolean;
  nowMs: number;
}): RegisterTrainingState {
  if (answer === undefined) return 'loading';
  if (answer === null) return 'not-found';
  if (!signedIn) return 'signed-out';
  const open = isOpen(answer, nowMs);
  const full = answer.fullClassDate !== undefined;
  if (answer.registered && (registrationOptions(answer).length === 0 || !open || full)) {
    return 'registered';
  }
  if (!open) return 'closed';
  return full ? 'full' : 'form';
}

export function trainingClosedLine(answer: Schedule, nowMs: number): string {
  return dateAtUtcMinus12(nowMs) > answer.pattern.registrationDeadline
    ? `It closed on ${formatCalendarDate(answer.pattern.registrationDeadline)}.`
    : 'Every class has passed or is cancelled.';
}
