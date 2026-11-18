import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import {
  classRegistrationOf,
  everyClassHasPlace,
  replacedBySeries,
  seriesRegistrationOf,
} from './trainingRegistrationReads';
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

/** Two entries compete when they need a place in common: a series entry needs one in every class. */
function competes(entry: Entry, other: Entry): boolean {
  return (
    entry.classId === undefined || other.classId === undefined || other.classId === entry.classId
  );
}

/** An entry waits behind the earlier entries that need a place it needs: a series entry behind all of them, a class entry behind the series and its own class. */
export function positionIn(queue: readonly Entry[], entry: Entry): number {
  const index = queue.findIndex((row) => row._id === entry._id);
  const ahead = index === -1 ? queue : queue.slice(0, index);
  return ahead.filter((other) => competes(entry, other)).length + 1;
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

/** A participant can hold a place and still have a waiting entry for it, so promoting it would give a second place. */
export async function participantHoldsPlace(
  ctx: Pick<QueryCtx, 'db'>,
  entry: Entry,
): Promise<boolean> {
  const { trainingId, userId, participant, classId } = entry;
  if (await seriesRegistrationOf(ctx, trainingId, userId, participant)) return true;
  return (
    classId !== undefined &&
    (await classRegistrationOf(ctx, trainingId, userId, classId, participant)) !== null
  );
}

export interface QueueRow {
  entry: Entry;
  hasPlace: boolean;
  /** No earlier entry that needs a place this one needs can be served, so a free place goes to this one. */
  next: boolean;
}

/** An entry whose account is gone, or whose participant already holds the place, cannot be given one, and must not hold up the entries behind it. */
export async function queueRowsOf(
  ctx: Pick<QueryCtx, 'db'>,
  classes: readonly Doc<'trainingClasses'>[],
  queue: readonly Entry[],
): Promise<QueueRow[]> {
  const rows: QueueRow[] = [];
  const served: Entry[] = [];
  for (const entry of queue) {
    const hasPlace = await entryHasPlace(ctx, classes, entry);
    const servable =
      hasPlace &&
      (await ctx.db.get('users', entry.userId)) !== null &&
      !(await participantHoldsPlace(ctx, entry));
    rows.push({
      entry,
      hasPlace,
      next: servable && !served.some((other) => competes(entry, other)),
    });
    if (servable) served.push(entry);
  }
  return rows;
}
