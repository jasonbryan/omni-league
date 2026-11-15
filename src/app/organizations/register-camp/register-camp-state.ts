import type { FunctionReturnType } from 'convex/server';
import type { api } from '../../../../convex/_generated/api';
import { participantsOffered } from '../../../../convex/lib/individualRegistration';
import { registrationIsOpen } from '../../../../convex/lib/registration';
import { formatCalendarDate } from '../../../../convex/lib/seasonInput';

export type CampRegistrationAnswer = FunctionReturnType<
  typeof api.campRegistrations.getForRegistration
>;

type CampSessionAnswer = NonNullable<NonNullable<CampRegistrationAnswer>['session']>;

export type RegisterCampState =
  | 'loading'
  | 'not-found'
  | 'signed-out'
  | 'no-session'
  | 'registered'
  | 'adult-not-allowed'
  | 'minor-not-allowed'
  | 'closed'
  | 'full'
  | 'form';

/** Who the form offers: the guardian cannot register themself twice, so a held place leaves only the child. */
export function registrationOptions(
  answer: NonNullable<CampRegistrationAnswer>,
): ('self' | 'minor')[] {
  return participantsOffered(answer).filter((kind) => kind !== 'self' || !answer.registered);
}

/** "Registered" comes before the rest once nothing else can be registered, so a person holding a place still sees it after the deadline or when the session is full. */
export function registerCampState({
  answer,
  signedIn,
  nowMs,
}: {
  answer: CampRegistrationAnswer | undefined;
  signedIn: boolean;
  nowMs: number;
}): RegisterCampState {
  if (answer === undefined) return 'loading';
  if (answer === null) return 'not-found';
  if (!signedIn) return 'signed-out';
  const { session } = answer;
  if (session === null) return 'no-session';
  const noOptionLeft = registrationOptions(answer).length === 0;
  const open = registrationIsOpen(session, nowMs);
  if (answer.registered && (noOptionLeft || !open || session.placesLeft === 0)) return 'registered';
  if (noOptionLeft) return 'adult-not-allowed';
  if (!open) return 'closed';
  return session.placesLeft === 0 ? 'full' : 'form';
}

/** Registration also closes when the session starts, so a deadline on or after the start date is not the day it closed. */
export function campClosedLine(
  session: Pick<CampSessionAnswer, 'registrationDeadline' | 'startDate'>,
): string {
  return session.registrationDeadline < session.startDate
    ? `It closed on ${formatCalendarDate(session.registrationDeadline)}.`
    : `It closed when the session started on ${formatCalendarDate(session.startDate)}.`;
}
