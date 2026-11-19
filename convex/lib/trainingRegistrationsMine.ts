import { v, type Infer } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { today } from './campPublicList';
import { participantValidator } from './individualRegistration';
import {
  UPCOMING_ROWS_LIMIT,
  MINE_SCAN_LIMIT,
  lookupOnce,
  publishedProgramSummary,
} from './myRegistrations';
import { classesToAttend } from './trainingRegistrationReads';
import { positionIn, waitingQueueOf } from './trainingWaitlistQueue';

export const trainingMineRowValidator = v.object({
  /** The id of the registration or of the waiting entry, so each row of a list has its own key. */
  rowId: v.string(),
  /** A series holds a place in every class; a class is one place. */
  kind: v.union(v.literal('series'), v.literal('class')),
  status: v.union(v.literal('registered'), v.literal('waiting')),
  /** Set on a waiting row. */
  position: v.optional(v.number()),
  participant: participantValidator,
  organizationName: v.string(),
  organizationSlug: v.string(),
  trainingName: v.string(),
  trainingSlug: v.string(),
  /** The class itself, or a series' next one. */
  classDate: v.string(),
  startTime: v.string(),
  endTime: v.string(),
  locations: v.array(v.string()),
});

export type TrainingMineRow = Infer<typeof trainingMineRowValidator>;

type Held = Pick<
  Doc<'trainingRegistrations'> | Doc<'trainingWaitlistEntries'>,
  '_id' | '_creationTime' | 'trainingId' | 'classId' | 'participant'
>;

export async function trainingRowsOf(
  ctx: Pick<QueryCtx, 'db'>,
  userId: Id<'users'>,
): Promise<TrainingMineRow[]> {
  const registrations = await ctx.db
    .query('trainingRegistrations')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .order('desc')
    .take(MINE_SCAN_LIMIT);
  const entries = (
    await ctx.db
      .query('trainingWaitlistEntries')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .take(MINE_SCAN_LIMIT)
  ).filter((entry) => entry.status === 'waiting');

  const todayDate = today();
  const trainingOf = lookupOnce(async (id: Id<'trainings'>) => {
    const training = await ctx.db.get('trainings', id);
    if (!training) return null;
    const summary = await publishedProgramSummary(ctx, training.programId, training.organizationId);
    if (!summary) return null;
    const classes = await classesToAttend(ctx, id, todayDate);
    return classes.length === 0 ? null : { summary, classes };
  });
  const queueOf = lookupOnce(async (id: Id<'trainings'>) => {
    const found = await trainingOf(id);
    return found && (await waitingQueueOf(ctx, id, found.classes));
  });

  const rows: { creation: number; row: TrainingMineRow }[] = [];
  const add = async (
    held: Held,
    status: TrainingMineRow['status'],
    positionOf?: (queue: Doc<'trainingWaitlistEntries'>[]) => number,
  ) => {
    const found = await trainingOf(held.trainingId);
    if (!found) return;
    const next =
      held.classId === undefined
        ? found.classes[0]
        : found.classes.find((row) => row._id === held.classId);
    if (!next) return;
    const position = positionOf?.((await queueOf(held.trainingId)) ?? []);
    rows.push({
      creation: held._creationTime,
      row: {
        rowId: held._id,
        kind: held.classId === undefined ? 'series' : 'class',
        status,
        ...(position !== undefined && { position }),
        participant: held.participant,
        organizationName: found.summary.organizationName,
        organizationSlug: found.summary.organizationSlug,
        trainingName: found.summary.programName,
        trainingSlug: found.summary.programSlug,
        classDate: next.date,
        startTime: next.startTime,
        endTime: next.endTime,
        locations: found.summary.locations,
      },
    });
  };
  for (const registration of registrations) await add(registration, 'registered');
  for (const entry of entries) {
    await add(entry, 'waiting', (queue) => positionIn(queue, entry));
  }

  return rows
    .sort((a, b) => a.row.classDate.localeCompare(b.row.classDate) || a.creation - b.creation)
    .slice(0, UPCOMING_ROWS_LIMIT)
    .map(({ row }) => row);
}
