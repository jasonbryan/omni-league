import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import {
  MINOR_KEY_END,
  MINOR_KEY_PREFIX,
  MAX_MINORS_PER_SESSION,
  participantKey,
  type Participant,
} from './individualRegistration';
import { WAITLIST_READ_LIMIT } from './waitlist';

export function waitingSeriesEntriesOf(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
): Promise<Doc<'trainingWaitlistEntries'>[]> {
  return ctx.db
    .query('trainingWaitlistEntries')
    .withIndex('by_trainingId_and_classId_and_status_and_requestedAt', (q) =>
      q.eq('trainingId', trainingId).eq('classId', undefined).eq('status', 'waiting'),
    )
    .take(WAITLIST_READ_LIMIT);
}

/** A waiting series entry holds the next place in every class, so each class counts as full to a new registration. */
export async function seriesEntryWaits(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
): Promise<boolean> {
  const first = await ctx.db
    .query('trainingWaitlistEntries')
    .withIndex('by_trainingId_and_classId_and_status_and_requestedAt', (q) =>
      q.eq('trainingId', trainingId).eq('classId', undefined).eq('status', 'waiting'),
    )
    .first();
  return first !== null;
}

export function positionIn(
  waiting: readonly Doc<'trainingWaitlistEntries'>[],
  id: Id<'trainingWaitlistEntries'>,
): number {
  const index = waiting.findIndex((entry) => entry._id === id);
  return index === -1 ? waiting.length + 1 : index + 1;
}

export async function waitingSeriesEntryOf(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
  userId: Id<'users'>,
  participant: Participant,
): Promise<Doc<'trainingWaitlistEntries'> | null> {
  const entry = await ctx.db
    .query('trainingWaitlistEntries')
    .withIndex('by_trainingId_and_userId_and_participantKey', (q) =>
      q
        .eq('trainingId', trainingId)
        .eq('userId', userId)
        .eq('participantKey', participantKey(participant)),
    )
    .order('desc')
    .first();
  return entry?.status === 'waiting' ? entry : null;
}

/** Leaves out a promoted entry: it is already a registration, which the guardian's children count includes. */
export async function waitingMinorEntriesOf(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
  userId: Id<'users'>,
): Promise<Doc<'trainingWaitlistEntries'>[]> {
  const entries = await ctx.db
    .query('trainingWaitlistEntries')
    .withIndex('by_trainingId_and_userId_and_participantKey', (q) =>
      q
        .eq('trainingId', trainingId)
        .eq('userId', userId)
        .gte('participantKey', MINOR_KEY_PREFIX)
        .lt('participantKey', MINOR_KEY_END),
    )
    .take(MAX_MINORS_PER_SESSION);
  return entries.filter((entry) => entry.status === 'waiting');
}
