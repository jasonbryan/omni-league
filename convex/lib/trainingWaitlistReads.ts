import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import {
  MINOR_KEY_END,
  MINOR_KEY_PREFIX,
  MAX_MINORS_PER_SESSION,
  participantKey,
  type Participant,
} from './individualRegistration';
import { MAX_TRAINING_WEEKS } from './trainingPattern';
import { CLASS_KEY_END, CLASS_KEY_PREFIX } from './trainingRegistration';
import { WAITLIST_READ_LIMIT } from './waitlist';

const BY_QUEUE = 'by_trainingId_and_classId_and_status_and_requestedAt';

export function waitingSeriesEntriesOf(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
): Promise<Doc<'trainingWaitlistEntries'>[]> {
  return ctx.db
    .query('trainingWaitlistEntries')
    .withIndex(BY_QUEUE, (q) =>
      q.eq('trainingId', trainingId).eq('classId', undefined).eq('status', 'waiting'),
    )
    .take(WAITLIST_READ_LIMIT);
}

export function waitingClassEntriesOf(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
  classId: Id<'trainingClasses'>,
): Promise<Doc<'trainingWaitlistEntries'>[]> {
  return ctx.db
    .query('trainingWaitlistEntries')
    .withIndex(BY_QUEUE, (q) =>
      q.eq('trainingId', trainingId).eq('classId', classId).eq('status', 'waiting'),
    )
    .take(WAITLIST_READ_LIMIT);
}

async function classEntryWaits(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
  classId: Id<'trainingClasses'>,
): Promise<boolean> {
  const first = await ctx.db
    .query('trainingWaitlistEntries')
    .withIndex(BY_QUEUE, (q) =>
      q.eq('trainingId', trainingId).eq('classId', classId).eq('status', 'waiting'),
    )
    .first();
  return first !== null;
}

/** A waiting class entry holds the next place of its class, so that class counts as full to a new registration. */
export async function classesWithWaitingEntries(
  ctx: Pick<QueryCtx, 'db'>,
  classes: readonly Doc<'trainingClasses'>[],
  /** The participant's own entries do not hold a class up for the series they are about to take. */
  except?: { userId: Id<'users'>; participant: Participant },
): Promise<Set<Id<'trainingClasses'>>> {
  const held = new Set<Id<'trainingClasses'>>();
  const exceptKey = except && participantKey(except.participant);
  for (const row of classes) {
    if (except === undefined) {
      if (await classEntryWaits(ctx, row.trainingId, row._id)) held.add(row._id);
      continue;
    }
    const waiting = await waitingClassEntriesOf(ctx, row.trainingId, row._id);
    if (
      waiting.some(
        (entry) =>
          entry.userId !== except.userId || participantKey(entry.participant) !== exceptKey,
      )
    ) {
      held.add(row._id);
    }
  }
  return held;
}

export async function waitlistHoldsClass(
  ctx: Pick<QueryCtx, 'db'>,
  trainingClass: Doc<'trainingClasses'>,
): Promise<boolean> {
  return (
    (await seriesEntryWaits(ctx, trainingClass.trainingId)) ||
    (await classEntryWaits(ctx, trainingClass.trainingId, trainingClass._id))
  );
}

/** A waiting series entry holds the next place in every class, so each class counts as full to a new registration. */
export async function seriesEntryWaits(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
): Promise<boolean> {
  const first = await ctx.db
    .query('trainingWaitlistEntries')
    .withIndex(BY_QUEUE, (q) =>
      q.eq('trainingId', trainingId).eq('classId', undefined).eq('status', 'waiting'),
    )
    .first();
  return first !== null;
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

// Each of the account holder and 20 children waits for at most one entry of each class.
const CLASS_ENTRIES_LIMIT = (MAX_MINORS_PER_SESSION + 1) * MAX_TRAINING_WEEKS;

export async function waitingClassEntriesOfUser(
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
        .gte('participantKey', CLASS_KEY_PREFIX)
        .lt('participantKey', CLASS_KEY_END),
    )
    .take(CLASS_ENTRIES_LIMIT);
  return entries.filter((entry) => entry.status === 'waiting');
}
