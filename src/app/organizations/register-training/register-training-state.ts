import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../../convex/_generated/api';
import { participantsOffered } from '../../../../convex/lib/individualRegistration';
import { dateAtUtcMinus12 } from '../../../../convex/lib/registration';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';
import { trainingClassDate } from '../../../../convex/lib/trainingPattern';
import { singleClassIsOpen } from '../../../../convex/lib/trainingRegistration';

export type TrainingRegistrationAnswer = FunctionReturnType<
  typeof api.trainingRegistrations.getForRegistration
>;

type Answer = NonNullable<TrainingRegistrationAnswer>;

export type RegisterTrainingState =
  | 'loading'
  | 'not-found'
  | 'signed-out'
  | 'registered'
  | 'closed'
  | 'full'
  | 'form'
  | 'class-not-open'
  | 'single-not-allowed';

function selfHoldsPlace(answer: Answer): boolean {
  return answer.singleClass === undefined
    ? answer.registered
    : answer.singleClass.held !== undefined;
}

/** Who the form offers: the account holder cannot register twice for themself, so a held place leaves only the child. */
export function registrationOptions(answer: Answer): ('self' | 'minor')[] {
  return participantsOffered(answer).filter((kind) => kind !== 'self' || !selfHoldsPlace(answer));
}

type Schedule = Pick<Answer, 'classCount' | 'pattern'>;

function isOpen(answer: Schedule, nowMs: number): boolean {
  return answer.classCount > 0 && dateAtUtcMinus12(nowMs) <= answer.pattern.registrationDeadline;
}

/** "Registered" comes first once nothing else can be asked for, so a person holding a place still sees it after the deadline or when a class is full. */
function stateFor(answer: Answer, held: boolean, open: boolean, full: boolean) {
  if (held && (registrationOptions(answer).length === 0 || !open || full)) return 'registered';
  if (!open) return 'closed';
  return full ? 'full' : 'form';
}

export function registerTrainingState({
  answer,
  signedIn,
  nowMs,
  classAsked = false,
}: {
  answer: TrainingRegistrationAnswer | undefined;
  signedIn: boolean;
  nowMs: number;
  classAsked?: boolean;
}): RegisterTrainingState {
  if (answer === undefined) return 'loading';
  if (answer === null) return 'not-found';
  if (!signedIn) return 'signed-out';
  if (classAsked) {
    const { singleClass } = answer;
    if (singleClass === undefined) return 'class-not-open';
    if (!singleClass.allowed) return 'single-not-allowed';
    return stateFor(
      answer,
      singleClass.held !== undefined,
      singleClassIsOpen(singleClass.date, nowMs),
      singleClass.placesLeft === 0,
    );
  }
  return stateFor(
    answer,
    answer.registered,
    isOpen(answer, nowMs),
    answer.fullClassDate !== undefined,
  );
}

export function trainingClosedLine(answer: Schedule, nowMs: number): string {
  return dateAtUtcMinus12(nowMs) > answer.pattern.registrationDeadline
    ? `It closed on ${formatCalendarDate(answer.pattern.registrationDeadline)}.`
    : 'Every class has passed or is cancelled.';
}

export function classClosedLine(classDate: string): string {
  return `It closed after ${trainingClassDate(classDate)}.`;
}
