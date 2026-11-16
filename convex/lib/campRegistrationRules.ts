import { ConvexError } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { CAMP_REGISTRATION_MESSAGES, type CampRegistrationRefusal } from './campRegistration';
import { minorRegistrationsOf, minorWaitlistEntriesOf } from './campRegistrationReads';
import { CAMP_WAITLIST_MESSAGES, type CampWaitlistCode } from './campWaitlist';
import {
  MAX_MINORS_PER_SESSION,
  adultMayRegister,
  childNameError,
  minorMayRegister,
  participantKey,
  type Participant,
} from './individualRegistration';
import { checkMinorName } from './minorName';
import { registrationIsOpen } from './registration';

export function refuseRegistration(
  refusal: Omit<CampRegistrationRefusal, 'code'> & {
    code: CampRegistrationRefusal['code'] | CampWaitlistCode;
  },
): never {
  // Spread: `ConvexError` data must be a plain object value, which an interface is not.
  throw new ConvexError({ ...refusal });
}

/** The team minors' name rule, so one name is one key however it was typed. */
export function checkedParticipant(participant: Participant): Participant {
  if (participant.kind === 'self') return participant;
  const checked = checkMinorName(participant.minorName);
  if (!checked.ok) throw new ConvexError({ ...childNameError(checked.error) });
  return { kind: 'minor', minorName: checked.name };
}

/** Whether the session has a place is the caller's to check. */
export async function checkedRegistrant(
  ctx: Pick<QueryCtx, 'db'>,
  {
    userId,
    session,
    camp,
    asked,
    ageConfirmed,
  }: {
    userId: Doc<'users'>['_id'];
    session: Doc<'campSessions'>;
    camp: Doc<'camps'>;
    asked: Participant;
    ageConfirmed: boolean;
  },
): Promise<Participant> {
  if (!registrationIsOpen(session, Date.now())) {
    refuseRegistration({
      code: 'registrationClosed',
      message: CAMP_REGISTRATION_MESSAGES.registrationClosed,
    });
  }
  const participant = checkedParticipant(asked);
  const key = participantKey(participant);
  const existing = await ctx.db
    .query('campRegistrations')
    .withIndex('by_sessionId_and_userId_and_participantKey', (q) =>
      q.eq('sessionId', session._id).eq('userId', userId).eq('participantKey', key),
    )
    .first();
  const minorField = participant.kind === 'minor' && { field: 'minorName' as const };
  if (existing) {
    refuseRegistration({
      code: 'alreadyRegistered',
      ...minorField,
      message: CAMP_REGISTRATION_MESSAGES.alreadyRegistered(existing.participant),
    });
  }
  const waiting = await ctx.db
    .query('campWaitlistEntries')
    .withIndex('by_sessionId_and_userId_and_participantKey', (q) =>
      q.eq('sessionId', session._id).eq('userId', userId).eq('participantKey', key),
    )
    .order('desc')
    .first();
  if (waiting?.status === 'waiting') {
    refuseRegistration({
      code: 'alreadyWaiting',
      ...minorField,
      message: CAMP_WAITLIST_MESSAGES.alreadyWaiting(waiting.participant),
    });
  }
  if (participant.kind === 'self' && !adultMayRegister(camp.maximumAge)) {
    refuseRegistration({
      code: 'adultNotAllowed',
      message: CAMP_REGISTRATION_MESSAGES.adultNotAllowed(camp.maximumAge),
    });
  }
  if (participant.kind === 'minor' && !minorMayRegister(camp.minimumAge)) {
    refuseRegistration({
      code: 'minorNotAllowed',
      message: CAMP_REGISTRATION_MESSAGES.minorNotAllowed(camp.minimumAge),
    });
  }
  if (!ageConfirmed) {
    refuseRegistration({
      code: 'ageNotConfirmed',
      field: 'ageConfirmed',
      message: CAMP_REGISTRATION_MESSAGES.ageNotConfirmed(participant),
    });
  }
  if (participant.kind === 'minor') {
    const held =
      (await minorRegistrationsOf(ctx, session._id, userId)).length +
      (await minorWaitlistEntriesOf(ctx, session._id, userId)).length;
    if (held >= MAX_MINORS_PER_SESSION) {
      refuseRegistration({
        code: 'minorLimit',
        field: 'minorName',
        message: CAMP_REGISTRATION_MESSAGES.minorLimit,
      });
    }
  }
  return participant;
}
