import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { everyClassHasPlace, replacedBySeries } from './trainingRegistrationReads';
import { waitingClassEntriesOf, waitingSeriesEntriesOf } from './trainingWaitlistReads';
import { WAITLIST_READ_LIMIT } from './waitlist';

type Entry = Doc<'trainingWaitlistEntries'>;

const byJoined = (a: Entry, b: Entry) =>
  a.requestedAt - b.requestedAt || a._creationTime - b._creationTime;

export async function waitingQueueOf(
  ctx: Pick<QueryCtx, 'db'>,
  trainingId: Id<'trainings'>,
  classes: readonly Doc<'trainingClasses'>[],
): Promise<Entry[]> {
  const queue = await waitingSeriesEntriesOf(ctx, trainingId);
  for (const row of classes) queue.push(...(await waitingClassEntriesOf(ctx, trainingId, row._id)));
  return queue.sort(byJoined).slice(0, WAITLIST_READ_LIMIT);
}

/** An entry waits behind the earlier entries that need a place it needs: a series entry behind all of them, a class entry behind the series and its own class. */
export function positionIn(queue: readonly Entry[], entry: Entry): number {
  const competes = (other: Entry) =>
    entry.classId === undefined || other.classId === undefined || other.classId === entry.classId;
  const index = queue.findIndex((row) => row._id === entry._id);
  const ahead = index === -1 ? queue : queue.slice(0, index);
  return ahead.filter(competes).length + 1;
}

export async function entryHasPlace(
  ctx: Pick<QueryCtx, 'db'>,
  classes: readonly Doc<'trainingClasses'>[],
  entry: Entry,
): Promise<boolean> {
  if (entry.classId !== undefined) {
    const row = classes.find(({ _id }) => _id === entry.classId);
    return row !== undefined && row.registeredCount < row.places;
  }
  if (classes.length === 0) return false;
  const replaced = await replacedBySeries(ctx, entry.trainingId, entry.userId, entry.participant);
  return everyClassHasPlace(classes, replaced);
}

/** A free place goes to the earliest entry that it satisfies, so an earlier entry that still lacks a place elsewhere does not hold up a later one. */
export async function firstServableEntry(
  ctx: Pick<QueryCtx, 'db'>,
  classes: readonly Doc<'trainingClasses'>[],
  queue: readonly Entry[],
): Promise<Entry | null> {
  for (const entry of queue) {
    // An entry whose account is gone cannot be given a place, and must not hold up the entries behind it.
    if (!(await ctx.db.get('users', entry.userId))) continue;
    if (await entryHasPlace(ctx, classes, entry)) return entry;
  }
  return null;
}
